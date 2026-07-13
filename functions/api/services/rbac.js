// Role-based access control (docs/01 §4). Enforced server-side on every endpoint.
// Roles + scope mirror the KSP hierarchy. Analysts get state-wide READ.

const ROLES = {
  SI: { level: 6, label: 'Sub-Inspector (IO)', scope: 'unit' },
  Inspector: { level: 5, label: 'Inspector / SHO', scope: 'unit' },
  ACP: { level: 4, label: 'ACP / DySP', scope: 'district' },
  Analyst: { level: 3, label: 'SCRB Analyst', scope: 'state' },
  Admin: { level: 1, label: 'Administrator', scope: 'state' },
};

// Seeded demo users (mock auth). Real Catalyst Auth maps JWT -> AppUser row.
const DEMO_USERS = {
  SI: { appUserId: 'U-SI', name: 'PSI R. Kumar', role: 'SI', unitId: '1', districtId: '1' },
  Inspector: { appUserId: 'U-INS', name: 'PI S. Gowda', role: 'Inspector', unitId: '1', districtId: '1' },
  ACP: { appUserId: 'U-ACP', name: 'DySP M. Rao', role: 'ACP', unitId: null, districtId: '1' },
  Analyst: { appUserId: 'U-ANA', name: 'SCRB Analyst', role: 'Analyst', unitId: null, districtId: null },
  Admin: { appUserId: 'U-ADM', name: 'System Admin', role: 'Admin', unitId: null, districtId: null },
};

function userFromRequest(req) {
  // Mock auth: role via header (demo). Catalyst adapter would derive from JWT -> AppUser.
  const role = (req.headers['x-kadi-role'] || 'Analyst').toString();
  const base = DEMO_USERS[role] || DEMO_USERS.Analyst;
  return { ...base, roleMeta: ROLES[base.role] };
}

// Predicate: can this user see this case (by unit/district scope)?
function caseInScope(user, c) {
  const scope = user.roleMeta.scope;
  if (scope === 'state') return true;
  if (scope === 'district') return String(c.districtId) === String(user.districtId);
  if (scope === 'unit') return String(c.unitId) === String(user.unitId);
  return false;
}

function requireRole(user, allowed) {
  if (!allowed.includes(user.role)) {
    const e = new Error(`Requires role: ${allowed.join(', ')}`);
    e.status = 403; e.code = 'forbidden';
    throw e;
  }
}

function capabilities(user) {
  return {
    role: user.role,
    label: user.roleMeta.label,
    scope: user.roleMeta.scope,
    canViewVulnerability: ['ACP', 'Analyst', 'Admin'].includes(user.role),
    canViewAudit: ['ACP', 'Admin'].includes(user.role),
    canAdmin: user.role === 'Admin',
  };
}

module.exports = { ROLES, DEMO_USERS, userFromRequest, caseInScope, requireRole, capabilities };
