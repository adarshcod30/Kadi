// submissions.js — the write path, and the approval chain that guards it.
//
// Until now KADI only read. That was defensible for an analytics product but it made the
// station tier a spectator: an SI can see that their register is siloed and can do nothing
// about it from here. This is the other half — a case enters the system from the station that
// registered it, and a supervisor decides whether it stands.
//
// THREE THINGS THIS GETS RIGHT, each of which is easy to get wrong:
//
//   1. SCOPE COMES FROM THE ACCOUNT, NEVER THE FORM. A submission's district and station are
//      taken from the submitting officer's token. If they came from the request body, an SI
//      could file a case into another district by editing a hidden field, and every scoped
//      read downstream would faithfully honour the lie.
//
//   2. APPROVAL IS BOUNDED THE SAME WAY READS ARE. An SP approves their own district. Only the
//      DGP and the Administrator approve anywhere. The queue is filtered by the same district
//      rule that filters the register, so an approver is never shown a decision they cannot
//      make.
//
//   3. A NEW CASE IS NOT AN ANALYSED CASE. Linkage, entity resolution, risk and health are all
//      computed by the offline pipeline over the whole corpus; none of it can run inside a
//      30-second function for one new row. So an approved case appears in the register at once
//      and is marked `awaitingAnalysis` until the next pipeline run. Saying nothing would let a
//      reader conclude a new case is unconnected, when the truth is that nothing has looked.
const crypto = require('crypto');
const datastore = require('./datastore');

const TABLE = 'CaseSubmission';
const PARTY_TABLE = 'SubmissionParty';
const UPDATE_TABLE = 'CaseUpdate';

// Live case ids are prefixed so they can never be confused with a corpus CaseMasterID, in a
// URL, a log line or a join. A collision here would silently attach one case's parties to
// another, which is the worst failure this file could have.
const LIVE_PREFIX = 'LIVE-';
const isLiveId = (id) => String(id).startsWith(LIVE_PREFIX);

// The row identifier is minted HERE, not read back from the store.
//
// Catalyst's row-insert endpoint answers with a ROWID that is not the ROWID the row ends up
// with -- filing one case returned 55468000000178070 while the row queried back as
// ...178073. Every accused and victim written against the response's id was therefore
// orphaned, silently, and the submission read back with no parties at all.
//
// Owning the key removes the whole class of problem: parties point at something the API
// generated, live case ids are built from it, and nothing downstream depends on the store
// agreeing with its own insert response.
const mintKey = () => `s${crypto.randomBytes(11).toString('hex')}`;

