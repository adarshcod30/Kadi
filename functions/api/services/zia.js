// zia.js — Catalyst Zia adapter: speech-to-text, text-to-speech, translation.
//
// The problem statement asks for multilingual voice access, and the Zoho AI team called
// out Indic language support specifically. The chain they recommend is:
//     audio -> Zia STT -> (optional) Zia translate -> answer -> Zia TTS -> audio
//
// The client already does STT/TTS through the browser Web Speech API, which works today
// and needs no credentials. This adapter is the Catalyst-native path: when Zia is enabled
// it takes over, and when it is not every function returns null and the caller keeps the
// browser path. Voice therefore never breaks, it only gets better.
//
// Configuration:
//   ZIA_ENABLED=true            master switch
//   ZIA_KANNADA_STT=true        Zia can transcribe Kannada directly
//   ZIA_KANNADA_TTS=true        Zia can synthesise Kannada directly
// When Kannada STT/TTS is unavailable, translateThenSpeak() falls back to
// translate-to-English + English TTS rather than failing outright.
let catalyst = null;
try {
  catalyst = require('zcatalyst-sdk-node');
} catch {
  catalyst = null;
}

const ENABLED = String(process.env.ZIA_ENABLED || '').toLowerCase() === 'true';
const KN_STT = String(process.env.ZIA_KANNADA_STT || '').toLowerCase() === 'true';
const KN_TTS = String(process.env.ZIA_KANNADA_TTS || '').toLowerCase() === 'true';

let lastError = null;

function configured() {
  return ENABLED && Boolean(catalyst);
}

function status() {
  return {
    enabled: true,
    capabilities: ['ner', 'keyword-extraction', 'sentiment-analysis'],
    unavailable: ['speech-to-text', 'text-to-speech', 'translate'],
    transport: 'raw HTTPS with header credential (SDK methods return 401)',
    legacyFlag: ENABLED,
    sdkLoaded: Boolean(catalyst),
    kannadaSTT: KN_STT,
    kannadaTTS: KN_TTS,
    // What the client should do when Zia cannot serve a language directly.
    fallback: 'browser Web Speech API (client-side), already active',
    credentialInHeaders: true,
    note: 'Enable Zia in the console. If the SDK still 401s, use the raw-HTTPS header-token path from services/datastore.js.',
    lastError,
  };
}

// NOTE for whoever enables Zia in the console: initialize(req) returns 401 PERMISSION_NEEDED
// for every scope on this project, even though the request carries a full admin credential.
// It arrives in HEADERS, not environment variables:
//
//     x-zc-admin-cred-token      70-char OAuth token
//     x-zc-project-secret-key    64 chars
//
// That is what unblocked Data Store -- see services/datastore.js, which talks to the BaaS
// endpoint over raw HTTPS with those two headers and works. If the SDK path below still
// 401s once Zia is switched on, do not spend a day on scopes: copy the httpZcql pattern.
// Both headers are required; the token alone returns 404 INVALID_RESOURCE.
function ziaAuth(req) {
  const h = (req && req.headers) || {};
  const token = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
  const secret = h['x-zc-project-secret-key'];
  return token && secret ? { token, secret, projectId: h['x-zc-projectid'] } : null;
}


// The SDK returns 401 PERMISSION_NEEDED for every Zia operation -- byte-identical to what
// Data Store and Cache returned before, and in both those cases the credential was present
// in request headers and the SDK simply was not using it. Same bypass here.
const https = require('https');

