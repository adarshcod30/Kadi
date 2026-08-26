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
// STATUS: wired but not yet live. What is confirmed working, and what is not:
//   working  - endpoint, model id (crm-di-glm47b-30b-it), CATALYST-ORG header, and a
//              valid 70-char OAuth token taken from the x-zc-admin-cred-token that
//              Catalyst injects into every deployed function request.
//   failing  - the endpoint answers HTTP 400 PATTERN_NOT_MATCHED with
//              reason "Error in processing `zoho-inputstream` parameter", i.e. it does
//              not accept our request body. Ruled out: non-ASCII content (sanitised),
//              a manual Content-Length (removed), a missing token (obtained), and the
//              auth prefix (configurable).
//   note     - a Connection created in Cloud Scale cannot be read by the SDK's
//              app.connection(): that API is for self-managed connectors and demands
//              client_id/client_secret, erroring "client_id cannot be null" otherwise.
// Set QUICKML_ENABLED=true once the exact payload shape is confirmed with Zoho support.
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let catalyst = null;
try {
  catalyst = require('zcatalyst-sdk-node');
} catch {
  catalyst = null;
}

const ENDPOINT = process.env.QUICKML_LLM_ENDPOINT
  || 'https://api.catalyst.zoho.in/quickml/v1/project/55468000000013048/glm/chat';
const DEPLOYMENT_ID = process.env.QUICKML_LLM_DEPLOYMENT_ID || '';
const RAG_KB_ID = process.env.QUICKML_RAG_KB_ID || '';
// RAG has its own endpoint. The previous code posted the RAG body to the LLM-serving URL,
// which ignores knowledge_base_id entirely -- so even with a KB configured it would have
// answered from the model's own weights and looked like RAG was working.
// Confirmed against the console: POST .../quickml/v1/project/{id}/rag/answer,
// OAuth scope QuickML.rag.READ.
const RAG_ENDPOINT = process.env.QUICKML_RAG_ENDPOINT
  || `https://api.catalyst.zoho.in/quickml/v1/project/${process.env.CATALYST_PROJECT_ID || '55468000000013048'}/rag/answer`;
const CONNECTION = process.env.QUICKML_CONNECTION_NAME || 'kadi_quickml';
const TIMEOUT_MS = Number(process.env.QUICKML_TIMEOUT_MS || 12000);
// Model id and org header are what the console's own sample request uses.
// UNDERSCORES, not hyphens. The console's own sample request reads
// "model": "crm-di-glm47b_30b_it" -- we had been sending crm-di-glm47b-30b-it,
// which is what the 400 PATTERN_NOT_MATCHED was actually complaining about.
const MODEL = process.env.QUICKML_MODEL || 'crm-di-glm47b_30b_it';
const ORG = process.env.CATALYST_ORG_ID || '60078029367';
const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '55468000000013048';
// The console shows 'Zoho-oauthtoken' in Headers but 'Bearer' in the JS sample.
// The console is self-inconsistent: the Headers panel shows 'Zoho-oauthtoken' while the
// JS/Python samples both use 'Bearer'. The samples are the thing that was tested.
const AUTH_PREFIX = process.env.QUICKML_AUTH_PREFIX || 'Bearer';

// The assistant runs inside a 30s Function. A model call that hangs would burn the whole
// budget and return nothing, so it is capped well below and falls back on timeout.
const SYSTEM_PROMPT = 'You are KADI, an assistant for the Karnataka State Police crime records system. You are given FACTS from the case database and a QUESTION. Answer ONLY from the FACTS. Never invent an FIR number, name, count or date. If the FACTS do not answer it, say so. Be concise: two or three sentences. Never mention or infer caste, religion or occupation; they are excluded from every model here by design. Reply in the same language as the QUESTION.';

let lastError = null;
let tokenState = 'not-attempted';

// Explicit opt-in. The endpoint currently rejects our request body with
// PATTERN_NOT_MATCHED / "Error in processing `zoho-inputstream` parameter" (see the
// note at the top of this file), so leaving it on would add a doomed round-trip to
// every assistant call for no benefit. Set QUICKML_ENABLED=true to re-enable once the
// payload contract is confirmed with Zoho.
function configured() {
  return Boolean(ENDPOINT) && String(process.env.QUICKML_ENABLED || '').toLowerCase() === 'true';
}

