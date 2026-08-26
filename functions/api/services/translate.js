// translate.js — English to Kannada, and back, for a bilingual police interface.
//
// WHY THIS EXISTS AT ALL. The obvious answer was Zia, and Zia does not do it: a live probe of
// the SDK on this project returns object detection, OCR, barcode, face analysis, sentiment,
// keyword extraction and NER, and no translate, no speech-to-text, no text-to-speech. So
// translation runs on the QuickML LLM, which does it well, and speech runs in the browser.
//
// THE RULE THAT MATTERS MORE THAN FLUENCY. An FIR number, a case id, a district id and a
// person's name must survive translation byte for byte. A crime number rendered in Kannada
// numerals, or "Ramesh Kumar" transliterated and then transliterated back, is not a
// translation -- it is a corrupted record, and on a police system that is the difference
// between an officer finding a case and not. So identifiers are masked out before the model
// sees them and restored afterwards, rather than trusted to a prompt instruction.
//
// Batched and cached, because a UI dictionary is hundreds of short strings and paying an LLM
// round trip per label would make the language toggle unusable.
const crypto = require('crypto');
const quickml = require('./quickml');
const cache = require('./cache');

// Kannada runs roughly three times English in tokens, so a batch that looks small in
// characters can still overrun the completion limit -- and a truncated JSON array fails the
// length check and takes the whole batch down with it. Small batches plus recursive splitting
// beat one large call: the first pass at 25 strings returned nothing usable for 567 of 570.
const MAX_BATCH = 8;              // strings per model call
const MAX_CHARS = 900;            // and a character ceiling, whichever binds first
const MIN_SPLIT = 1;              // recurse down to single strings before giving up

const LANGS = { kn: 'Kannada', en: 'English' };

const SYSTEM = 'You are a translator for an Indian police records system. You are given a JSON '
  + 'array of short interface strings. Return ONLY a JSON array of the same length, in the same '
  + 'order, with each string translated.\n'
  + 'CRITICAL: some strings contain placeholders like {{a}} {{b}} {{c}}. Each placeholder stands '
  + 'for a number, a case id or a police code. You MUST copy every placeholder into your answer '
  + 'exactly as written, keeping every one of them, moved to wherever the target grammar needs '
  + 'it. Never delete a placeholder, never renumber one, never replace one with a number.\n'
  + 'Example. Input: ["Open {{a}} days - {{b}} the peer median ({{c}})"]  '
  + 'Output: ["{{a}} \u0ca6\u0cbf\u0ca8\u0c97\u0cb3\u0cbf\u0c82\u0ca6 \u0ca4\u0cc6\u0cb0\u0cc6\u0ca6\u0cbf\u0ca6\u0cc6 - '
  + '\u0cb8\u0cae\u0cbe\u0ca8 \u0caa\u0ccd\u0cb0\u0c95\u0cb0\u0ca3\u0c97\u0cb3 \u0cae\u0ca7\u0ccd\u0caf\u0cb8\u0ccd\u0ca5\u0ca6 {{b}} ({{c}})"]\n'
  + 'Other rules: keep it short enough to fit a button or a table header; use the term a police '
  + 'officer would use, not a literary one; if a string is already in the target language return '
  + 'it unchanged. Output the JSON array and nothing else - no explanation, no code fence.';

// Which placeholders a string carries, as a sorted signature. Used to refuse any translation
// that lost one.
const slots = (s) => (String(s).match(/\{\{\s*[a-z]+\s*\}\}/gi) || [])
  .map((x) => x.replace(/\s/g, '').toLowerCase()).sort().join(',');

// Tokens that must come back exactly as they went in: FIR and case numbers, ids, dates,
// percentages, anything with digits, and ALL-CAPS acronyms. Masked as {{0}}, {{1}} ... which
// the prompt is told to leave alone, and restored on the way out. Belt and braces: the
// restore step does not care whether the model obeyed.
// One number is one token, unit and all. The first version split "2.6x" into "2." and "6x"
// and did not match "501d" at all, so the tail of every figure was left for the model to
// reword -- which it did.
const PROTECT = new RegExp([
  // No whitespace before the unit and a lookahead after it, or "1283 days" matches
  // "1283 d" and leaves "ays" stranded in the sentence.
  '\\d+(?:[.,:/-]\\d+)*(?:%|x|d|km|m|hrs?|yrs?)?(?![a-zA-Z0-9])',
  '\\b[A-Z]{2,}[A-Z0-9_-]*\\b',                        // FIR, IPC, KSP, CL04818, LIVE-abc
].join('|'), 'g');

