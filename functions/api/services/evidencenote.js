// evidencenote.js — a machine reading of a photograph, filed against a case.
//
// WHY THIS EXISTS. Until now the Evidence screen was a viewer: an officer photographed a
// seizure memo, watched 800 characters of correct transcription appear, and had nowhere to put
// it. The reading died with the tab. That makes the whole screen a demonstration of a
// capability rather than a step in anybody's day, because the work an officer was trying to
// avoid — retyping the memo — still had to be done somewhere else.
//
// A filed note closes that loop. The transcription becomes part of the case, and the station
// that registered the case can read it without having had access to the image.
//
// FOUR DECISIONS, each of which is easy to get wrong:
//
//   1. THIS IS NOT A CaseUpdate, AND THE DISTINCTION MATTERS. A CaseUpdate changes a FIELD:
//      it carries a before and an after and a supervisor decides whether the register should
//      now say the new thing. An OCR reading changes no field. It is a document filed
//      alongside the case, and forcing it through the amendment queue would put an approver
//      in front of "afterValue: <800 characters of memo>" with no field it corresponds to and
//      no way to say what approving it would mean.
//
//   2. WRITING NEEDS STATE TIER; READING FOLLOWS THE CASE. Only DGP, Administrator and the
//      SCRB Analyst can read an uploaded image at all, so only they can produce a note. But
//      once a note is attached, it belongs to the case — and the station whose register holds
//      that case is exactly who needs the transcription. So the read is gated by the case's
//      own scope check and nothing else. An SHO sees the memo text filed against their case
//      without ever being able to upload an image.
//
//   3. THE IMAGE IS NOT STORED BY DEFAULT, AND RETENTION IS A CHOICE RATHER THAN A BEHAVIOUR.
//      The photograph is the part carrying privacy weight — faces in a scene, a bystander's
//      number plate, whatever else was in frame. The transcription is the part with
//      evidentiary value.
//
//      This file originally said the image was NEVER stored. That was too strong. It cost
//      something real: a reading could not be checked against the page it came from, and a
//      better OCR engine next year could not be run over it. For a seizure memo an officer
//      deliberately chose to keep, that is a records loss dressed as a privacy win.
//
//      So the default is unchanged — nothing is kept unless somebody says to keep it — and
//      retention is an explicit per-reading choice, scoped like the note, deleted when the note
//      is withdrawn, and audited on write, on read and on re-read. The incidental-content risk
//      the original rule was about is handled by it being a decision: nobody retains a crowd
//      photograph by accident.
//
//   4. NOTES ARE WITHDRAWN, NEVER DELETED. Attaching a reading to the wrong case is a
//      one-click mistake and needs an undo. But a police record with a hard delete is a
//      record that can be made to have never said something. So a withdrawal sets a status,
//      names who did it and why, and the row stays. Withdrawn notes are hidden from the case
//      view and visible in the audit trail, which is the correct asymmetry.
const crypto = require('crypto');
const datastore = require('./datastore');
const filestore = require('./filestore');

const TABLE = 'EvidenceNote';

// Which readers may produce a note, and what each one is called in the record. A note whose
// provenance says "ocr" and nothing else is a claim with no author; a reader six months later
// needs to know WHICH machine read the page, because that is what tells them how much to
// trust it and what to re-check.
const CAPABILITIES = {
  ocr: { label: 'Text extraction', engine: 'Zia OCR' },
  barcode: { label: 'Code scan', engine: 'Zia barcode scanner' },
  read: { label: 'Vision reading', engine: 'Qwen 3.6 vision' },
};

// Minted here rather than read back from the insert response. Catalyst's row-insert endpoint
// returns a ROWID that is NOT the ROWID the row settles at — submissions.js documents the
// case where every child row written against the response id was silently orphaned. Owning
// the key removes the whole class of problem.
const mintKey = () => `e${crypto.randomBytes(11).toString('hex')}`;

