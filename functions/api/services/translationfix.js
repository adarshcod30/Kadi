// translationfix.js — letting a Kannada speaker correct the machine's Kannada.
//
// WHY THIS EXISTS. Every Kannada string in this product was written by a machine. kn.json holds
// 1,100 of them and not one has been read by a native speaker. That has been listed as a known
// limitation since the language toggle shipped, which is an honest thing to say and does
// nothing at all about it — a limitation that can only be fixed by an offline process nobody
// has scheduled is a limitation that stays.
//
// The fix is not to find a reviewer. It is to make the review something that can happen a
// sentence at a time, by the officers already reading the Kannada interface, at the moment they
// notice a word is wrong. That is the only version of this review that ever actually happens.
//
// FOUR DECISIONS:
//
//   1. A CORRECTION APPLIES IMMEDIATELY. No approval queue. An approval queue for interface
//      wording means the queue becomes the bottleneck and the review dies in it — and unlike a
//      case record, a label is not a claim about a person. Every correction is attributed and
//      audited, and any string's history is visible, which is the accountability that matters
//      here.
//
//   2. NOTHING IS EDITED IN PLACE. A new correction SUPERSEDES the previous one; the old row
//      stays. So the history of a string is readable, a bad correction can be answered with a
//      better one, and "who changed this and what did it say before" always has an answer.
//
//   3. THE KEY IS A HASH, NOT THE TEXT. Catalyst capped the sourceText column at 255
//      characters and the longest interface copy in this product is well past that — and long
//      paragraphs are exactly where machine translation goes wrong most, so excluding them
//      would exclude the strings that need review. The full English is stored in a text column
//      and matched on its SHA256.
//
//   4. ANY SIGNED-IN OFFICER MAY CORRECT. Not just administrators. The people who read the
//      Kannada interface all day are station officers, and they are the ones who know that a
//      word is technically a translation and not what anybody in a police station calls that
//      thing. Restricting this to the state tier would restrict it to the people least likely
//      to use the Kannada UI.
const crypto = require('crypto');
const datastore = require('./datastore');

const TABLE = 'TranslationFix';