// Placeholders are LETTERS, not numbers, and that is not cosmetic.
//
// The first version used {{0}}, {{1}} -- and PROTECT matches any digit, so masking an already
// masked string mangled its own placeholders. Rows came back carrying each other's numbers:
// a case open 1283 days rendered as 2.5x when the source said 2.6x. On a police system that is
// a fabricated figure, not a formatting bug. Lowercase letters are matched by nothing in
// PROTECT, so masking is now genuinely idempotent.
const label = (i) => {
  let n = i; let s = '';
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};

function mask(text) {
  const kept = [];
  const masked = String(text).replace(PROTECT, (m) => {
    kept.push(m);
    return `{{${label(kept.length - 1)}}}`;
  });
  return { masked, kept };
}
function unmask(text, kept) {
  return String(text).replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (whole, code) => {
    let n = 0;
    const c = String(code).toLowerCase();
    for (let i = 0; i < c.length; i += 1) n = n * 26 + (c.charCodeAt(i) - 96);
    const idx = n - 1;
    // An index the model invented has no value to restore. Dropping the placeholder is right:
    // leaving "{{q}}" in an officer's reading is worse than a missing token.
    return kept[idx] !== undefined ? kept[idx] : '';
  });
}

// Keyed on the MASKED text, which is the single most valuable line in this file.
//
// A worklist renders sixty rows of "Open 1283 days - 2.6x the peer median (501d) for this
// crime type". Sixty distinct strings, sixty cache misses, sixty model calls -- for one
// sentence. Masked, they are all the same template, so it is one call and fifty-nine hits, and
// the digits are restored per row afterwards. This is what makes translating a data-heavy page
// affordable at all.
// Versioned. An earlier build stored translations that had silently dropped their
// placeholders, and a cache with no version is a cache you cannot correct -- every later
// request served the corrupt value back and looked like the bug had not been fixed. Bump this
// whenever the masking or the prompt changes in a way that invalidates what is stored.
const CACHE_VERSION = 'v2';
const keyFor = (maskedText, to) => {
  let h = 5381;
  const s = `${to}:${maskedText}`;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `tr${CACHE_VERSION}_${to}_${h.toString(36)}`;
};

// In-process memo on top of the shared cache. A page render asks for the same forty labels on
// every mount; this makes the second one free even before Cache is consulted.
const memo = new Map();

function parseArray(raw, expected) {
  if (!raw) return null;
  // The model is asked for bare JSON but sometimes fences it. Take the first array that parses.
  const cleaned = String(raw).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    // A short or long array means the model dropped or invented an item, and a
    // silently misaligned dictionary is worse than an untranslated one -- every label after
    // the drop would carry the wrong text.
    if (arr.length !== expected) return null;
    return arr.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
  } catch {
    return null;
  }
}

/**
 * Translate a batch of ALREADY-MASKED templates, and return them still masked.
 *
 * This function must not mask or unmask. It used to do both, and the second masking pass found
 * no numbers left to keep -- so the unmask that followed replaced every {{a}} with nothing and
 * deleted the very placeholders the model had correctly preserved. Restoring values is the
 * caller's job, because only the caller knows which row's numbers go back into which template.
 */
async function translateBatch(req, templates, to) {
  const payload = JSON.stringify(templates);
  const out = await quickml.complete(req, {
    system: SYSTEM,
    user: `Target language: ${LANGS[to] || to}\n${payload}`,
    // Generous, because Kannada is far more tokens per character than English and a truncated
    // final item fails the whole batch.
    maxTokens: Math.min(4000, 400 + payload.length * 6),
    temperature: 0.1,
  }).catch(() => null);
  const arr = parseArray(out, templates.length);
  if (!arr) return null;
  return arr.map((t, i) => {
    // A translation that dropped a placeholder would render as "Open  days - the peer median
    // ()" -- fluent Kannada with the numbers silently gone. On a police system a figure that
    // quietly disappears is worse than a sentence left in English, so this refuses it and the
    // caller falls back to the source.
    if (slots(t) !== slots(templates[i])) return null;
    return t;
  });
}

/**
 * Translate a batch, and on failure split it and try the halves.
 *
 * One over-long string in a batch of eight should cost that string, not the other seven. The
 * first version returned null for the whole batch and left 567 of 570 labels in English.
 */