function status() {
  return {
    configured: configured(),
    endpointSet: Boolean(ENDPOINT),
    deploymentIdSet: Boolean(DEPLOYMENT_ID),
    ragKbSet: Boolean(RAG_KB_ID),
    ragEndpoint: RAG_ENDPOINT,
    connectionSet: Boolean(CONNECTION),
    sdkLoaded: Boolean(catalyst),
    model: MODEL,
    tokenState,
    lastError,
  };
}

/**
 * OAuth token for QuickML.
 *
 * Note on the console Connection: the SDK's app.connection() is for *self-managed*
 * connectors - it wants client_id/client_secret/refresh_url supplied by the caller and
 * errors with "client_id cannot be null" when handed a console-created Connection. So a
 * Connection made in Cloud Scale is not consumable this way.
 *
 * What a deployed function does have is the credential Catalyst injects per request.
 * Prefer an explicit token from config, then that injected admin credential.
 */
async function accessToken(req) {
  if (process.env.QUICKML_ACCESS_TOKEN) {
    tokenState = 'env-token';
    return process.env.QUICKML_ACCESS_TOKEN;
  }
  const h = (req && req.headers) || {};
  const injected = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
  if (injected) {
    tokenState = `injected(${h['x-zc-admin-cred-token'] ? 'admin' : 'user'},len=${String(injected).length})`;
    return injected;
  }
  tokenState = 'no-credential-available';
  return null;
}

// The gateway in front of QuickML is strict about punctuation, so normalise the
// typographic characters our own templates produce while leaving real script
// characters (e.g. Kannada) untouched.
function asciiSafe(str) {
  return String(str)
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...');
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
        'CATALYST-ORG': ORG,
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
    const headers = token ? { Authorization: `${AUTH_PREFIX} ${token}` } : {};
    const body = {
      model: MODEL,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: asciiSafe(`FACTS:\n${facts}\n\nQUESTION (${lang}): ${question}`) },
      ],
      temperature: 0.2,
      max_tokens: 300,
      stream: false,
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
    const headers = token ? { Authorization: `${AUTH_PREFIX} ${token}` } : {};
    const body = {
      model: MODEL,
      chat_template_kwargs: { enable_thinking: false },
      knowledge_base_id: RAG_KB_ID,
      documents: [RAG_KB_ID],
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\nAnswer from the attached documents.` },
        { role: 'user', content: `QUESTION (${lang}): ${question}` },
      ],
      temperature: 0.1,
      max_tokens: 400,
      stream: false,
    };
    const out = await postJson(RAG_ENDPOINT, body, headers);
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

/**
 * List what the knowledge base currently holds.
 */
async function listDocuments(req) {
  const token = await accessToken(req);
  if (!token) return { ok: false, stage: 'token', tokenState };
  const base = `https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}`;
  const out = await new Promise((resolve) => {
    const u = new URL(`${base}/rag/documents`);
    const rq = https.request({
      hostname: u.hostname, path: u.pathname, method: 'GET',
      headers: { Authorization: `${AUTH_PREFIX} ${token}`, 'CATALYST-ORG': ORG, Accept: 'application/json' },
      timeout: 15000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    rq.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    rq.on('timeout', () => { rq.destroy(); resolve({ status: 0, body: 'timeout' }); });
    rq.end();
  });
  try {
    const j = JSON.parse(out.body);
    return { ok: out.status === 200, status: out.status, documents: j.documents || [] };
  } catch {
    return { ok: false, status: out.status, raw: out.body.slice(0, 300) };
  }
}

/**
 * Upload one document to the knowledge base.
 *
 * multipart/form-data, hand-built. The endpoint rejected every JSON shape with
 * LESS_THAN_MIN_OCCURANCE naming `documentName`, which is the signature of a form parameter
 * rather than a JSON field -- so the body is assembled here rather than pulling in a
 * form-data dependency for one call inside a function that must stay small.
 */
function uploadDocument(req, token, { name, content }) {
  const boundary = `----kadi${crypto.randomBytes(12).toString('hex')}`;
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="documentName"\r\n\r\n${name}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n`
      + `Content-Type: text/markdown\r\n\r\n${content}\r\n`,
    `--${boundary}--\r\n`,
  ];
  const body = Buffer.from(parts.join(''), 'utf8');
  const u = new URL(`https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}/rag/documents`);
  return new Promise((resolve) => {
    const rq = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        Authorization: `${AUTH_PREFIX} ${token}`,
        'CATALYST-ORG': ORG,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 25000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ name, status: res.statusCode, body: b.slice(0, 300) }));
    });
    rq.on('error', (e) => resolve({ name, status: 0, body: String(e.message) }));
    rq.on('timeout', () => { rq.destroy(); resolve({ name, status: 0, body: 'timeout' }); });
    rq.write(body); rq.end();
  });
}

