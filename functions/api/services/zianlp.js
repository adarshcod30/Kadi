// zianlp.js — Zia's trained NLP models: translation, speech-to-text, text-to-speech.
//
// A CORRECTION WORTH RECORDING. An earlier probe concluded that "Zia does not translate on this
// project" and that speech had to run in the browser. That probe was of the Zia SDK
// (`catalyst.zia()`), which exposes object detection, OCR, barcode, face analysis, sentiment,
// keyword extraction and NER -- and genuinely has none of these. But Catalyst ships them
// somewhere else entirely: as QuickML **Trained NLP Models**, under a different host path and
// with their own endpoints. Same platform, different surface. The conclusion was right about
// the SDK and wrong about the platform, and translate.js was built on the LLM as a result.
//
// WHY THESE ARE BETTER THAN WHAT THEY REPLACE.
//
//   translate  A purpose-built translation model beats a general LLM asked to translate: it
//              does not editorialise, does not drop placeholders, and answers in milliseconds
//              rather than seconds. The LLM stays as the fallback.
//   tts        The browser's speechSynthesis has no Kannada voice on most machines, which is
//              why the assistant had to say so and stay silent. This has three Kannada
//              speakers and returns WAV, so read-aloud works everywhere.
//   stt        Browser SpeechRecognition is Chrome-only and its Kannada support is patchy.
//              This takes an audio file and returns text for en, hi and kn.
//
// All three carry OAuth scope QuickML.deployment.READ and take the same credential the rest of
// the QuickML surface does.
const https = require('https');
const quickml = require('./quickml');

const HOST = process.env.ZIA_NLP_HOST || 'api.catalyst.zoho.in';
const BASE = process.env.ZIA_NLP_BASE || '/quickml/api/v1/models/zia';
const ORG = process.env.CATALYST_ORG_ID || '60078029367';
const TIMEOUT_MS = Number(process.env.ZIA_NLP_TIMEOUT_MS || 12000);

// What each model actually supports, per the console. Kept here so a caller can refuse a
// language before spending a round trip finding out.
const TRANSLATE_LANGS = ['en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa', 'or'];
const SPEECH_LANGS = ['en', 'hi', 'kn'];
// THE ROSTER THE ENDPOINT ACTUALLY HAS, WHICH IS NOT THE ONE THE CONSOLE DOCUMENTS.
//
// The console's model card lists English male as Thomas, Adam, Brian. Asking for Thomas returns
//
//     400 {"message":"Speaker 'Thomas' is not available for language 'en'."}
//
// while David and Emma -- documented nowhere -- return valid audio. Every one of the twelve was
// called to find this out, and a nonsense name was called too, to confirm the endpoint really
// validates rather than silently substituting a default. Hindi and Kannada match their card.
//
// Recorded here because the documentation is the thing a reader would trust, and on this point
// it is wrong.
const SPEAKERS = {
  en: { male: ['Adam', 'Brian', 'David'], female: ['Mary', 'Anna', 'Beth', 'Emma'] },
  hi: { male: ['Rohit', 'Aman'], female: ['Divya', 'Rani'] },
  kn: { male: ['Suresh', 'Chetan'], female: ['Anu', 'Vidya'] },
};
// What the model accepts alongside a speaker. All three were sitting unused: every request went
// out moderate/moderate/neutral, which is the flattest combination on offer and a fair part of
// why the voice was described as robotic.
const PITCH = ['low', 'moderate', 'high'];
const SPEED = ['slow', 'moderate', 'fast'];
const EMOTION = ['neutral', 'happy', 'sad', 'angry'];

let lastError = null;
const errors = {};

/**
 * One attempt. Callers go through `requestRetry`, which is where the 502 handling lives.
 */
function request(path, { method = 'POST', body, contentType = 'application/json', token, raw = false }) {
  return new Promise((resolve) => {
    const payload = contentType === 'application/json' ? JSON.stringify(body) : body;
    const rq = https.request({
      hostname: HOST,
      path: `${BASE}${path}`,
      method,
      headers: {
        'Content-Type': contentType,
        'CATALYST-ORG': ORG,
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastError = `${path} http ${res.statusCode}: ${buf.toString('utf8').slice(0, 200)}`;
          errors[path] = lastError;
          return resolve(null);
        }
        // TTS answers audio/wav, so the caller gets bytes rather than a parse attempt.
        if (raw) return resolve(buf);
        try { resolve(JSON.parse(buf.toString('utf8'))); } catch (e) {
          lastError = `${path} parse: ${e.message}`;
          errors[path] = lastError;
          resolve(null);
        }
      });
    });
    rq.on('timeout', () => { lastError = `${path} timeout`; errors[path] = lastError; rq.destroy(); resolve(null); });
    rq.on('error', (e) => { lastError = `${path} net: ${e.message}`; errors[path] = lastError; resolve(null); });
    rq.write(payload);
    rq.end();
  });
}

/**
 * Retry on a 5xx, because this upstream returns them under load rather than as a verdict.
 *
 * Measured: the same Kannada sentence succeeds three times running at ~4.3s, while a longer one
 * comes back 502 from nginx -- an upstream timeout on a cold model worker, not a rejection of
 * the request. One retry after a short pause turns most of those into the 200 they should have
 * been. A 4xx is a real answer about the body and is never retried.
 */