async function translateBatchSplit(req, texts, to) {
  const done = await translateBatch(req, texts, to);
  // A batch where every item survived validation is finished. A batch where some items lost
  // their placeholders gets split, because alone the model tends to get them right.
  if (done && done.every((v) => v !== null)) return done;
  if (texts.length <= MIN_SPLIT) return done && done.some((v) => v !== null) ? done : null;
  const mid = Math.ceil(texts.length / 2);
  const [a, b] = await Promise.all([
    translateBatchSplit(req, texts.slice(0, mid), to),
    translateBatchSplit(req, texts.slice(mid), to),
  ]);
  if (!a && !b) return null;
  return [
    ...(a || new Array(mid).fill(null)),
    ...(b || new Array(texts.length - mid).fill(null)),
  ];
}

/**
 * Translate many strings at once.
 *
 * Returns { items: [{ source, text, translated }], engine, hits, misses }. Anything that fails
 * comes back as its source with translated:false, so a caller can always render something --
 * a half-translated interface is bad, a blank one is worse.
 */
async function translateMany(req, texts, to = 'kn') {
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || ''));
  if (!LANGS[to]) return { items: list.map((s) => ({ source: s, text: s, translated: false })), reason: 'unsupported language' };

  const result = new Array(list.length);
  // Mask every input up front, then work in masked space. Two rows that differ only in their
  // numbers become one unit of work.
  const masks = list.map(mask);
  const byTemplate = new Map();          // masked text -> { indices, key }
  let hits = 0;

  for (let i = 0; i < list.length; i += 1) {
    if (!list[i].trim()) { result[i] = { source: list[i], text: list[i], translated: true }; continue; }
    const t = masks[i].masked;
    if (!byTemplate.has(t)) byTemplate.set(t, { indices: [], key: keyFor(t, to) });
    byTemplate.get(t).indices.push(i);
  }

  const settle = (t, translatedMask) => {
    const { indices } = byTemplate.get(t);
    for (const i of indices) {
      result[i] = {
        source: list[i],
        text: translatedMask ? unmask(translatedMask, masks[i].kept) : list[i],
        translated: Boolean(translatedMask),
      };
    }
  };

  const pending = [];
  for (const [t, rec] of byTemplate.entries()) {
    // Validate on READ as well as on write. A stored value whose placeholders no longer match
    // the template is poison from an older masking scheme, and serving it would drop numbers
    // out of an officer's reading. Discard and re-translate rather than trust the cache.
    const usable = (v) => v && slots(v) === slots(t);
    if (memo.has(rec.key) && usable(memo.get(rec.key))) {
      settle(t, memo.get(rec.key)); hits += rec.indices.length; continue;
    }
    const cached = await cache.get(req, rec.key).catch(() => null);
    if (usable(cached)) { memo.set(rec.key, cached); settle(t, cached); hits += rec.indices.length; continue; }
    pending.push(t);
  }

  let engine = hits ? 'cache' : 'none';
  for (let start = 0; start < pending.length;) {
    const group = [];
    let chars = 0;
    while (start < pending.length && group.length < MAX_BATCH && chars < MAX_CHARS) {
      chars += pending[start].length + 8;
      group.push(pending[start]);
      start += 1;
    }
    // translateBatch masks again, which is a no-op on already-masked text: the placeholders
    // contain no digits or capitals for PROTECT to catch.
    const done = await translateBatchSplit(req, group, to);
    for (let j = 0; j < group.length; j += 1) {
      const t = group[j];
      const out = done && done[j];
      if (out) {
        engine = 'llm';
        memo.set(byTemplate.get(t).key, out);
        await cache.put(req, byTemplate.get(t).key, out).catch(() => {});
      }
      settle(t, out || null);
    }
  }

  for (let i = 0; i < result.length; i += 1) {
    if (!result[i]) result[i] = { source: list[i], text: list[i], translated: false };
  }
  return {
    items: result,
    engine,
    total: result.length,
    translated: result.filter((r) => r.translated).length,
    cacheHits: hits,
    // How much the masking bought. Sixty worklist rows collapsing to two templates is the
    // difference between this being usable and not.
    templates: byTemplate.size,
  };
}

/** One string, for the places that only need one. */
async function translateOne(req, text, to = 'kn') {
  const out = await translateMany(req, [text], to);
  return out.items[0];
}

module.exports = { translateMany, translateOne, LANGS, mask, unmask };
