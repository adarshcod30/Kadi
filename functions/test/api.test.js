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

  // District tier may move between districts but is always confined to exactly one.
  const si = rbac.userFromRequest({ headers: { 'x-kadi-role': 'SI' }, query: { district: '7' } });
  assert.strictEqual(si.districtId, '7', 'district tier may switch district');
  assert.ok(!si.drilledFromState, 'district tier was never at state scope to drill from');
  assert.ok(rbac.caseInScope(si, { unitId: '1', districtId: '7' }), 'sees the switched district');
  assert.ok(!rbac.caseInScope(si, { unitId: '1', districtId: '8' }), 'still cannot see another');
  assert.strictEqual(rbac.capabilities(si).canViewWholeState, false, 'cannot step out to state');

  // State tier drills IN and can step back OUT -- that is what holding the state view buys.
  const dgp = rbac.userFromRequest({ headers: { 'x-kadi-role': 'DGP' }, query: { district: '7' } });
  assert.strictEqual(dgp.districtId, '7', 'state tier may drill into a district');
  assert.ok(dgp.drilledFromState, 'and is marked as having drilled in');
  assert.ok(rbac.caseInScope(dgp, { unitId: '1', districtId: '7' }), 'reads as that district');
  assert.ok(!rbac.caseInScope(dgp, { unitId: '1', districtId: '8' }),
    'a drilled state user is genuinely narrowed, not merely labelled');
  assert.strictEqual(rbac.capabilities(dgp).effectiveScope, 'district');
  assert.strictEqual(rbac.capabilities(dgp).canViewWholeState, true, 'may drill back out');

  const dgpOut = rbac.userFromRequest({ headers: { 'x-kadi-role': 'DGP' }, query: {} });
  assert.ok(rbac.caseInScope(dgpOut, { unitId: '1', districtId: '8' }), 'and drilling out restores state scope');
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

// Paging and sorting are the two things a 60,000-row register cannot be used without, and
// both fail quietly: a broken page-2 looks like "the list ends here", and a broken sort looks
// like data that happens to be in that order. Assert them rather than eyeball them.
test('cases: paging returns disjoint pages and every sort is total', () => {
  const q = require('../api/services/queries');
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };

  const p1 = q.listCases(analyst, { pageSize: 25, page: 1 });
  const p2 = q.listCases(analyst, { pageSize: 25, page: 2 });
  assert.strictEqual(p1.page, 1);
  assert.strictEqual(p2.page, 2);
  assert.strictEqual(p1.items.length, 25);
  assert.strictEqual(p1.total, p2.total, 'total must not depend on the page requested');
  const overlap = new Set(p1.items.map((c) => c.caseMasterId));
  assert.ok(!p2.items.some((c) => overlap.has(c.caseMasterId)), 'pages must be disjoint');

  // The last page must be reachable and non-empty -- an off-by-one here strands the tail.
  const lastPage = Math.ceil(p1.total / 25);
  assert.ok(q.listCases(analyst, { pageSize: 25, page: lastPage }).items.length > 0);

  const asc = q.listCases(analyst, { pageSize: 50, sort: 'date_asc' }).items;
  assert.ok(asc.every((c, i) => i === 0 || asc[i - 1].crimeRegisteredDate <= c.crimeRegisteredDate));
  const linked = q.listCases(analyst, { pageSize: 50, sort: 'linked_desc' }).items;
  assert.ok(linked.every((c, i) => i === 0 || linked[i - 1].linkedCount >= c.linkedCount));
  const heinous = q.listCases(analyst, { pageSize: 50, sort: 'gravity_desc' }).items;
  assert.ok(heinous.every((c) => c.gravity === 'Heinous'), 'heinous must sort ahead of the rest');
  const sev = q.listCases(analyst, { pageSize: 50, sort: 'severity_desc' }).items;
  assert.ok(sev.every((c) => c.healthSeverity === 'high'), 'high severity must sort first');

  // An unknown sort must fall back, not throw or silently return an unsorted page.
  assert.strictEqual(q.listCases(analyst, { sort: 'nonsense' }).sort, 'date_desc');

  // Summary counts describe the whole filtered set, so they cannot depend on the page.
  assert.deepStrictEqual(p1.summary, p2.summary);
  const linkedOnly = q.listCases(analyst, { linked: 'true', pageSize: 1 });
  assert.strictEqual(linkedOnly.total, p1.summary.linked, 'summary.linked must match the filter it offers');
  assert.ok(linkedOnly.items.every((c) => c.linkedCount > 0));
});

