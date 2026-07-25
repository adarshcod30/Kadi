// quickml.js — Catalyst QuickML adapter: GLM-4.7 LLM serving + RAG knowledge base.
//
// The assistant answers from the structured DB via a whitelisted set of query tools
// (see assistant.js). QuickML changes HOW the answer is worded, not WHERE the facts come
// from: the numbers and FIR citations are still produced locally, and the model is asked
// only to phrase them. That ordering is deliberate — it means the model cannot invent a
// case number, and the assistant keeps working unchanged when QuickML is unconfigured.
//
// Configuration (all optional; absent = disabled, and the caller falls back):
//   QUICKML_LLM_ENDPOINT      full URL of the deployed GLM-4.7 endpoint
//   QUICKML_LLM_DEPLOYMENT_ID deployment id, sent when the endpoint expects it
//   QUICKML_RAG_KB_ID         knowledge-base / document id for RAG answers
//   QUICKML_CONNECTION_NAME   Catalyst Connection holding scope quickml.deployment.read
//
// Auth: QuickML rejects anonymous calls. Credentials come from a Catalyst Connection,
// fetched through the SDK at call time so no token is ever stored in the repo.
const https = require('https');
const { URL } = require('url');

let catalyst = null;
try {
  catalyst = require('zcatalyst-sdk-node');
} catch {
  catalyst = null;
}

const ENDPOINT = process.env.QUICKML_LLM_ENDPOINT || '';
const DEPLOYMENT_ID = process.env.QUICKML_LLM_DEPLOYMENT_ID || '';
const RAG_KB_ID = process.env.QUICKML_RAG_KB_ID || '';
const CONNECTION = process.env.QUICKML_CONNECTION_NAME || '';
const TIMEOUT_MS = Number(process.env.QUICKML_TIMEOUT_MS || 12000);

// The assistant runs inside a 30s Function. A model call that hangs would burn the whole
// budget and return nothing, so it is capped well below and falls back on timeout.
const SYSTEM_PROMPT = `You are KADI, an assistant for the Karnataka State Police crime
records system. You will be given FACTS retrieved from the case database and a QUESTION.

Rules:
- Answer ONLY from the FACTS. Never invent an FIR number, name, count, or date.
- If the FACTS do not answer the question, say so plainly.
- Be concise: two or three sentences, in the register a police officer would use.
- Never mention or infer caste, religion, or occupation. They are excluded from every
  model in this system by design; if asked, say that exclusion is deliberate.
- Reply in the same language as the QUESTION (English or Kannada).`;

let lastError = null;

function configured() {
  return Boolean(ENDPOINT);
}

function status() {
  return {
    configured: configured(),
    endpointSet: Boolean(ENDPOINT),
    deploymentIdSet: Boolean(DEPLOYMENT_ID),
    ragKbSet: Boolean(RAG_KB_ID),
    connectionSet: Boolean(CONNECTION),
    sdkLoaded: Boolean(catalyst),
    lastError,
  };
}

/** Access token from the Catalyst Connection (never persisted). */
async function accessToken(req) {
  if (!catalyst || !CONNECTION || !req) return null;
  try {
    const app = catalyst.initialize(req, { scope: 'admin' });
    const conn = app.connection({ [CONNECTION]: { /* scopes configured in console */ } });
    const svc = conn.getConnector(CONNECTION);
    return await svc.getAccessToken();
  } catch (e) {
    lastError = `connection: ${e && e.message ? e.message : e}`;
    return null;
  }
}

function postJson(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(new Error(`bad QUICKML_LLM_ENDPOINT: ${urlStr}`));
    }
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`)); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Pull the answer text out of whichever response shape the endpoint returns. */
function extractText(res) {
  if (!res) return null;
  if (typeof res === 'string') return res;
  const c = res.choices && res.choices[0];
  if (c) {
    if (c.message && typeof c.message.content === 'string') return c.message.content;
    if (typeof c.text === 'string') return c.text;
  }
  for (const k of ['answer', 'output', 'response', 'result', 'content', 'text', 'raw']) {
    if (typeof res[k] === 'string') return res[k];
  }
  if (res.data) return extractText(res.data);
  return null;
}

/**
 * Rephrase locally-derived facts using GLM-4.7.
 * Returns null on any failure so the caller keeps its deterministic answer — a worse
 * sentence is always better than no answer, and never worth a 500.
 */
async function phrase(req, { question, facts, lang }) {
  if (!configured()) return null;
  try {
    const token = await accessToken(req);
    const headers = token ? { Authorization: `Zoho-oauthtoken ${token}` } : {};
    const body = {
      ...(DEPLOYMENT_ID ? { deployment_id: DEPLOYMENT_ID } : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `FACTS:\n${facts}\n\nQUESTION (${lang}): ${question}` },
      ],
      temperature: 0.2,
      max_tokens: 300,
    };
    const out = await postJson(ENDPOINT, body, headers);
    const text = extractText(out);
    if (text && text.trim()) {
      lastError = null;
      return text.trim();
    }
    lastError = 'empty response from QuickML';
    return null;
  } catch (e) {
    lastError = `phrase: ${e && e.message ? e.message : e}`;
    return null;
  }
}

/**
 * RAG answer over the uploaded knowledge base (IPC/BNS/SOP documents).
 * Separate from `phrase`: this one is allowed to answer from the documents rather than
 * from the case database, and says so to the caller so the UI can label the source.
 */
async function ragAnswer(req, { question, lang }) {
  if (!configured() || !RAG_KB_ID) return null;
  try {
    const token = await accessToken(req);
    const headers = token ? { Authorization: `Zoho-oauthtoken ${token}` } : {};
    const body = {
      ...(DEPLOYMENT_ID ? { deployment_id: DEPLOYMENT_ID } : {}),
      knowledge_base_id: RAG_KB_ID,
      documents: [RAG_KB_ID],
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\nAnswer from the attached documents.` },
        { role: 'user', content: `QUESTION (${lang}): ${question}` },
      ],
      temperature: 0.1,
      max_tokens: 400,
    };
    const out = await postJson(ENDPOINT, body, headers);
    const text = extractText(out);
    if (text && text.trim()) {
      lastError = null;
      return { answer: text.trim(), source: 'knowledge_base', kbId: RAG_KB_ID };
    }
    return null;
  } catch (e) {
    lastError = `rag: ${e && e.message ? e.message : e}`;
    return null;
  }
}

module.exports = { configured, status, phrase, ragAnswer, SYSTEM_PROMPT };