/**
 * Push every bundled knowledge-base document.
 *
 * STATUS: blocked on scope, and worth recording rather than deleting.
 *
 * The multipart contract is right -- the endpoint stopped complaining about `documentName`
 * once the body was built as a form. What it returns instead is 401 INVALID_OAUTHSCOPE on
 * every POST, while GET /rag/documents answers 200 from the same credential. So the token
 * Catalyst injects into a deployed function carries QuickML.rag.READ and no write scope.
 *
 * This is the same shape as the Data Store DDL wall: the path is correct, the credential is
 * not privileged for it. Uploading is therefore a console action until a write scope is
 * granted, and this route stays so that the moment it is, the KB can be refreshed by the same
 * command that regenerates the documents rather than maintained by hand until it silently
 * disagrees with the product.
 */
async function syncKnowledgeBase(req) {
  const token = await accessToken(req);
  if (!token) return { ok: false, stage: 'token', tokenState };
  const dir = path.join(__dirname, '..', 'data', 'kb');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch {
    return { ok: false, reason: 'no bundled knowledge-base documents found' };
  }
  const results = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    // eslint-disable-next-line no-await-in-loop
    results.push(await uploadDocument(req, token, { name: f, content }));
  }
  const uploaded = results.filter((r) => r.status >= 200 && r.status < 300);
  const scopeBlocked = results.some((r) => r.status === 401 && /OAUTHSCOPE/i.test(r.body));
  return {
    ok: uploaded.length > 0,
    uploaded: uploaded.length,
    attempted: results.length,
    // Say which wall this is. A bare 401 reads as "broken"; naming the scope says the request
    // was correct and the credential was not, which is a different thing to go and fix.
    blocked: scopeBlocked ? 'QuickML rag write scope' : null,
    remedy: scopeBlocked
      ? 'The injected function credential holds QuickML.rag.READ only. Upload the documents in '
        + 'the QuickML console (RAG > Documents), or grant a write scope and re-run this.'
      : null,
    results: results.map((r) => ({ name: r.name, status: r.status, body: r.body.slice(0, 160) })),
  };
}

// Bypasses the QUICKML_ENABLED gate so the contract can be verified before the assistant// Bypasses the QUICKML_ENABLED gate so the contract can be verified before the assistant
// is switched onto it. Returns the raw upstream reply either way.
async function selfTest(req) {
  const token = await accessToken(req);
  if (!token) return { ok: false, stage: 'token', tokenState };
  const headers = { Authorization: `${AUTH_PREFIX} ${token}` };
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Reply with exactly: KADI OK' },
    ],
    max_tokens: 32,
    temperature: 0.2,
    stream: false,
    // GLM-4.7 is a reasoning model and narrates its deliberation into the answer unless
    // this is off. Asked to reply "KADI OK" it returned "1. **Analyze the User's Input:**...".
    chat_template_kwargs: { enable_thinking: false },
  };
  try {
    const out = await postJson(ENDPOINT, body, headers);
    return { ok: true, model: MODEL, authPrefix: AUTH_PREFIX, text: extractText(out),
      raw: JSON.stringify(out).slice(0, 400) };
  } catch (e) {
    return { ok: false, stage: 'post', model: MODEL, authPrefix: AUTH_PREFIX,
      error: (e && e.message ? e.message : String(e)).slice(0, 400) };
  }
}

// Generic completion. insight.js builds the prompt; this only transports it.
async function complete(req, { system, user, maxTokens = 220, temperature = 0.35 }) {
  const token = await accessToken(req);
  if (!token) return null;
  const out = await postJson(ENDPOINT, {
    model: MODEL,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: asciiSafe(system) },
      { role: 'user', content: asciiSafe(user) },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  }, { Authorization: `${AUTH_PREFIX} ${token}` });
  return extractText(out);
}

module.exports = {
  listDocuments, syncKnowledgeBase, configured, status, phrase, ragAnswer, selfTest, complete, SYSTEM_PROMPT };
