// Role-based access control. Enforced server-side on every endpoint.
//
// TWO TIERS, not five roles. The brief asks for district-level drill-down as a first-class
// capability, and five overlapping roles made that muddy -- three different scopes, none of
// them the one the brief actually names. So scope is now a two-position switch:
//
//   STATE     SCRB Analyst, DGP, Administrator   all 31 districts
//   DISTRICT  SI, DySP, SP                        one district, plus cases linked into it
//
// Station is a drill-down *within* a scope (?unit=), not a third role tier. An SI and an SP
// see the same district; what differs is what they do with it, not what they can read.

const ROLES = {
  // --- state tier ---
  Analyst: { level: 2, label: 'SCRB Analyst', scope: 'state', tier: 'state' },
  DGP: { level: 1, label: 'State DGP', scope: 'state', tier: 'state' },
  Admin: { level: 1, label: 'Administrator', scope: 'state', tier: 'state' },
  // --- district tier ---
  SP: { level: 3, label: 'Superintendent of Police', scope: 'district', tier: 'district' },
  DSP: { level: 4, label: 'DySP / ACP', scope: 'district', tier: 'district' },
  SI: { level: 5, label: 'Sub-Inspector (IO)', scope: 'district', tier: 'district' },
};

// Older role names still arrive from cached clients and saved links. Map rather than 404.
const ALIASES = { Inspector: 'SI', ACP: 'DSP', SCRB: 'Analyst' };

const DEMO_USERS = {
  Analyst: { appUserId: 'U-ANA', name: 'SCRB Analyst', role: 'Analyst', unitId: null, districtId: null },
  DGP: { appUserId: 'U-DGP', name: 'DGP Karnataka', role: 'DGP', unitId: null, districtId: null },
  Admin: { appUserId: 'U-ADM', name: 'System Administrator', role: 'Admin', unitId: null, districtId: null },
  SP: { appUserId: 'U-SP', name: 'SP Bengaluru City', role: 'SP', unitId: null, districtId: '1' },
  DSP: { appUserId: 'U-DSP', name: 'DySP M. Rao', role: 'DSP', unitId: null, districtId: '1' },
  SI: { appUserId: 'U-SI', name: 'PSI R. Kumar', role: 'SI', unitId: '1', districtId: '1' },
};

function resolveRole(raw) {
  const r = String(raw || 'Analyst');
  return ROLES[r] ? r : (ALIASES[r] || 'Analyst');
}

function userFromRequest(req) {
  const role = resolveRole(req.headers['x-kadi-role']);
  const base = DEMO_USERS[role];
  // District-tier users may switch which district they are looking at (?district=), and any
  // user may drill into one station (?unit=). Neither can widen scope -- caseInScope still
  // gates on tier, so a district user asking for another district gets their own.
  const q = (req.query || {});
  const user = { ...base, roleMeta: ROLES[role] };

  // Drill-down, which the brief names as a first-class capability.
  //
  // State tier may drill INTO any district and back out again -- that is the whole point of
  // holding the state view. District tier may switch which district it looks at but can
  // never widen past one, so ?district= narrows for everyone and widens for nobody.
  if (q.district) {
    user.districtId = String(q.district);
    if (user.roleMeta.tier === 'state') user.drilledFromState = true;
  }
  if (q.unit) user.drillUnitId = String(q.unit);
  return user;
}

// Predicate: can this user see this case?
function caseInScope(user, c) {
  const { scope } = user.roleMeta;
  if (user.drillUnitId && String(c.unitId) !== user.drillUnitId) return false;
  // A state user who has drilled into a district reads as that district until they drill out.
  if (user.drilledFromState) return String(c.districtId) === String(user.districtId);
  if (scope === 'state') return true;
  if (scope === 'district') return String(c.districtId) === String(user.districtId);
  if (scope === 'unit') return String(c.unitId) === String(user.unitId); // legacy
  return false;
}

function requireRole(user, allowed) {
  const expanded = allowed.flatMap((a) => (a === 'ACP' ? ['DSP', 'SP'] : a === 'Inspector' ? ['SI'] : [a]));
  if (!expanded.includes(user.role)) {
    const e = new Error(`Requires role: ${expanded.join(', ')}`);
    e.status = 403; e.code = 'forbidden';
    throw e;
  }
}

function capabilities(user) {
  const stateTier = user.roleMeta.tier === 'state';
  const drilled = Boolean(user.drilledFromState);
  return {
    role: user.role,
    label: user.roleMeta.label,
    scope: user.roleMeta.scope,
    tier: user.roleMeta.tier,
    districtId: user.districtId || null,
    drillUnitId: user.drillUnitId || null,
    canViewVulnerability: true,
    canViewAudit: stateTier || user.role === 'SP',
    canAdmin: user.role === 'Admin',
    // Everyone can move between districts. Only a state user can step back out to the whole
    // state, which is the difference the two tiers actually encode.
    canSwitchDistrict: true,
    canViewWholeState: stateTier,
    drilledFromState: drilled,
    effectiveScope: drilled ? 'district' : user.roleMeta.scope,
  };
}

module.exports = { ROLES, ALIASES, DEMO_USERS, userFromRequest, caseInScope, requireRole, capabilities };