const esc = (v) => String(v == null ? '' : v).replace(/'/g, "''");
const nowIso = () => new Date().toISOString();
const trim = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// ---- who may do what ----------------------------------------------------------------
// Station tier registers cases, because that is who registers cases. A district or state
// officer filing an FIR into a station they do not sit in would be a fiction, and the point of
// the write path is that it mirrors the chain of command rather than inventing a new one.
function canSubmit(user) {
  return Boolean(user && user.roleMeta && user.roleMeta.tier === 'station');
}
function canApprove(user) {
  if (!user) return false;
  return user.role === 'DGP' || user.role === 'Admin' || user.role === 'SP';
}
// Where an approver's authority ends. DGP and Administrator hold the state; an SP holds one
// district and nothing beyond it.
function approvalDistrict(user) {
  if (user.role === 'DGP' || user.role === 'Admin') return null;   // no restriction
  return user.districtId ? String(user.districtId) : '__none__';
}

const PARTY_ROLES = new Set(['accused', 'victim', 'complainant']);

// ---- submit ---------------------------------------------------------------------------
/**
 * File a case.
 *
 * `lookups` is the same object /lookups serves, passed in by the route rather than imported,
 * so this service keeps no dependency on the corpus loader. It is used to check that the crime
 * head, sub-head and gravity actually EXIST and agree with each other -- the form can only
 * offer real ones, but the endpoint is reachable without the form, and a case whose sub-head
 * resolves to nothing renders as a blank crime type in every view downstream.
 */
async function submit(req, user, body = {}, lookups = null) {
  if (!canSubmit(user)) {
    return { ok: false, error: 'Only a station officer may register a case.', status: 403 };
  }
  if (!user.unitId) return { ok: false, error: 'Your account is not attached to a station.', status: 403 };

  const crimeNo = trim(body.crimeNo, 40);
  const subHeadId = trim(body.crimeSubHeadId, 16);
  const headId = trim(body.crimeHeadId, 16);
  const registeredDate = trim(body.crimeRegisteredDate, 24);
  const briefFacts = trim(body.briefFacts, 4000);

  if (!/^\d{6,20}$/.test(crimeNo)) return { ok: false, error: 'Enter the FIR crime number.', status: 400 };
  if (!subHeadId || !headId) return { ok: false, error: 'Select the crime head and sub-head.', status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registeredDate)) return { ok: false, error: 'Enter the date of registration.', status: 400 };
  // A future registration date is always a typo, and one that would push corpusAsOf forward
  // and shift every "last 90 days" window in the product.
  if (registeredDate > nowIso().slice(0, 10)) return { ok: false, error: 'The registration date cannot be in the future.', status: 400 };
  if (briefFacts.length < 20) return { ok: false, error: 'Describe the offence in at least a sentence.', status: 400 };

  if (lookups) {
    const sub = (lookups.subheads || []).find((x) => String(x.id) === subHeadId);
    if (!sub) return { ok: false, error: 'That crime sub-head does not exist.', status: 400 };
    // Head and sub-head must agree. A sub-head borrowed from another head is the commonest way
    // a register ends up mis-classified, and it is invisible afterwards.
    if (String(sub.headId) !== headId) {
      return { ok: false, error: 'The sub-head does not belong to the chosen crime head.', status: 400 };
    }
    const gravityId = trim(body.gravityId, 8);
    if (gravityId && !(lookups.gravities || []).some((x) => String(x.id) === gravityId)) {
      return { ok: false, error: 'That gravity does not exist.', status: 400 };
    }
    const categoryId = trim(body.categoryId, 8);
    if (categoryId && !(lookups.categories || []).some((x) => String(x.id) === categoryId)) {
      return { ok: false, error: 'That category does not exist.', status: 400 };
    }
  }

  // The one query that is worth the round trip: a duplicate FIR number in the same station is
  // a real data-entry error, and catching it here is cheaper than reconciling it later.
  const dupe = await datastore.query(req,
    `SELECT ROWID FROM ${TABLE} WHERE crimeNo = '${esc(crimeNo)}' AND unitId = '${esc(user.unitId)}'`, TABLE);
  if (dupe && dupe.length) {
    return { ok: false, error: 'A submission with this crime number already exists for your station.', status: 409 };
  }

  const key = mintKey();
  const row = {
    submissionKey: key,
    crimeNo,
    caseNo: trim(body.caseNo, 40),
    // Scope from the account, never the form. This is the security boundary of the whole file.
    unitId: String(user.unitId),
    districtId: String(user.districtId || ''),
    crimeHeadId: headId,
    crimeSubHeadId: subHeadId,
    gravityId: trim(body.gravityId, 8),
    categoryId: trim(body.categoryId, 8),
    crimeRegisteredDate: registeredDate,
    incidentFromDate: trim(body.incidentFromDate, 32),
    latitude: trim(body.latitude, 24),
    longitude: trim(body.longitude, 24),
    briefFacts,
    actsSections: trim(body.actsSections, 2000),
    ioName: trim(body.ioName, 128) || user.name || '',
    submittedBy: user.email || user.appUserId || '',
    submitterRole: user.role,
    submittedAt: nowIso(),
    submissionStatus: 'pending',
    reviewedBy: '',
    reviewedAt: '',
    reviewNote: '',
    caseMasterId: '',
  };

  const written = await datastore.insertRows(req, TABLE, [row]);
  if (!written) {
    return { ok: false, error: 'Could not record the submission. Try again shortly.', status: 503 };
  }
  const id = key;

  // Parties are best-effort BY DESIGN. The submission is the record of intent; losing an
  // accused row must not lose the FIR, and a supervisor reviewing a submission with no parties
  // can see that and send it back.
  const parties = Array.isArray(body.parties) ? body.parties.slice(0, 20) : [];
  const partyRows = parties
    .filter((p) => p && trim(p.fullName, 128) && PARTY_ROLES.has(String(p.partyRole)))
    .map((p) => ({
      submissionId: key,
      partyRole: String(p.partyRole),
      fullName: trim(p.fullName, 128),
      age: trim(p.age, 8),
      gender: trim(p.gender, 16),
      address: trim(p.address, 500),
      contact: trim(p.contact, 32),
      createdAt: nowIso(),
    }));
  let partiesWritten = 0;
  if (partyRows.length) {
    const ok = await datastore.insertRows(req, PARTY_TABLE, partyRows);
    partiesWritten = ok ? partyRows.length : 0;
  }

  return { ok: true, id, crimeNo, parties: partiesWritten, status: 'pending' };
}