const esc = (v) => String(v == null ? '' : v).replace(/'/g, "''");
const nowIso = () => new Date().toISOString();
const trim = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Reading an uploaded image is state tier, so producing a note is too. Kept here as well as
// on the route because the two must not be able to drift apart: a note that exists is proof
// that somebody read an image, and if this list ever grew past the route's, a district
// account could file readings it was never allowed to take.
function canFile(user) {
  return ['DGP', 'Admin', 'Analyst'].includes(String(user && user.role));
}

/**
 * File a reading against a case.
 *
 * `caseFacts` is the case AS THE SERVER READ IT — crimeNo, districtId, unitId come from the
 * register via a scope-checked lookup in the route, never from the request body. If they came
 * from the body, a note could be filed into another district's case and every scoped read
 * downstream would faithfully honour the lie. This is the same rule submissions.js opens with,
 * and it is the single most important line in either file.
 */
async function file(req, user, body = {}, caseFacts = null) {
  if (!canFile(user)) {
    return { ok: false, error: 'Filing a reading requires Administrator, DGP or SCRB Analyst.', status: 403 };
  }
  if (!caseFacts || !caseFacts.caseMasterId) return { ok: false, error: 'Unknown case.', status: 404 };

  const capability = String(body.capability || '');
  if (!CAPABILITIES[capability]) {
    return { ok: false, error: `capability must be one of: ${Object.keys(CAPABILITIES).join(', ')}`, status: 400 };
  }
  // An empty reading is not a note. The barcode scanner returns `content: ""` on an image
  // with no code in it, which is a correct answer and a useless attachment — filing it would
  // put a blank entry on the case that a later reader has to open to discover says nothing.
  const extract = trim(body.extract, 9000);
  if (!extract) return { ok: false, error: 'There is nothing in this reading to file.', status: 400 };

  const key = mintKey();
  const row = {
    noteKey: key,
    caseMasterId: String(caseFacts.caseMasterId),
    crimeNo: trim(caseFacts.crimeNo, 40),
    districtId: String(caseFacts.districtId || ''),
    unitId: String(caseFacts.unitId || ''),
    capability,
    engine: trim(body.engine, 80) || CAPABILITIES[capability].engine,
    question: trim(body.question, 2000),
    extract,
    confidence: trim(body.confidence, 8),
    filename: trim(body.filename, 200),
    imageBytes: trim(body.bytes, 16),
    // 1 for a photograph, N for a PDF or a set of pages read as one document.
    pageCount: trim(body.pageCount, 8) || '1',
    // Retention is arranged AFTER the row exists, by a separate call carrying the bytes. It is
    // never part of filing: the reading is the record and the page is a convenience, so an
    // upload that fails must leave a filed note rather than losing it.
    imageFileId: '', retainedBy: '', rereadCount: '0',
    noteStatus: 'filed',
    createdBy: trim(user.email || user.appUserId || user.role, 160),
    creatorRole: user.role,
    createdAt: nowIso(),
    withdrawnBy: '', withdrawnAt: '', withdrawReason: '',
  };
  const written = await datastore.insertRows(req, TABLE, [row]);
  if (!written) return { ok: false, error: 'Could not file the reading.', status: 503 };
  return { ok: true, id: key, caseMasterId: row.caseMasterId, crimeNo: row.crimeNo };
}

const SELECT = 'SELECT ROWID, noteKey, caseMasterId, crimeNo, districtId, unitId, capability, '
  + 'engine, question, extract, confidence, filename, imageBytes, pageCount, imageFileId, '
  + 'retainedBy, rereadCount, noteStatus, createdBy, '
  + `creatorRole, createdAt, withdrawnBy, withdrawnAt, withdrawReason FROM ${TABLE}`;

function map(r) {
  const cap = CAPABILITIES[r.capability] || {};
  return {
    id: String(r.noteKey || r.ROWID),
    caseMasterId: r.caseMasterId,
    crimeNo: r.crimeNo || null,
    capability: r.capability,
    capabilityLabel: cap.label || r.capability,
    engine: r.engine || cap.engine || '',
    question: r.question || '',
    extract: r.extract || '',
    confidence: r.confidence || null,
    filename: r.filename || null,
    bytes: r.imageBytes ? Number(r.imageBytes) : null,
    pages: Number(r.pageCount || 1),
    // The id itself is never sent to the browser -- only whether a page is there. A file id in
    // a list response is a handle somebody can try, and the page is fetched through the note's
    // own scoped route instead.
    retained: Boolean(r.imageFileId),
    retainedBy: r.retainedBy || null,
    rereads: Number(r.rereadCount || 0),
    status: r.noteStatus || 'filed',
    createdBy: r.createdBy,
    creatorRole: r.creatorRole,
    createdAt: r.createdAt,
    withdrawnBy: r.withdrawnBy || null,
    withdrawnAt: r.withdrawnAt || null,
    withdrawReason: r.withdrawReason || null,
  };
}

/**
 * Notes filed against one case, newest first.
 *
 * NO SCOPE CHECK HERE, DELIBERATELY. The caller has already resolved the case through the
 * scoped lookup, which throws for a case the reader may not see. Repeating the check here
 * would mean two implementations of one rule, and the moment they disagree the weaker one is
 * the one that matters.
 */
async function forCase(req, caseMasterId, { includeWithdrawn = false } = {}) {
  const id = trim(caseMasterId, 40);
  if (!id) return [];
  const where = [`caseMasterId = '${esc(id)}'`];
  if (!includeWithdrawn) where.push("noteStatus = 'filed'");
  const rows = await datastore.query(req,
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT 100`, TABLE);
  if (!rows) return [];
  return rows.map(map);
}

/** Everything this officer has filed lately — the Evidence screen's own history. */
async function recent(req, { createdBy = '', limit = 25 } = {}) {
  const where = ["noteStatus = 'filed'"];
  if (createdBy) where.push(`createdBy = '${esc(trim(createdBy, 160))}'`);
  const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const rows = await datastore.query(req,
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT ${n}`, TABLE);
  if (!rows) return [];
  return rows.map(map);
}

/** One note by key, unmapped, for the routes that need its file id or its scope. */
async function getOne(req, id) {
  const key = trim(id, 40);
  if (!key) return null;
  const rows = await datastore.query(req, `${SELECT} WHERE noteKey = '${esc(key)}'`, TABLE);
  return rows && rows.length ? rows[0] : null;
}

/**
 * Keep the page image behind an already-filed reading.
 *
 * SEPARATE FROM FILING, ON PURPOSE. The reading is the record; the page is a convenience. If
 * this were part of file(), an upload that timed out would take a correct transcription down
 * with it, and the officer would be back to retyping the memo — which is the exact problem the
 * whole feature exists to remove. Filing succeeds first, and this either adds the page or does
 * not.
 */
async function retain(req, user, id, buffer, { filename = 'page.png', mime = 'image/png' } = {}) {
  if (!canFile(user)) return { ok: false, error: 'Requires Administrator, DGP or SCRB Analyst.', status: 403 };
  const n = await getOne(req, id);
  if (!n) return { ok: false, error: 'Unknown reading.', status: 404 };
  if (String(n.createdBy) !== String(user.email || user.appUserId || user.role) && user.role !== 'Admin') {
    return { ok: false, error: 'Only the officer who filed a reading may keep its page.', status: 403 };
  }
  if (n.imageFileId) return { ok: false, error: 'This reading already has its page.', status: 409 };

  const up = await filestore.put(req, buffer, filename, mime);
  if (!up.ok) return { ok: false, error: `Could not keep the page: ${up.error}`, status: 503 };

  const out = await datastore.query(req,
    `UPDATE ${TABLE} SET imageFileId='${esc(up.fileId)}', `
      + `retainedBy='${esc(user.email || user.role)}' WHERE noteKey='${esc(trim(id, 40))}'`);
  if (out === null) {
    // The row did not take the reference, so nothing can ever reach this file again. Remove it
    // rather than leaving an unreferenced photograph in the store forever.
    await filestore.remove(req, up.fileId);
    return { ok: false, error: 'Could not record the retained page.', status: 503 };
  }
  return { ok: true, id: trim(id, 40), bytes: up.bytes };
}

/**
 * Note that a retained page was read again.
 *
 * A re-read does NOT overwrite the original reading, and it does not file itself. It returns
 * what the second engine said and leaves the officer to file it as its own note if it is worth
 * keeping. That preserves the whole point of re-reading: comparing what two engines made of
 * the same page, with both readings intact and separately attributable.
 */
async function recordReread(req, id) {
  const n = await getOne(req, id);
  if (!n) return 0;
  const next = Number(n.rereadCount || 0) + 1;
  await datastore.query(req,
    `UPDATE ${TABLE} SET rereadCount='${next}' WHERE noteKey='${esc(trim(id, 40))}'`);
  return next;
}

/**
 * Withdraw a note. The row survives; only its status changes.
 *
 * Who may: the officer who filed it, or an Administrator. Not the case's own station — a
 * reading filed against their case is not theirs to retract, and letting the subject of a
 * record remove it is the failure mode this whole design is avoiding.
 */
async function withdraw(req, user, id, reason) {
  const key = trim(id, 40);
  if (!key) return { ok: false, error: 'Unknown reading.', status: 404 };
  const why = trim(reason, 250);
  if (why.length < 5) return { ok: false, error: 'Say why it is being withdrawn.', status: 400 };

  const rows = await datastore.query(req,
    `SELECT ROWID, noteKey, createdBy, noteStatus, caseMasterId, imageFileId FROM ${TABLE} WHERE noteKey = '${esc(key)}'`, TABLE);
  if (!rows || !rows.length) return { ok: false, error: 'Unknown reading.', status: 404 };
  const n = rows[0];
  const mine = String(n.createdBy) === String(user.email || user.appUserId || user.role);
  if (!mine && user.role !== 'Admin') {
    return { ok: false, error: 'Only the officer who filed a reading, or an Administrator, may withdraw it.', status: 403 };
  }
  if (n.noteStatus === 'withdrawn') return { ok: false, error: 'Already withdrawn.', status: 409 };

  const out = await datastore.query(req,
    `UPDATE ${TABLE} SET noteStatus='withdrawn', withdrawnBy='${esc(user.email || user.role)}', `
      + `withdrawnAt='${nowIso()}', withdrawReason='${esc(why)}', imageFileId='' `
      + `WHERE noteKey='${esc(key)}'`);
  if (out === null) return { ok: false, error: 'Could not withdraw the reading.', status: 503 };

  // The TEXT survives a withdrawal and the PHOTOGRAPH does not, which is the right asymmetry.
  // The text is the record -- keeping it is what stops a note being made to have never existed.
  // The image is a convenience this feature did not want to be holding in the first place, and
  // an officer pulling a mis-filed reading wants it gone rather than merely hidden. Done after
  // the row is updated, so a delete that fails leaves an orphaned file rather than a note still
  // pointing at a photograph it no longer admits to.
  if (n.imageFileId) await filestore.remove(req, n.imageFileId).catch(() => null);
  return { ok: true, id: key, caseMasterId: n.caseMasterId, pageDeleted: Boolean(n.imageFileId) };
}

function status() {
  return {
    table: TABLE,
    task: 'machine readings of photographs, filed against a case',
    capabilities: CAPABILITIES,
    stores: 'the reading always; the page image only when an officer explicitly kept it',
    writeRequires: 'DGP, Administrator or SCRB Analyst, because filing a note requires having '
      + 'read an uploaded image',
    readFollows: 'the case: anyone who can see the case sees the readings filed against it',
    deletion: 'a note is withdrawn, which records who and why and keeps the row and its text. '
      + 'A retained page IS deleted at that point.',
  };
}

module.exports = {
  file, forCase, recent, withdraw, canFile, status, getOne, retain, recordReread,
  CAPABILITIES, TABLE,
};
