// Role-based access control. Enforced server-side on every endpoint.
//
// THREE TIERS, mirroring how the force is actually organised -- state, district, station.
// Each is a genuine read boundary enforced on every query, not a label:
//
//   STATE    SCRB Analyst, DGP, Administrator   all 31 districts
//   DISTRICT SP, DySP                            one district, plus cases linked into it
//   STATION  SHO                                 one police station's own register
//
// The station tier is the ground floor of the hierarchy and the one the whole product argues
// against: an SHO sees their own register and nothing else, which is precisely the silo the
// brief describes. Giving that view its own login makes the argument demonstrable rather than
// asserted -- you can stand in it, see how little is visible, and then step up a tier.
//
// Only ONE station is provisioned, deliberately. This is a prototype, and a station tier that
// works for one real station with real volume is more honest than 298 shells. Bengaluru Bazaar
// PS was chosen because it carries the largest register in Bengaluru City (276 cases, 152 of
// them linked to cases elsewhere), so the silo argument has something to show.
// Names for the scope readout. Kept here rather than looked up from the store so rbac stays
// free of a data dependency -- it is imported by tests that never load the corpus.
const DISTRICT_NAMES = {
  1: 'Bengaluru City', 2: 'Bengaluru Rural', 3: 'Mysuru', 4: 'Mandya', 5: 'Hassan',
  6: 'Tumakuru', 7: 'Kalaburagi', 8: 'Ballari', 9: 'Vijayapura', 10: 'Belagavi',
  11: 'Dharwad', 12: 'Hubballi-Dharwad', 13: 'Udupi', 14: 'Dakshina Kannada',
  15: 'Uttara Kannada', 16: 'Shivamogga', 17: 'Chitradurga', 18: 'Davanagere',
  19: 'Kolar', 20: 'Chikkaballapura', 21: 'Ramanagara', 22: 'Chamarajanagar',
  23: 'Kodagu', 24: 'Chikkamagaluru', 25: 'Haveri', 26: 'Gadag', 27: 'Bagalkote',
  28: 'Koppal', 29: 'Raichur', 30: 'Yadgir', 31: 'Bidar',
};

const STATION_UNIT_ID = '46';
const STATION_NAME = 'Bengaluru Bazaar PS';

const ROLES = {
  // --- state tier ---
  Analyst: { level: 2, label: 'SCRB Analyst', scope: 'state', tier: 'state' },
  DGP: { level: 1, label: 'State DGP', scope: 'state', tier: 'state' },
  Admin: { level: 1, label: 'Administrator', scope: 'state', tier: 'state' },
  // --- district tier ---
  SP: { level: 3, label: 'Superintendent of Police', scope: 'district', tier: 'district' },
  DSP: { level: 4, label: 'DySP / ACP', scope: 'district', tier: 'district' },
  // --- station tier ---
  // Both posts work out of a single station, so both read one register. An SI investigating
  // from a station desk has exactly the visibility problem this tier exists to show.
  SHO: { level: 5, label: 'Station House Officer', scope: 'unit', tier: 'station' },
  SI: { level: 5, label: 'Sub-Inspector (IO)', scope: 'unit', tier: 'station' },
};

// Older role names still arrive from cached clients and saved links. Map rather than 404.
const ALIASES = { Inspector: 'SI', ACP: 'DSP', SCRB: 'Analyst' };

const DEMO_USERS = {
  Analyst: { appUserId: 'U-ANA', name: 'SCRB Analyst', role: 'Analyst', unitId: null, districtId: null },
  DGP: { appUserId: 'U-DGP', name: 'DGP Karnataka', role: 'DGP', unitId: null, districtId: null },
  Admin: { appUserId: 'U-ADM', name: 'System Administrator', role: 'Admin', unitId: null, districtId: null },
  SP: { appUserId: 'U-SP', name: 'SP Bengaluru City', role: 'SP', unitId: null, districtId: '1' },
  DSP: { appUserId: 'U-DSP', name: 'DySP M. Rao', role: 'DSP', unitId: null, districtId: '1' },
  SI: { appUserId: 'U-SI', name: `PSI ${STATION_NAME}`, role: 'SI', unitId: STATION_UNIT_ID, districtId: '1' },
  SHO: { appUserId: 'U-SHO', name: `SHO ${STATION_NAME}`, role: 'SHO', unitId: STATION_UNIT_ID, districtId: '1' },
};

function resolveRole(raw) {
  const r = String(raw || 'Analyst');
  return ROLES[r] ? r : (ALIASES[r] || 'Analyst');
}

