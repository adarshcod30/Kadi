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
    enabled: ENABLED,
    sdkLoaded: Boolean(catalyst),
    kannadaSTT: KN_STT,
    kannadaTTS: KN_TTS,
    // What the client should do when Zia cannot serve a language directly.
    fallback: 'browser Web Speech API (client-side), already active',
    lastError,
  };
}

function zia(req) {
  if (!configured() || !req) return null;
  try {
    const app = catalyst.initialize(req, { scope: 'admin' });
    return app.zia();
  } catch (e) {
    lastError = `initialize: ${e && e.message ? e.message : e}`;
    return null;
  }
}

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

module.exports = { configured, status, speechToText, textToSpeech, translate, translateThenSpeak };
