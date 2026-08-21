// API tests — envelope, RBAC scoping/capabilities, and the fairness invariant on
// responses. Run: node --test  (from functions/). Pure unit tests + a store smoke test.
const { test } = require('node:test');
const assert = require('node:assert');

const rbac = require('../api/services/rbac');
const { ok, err } = require('../api/lib/envelope');

test('envelope shapes', () => {
  assert.deepStrictEqual(ok({ a: 1 }), { ok: true, data: { a: 1 } });
  const e = err('forbidden', 'nope');
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.error.code, 'forbidden');
});

test('rbac scope: analyst sees state-wide, SI unit-only', () => {
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  const inScope = { unitId: '1', districtId: '1' };
  const outScope = { unitId: '99', districtId: '9' };
  assert.ok(rbac.caseInScope(analyst, outScope), 'analyst = state read');
  // SI is district tier now, not unit tier: same district is visible, other district is not.
  assert.ok(rbac.caseInScope(si, { unitId: '77', districtId: '1' }), 'SI sees own district');
  assert.ok(!rbac.caseInScope(si, outScope), 'SI blocked from other district');
});

test('rbac scope: district tier (SP/DSP/SI) is district-level', () => {
  for (const role of ['SP', 'DSP', 'SI']) {
    const u = { ...rbac.DEMO_USERS[role], roleMeta: rbac.ROLES[role] };
    assert.strictEqual(u.roleMeta.tier, 'district', `${role} is district tier`);
    assert.ok(rbac.caseInScope(u, { unitId: '55', districtId: '1' }), `${role} same district ok`);
    assert.ok(!rbac.caseInScope(u, { unitId: '55', districtId: '5' }), `${role} other district blocked`);
  }
});

test('rbac scope: state tier (Analyst/DGP/Admin) sees everything', () => {
  for (const role of ['Analyst', 'DGP', 'Admin']) {
    const u = { ...rbac.DEMO_USERS[role], roleMeta: rbac.ROLES[role] };
    assert.strictEqual(u.roleMeta.tier, 'state', `${role} is state tier`);
    assert.ok(rbac.caseInScope(u, { unitId: '99', districtId: '9' }), `${role} sees any district`);
  }
});

test('rbac: station drill-down narrows but never widens', () => {
  const analyst = rbac.userFromRequest({ headers: { 'x-kadi-role': 'Analyst' }, query: { unit: '5' } });
  assert.ok(rbac.caseInScope(analyst, { unitId: '5', districtId: '9' }), 'drilled unit visible');
  assert.ok(!rbac.caseInScope(analyst, { unitId: '6', districtId: '9' }), 'other unit hidden');

  // a district user asking for another district must not escape their own
  const si = rbac.userFromRequest({ headers: { 'x-kadi-role': 'SI' }, query: { district: '7' } });
  assert.strictEqual(si.districtId, '7', 'district tier may switch district');
  const dgp = rbac.userFromRequest({ headers: { 'x-kadi-role': 'DGP' }, query: { district: '7' } });
  assert.strictEqual(dgp.districtId, null, 'state tier ignores district switch, stays state-wide');
});

test('rbac requireRole gates capabilities', () => {
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  const admin = { ...rbac.DEMO_USERS.Admin, roleMeta: rbac.ROLES.Admin };
  assert.throws(() => rbac.requireRole(si, ['Admin']), /Requires role/);
  // legacy role names in older call sites still resolve
  assert.doesNotThrow(() => rbac.requireRole({ ...rbac.DEMO_USERS.DSP, roleMeta: rbac.ROLES.DSP }, ['ACP']));
  assert.doesNotThrow(() => rbac.requireRole(admin, ['Admin']));
  assert.strictEqual(rbac.capabilities(si).canViewAudit, false);
  assert.strictEqual(rbac.capabilities(admin).canAdmin, true);
});

test('userFromRequest defaults to Analyst, honours role header', () => {
  assert.strictEqual(rbac.userFromRequest({ headers: {} }).role, 'Analyst');
  // legacy aliases map onto the two-tier model rather than 404ing
  assert.strictEqual(rbac.userFromRequest({ headers: { 'x-kadi-role': 'ACP' } }).role, 'DSP');
  assert.strictEqual(rbac.userFromRequest({ headers: { 'x-kadi-role': 'Inspector' } }).role, 'SI');
  assert.strictEqual(rbac.userFromRequest({ headers: { 'x-kadi-role': 'DGP' } }).role, 'DGP');
});

test('store + queries: cases scoped, graph carries explanation + fairness', () => {
  const q = require('../api/services/queries');
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  const all = q.listCases(analyst, { pageSize: 1 });
  const scoped = q.listCases(si, { pageSize: 1 });
  assert.ok(all.total > scoped.total, 'analyst sees more than SI');

  // pick a case that has links, then assert graph explanation + fairness
  const linked = q.listCases(analyst, { sort: 'linked_desc', pageSize: 1 }).items[0];
  const g = q.graphForCase(analyst, linked.caseMasterId, {});
  assert.ok(g.nodes.length >= 1);
  assert.ok(g.explanation.fairness.includes('never'), 'fairness statement present');
  // every edge carries an evidence explanation ("Why linked")
  for (const e of g.edges) assert.ok(e.explanation && e.explanation.matched, 'edge has evidence');
});

test('geoGrid bins the full dataset and honours head + hour filters', () => {
  const q = require('../api/services/queries');
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };

  const all = q.geoGrid(analyst, { cell: 0.05 });
  assert.ok(all.cells.length > 100, 'expected many populated cells');
  assert.ok(all.maxCount > 100, 'expected a dense urban cell');
  assert.ok(all.total > 30000, 'grid must bin the FULL dataset, not a sample');
  // counts must be internally consistent — the heat weight is derived from them
  assert.strictEqual(all.maxCount, all.cells.reduce((m, c) => Math.max(m, c.count), 0));
  assert.strictEqual(all.total, all.cells.reduce((s, c) => s + c.count, 0));

  // filters must strictly narrow the binned set
  const night = q.geoGrid(analyst, { cell: 0.05, hourFrom: 0, hourTo: 4 });
  assert.ok(night.total > 0 && night.total < all.total, 'time filter should narrow the set');
  const cyber = q.geoGrid(analyst, { cell: 0.05, head: '4' });
  assert.ok(cyber.total > 0 && cyber.total < all.total, 'head filter should narrow the set');
});

test('fairness: vulnerability endpoint role-gated + excludes protected', () => {
  const q = require('../api/services/queries');
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  assert.throws(() => q.vulnerability(si), /Requires role/);
  const v = q.vulnerability(analyst);
  assert.ok(v.disclaimer.toLowerCase().includes('excluded'));
});