// ---- read ------------------------------------------------------------------------------
function mapSubmission(r) {
  return {
    // The minted key, falling back to ROWID for any row written before the key existed.
    id: String(r.submissionKey || r.ROWID),
    crimeNo: r.crimeNo,
    caseNo: r.caseNo || null,
    unitId: r.unitId,
    districtId: r.districtId,
    crimeHeadId: r.crimeHeadId,
    crimeSubHeadId: r.crimeSubHeadId,
    gravityId: r.gravityId || null,
    categoryId: r.categoryId || null,
    crimeRegisteredDate: r.crimeRegisteredDate,
    incidentFromDate: r.incidentFromDate || null,
    latitude: r.latitude || null,
    longitude: r.longitude || null,
    briefFacts: r.briefFacts || '',
    actsSections: r.actsSections || '',
    ioName: r.ioName || '',
    submittedBy: r.submittedBy,
    submitterRole: r.submitterRole,
    submittedAt: r.submittedAt,
    status: r.submissionStatus,
    reviewedBy: r.reviewedBy || null,
    reviewedAt: r.reviewedAt || null,
    reviewNote: r.reviewNote || null,
    caseMasterId: r.caseMasterId || null,
  };
}

const SELECT = 'SELECT ROWID, submissionKey, crimeNo, caseNo, unitId, districtId, crimeHeadId, crimeSubHeadId, '
  + 'gravityId, categoryId, crimeRegisteredDate, incidentFromDate, latitude, longitude, '
  + 'briefFacts, actsSections, ioName, submittedBy, submitterRole, submittedAt, '
  + `submissionStatus, reviewedBy, reviewedAt, reviewNote, caseMasterId FROM ${TABLE}`;

/**
 * What this user may see of the submission queue.
 *
 * A station officer sees their own station's submissions — including their own rejected ones,
 * which is the half of the loop that makes rejection useful rather than merely final.
 * An approver sees everything they could decide.
 */
async function list(req, user, { status = '', limit = 100 } = {}) {
  const where = [];
  if (canApprove(user)) {
    const d = approvalDistrict(user);
    if (d) where.push(`districtId = '${esc(d)}'`);
  } else if (user.roleMeta.tier === 'station') {
    where.push(`unitId = '${esc(user.unitId || '__none__')}'`);
  } else {
    // A district DySP or state Analyst reads the register, not the queue. Returning an empty
    // list rather than a 403 keeps the tab renderable for everyone with an honest reason.
    return { items: [], visible: false, reason: 'Submissions are visible to the station that files them and the officer who approves them.' };
  }
  if (status) where.push(`submissionStatus = '${esc(status)}'`);
  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
    + ` ORDER BY submittedAt DESC LIMIT ${Math.min(200, Math.max(1, Number(limit) || 100))}`;
  const rows = await datastore.query(req, sql, TABLE);
  if (rows === null) return { items: [], visible: true, available: false, reason: 'The submission register is unreachable right now.' };
  return { items: rows.map(mapSubmission), visible: true, available: true };
}