test('offenders: whole watchlist is reachable by paging, and filters agree with the summary', () => {
  const q = require('../api/services/queries');
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };

  const first = q.listOffenders(analyst, { pageSize: 50 });
  assert.ok(first.total > 100, 'watchlist should hold the full repeat-offender set');
  // Walk every page: the union must be the whole list with no duplicates. This is the
  // regression guard for a list that silently showed only its first page.
  const seen = new Set();
  const pages = Math.ceil(first.total / 50);
  for (let p = 1; p <= pages; p += 1) {
    for (const o of q.listOffenders(analyst, { pageSize: 50, page: p }).items) seen.add(o.offenderIdentityId);
  }
  assert.strictEqual(seen.size, first.total, 'every offender must be reachable by paging');

  const risk = q.listOffenders(analyst, { pageSize: 100, sort: 'risk_desc' }).items;
  assert.ok(risk.every((o, i) => i === 0 || risk[i - 1].riskScore >= o.riskScore));
  const recent = q.listOffenders(analyst, { pageSize: 100, sort: 'recent_desc' }).items;
  assert.ok(recent.every((o, i) => i === 0 || (recent[i - 1].lastSeen || '') >= (o.lastSeen || '')));
  const reach = q.listOffenders(analyst, { pageSize: 100, sort: 'districts_desc' }).items;
  assert.ok(reach.every((o, i) => i === 0 || reach[i - 1].distinctDistricts >= o.distinctDistricts));

  // Each headline count must be exactly what its own filter returns, or the chips lie.
  assert.strictEqual(q.listOffenders(analyst, { band: 'High', pageSize: 1 }).total, first.summary.high);
  assert.strictEqual(q.listOffenders(analyst, { crossDistrict: 'true', pageSize: 1 }).total, first.summary.crossDistrict);
  assert.strictEqual(q.listOffenders(analyst, { networked: 'true', pageSize: 1 }).total, first.summary.networked);

  // Recency is measured against the corpus, not wall-clock, so it must stay stable over time.
  assert.match(String(first.asOf), /^\d{4}-\d{2}-\d{2}$/);
  const active = q.listOffenders(analyst, { activeDays: '90', pageSize: 1 });
  assert.ok(active.total > 0 && active.total < first.total, 'recency filter should narrow the set');

  // Entity resolution is the point of this list: an alias must find the identity it merged into.
  const withAlias = risk.find((o) => (o.nameVariants || []).some((v) => v !== o.canonicalName));
  if (withAlias) {
    const alias = withAlias.nameVariants.find((v) => v !== withAlias.canonicalName);
    const hits = q.listOffenders(analyst, { search: alias, pageSize: 200 }).items;
    assert.ok(hits.some((o) => o.offenderIdentityId === withAlias.offenderIdentityId),
      'searching a known alias must return the resolved identity');
  }
});

// Query strings are user input, and these list views are deliberately shareable -- so a
// hand-edited or truncated link is a normal input, not an edge case. It must degrade to
// page 1, never to an empty table that reads as "no such records".
test('paging survives junk query params', () => {
  const q = require('../api/services/queries');
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const baseline = q.listCases(analyst, {}).total;

  for (const bad of [{ page: 'abc' }, { page: '' }, { page: '-4' }, { page: '0' },
    { pageSize: 'abc' }, { pageSize: '0' }, { pageSize: '-10' }, { page: 'abc', pageSize: 'xyz' }]) {
    const r = q.listCases(analyst, bad);
    assert.ok(r.items.length > 0, `cases must not go empty for ${JSON.stringify(bad)}`);
    assert.strictEqual(r.total, baseline, 'total must be unaffected by junk paging');
    assert.ok(r.page >= 1 && Number.isFinite(r.page));
    assert.ok(r.pageSize >= 1 && r.pageSize <= 200);

    const o = q.listOffenders(analyst, bad);
    assert.ok(o.items.length > 0, `offenders must not go empty for ${JSON.stringify(bad)}`);
    assert.ok(o.pageSize >= 1 && o.pageSize <= 200);
  }
  // An over-large pageSize is clamped rather than honoured -- one request must not be able to
  // ask for the whole 60k corpus.
  assert.strictEqual(q.listCases(analyst, { pageSize: '99999' }).pageSize, 200);
});