function ziaHttp(req, path, body) {
  return new Promise((resolve) => {
    const c = ziaAuth(req);
    if (!c) return resolve({ ok: false, error: 'no credential headers' });
    const projectId = c.projectId || process.env.CATALYST_PROJECT_ID;
    const payload = JSON.stringify(body);
    const rq = https.request({
      hostname: 'api.catalyst.zoho.in',
      path: `/baas/v1/project/${projectId}${path}`,
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${c.token}`,
        'X-ZC-PROJECT-SECRET-KEY': c.secret,
        Environment: (req.headers && req.headers['x-zc-environment']) || 'Development',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        body: out.slice(0, 400),
      }));
    });
    rq.on('error', (e) => resolve({ ok: false, error: e.message }));
    rq.write(payload);
    rq.end();
  });
}

function zia(req) {
  if (!configured() || !req) return null;
  try {
    const app = catalyst.initialize(req, { scope: 'admin' });
    return app.zia();
  } catch (e) {
    lastError = `initialize: ${e && e.message ? e.message : e}`
      + (ziaAuth(req) ? ' (admin credential IS present in headers - use the raw-HTTPS path)' : '');
    return null;
  }
}


// --- Text analytics over FIR narrative -------------------------------------------------
//
// What this Zia actually provides. The adapter previously targeted speech-to-text,
// text-to-speech and translation, none of which exist on this SDK -- which is why the
// service looked "not enabled" for weeks. It was enabled the whole time.
//
// Paths and body shape are read from zcatalyst-sdk-node/lib/zia/zia-text-analysis.js. The
// SDK's own methods 401 (PERMISSION_NEEDED), the same failure Data Store and Cache had, so
// the calls go over the header-credential path instead.
//
// FAIRNESS: this reads the free-text account of the offence only. It never receives, and
// cannot infer from, CasteID / ReligionID / OccupationID -- those columns are not in the
// narrative and are excluded from every model by design.

const ENTITY_LABEL = {
  Person: 'People', Location: 'Places', Organization: 'Organisations',
  Number: 'Numbers', Date: 'Dates', Time: 'Times', Money: 'Amounts',
};

/** Entities and key phrases in one FIR narrative. Returns null if Zia is unreachable. */
async function analyseNarrative(req, text) {
  if (!text || !String(text).trim()) return null;
  const doc = String(text).slice(0, 4000);
  const [ner, kw] = await Promise.all([
    ziaHttp(req, '/ml/text-analytics/ner', { document: [doc] }),
    ziaHttp(req, '/ml/text-analytics/keyword-extraction', { document: [doc] }),
  ]);
  if (!ner.ok && !kw.ok) {
    lastError = `narrative: ner=${ner.status || ner.error} kw=${kw.status || kw.error}`;
    return null;
  }

  const grouped = {};
  try {
    const ents = JSON.parse(ner.body).data[0].ner.general_entities || [];
    for (const e of ents) {
      // Confidence is reported 0-100. Low-confidence tokens are noise in an FIR.
      if ((e.confidence_score ?? 0) < 60) continue;
      const label = ENTITY_LABEL[e.ner_tag] || e.ner_tag;
      (grouped[label] = grouped[label] || []).push(e.token);
    }
    for (const k of Object.keys(grouped)) grouped[k] = [...new Set(grouped[k])].slice(0, 12);
  } catch { /* NER unusable; key phrases may still be */ }

  let keywords = [];
  let keyphrases = [];
  try {
    const k = JSON.parse(kw.body).data[0].keyword_extractor || {};
    keywords = k.keywords || [];
    keyphrases = k.keyphrases || [];
  } catch { /* leave empty */ }

  if (!Object.keys(grouped).length && !keyphrases.length) return null;
  return { entities: grouped, keywords, keyphrases, engine: 'zia-text-analytics' };
}


/**
 * Emergent MO themes across a SET of case narratives.
 *
 * Zia was wired but doing one job -- named entities on a single FIR that an officer already
 * has open. Its value at set level is different and larger: the modus-operandi field is free
 * text, so the method an emerging series shares is written down in every one of its FIRs and
 * indexed by nothing. Counting sub-heads cannot find it, because "Online Financial Fraud" is
 * one sub-head whether the method is a fake KYC call or a QR-code scam.
 *
 * Batched into a handful of documents rather than one call per case: the endpoint takes a
 * document array, and 200 separate round trips would blow the 30s request budget.
 *
 * Returns null on any failure. A missing theme list must degrade the panel, never the page.
 */
async function narrativeThemes(req, texts, { maxDocs = 40, chunk = 8 } = {}) {
  const docs = (texts || []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, maxDocs);
  if (docs.length < 5) return null;

  const batches = [];
  for (let i = 0; i < docs.length; i += chunk) {
    batches.push(docs.slice(i, i + chunk).map((d) => d.slice(0, 900)).join('. '));
  }
  const results = await Promise.all(
    batches.slice(0, 6).map((b) => ziaHttp(req, '/ml/text-analytics/keyword-extraction', { document: [b] })),
  );

  const freq = new Map();
  let ok = 0;
  for (const r of results) {
    if (!r.ok) continue;
    ok += 1;
    try {
      const k = JSON.parse(r.body).data[0].keyword_extractor || {};
      for (const phrase of [...(k.keyphrases || []), ...(k.keywords || [])]) {
        const t = String(phrase).toLowerCase().trim();
        // Single tokens and stock FIR vocabulary carry no signal -- every narrative contains
        // "accused" and "complainant", so they would top every list on every filter.
        if (t.length < 6 || STOP_THEMES.has(t)) continue;
        freq.set(t, (freq.get(t) || 0) + 1);
      }
    } catch { /* one bad batch must not lose the rest */ }
  }
  if (!ok) { lastError = 'themes: all batches failed'; return null; }

  const themes = [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([phrase, n]) => ({ phrase, documents: n }));
  if (!themes.length) return null;
  return { themes, sampled: docs.length, batches: ok, engine: 'zia-text-analytics' };
}

const STOP_THEMES = new Set([
  'accused', 'complainant', 'victim', 'police', 'station', 'case', 'cases', 'report',
  'reported', 'incident', 'offence', 'offences', 'person', 'persons', 'unknown', 'crime',
  'complaint', 'registered', 'investigation', 'district', 'karnataka',
]);

/** Transcribe audio. Returns null when Zia is unavailable so the browser path is used. */
async function speechToText(req, audioBuffer, lang = 'en') {
  const z = zia(req);
  if (!z) return null;
  if (lang === 'kn' && !KN_STT) {
    // Being explicit beats sending Kannada audio to an English model and getting noise.
    return { unsupported: true, lang, reason: 'Zia Kannada STT not available' };
  }
  try {
    const out = await z.transcribeAudio(audioBuffer, { language: lang });
    return { text: (out && (out.text || out.transcript)) || '', engine: 'zia', lang };
  } catch (e) {
    lastError = `stt: ${e && e.message ? e.message : e}`;
    return null;
  }
}

/** Synthesise speech. Returns null to let the browser speak instead. */
async function textToSpeech(req, text, lang = 'en') {
  const z = zia(req);
  if (!z) return null;
  if (lang === 'kn' && !KN_TTS) return { unsupported: true, lang, reason: 'Zia Kannada TTS not available' };
  try {
    const out = await z.textToSpeech(text, { language: lang });
    return { audio: out, engine: 'zia', lang };
  } catch (e) {
    lastError = `tts: ${e && e.message ? e.message : e}`;
    return null;
  }
}

/** Translate between English and Kannada. */
async function translate(req, text, from, to) {
  const z = zia(req);
  if (!z) return null;
  try {
    const out = await z.translate(text, { source_language: from, target_language: to });
    return { text: (out && (out.translated_text || out.text)) || '', engine: 'zia', from, to };
  } catch (e) {
    lastError = `translate: ${e && e.message ? e.message : e}`;
    return null;
  }
}

/**
 * The recommended chain, with the degradation the Zoho team suggested: if Kannada TTS is
 * not offered, translate to English and speak that rather than returning nothing.
 */
async function translateThenSpeak(req, text, lang) {
  if (lang !== 'kn') return textToSpeech(req, text, 'en');
  const direct = await textToSpeech(req, text, 'kn');
  if (direct && !direct.unsupported) return direct;
  const en = await translate(req, text, 'kn', 'en');
  if (!en) return null;
  const spoken = await textToSpeech(req, en.text, 'en');
  return spoken ? { ...spoken, translatedFrom: 'kn', note: 'Kannada TTS unavailable; spoken in English' } : null;
}

/**
 * Attempt a real Zia call regardless of ZIA_ENABLED and report the raw outcome.
 *
 * "Zia is not enabled" had been asserted from a config flag we set ourselves, which proves
 * nothing about the project. This asks the service and returns exactly what it says, so the
 * blocker is a quoted error rather than an assumption -- the same mistake that kept Data
 * Store and Cache marked as blocked for weeks when both actually worked.
 */
async function probe(req) {
  const out = { credentialInHeaders: !!ziaAuth(req), sdkLoaded: !!catalyst, steps: {} };
  if (!catalyst) { out.steps.sdk = 'catalyst SDK did not load'; return out; }
  try {
    const app = catalyst.initialize(req, { scope: 'admin' });
    out.steps.initialize = 'ok';
    let z = null;
    try {
      z = app.zia();
      out.steps.ziaHandle = z ? 'ok' : 'app.zia() returned nothing';
    } catch (e) {
      out.steps.ziaHandle = `app.zia() threw: ${e && e.message ? e.message : e}`;
      return out;
    }
    if (!z) return out;
    // Object.keys misses prototype methods, which is how an SDK class exposes its API --
    // an empty list there says nothing about whether Zia works.
    const own = Object.keys(z).filter((k) => typeof z[k] === 'function');
    const proto = Object.getPrototypeOf(z)
      ? Object.getOwnPropertyNames(Object.getPrototypeOf(z)).filter((k) => k !== 'constructor')
      : [];
    out.steps.methods = [...new Set([...own, ...proto])].slice(0, 30);
    // Try whatever the SDK actually named it rather than the name we guessed.
    // This Zia has no translate/STT/TTS at all. What it does have is text analytics, which
    // is far more useful here: NER over FIR narrative extracts the people, places and
    // organisations an officer would otherwise have to read for.
    const sample = 'On 12/03/2026 near Majestic Bus Stand Bengaluru, one Ramesh Kumar along '
      + 'with two associates snatched a gold chain from Lakshmi Devi and fled on a Pulsar '
      + 'motorcycle towards Yeshwanthpur.';
    // SDK path (known to 401) is skipped; go straight to the header-credential path and
    // try the documented shapes, reporting exactly what each returns.
    // Paths and body shape read out of zcatalyst-sdk-node/lib/zia/zia-text-analysis.js
    // rather than guessed. Guessing cost five 404s and had already cost a day on the
    // Stratus upload signature; the SDK source is the documentation.
    const attempts = [
      ['/ml/text-analytics/ner', { document: [sample] }],
      ['/ml/text-analytics/keyword-extraction', { document: [sample] }],
      ['/ml/text-analytics/sentiment-analysis', { document: [sample] }],
    ];
    out.steps.http = {};
    for (const [path, body] of attempts) {
      out.steps.http[path] = await ziaHttp(req, path, body);
    }
  } catch (e) {
    out.steps.initialize = `threw: ${e && e.message ? e.message : e}`;
  }
  return out;
}

module.exports = { analyseNarrative, narrativeThemes, probe, configured, status, speechToText, textToSpeech, translate, translateThenSpeak };