async function partiesFor(req, submissionId) {
  const rows = await datastore.query(req,
    `SELECT ROWID, submissionId, partyRole, fullName, age, gender, address, contact `
      + `FROM ${PARTY_TABLE} WHERE submissionId = '${esc(submissionId)}'`, PARTY_TABLE);
  if (!rows) return [];
  return rows.map((r) => ({
    id: String(r.ROWID), partyRole: r.partyRole, fullName: r.fullName,
    age: r.age || null, gender: r.gender || null, address: r.address || '', contact: r.contact || '',
  }));
}

async function getOne(req, user, id) {
  const key = trim(id, 40);
  if (!key) return null;
  const rows = await datastore.query(req, `${SELECT} WHERE submissionKey = '${esc(key)}'`, TABLE);
  if (!rows || !rows.length) return null;
  const s = mapSubmission(rows[0]);
  // The same boundary as list(), applied to a direct fetch — otherwise the id in the URL
  // becomes the way around the queue filter.
  const mine = user.roleMeta.tier === 'station' && String(s.unitId) === String(user.unitId);
  const d = canApprove(user) ? approvalDistrict(user) : '__no__';
  const approvable = canApprove(user) && (d === null || String(s.districtId) === d);
  if (!mine && !approvable) return null;
  s.parties = await partiesFor(req, s.id);
  s.canDecide = approvable && s.status === 'pending';
  return s;
}

// ---- decide ------------------------------------------------------------------------------
async function decide(req, user, id, decision, note) {
  if (!canApprove(user)) return { ok: false, error: 'Requires SP, DGP or Administrator.', status: 403 };
  const key = trim(id, 40);
  if (!key) return { ok: false, error: 'Unknown submission.', status: 404 };

  const rows = await datastore.query(req,
    `SELECT ROWID, submissionKey, districtId, unitId, crimeNo, submissionStatus FROM ${TABLE} `
      + `WHERE submissionKey = '${esc(key)}'`, TABLE);
  if (!rows || !rows.length) return { ok: false, error: 'Unknown submission.', status: 404 };
  const s = rows[0];

  const d = approvalDistrict(user);
  if (d !== null && String(s.districtId) !== d) {
    return { ok: false, error: 'That submission is outside your district.', status: 403 };
  }
  if (s.submissionStatus !== 'pending') {
    return { ok: false, error: `This submission was already ${s.submissionStatus}.`, status: 409 };
  }

  const verdict = String(decision) === 'approve' ? 'approved'
    : String(decision) === 'return' ? 'returned' : 'rejected';
  // A rejection or a return without a reason is a dead end for the officer who filed it, so
  // the reason is required for both. An approval needs no justification.
  const reason = trim(note, 1000);
  if (verdict !== 'approved' && reason.length < 5) {
    return { ok: false, error: 'Give a reason so the station can act on it.', status: 400 };
  }

  const caseId = verdict === 'approved' ? `${LIVE_PREFIX}${key}` : '';
  const out = await datastore.query(req,
    `UPDATE ${TABLE} SET submissionStatus='${verdict}', reviewedBy='${esc(user.email || user.role)}', `
      + `reviewedAt='${nowIso()}', reviewNote='${esc(reason)}', caseMasterId='${esc(caseId)}' `
      + `WHERE submissionKey='${esc(key)}'`);
  if (out === null) return { ok: false, error: 'Could not record the decision.', status: 503 };

  invalidateLive();
  return { ok: true, status: verdict, caseMasterId: caseId || null, crimeNo: s.crimeNo };
}

// ---- the read model union -----------------------------------------------------------------
//
// Approved submissions become rows in the register. They are cached in-process for a short
// window because every case read would otherwise pay a Data Store round trip for what is
// usually an empty list, and invalidated outright on approval so the officer who just approved
// a case sees it immediately rather than up to a minute later. Another container may lag by
// the TTL; that is the honest cost of not having a shared cache, and a minute of lag on a
// newly approved FIR is not a correctness problem.
const LIVE_TTL_MS = 60 * 1000;
let liveCache = { at: 0, rows: [] };
function invalidateLive() { liveCache = { at: 0, rows: [] }; }

