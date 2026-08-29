// Audit log — every sensitive read and AI query is recorded (who, what, when).
//
// Two layers. The in-memory ring buffer answers /audit instantly and always works. Behind it,
// rows are written through to the AuditLog Data Store table so the trail survives a cold
// start, which the buffer alone does not -- and an accountability record that evaporates when
// a container recycles cannot support the claim being made for it.
//
// The write is fire-and-forget and swallows every failure. An audit write must never turn a
// successful read into a 500, and the buffer means nothing is lost from the user's view even
// when the table is unreachable.
const datastore = require('./datastore');

let persistOk = 0;
let persistFail = 0;
let persistLast = null;
const MAX = 5000;
const buffer = [];
let seq = 0;

function record({ user, action, targetType, targetId, queryText, ip, req }) {
  seq += 1;
  const row = {
    auditId: `A${String(seq).padStart(7, '0')}`,
    appUserId: user?.appUserId || 'anon',
    userName: user?.name || 'anon',
    role: user?.role || 'anon',
    action, targetType: targetType || null, targetId: targetId || null,
    queryText: queryText || null, ip: ip || null,
    ts: new Date().toISOString(),
  };
  buffer.push(row);
  if (buffer.length > MAX) buffer.shift();

  if (req && process.env.AUDIT_PERSIST !== 'false') {
    datastore.insertRows(req, 'AuditLog', [{
      appUserId: row.appUserId, userName: row.userName, role: row.role,
      action: row.action, targetType: row.targetType || '', targetId: row.targetId || '',
      queryText: (row.queryText || '').slice(0, 500), ip: row.ip || '', ts: row.ts,
    }]).then((ok) => {
      if (ok) persistOk += 1; else { persistFail += 1; persistLast = datastore.diag().httpError; }
    }).catch(() => { persistFail += 1; });
  }
  return row;
}

function list({ limit = 100, action, role } = {}) {
  let rows = buffer.slice().reverse();
  if (action) rows = rows.filter((r) => r.action === action);
  if (role) rows = rows.filter((r) => r.role === role);
  return rows.slice(0, limit);
}

// The read side of the write-through this file's header promises: a live ZCQL read against
// AuditLog, for when the in-memory buffer (this container's session only) is too thin to
// answer honestly. Returns null on any Data Store failure so the caller can fall back to
// the buffer rather than turning an audit read into a 500.
async function listPersisted(req, { limit = 100, action } = {}) {
  const where = action ? ` WHERE action='${String(action).replace(/'/g, "''")}'` : '';
  const rows = await datastore.query(
    req,
    `SELECT appUserId, userName, role, action, targetType, targetId, queryText, ip, ts `
      // 300, not 500. ZCQL REFUSES any LIMIT above 300 -- it answers "ZCQL CANNOT HAVE MORE
      // THAN 300 ROWS in LIMIT" rather than truncating, so the whole query fails and this
      // returns null. The caller then falls back to the in-memory buffer, and an administrator
      // who asked for 400 entries of history was handed ONE. Asking for more quietly gave less,
      // which is the worst way for an audit log to be wrong.
      + `FROM AuditLog${where} ORDER BY ROWID DESC LIMIT 0, ${Math.min(Number(limit) || 100, 300)}`,
    'AuditLog',
  );
  if (rows === null) return null;
  return rows.map((r, i) => ({
    auditId: `D${String(i).padStart(7, '0')}`,
    appUserId: r.appUserId, userName: r.userName, role: r.role,
    action: r.action, targetType: r.targetType || null, targetId: r.targetId || null,
    queryText: r.queryText || null, ip: r.ip || null, ts: r.ts,
  }));
}

module.exports = {
  record, list, listPersisted,
  persistence: () => ({ ok: persistOk, failed: persistFail, lastError: persistLast }),
};