const mintKey = () => `t${crypto.randomBytes(11).toString('hex')}`;
const esc = (v) => String(v == null ? '' : v).replace(/'/g, "''");
const nowIso = () => new Date().toISOString();
const trim = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** The stable identity of an English string, independent of how long it is. */
const hash = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

const SELECT = 'SELECT ROWID, fixKey, sourceText, sourceFull, sourceHash, kannada, machineText, '
  + `note, fixStatus, fixedBy, fixerRole, fixedAt FROM ${TABLE}`;

function map(r) {
  return {
    id: String(r.fixKey || r.ROWID),
    source: r.sourceFull || r.sourceText,
    hash: r.sourceHash,
    kannada: r.kannada || '',
    machineText: r.machineText || '',
    note: r.note || '',
    status: r.fixStatus || 'active',
    fixedBy: r.fixedBy,
    fixerRole: r.fixerRole,
    fixedAt: r.fixedAt,
  };
}

/**
 * Every correction currently in force, as a map the interface can lay over its dictionary.
 *
 * Returned as { english: kannada } rather than as rows, because that is the shape the caller
 * uses and building it here means the browser is not handed 1,100 objects to reduce on every
 * page load.
 */
// ZCQL refuses any LIMIT above 300 -- "ZCQL CANNOT HAVE MORE THAN 300 ROWS in LIMIT", which is
// an error rather than a silent truncation, so a single big query returns NOTHING. It supports
// `LIMIT offset, count`, so this pages. Capped at ten pages: 3,000 corrections is far past the
// 1,133 strings in the interface, and an unbounded loop against a paging API is how one bad row
// turns into a function timeout.
const PAGE = 300;
const MAX_PAGES = 10;

async function pagedActive(req) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await datastore.query(req,
      `${SELECT} WHERE fixStatus = 'active' ORDER BY fixedAt DESC LIMIT ${page * PAGE}, ${PAGE}`, TABLE);
    if (rows === null) return page === 0 ? null : all;   // first page failing means unavailable
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function overrides(req) {
  const rows = await pagedActive(req);
  if (!rows) return { map: {}, count: 0, available: false };
  const out = {};
  // Newest first, so the first row seen for a hash is the one in force. A later row for the
  // same string is an older correction that a newer one superseded.
  const seen = new Set();
  for (const r of rows) {
    const h = r.sourceHash;
    if (!h || seen.has(h)) continue;
    seen.add(h);
    const src = r.sourceFull || r.sourceText;
    if (src && r.kannada) out[src] = r.kannada;
  }
  return { map: out, count: Object.keys(out).length, available: true };
}

/** Every correction ever written for one string, newest first — the string's own history. */
async function historyFor(req, source) {
  const h = hash(source);
  const rows = await datastore.query(req,
    `${SELECT} WHERE sourceHash = '${esc(h)}' ORDER BY fixedAt DESC LIMIT 0, 50`, TABLE);
  if (!rows) return [];
  return rows.map(map);
}

/** The most recent corrections across all strings, for the review screen's activity list. */
async function recent(req, { limit = 50 } = {}) {
  // 300 is ZCQL's hard ceiling on LIMIT, and exceeding it is an error rather than a truncation.
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await datastore.query(req,
    `${SELECT} ORDER BY fixedAt DESC LIMIT 0, ${n}`, TABLE);
  if (!rows) return [];
  return rows.map(map);
}

/**
 * Write a correction.
 *
 * Supersedes rather than edits: the previous active row for this string is marked superseded
 * and a new row is inserted. Two writes rather than one, and worth it — an interface string
 * whose history is "it says this now" cannot answer who changed it or what it said before.
 */
async function submit(req, user, body = {}) {
  // NOT trimmed. Every other field here is something a person typed and should be tidied; the
  // source is a LOOKUP KEY and has to survive byte for byte. The interface looks a string up by
  // its exact text, so a correction stored against a trimmed copy of a string that has
  // surrounding whitespace would be saved, reported as saved, and never match anything.
  const source = String(body.source == null ? '' : body.source).slice(0, 9000);
  if (!source.trim()) return { ok: false, error: 'Nothing to correct.', status: 400 };
  const kannada = trim(body.kannada, 9000);
  if (!kannada) return { ok: false, error: 'Write the Kannada.', status: 400 };
  // A "correction" in Latin script is somebody typing in the wrong box. Kannada occupies
  // U+0C80..U+0CFF; requiring at least one character from it costs nothing and catches the
  // mistake at the point it is made rather than after it is live for everyone.
  if (!/[ಀ-೿]/.test(kannada)) {
    return { ok: false, error: 'That does not contain any Kannada.', status: 400 };
  }
  if (kannada === trim(body.machineText, 9000)) {
    return { ok: false, error: 'That is what it already says.', status: 400 };
  }

  const h = hash(source);
  // Supersede first. If the insert then fails the string falls back to the machine wording,
  // which is a worse translation but never a wrong attribution — the alternative ordering can
  // leave two rows both claiming to be in force.
  await datastore.query(req,
    `UPDATE ${TABLE} SET fixStatus='superseded' WHERE sourceHash='${esc(h)}' AND fixStatus='active'`);

  const key = mintKey();
  const written = await datastore.insertRows(req, TABLE, [{
    fixKey: key,
    sourceHash: h,
    sourceFull: source,
    sourceText: source.slice(0, 250),
    kannada,
    machineText: trim(body.machineText, 9000),
    note: trim(body.note, 250),
    fixStatus: 'active',
    fixedBy: trim(user.email || user.appUserId || user.role, 160),
    fixerRole: user.role,
    fixedAt: nowIso(),
  }]);
  if (!written) return { ok: false, error: 'Could not save the correction.', status: 503 };
  return { ok: true, id: key, source, kannada };
}

/**
 * Put a string back to the machine wording.
 *
 * Implemented as superseding the active correction rather than deleting it, for the same reason
 * everything else here is: the row is how anyone later finds out that a correction was made and
 * then taken back.
 */
async function revert(req, user, source) {
  // Same reason as submit(): the source is a key, not prose.
  const src = String(source == null ? '' : source).slice(0, 9000);
  if (!src.trim()) return { ok: false, error: 'Nothing to revert.', status: 400 };
  const h = hash(src);
  const rows = await datastore.query(req,
    `SELECT ROWID, fixKey FROM ${TABLE} WHERE sourceHash = '${esc(h)}' AND fixStatus = 'active'`, TABLE);
  if (!rows || !rows.length) return { ok: false, error: 'That string has no correction.', status: 404 };
  const out = await datastore.query(req,
    `UPDATE ${TABLE} SET fixStatus='superseded' WHERE sourceHash='${esc(h)}' AND fixStatus='active'`);
  if (out === null) return { ok: false, error: 'Could not revert.', status: 503 };
  return { ok: true, source: src, revertedBy: user.email || user.role };
}

function status() {
  return {
    table: TABLE,
    task: 'human corrections to the machine-written Kannada interface',
    why: 'every Kannada string in this product was written by a model and none had been read '
      + 'by a native speaker. This makes that review something that can happen one sentence at '
      + 'a time, by the officers already reading the Kannada interface.',
    applies: 'immediately, over the built dictionary. No approval queue — a queue for interface '
      + 'wording becomes the bottleneck the review dies in.',
    history: 'a correction supersedes the previous one and both rows stay, so who changed a '
      + 'string and what it said before always has an answer.',
    whoMay: 'any signed-in officer. The people reading the Kannada interface all day are the '
      + 'ones who know what a thing is actually called in a police station.',
  };
}

module.exports = { overrides, historyFor, recent, submit, revert, status, hash, TABLE };