function toCaseRow(s, db) {
  const L = db.lookups;
  const unit = L.units.get(String(s.unitId));
  const district = L.districts.get(String(s.districtId));
  const head = L.heads.get(String(s.crimeHeadId));
  const sub = L.subheads.get(String(s.crimeSubHeadId));
  const gravity = L.gravities.get(String(s.gravityId));
  const category = L.categories.get(String(s.categoryId));
  return {
    caseMasterId: s.caseMasterId,
    crimeNo: s.crimeNo,
    caseNo: s.caseNo || '',
    crimeRegisteredDate: s.crimeRegisteredDate,
    incidentFromDate: s.incidentFromDate || '',
    incidentToDate: '',
    infoReceivedPSDate: '',
    unitId: String(s.unitId),
    unitName: unit ? unit.UnitName : '',
    districtId: String(s.districtId),
    districtName: district ? district.DistrictName : '',
    crimeHeadId: String(s.crimeHeadId),
    crimeHead: head ? head.CrimeGroupName : '',
    crimeSubHeadId: String(s.crimeSubHeadId),
    crimeSubHead: sub ? sub.CrimeHeadName : '',
    // Every case enters under investigation. Closure is a lifecycle change with its own
    // approval, not something a submitter may assert on the way in.
    statusId: '1',
    status: 'Under Investigation',
    categoryId: String(s.categoryId || ''),
    category: category ? category.LookupValue : '',
    gravityId: String(s.gravityId || ''),
    gravity: gravity ? gravity.LookupValue : '',
    latitude: s.latitude ? Number(s.latitude) : null,
    longitude: s.longitude ? Number(s.longitude) : null,
    briefFacts: s.briefFacts,
    ioId: '', ioName: s.ioName || '',
    // Zeroed rather than omitted, and both are TRUE STATEMENTS ABOUT WHAT IS KNOWN, not
    // findings: nothing has looked for links or scored this case yet.
    linkedCount: 0,
    clusterId: null,
    healthSeverity: null,
    // The flag the whole interface hangs its caveat on.
    awaitingAnalysis: true,
    source: 'live',
    submittedBy: s.submittedBy,
    approvedBy: s.reviewedBy,
    approvedAt: s.reviewedAt,
  };
}

/**
 * Approved cases not yet in the bundle, in register shape. Returns [] on any failure — a Data
 * Store outage must degrade the register to the bundle, never to an error.
 */
async function liveCases(req, db) {
  const now = Date.now();
  if (liveCache.at && now - liveCache.at < LIVE_TTL_MS) return liveCache.rows;
  const rows = await datastore.query(req, `${SELECT} WHERE submissionStatus = 'approved'`, TABLE);
  if (rows === null) return liveCache.rows;      // keep whatever was last known good
  const mapped = rows.map(mapSubmission).filter((s) => s.caseMasterId).map((s) => toCaseRow(s, db));
  liveCache = { at: now, rows: mapped };
  return mapped;
}

/** Parties for a live case, in the shape /cases/:id returns. */
async function livePartiesFor(req, caseMasterId) {
  if (!isLiveId(caseMasterId)) return null;
  const submissionId = String(caseMasterId).slice(LIVE_PREFIX.length);
  const parties = await partiesFor(req, submissionId);
  const pick = (roleName) => parties.filter((p) => p.partyRole === roleName)
    .map((p) => ({ name: p.fullName, age: p.age, genderId: null, address: p.address }));
  return {
    complainants: pick('complainant'),
    victims: pick('victim'),
    accused: pick('accused').map((a) => ({ ...a, accusedMasterId: null, personId: null })),
  };
}

// ---- lifecycle updates (closure, arrest, chargesheet) --------------------------------------
//
// The same gate, for a change to a case that already exists. Each row carries BEFORE and AFTER
// rather than only the new value, because an audit trail that records that something changed
// without recording what it was is a log, not a trail.
const UPDATE_TYPES = {
  closure: { label: 'Case closure', field: 'Case status' },
  arrest: { label: 'Arrest recorded', field: 'Arrest' },
  chargesheet: { label: 'Chargesheet filed', field: 'Chargesheet' },
  status: { label: 'Status change', field: 'Case status' },
  party: { label: 'Party added', field: 'Parties' },
};