async function requestRetry(path, opts, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const out = await request(path, opts);
    if (out) return out;
    const err = String(errors[path] || '');
    // Only a gateway/server error is worth repeating. A 400 says the body is wrong and will
    // stay wrong.
    if (!/http 5\d\d/.test(err)) return null;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  return null;
}

/**
 * Translate one string. Returns null on any failure so the caller can fall back.
 *
 * The response shape is not pinned down by the console page, so several documented spellings
 * are accepted rather than guessing one and silently returning nothing.
 */
async function translate(req, text, from, to) {
  if (!TRANSLATE_LANGS.includes(to)) return null;
  const token = await quickml.accessToken(req);
  if (!token) { lastError = 'no oauth token'; return null; }
  // Exactly these three keys. The first attempt also sent source_language/target_language on
  // the theory that extra fields are harmless, and the model answered 400
  // LESS_THAN_MIN_OCCURANCE -- it validates the body strictly. Read from the console's
  // Sample Request rather than guessed.
  const out = await requestRetry('/translate', {
    token,
    body: { text: String(text), src_lang: from, tgt_lang: to },
  });
  if (!out) return null;
  const translated = out.translated_text || (out.data && out.data.translated_text);
  return translated ? String(translated) : null;
}

/**
 * Speak text. Returns { audio: Buffer, mime } or null.
 *
 * This is what makes Kannada read-aloud work at all: the browser has no Kannada voice on most
 * machines, and an English voice reading Kannada text produces noise, not an accent.
 */
async function speak(req, text, { lang = 'en', speaker, pitch = 'moderate', speed = 'moderate', emotion = 'neutral' } = {}) {
  if (!SPEECH_LANGS.includes(lang)) return null;
  const token = await quickml.accessToken(req);
  if (!token) { lastError = 'no oauth token'; return null; }
  const voice = speaker || (SPEAKERS[lang] && SPEAKERS[lang].female[0]) || undefined;
  // Capped well below what the model accepts. Long input is what pushes the upstream past the
  // gateway timeout and returns 502; a spoken answer that runs past a couple of hundred
  // characters is not being listened to anyway.
  const buf = await requestRetry('/tts/synthesize', {
    token,
    raw: true,
    body: {
      text: String(text).slice(0, 600),
      language: lang,
      speaker: voice,
      pitch,
      speed,
      emotion,
    },
  });
  if (!buf || !buf.length) return null;
  // A JSON error body can arrive with a 200 on some Zoho surfaces. Audio does not start with
  // '{', so this catches it before an error string is handed to an <audio> element.
  if (buf[0] === 0x7b) {
    lastError = `tts returned json: ${buf.toString('utf8').slice(0, 160)}`;
    return null;
  }
  return { audio: buf, mime: 'audio/wav', lang, speaker: voice };
}

/**
 * Transcribe audio. `audio` is a Buffer; `filename` only shapes the multipart part name.
 *
 * multipart/form-data is assembled by hand because the function bundle carries no form-data
 * dependency and this is the only place that needs one.
 */
async function transcribe(req, audio, { lang = 'en', filename = 'audio.wav', mime = 'audio/wav' } = {}) {
  if (!SPEECH_LANGS.includes(lang)) return null;
  const token = await quickml.accessToken(req);
  if (!token) { lastError = 'no oauth token'; return null; }
  const boundary = `----kadi${Date.now().toString(36)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n`
    + `Content-Type: ${mime}\r\n\r\n`, 'utf8',
  );
  const langPart = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${lang}\r\n`
    + `--${boundary}--\r\n`, 'utf8',
  );
  const body = Buffer.concat([head, audio, langPart]);
  const out = await requestRetry('/audio/transcribe', {
    token,
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  });
  if (!out) return null;
  const d = out.data || out.result || out;
  const text = d.text || d.transcript || d.transcription || d.output
    || (Array.isArray(d) && d[0] && (d[0].text || d[0].transcript));
  return text ? String(text) : null;
}

function status() {
  return {
    host: HOST,
    base: BASE,
    models: {
      translate: { path: `${BASE}/translate`, languages: TRANSLATE_LANGS },
      tts: { path: `${BASE}/tts/synthesize`, languages: SPEECH_LANGS, speakers: SPEAKERS },
      stt: { path: `${BASE}/audio/transcribe`, languages: SPEECH_LANGS },
    },
    lastError,
    errors,
    note: 'Zia trained NLP models, reached through the QuickML model surface -- NOT the Zia SDK, '
      + 'which has no translate, STT or TTS on this project. Different surface, same platform.',
  };
}

/** Try all three with a known input and report exactly what each returns. */
async function probe(req) {
  const out = {};
  const t0 = Date.now();
  out.translate = await translate(req, 'Which cases are slipping?', 'en', 'kn');
  out.translateMs = Date.now() - t0;
  const t1 = Date.now();
  const spoken = await speak(req, 'ಎರಡು ಪ್ರಕರಣಗಳು ವಿಳಂಬವಾಗಿವೆ', { lang: 'kn' });
  out.tts = spoken ? { bytes: spoken.audio.length, mime: spoken.mime, speaker: spoken.speaker } : null;
  out.ttsMs = Date.now() - t1;
  out.errors = errors;
  return out;
}

module.exports = {
  SPEAKERS, PITCH, SPEED, EMOTION,
  translate, speak, transcribe, status, probe,
  TRANSLATE_LANGS, SPEECH_LANGS, SPEAKERS,
};