// The station tier is the ground floor of the hierarchy and the one the product's argument
// rests on being real: an SHO sees their own register and nothing else. A boundary that can be
// widened by editing a query string is decoration, so it is asserted rather than assumed.
test('station tier: pinned to one register, and cannot be widened by query params', () => {
  const q = require('../api/services/queries');
  const sho = rbac.userFromRequest({
    headers: { 'x-kadi-role': 'SHO' },
    // A deliberate attempt to escape: another district AND another station.
    query: { district: '5', unit: '99' },
  });
  assert.strictEqual(sho.roleMeta.tier, 'station');
  assert.strictEqual(sho.unitId, rbac.STATION_UNIT_ID, 'must stay on its own station');
  assert.strictEqual(sho.districtId, '1', '?district= must not move a station user');
  assert.ok(!sho.drillUnitId, '?unit= must not be honoured for a station user');

  assert.ok(rbac.caseInScope(sho, { unitId: rbac.STATION_UNIT_ID, districtId: '1' }));
  assert.ok(!rbac.caseInScope(sho, { unitId: '35', districtId: '1' }), 'other station in same district blocked');
  assert.ok(!rbac.caseInScope(sho, { unitId: '99', districtId: '5' }), 'the escape attempt is blocked');

  const caps = rbac.capabilities(sho);
  assert.strictEqual(caps.effectiveScope, 'unit');
  assert.strictEqual(caps.canViewWholeState, false);
  assert.strictEqual(caps.canSwitchDistrict, false, 'a station officer has exactly one register');
  assert.strictEqual(caps.canViewAudit, false);

  // Every list must narrow, not just the case register. Offenders was the one that leaked:
  // it fell through to the state watchlist because the narrowing test only knew two tiers.
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const sCases = q.listCases(sho, { pageSize: 1 });
  const aCases = q.listCases(analyst, { pageSize: 1 });
  assert.ok(sCases.total > 0 && sCases.total < aCases.total / 50, 'station register is a small slice');

  const sOff = q.listOffenders(sho, { pageSize: 1 });
  assert.ok(sOff.total > 0, 'station should still surface its own repeat offenders');
  assert.ok(sOff.total < q.listOffenders(analyst, { pageSize: 1 }).total, 'offenders must narrow');
  assert.strictEqual(sOff.scope, 'unit');

  assert.ok(q.listHealth(sho, { pageSize: 1 }).total < q.listHealth(analyst, { pageSize: 1 }).total);
  assert.ok(q.geoPoints(sho, { limit: 9000 }).total < q.geoPoints(analyst, { limit: 9000 }).total,
    'the dot map must not show the whole state to a station officer');
  assert.ok(q.alerts(sho).length <= q.alerts(analyst).length);
  assert.ok(q.stats(sho).totalCases < q.stats(analyst).totalCases);

  // Every case the station CAN see must genuinely belong to it.
  for (const c of q.listCases(sho, { pageSize: 200 }).items) {
    assert.strictEqual(String(c.unitId), rbac.STATION_UNIT_ID);
  }
});

test('existing two tiers are unchanged by the addition of the third', () => {
  const q = require('../api/services/queries');
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const sp = { ...rbac.DEMO_USERS.SP, roleMeta: rbac.ROLES.SP };
  assert.strictEqual(rbac.capabilities(analyst).effectiveScope, 'state');
  assert.strictEqual(rbac.capabilities(sp).effectiveScope, 'district');
  assert.ok(q.listCases(analyst, { pageSize: 1 }).total > q.listCases(sp, { pageSize: 1 }).total);
  assert.ok(q.listOffenders(sp, { pageSize: 1 }).total < q.listOffenders(analyst, { pageSize: 1 }).total);
  // SI stays district-scoped: existing saved links must not silently narrow to a station.
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  assert.strictEqual(si.roleMeta.tier, 'district');
});