async function requestUpdate(req, user, body = {}) {
  // An IO records what happened on their own case; a DySP does the same for cases in the
  // district they supervise. Both changes still need a supervisor's approval below.
  const tier = user.roleMeta.tier;
  if (tier !== 'station' && user.role !== 'DSP') {
    return { ok: false, error: 'Only the investigating station or a DySP may request a case update.', status: 403 };
  }
  const type = String(body.updateType || '');
  if (!UPDATE_TYPES[type]) return { ok: false, error: 'Choose what is being recorded.', status: 400 };
  const caseMasterId = trim(body.caseMasterId, 40);
  if (!caseMasterId) return { ok: false, error: 'Unknown case.', status: 400 };
  const after = trim(body.afterValue, 1000);
  if (!after) return { ok: false, error: 'Record what changed.', status: 400 };
  const reason = trim(body.reason, 1000);
  if (reason.length < 5) return { ok: false, error: 'Give the grounds for the change.', status: 400 };

  // One pending request of a kind per case. Submissions have guarded against a duplicate FIR
  // number since they shipped; updates did not, and two identical arrest requests sat in the
  // queue at once -- which puts an approver in the position of approving the same fact twice
  // and makes the second decision meaningless.
  const existing = await datastore.query(req,
    `SELECT ROWID FROM ${UPDATE_TABLE} WHERE caseMasterId = '${esc(caseMasterId)}' `
      + `AND updateType = '${esc(type)}' AND updateStatus = 'pending'`, UPDATE_TABLE);
  if (existing && existing.length) {
    // Phrased without an article: "A arrest recorded request" is what naive interpolation
    // produced, and every label would need its own a/an to fix it that way.
    return { ok: false, error: `There is already a pending "${UPDATE_TYPES[type].label}" request on this case.`, status: 409 };
  }

  const key = mintKey();
  const row = {
    updateKey: key,
    caseMasterId,
    crimeNo: trim(body.crimeNo, 40),
    // Scope from the case as the SERVER sees it, passed in by the route after a scope check.
    // The route does that with getCase(..., { requireInScope: true }); until that option
    // existed the check named here did not happen, and a station SI could file an update
    // against any case in the state.
    districtId: String(body.districtId || ''),
    unitId: String(body.unitId || ''),
    updateType: type,
    beforeValue: trim(body.beforeValue, 1000),
    afterValue: after,
    reason,
    requestedBy: user.email || user.appUserId || '',
    requesterRole: user.role,
    requestedAt: nowIso(),
    updateStatus: 'pending',
    reviewedBy: '', reviewedAt: '', reviewNote: '',
  };
  const written = await datastore.insertRows(req, UPDATE_TABLE, [row]);
  if (!written) return { ok: false, error: 'Could not record the request.', status: 503 };
  return { ok: true, id: key, status: 'pending' };
}

const UPDATE_SELECT = 'SELECT ROWID, updateKey, caseMasterId, crimeNo, districtId, unitId, updateType, '
  + 'beforeValue, afterValue, reason, requestedBy, requesterRole, requestedAt, updateStatus, '
  + `reviewedBy, reviewedAt, reviewNote FROM ${UPDATE_TABLE}`;

function mapUpdate(r) {
  return {
    id: String(r.updateKey || r.ROWID),
    caseMasterId: r.caseMasterId,
    crimeNo: r.crimeNo || null,
    districtId: r.districtId,
    unitId: r.unitId,
    updateType: r.updateType,
    updateLabel: (UPDATE_TYPES[r.updateType] || {}).label || r.updateType,
    field: (UPDATE_TYPES[r.updateType] || {}).field || '',
    beforeValue: r.beforeValue || '',
    afterValue: r.afterValue || '',
    reason: r.reason || '',
    requestedBy: r.requestedBy,
    requesterRole: r.requesterRole,
    requestedAt: r.requestedAt,
    status: r.updateStatus,
    reviewedBy: r.reviewedBy || null,
    reviewedAt: r.reviewedAt || null,
    reviewNote: r.reviewNote || null,
  };
}

