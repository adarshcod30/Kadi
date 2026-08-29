// vlm.js — reading a document or a photograph, with Qwen 3.6 35B Vision Language.
//
// WHAT THIS IS FOR, AND WHAT IT IS CAREFULLY NOT FOR.
//
// An officer holds paper. A seizure memo, a handwritten complaint, a notice, a registration
// plate in a scene photograph, a page of a case diary. None of it is in the database, and the
// gap between "I have this in my hand" and "it is in the register" is where an hour goes.
// This model reads an image and answers a question about it, so that gap costs a photograph.
//
// IT IS NOT AN IDENTIFICATION SYSTEM. It is not asked who a person is, and it must never be:
// no face matching, no identification of individuals from photographs, no inference about a
// person's community, and nothing that would put a name to a face that the register did not
// already carry. The system prompt says so, the route refuses the obvious phrasings, and the
// reason is not squeamishness -- an identification produced by a general vision model, in a
// police file, is a wrong answer with a uniform behind it.
//
// GROUNDING. Everything this returns is grounded in ONE image the user supplied in this
// request. It is never mixed with the case database, never stored, and the answer is labelled
// `source: 'document'` so a reader can see that it came from a photograph rather than from the
// register. The model is told to say when the image does not show the answer, and that
// instruction is the whole anti-hallucination story here: a vision model asked "what is the
// FIR number" on an image with no FIR number will invent a plausible one unless told not to.
const https = require('https');
const quickml = require('./quickml');

const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '55468000000013048';
const ENDPOINT = process.env.QUICKML_VLM_ENDPOINT
  || `https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}/vlm/chat`;
const MODEL = process.env.QUICKML_VLM_MODEL || 'VL-Qwen3.6-35B-A3B';
const ORG = process.env.CATALYST_ORG_ID || '60078029367';
const TIMEOUT_MS = Number(process.env.QUICKML_VLM_TIMEOUT_MS || 25000);
const MAX_BYTES = Number(process.env.QUICKML_VLM_MAX_BYTES || 6 * 1024 * 1024);

// Refused outright rather than passed through and hoped about. These are the phrasings that
// turn a document reader into an identification system.
const FORBIDDEN = [
  /\bwho\s+is\s+(this|the|that)\s*(person|man|woman|guy|girl|boy|suspect|accused)?\b/i,
  /\bidentif(y|ication)\b.*\b(person|face|man|woman|suspect|accused|individual)\b/i,
  /\b(match|recognise|recognize)\b.*\bface\b/i,
  /\bwhat (caste|religion|community)\b/i,
  /\b(caste|religion)\s+of\b/i,
];

const SYSTEM_PROMPT = [
  'You read documents and photographs for a police records system in Karnataka, India.',
  'Answer ONLY from what is visible in the image provided.',
  'If the image does not contain the answer, say exactly what is missing. Never guess a',
  'number, a name, a date or a registration mark that you cannot actually read — an invented',
  'FIR number or plate is worse than no answer.',
  'If handwriting or print is unclear, say it is unclear and give your best reading marked',
  'as uncertain.',
  'Never identify a person, never infer caste, religion or community, and never speculate',
  'about guilt.',
  'Be concise and factual.',
].join(' ');

let lastError = null;
let lastUsed = null;

function configured() {
  return Boolean(ENDPOINT && MODEL);
}

/** The reason a request is refused, or null when it is allowed. */
function refuse(prompt) {
  const p = String(prompt || '');
  for (const re of FORBIDDEN) {
    if (re.test(p)) {
      return 'This assistant reads documents; it does not identify people from photographs. '
        + 'Ask what the document says instead.';
    }
  }
  return null;
}

function postJson(body, token) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(ENDPOINT); } catch { lastError = 'bad vlm url'; return resolve(null); }
    const payload = JSON.stringify(body);
    const rq = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Zoho-oauthtoken ${token}`,
        'CATALYST-ORG': ORG,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastError = `http ${res.statusCode}: ${out.slice(0, 200)}`;
          return resolve(null);
        }
        try { resolve(JSON.parse(out)); } catch (e) { lastError = `parse: ${e.message}`; resolve(null); }
      });
    });
    rq.on('timeout', () => { lastError = 'timeout'; rq.destroy(); resolve(null); });
    rq.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    rq.write(payload);
    rq.end();
  });
}

/**
 * Ask a question about one image.
 *
 * Returns { answer, model, metrics } or null. Never throws: every caller treats a null as
 * "the document reader is unavailable" and says so, rather than falling back to a text model
 * that cannot see the image and would answer from nothing.
 */
async function readImage(req, imageBuffer, prompt, { maxTokens = 700 } = {}) {
  if (!configured()) { lastError = 'vlm not configured'; return null; }
  if (!imageBuffer || !imageBuffer.length) { lastError = 'no image'; return null; }
  if (imageBuffer.length > MAX_BYTES) {
    lastError = `image too large (${imageBuffer.length} bytes, limit ${MAX_BYTES})`;
    return null;
  }
  const token = await quickml.accessToken(req).catch(() => null);
  if (!token) { lastError = 'no oauth token'; return null; }

  const out = await postJson({
    prompt: String(prompt || 'Describe what this document says.').slice(0, 2000),
    model: MODEL,
    images: [imageBuffer.toString('base64')],
    system_prompt: SYSTEM_PROMPT,
    top_k: 50,
    top_p: 0.9,
    // Low rather than the sample's 0.7. This reads evidence: the same photograph asked the
    // same question twice should not produce two different registration numbers.
    temperature: 0.1,
    max_tokens: maxTokens,
  }, token);
  if (!out) return null;

  // The console's sample wraps the answer in a fenced block when it was asked for JSON. Strip
  // the fence if it is there and leave the content alone otherwise.
  const raw = out.response || out.answer || out.text || '';
  const answer = String(raw).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  if (!answer) { lastError = `no answer in reply ${JSON.stringify(out).slice(0, 160)}`; return null; }
  lastError = null;
  lastUsed = new Date().toISOString();
  return {
    answer,
    model: out.model || MODEL,
    metrics: out.metrics || null,
    requestId: out.request_id || null,
  };
}

function status() {
  return {
    task: 'document and photograph reading — answers a question about one image the user supplied',
    model: MODEL,
    endpoint: ENDPOINT,
    configured: configured(),
    maxBytes: MAX_BYTES,
    lastUsed,
    lastError,
    grounding: 'the single image in the request, and nothing else — never mixed with the case '
      + 'database, never stored',
    refuses: 'identification of people, face matching, and any question about caste, religion '
      + 'or community',
  };
}

module.exports = { readImage, refuse, configured, status, SYSTEM_PROMPT, MAX_BYTES };