// A signed-in user's scope comes from their token, never from a header.
//
// This is the whole security boundary. The demo path deliberately trusts x-kadi-role, which
// is fine while it is only a demo -- but a real account must not be widenable by anything the
// browser can set, so when a valid token is present the header is ignored entirely and the
// district and station are read out of the signed payload.
function userFromToken(req) {
  // NOT the Authorization header. Catalyst's gateway claims that one for its own OAuth and
  // rejects the request with INVALID_TOKEN before it ever reaches this function -- the session
  // token has to travel under a name the platform does not already own.
  const token = req.headers['x-kadi-token'] || null;
  if (!token) return null;
  // Required late to avoid a cycle: auth.js reads datastore, which does not read rbac.
  // eslint-disable-next-line global-require
  const payload = require('./auth').verifyToken(token);
  if (!payload) return null;
  const role = resolveRole(payload.role);
  const meta = ROLES[role];
  const user = {
    appUserId: payload.sub,
    name: payload.name || meta.label,
    role,
    email: payload.sub,
    authenticated: true,
    districtId: payload.districtId || null,
    unitId: payload.unitId || null,
    roleMeta: meta,
  };
  // A state-tier account may still drill into a district -- that is a narrowing, and the
  // whole point of holding the state view. District and station accounts are pinned.
  if (meta.tier === 'state') {
    const q = req.query || {};
    if (q.district) { user.districtId = String(q.district); user.drilledFromState = true; }
    if (q.unit) user.drillUnitId = String(q.unit);
  }
  return user;
}

function userFromRequest(req) {
  const authed = userFromToken(req);
  if (authed) return authed;

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
  // A station user is pinned. Ignoring these rather than applying them keeps the boundary in
  // one place (caseInScope) instead of two that must agree.
  if (user.roleMeta.tier === 'station') return user;
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
  // Station tier first and unconditionally. ?district= and ?unit= must not be able to move it:
  // a tier whose boundary can be widened by editing the URL is decoration, and this is the one
  // tier the product's whole argument rests on being real.
  if (user.roleMeta.tier === 'station') return String(c.unitId) === String(user.unitId);
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
  const stationTier = user.roleMeta.tier === 'station';
  const drilled = Boolean(user.drilledFromState);
  return {
    unitName: stationTier ? STATION_NAME : null,
    // Resolved here so the shell can name the scope without a second lookup. The footer says
    // "Bengaluru City", not "district 1" -- an id tells a viewer nothing about what they hold.
    districtName: user.districtId ? (DISTRICT_NAMES[String(user.districtId)] || null) : null,
    role: user.role,
    label: user.roleMeta.label,
    scope: user.roleMeta.scope,
    tier: user.roleMeta.tier,
    districtId: user.districtId || null,
    // The station this account holds. The client needs the id, not just the name, to narrow a
    // panel to the officer's own register without string-matching on a display label.
    unitId: user.unitId || null,
    drillUnitId: user.drillUnitId || null,
    canViewVulnerability: true,
    canViewAudit: stateTier || user.role === 'SP',
    isStation: stationTier,
    canAdmin: user.role === 'Admin',
    // Sign-up requests are decided by the two posts that hold the whole state.
    canApproveAccounts: user.role === 'DGP' || user.role === 'Admin',
    // The write path, mirroring the chain of command rather than inventing a new one: the
    // station registers a case, a supervisor lets it stand. Kept here so the interface and
    // the server read the same rule -- when the two hold their own copies they drift, and the
    // one that drifts is always the one that renders a button the server then refuses.
    canSubmitCase: stationTier,
    canApproveCases: user.role === 'DGP' || user.role === 'Admin' || user.role === 'SP',
    // True only for a token-backed session. The interface uses it to say which way you came
    // in, because "demo" and "signed in as SP Mysuru" must never look the same.
    authenticated: Boolean(user.authenticated),
    email: user.email || null,
    // Everyone can move between districts. Only a state user can step back out to the whole
    // state, which is the difference the two tiers actually encode.
    // Who may move between districts.
    //
    // A station officer never can. Neither can a SIGNED-IN district officer: SP Mysuru holds
    // Mysuru, and the server already refuses anything else -- but a switcher that silently
    // returns the same district is worse than no switcher, because it looks broken rather
    // than bounded. The demo district tier keeps it, since switching freely is the whole
    // point of a demonstration.
    canSwitchDistrict: !stationTier && !(user.authenticated && user.roleMeta.tier === 'district'),
    canViewWholeState: stateTier,
    drilledFromState: drilled,
    effectiveScope: stationTier ? 'unit' : (drilled ? 'district' : user.roleMeta.scope),
  };
}

module.exports = {
  ROLES, ALIASES, DEMO_USERS, userFromRequest, userFromToken, caseInScope, requireRole, capabilities,
  STATION_UNIT_ID, STATION_NAME,
};
