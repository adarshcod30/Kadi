// Audit log — every sensitive read + AI query is recorded (who, what, when).
// Mock: in-memory ring buffer. Catalyst adapter writes to the AuditLog Data Store table.
const MAX = 5000;
const buffer = [];
let seq = 0;

function record({ user, action, targetType, targetId, queryText, ip }) {
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
  return row;
}

function list({ limit = 100, action, role } = {}) {
  let rows = buffer.slice().reverse();
  if (action) rows = rows.filter((r) => r.action === action);
  if (role) rows = rows.filter((r) => r.role === role);
  return rows.slice(0, limit);
}

module.exports = { record, list };