async function listUpdates(req, user, { status = '', caseMasterId = '', limit = 100 } = {}) {
  const where = [];
  if (caseMasterId) {
    where.push(`caseMasterId = '${esc(caseMasterId)}'`);
  } else if (canApprove(user)) {
    const d = approvalDistrict(user);
    if (d) where.push(`districtId = '${esc(d)}'`);
  } else if (user.roleMeta.tier === 'station') {
    where.push(`unitId = '${esc(user.unitId || '__none__')}'`);
  } else {
    return { items: [], visible: false, reason: 'Case updates are visible to the station that files them and the officer who approves them.' };
  }
  if (status) where.push(`updateStatus = '${esc(status)}'`);
  const rows = await datastore.query(req,
    `${UPDATE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
      + ` ORDER BY requestedAt DESC LIMIT ${Math.min(200, Math.max(1, Number(limit) || 100))}`, UPDATE_TABLE);
  if (rows === null) return { items: [], visible: true, available: false, reason: 'The update register is unreachable right now.' };
  return { items: rows.map(mapUpdate), visible: true, available: true };
}

async function decideUpdate(req, user, id, decision, note) {
  if (!canApprove(user)) return { ok: false, error: 'Requires SP, DGP or Administrator.', status: 403 };
  const key = trim(id, 40);
  if (!key) return { ok: false, error: 'Unknown request.', status: 404 };
  const rows = await datastore.query(req,
    `SELECT ROWID, updateKey, districtId, updateStatus, updateType, caseMasterId FROM ${UPDATE_TABLE} `
      + `WHERE updateKey = '${esc(key)}'`, UPDATE_TABLE);
  if (!rows || !rows.length) return { ok: false, error: 'Unknown request.', status: 404 };
  const u = rows[0];
  const d = approvalDistrict(user);
  if (d !== null && String(u.districtId) !== d) {
    return { ok: false, error: 'That request is outside your district.', status: 403 };
  }
  if (u.updateStatus !== 'pending') return { ok: false, error: `Already ${u.updateStatus}.`, status: 409 };

  const verdict = String(decision) === 'approve' ? 'approved' : 'rejected';
  const reason = trim(note, 1000);
  if (verdict === 'rejected' && reason.length < 5) {
    return { ok: false, error: 'Give a reason so the station can act on it.', status: 400 };
  }
  const out = await datastore.query(req,
    `UPDATE ${UPDATE_TABLE} SET updateStatus='${verdict}', reviewedBy='${esc(user.email || user.role)}', `
      + `reviewedAt='${nowIso()}', reviewNote='${esc(reason)}' WHERE updateKey='${esc(key)}'`);
  if (out === null) return { ok: false, error: 'Could not record the decision.', status: 503 };
  return { ok: true, status: verdict, updateType: u.updateType, caseMasterId: u.caseMasterId };
}

/**
 * Approved lifecycle changes for one case, newest first — the case's own history, which is
 * what a reader of a live case actually wants to see under it.
 */
async function approvedUpdatesFor(req, caseMasterId) {
  const rows = await datastore.query(req,
    `${UPDATE_SELECT} WHERE caseMasterId = '${esc(caseMasterId)}' AND updateStatus = 'approved'`
      + ' ORDER BY reviewedAt DESC LIMIT 50', UPDATE_TABLE);
  if (!rows) return [];
  return rows.map(mapUpdate);
}

module.exports = {
  TABLE, PARTY_TABLE, UPDATE_TABLE, LIVE_PREFIX, UPDATE_TYPES,
  isLiveId, canSubmit, canApprove, approvalDistrict,
  submit, list, getOne, decide, liveCases, livePartiesFor, invalidateLive,
  requestUpdate, listUpdates, decideUpdate, approvedUpdatesFor,
};
