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

test('rbac scope: analyst sees state-wide, SI is station-only', () => {
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  const outScope = { unitId: '99', districtId: '9' };
  assert.ok(rbac.caseInScope(analyst, outScope), 'analyst = state read');
  // SI works out of a station, so it reads one register -- not the whole district. An SI at a
  // station desk has exactly the visibility problem the station tier exists to demonstrate.
  assert.ok(rbac.caseInScope(si, { unitId: rbac.STATION_UNIT_ID, districtId: '1' }), 'SI sees own station');
  assert.ok(!rbac.caseInScope(si, { unitId: '77', districtId: '1' }), 'SI blocked from another station in its own district');
  assert.ok(!rbac.caseInScope(si, outScope), 'SI blocked from another district');
});

test('rbac scope: district tier (SP/DSP) is district-level', () => {
  for (const role of ['SP', 'DSP']) {
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
  const dsp = rbac.userFromRequest({ headers: { 'x-kadi-role': 'DSP' }, query: { district: '7' } });
  assert.strictEqual(dsp.districtId, '7', 'district tier may switch district');
  assert.ok(!dsp.drilledFromState, 'district tier was never at state scope to drill from');
  assert.ok(rbac.caseInScope(dsp, { unitId: '1', districtId: '7' }), 'sees the switched district');
  assert.ok(!rbac.caseInScope(dsp, { unitId: '1', districtId: '8' }), 'still cannot see another');
  assert.strictEqual(rbac.capabilities(dsp).canViewWholeState, false, 'cannot step out to state');

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
  // SI and SHO both work out of a station, so both sit at the station tier.
  assert.strictEqual(rbac.ROLES.SI.tier, 'station');
  assert.strictEqual(rbac.ROLES.SHO.tier, 'station');
});

// Authentication is the one place where a bug is a breach rather than a defect, so the
// boundary is asserted directly rather than inferred from the interface behaving.
test('auth: passwords are hashed, never stored or compared in plaintext', () => {
  const auth = require('../api/services/auth');
  const h = auth.hashPassword('correct horse battery staple');
  assert.ok(h.startsWith('scrypt$'), 'scrypt with a per-account salt');
  assert.ok(!h.includes('correct horse'), 'the plaintext must not appear in the hash');
  assert.ok(auth.verifyPassword('correct horse battery staple', h));
  assert.ok(!auth.verifyPassword('Correct horse battery staple', h), 'case matters');
  assert.ok(!auth.verifyPassword('', h));
  assert.ok(!auth.verifyPassword('x', 'not-a-hash'), 'a malformed record must refuse, not throw');

  // Two accounts with the same password must not share a hash, or one crack breaks both.
  assert.notStrictEqual(auth.hashPassword('same'), auth.hashPassword('same'));

  // Every provisioned account ships a hash and no plaintext.
  const all = [...auth.provisioned().values()];
  assert.strictEqual(all.length, 36, '3 state + 31 district + 2 station');
  for (const a of all) {
    assert.ok(a.passwordHash.startsWith('scrypt$'), `${a.email} must be hashed`);
    assert.ok(!('plain' in a), `${a.email} must not carry a plaintext password into the app`);
    assert.match(a.email, /@ksp\.gov\.in$/);
  }
});

test('auth: a token is tamper-evident and expires', () => {
  const auth = require('../api/services/auth');
  const acct = { email: 'sp.mysuru@ksp.gov.in', fullName: 'SP Mysuru', role: 'SP', districtId: '3', unitId: null };
  const tok = auth.issueToken(acct);
  const ok = auth.verifyToken(tok);
  assert.strictEqual(ok.role, 'SP');
  assert.strictEqual(ok.districtId, '3');

  // Re-signing a doctored payload requires the secret, which the client does not hold.
  const [body] = tok.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ ...ok, role: 'DGP', districtId: null })).toString('base64url');
  assert.strictEqual(auth.verifyToken(`${forgedBody}.${tok.split('.')[1]}`), null, 'payload swap must fail');
  assert.strictEqual(auth.verifyToken(`${body}.deadbeef`), null, 'signature swap must fail');
  assert.strictEqual(auth.verifyToken('garbage'), null);
  assert.strictEqual(auth.verifyToken(''), null);
  assert.strictEqual(auth.verifyToken(null), null);

  const expired = auth.issueToken(acct);
  const [b] = expired.split('.');
  const stale = JSON.parse(Buffer.from(b, 'base64url').toString());
  stale.exp = Date.now() - 1000;
  const staleBody = Buffer.from(JSON.stringify(stale)).toString('base64url');
  assert.strictEqual(auth.verifyToken(`${staleBody}.${expired.split('.')[1]}`), null, 'expiry is enforced');
});

test('auth: a signed-in district account cannot widen its own scope', () => {
  const auth = require('../api/services/auth');
  const q = require('../api/services/queries');
  const mysuru = [...auth.provisioned().values()].find((a) => a.email.startsWith('sp.mysuru@'));
  assert.ok(mysuru, 'SP Mysuru must be provisioned');
  const token = auth.issueToken(mysuru);

  // Every escape route a browser has: a forged role header, another district, another unit.
  const u = rbac.userFromRequest({
    headers: { 'x-kadi-token': token, 'x-kadi-role': 'DGP' },
    query: { district: '1', unit: '46' },
  });
  assert.strictEqual(u.role, 'SP', 'the header must be ignored when a token is present');
  assert.strictEqual(u.districtId, mysuru.districtId, 'the token pins the district');
  assert.ok(!u.drillUnitId, '?unit= must not apply to a district account');
  assert.ok(rbac.caseInScope(u, { unitId: '9', districtId: mysuru.districtId }));
  assert.ok(!rbac.caseInScope(u, { unitId: '46', districtId: '1' }), 'Bengaluru City stays unreachable');
  assert.strictEqual(rbac.capabilities(u).canViewWholeState, false);
  assert.strictEqual(rbac.capabilities(u).canApproveAccounts, false);

  // And the register it reads is genuinely only its own district.
  for (const c of q.listCases(u, { pageSize: 100 }).items) {
    assert.strictEqual(String(c.districtId), mysuru.districtId);
  }
});

test('auth: state accounts may drill in; only DGP and Admin approve', () => {
  const auth = require('../api/services/auth');
  const seeded = (p) => [...auth.provisioned().values()].find((a) => a.email.startsWith(p));
  const asUser = (acct, query = {}) => rbac.userFromRequest({
    headers: { 'x-kadi-token': auth.issueToken(acct) }, query,
  });

  // A state account drilling into a district is a NARROWING, which is the point of the tier.
  const dgp = asUser(seeded('dgp@'), { district: '3' });
  assert.strictEqual(dgp.districtId, '3');
  assert.ok(dgp.drilledFromState);
  assert.ok(!rbac.caseInScope(dgp, { unitId: '1', districtId: '8' }), 'a drilled state user is genuinely narrowed');
  assert.ok(rbac.caseInScope(asUser(seeded('dgp@')), { unitId: '1', districtId: '8' }), 'and can step back out');

  assert.strictEqual(rbac.capabilities(asUser(seeded('dgp@'))).canApproveAccounts, true);
  assert.strictEqual(rbac.capabilities(asUser(seeded('admin@'))).canApproveAccounts, true);
  assert.strictEqual(rbac.capabilities(asUser(seeded('scrb.analyst@'))).canApproveAccounts, false,
    'the analyst holds the whole state but does not decide who gets in');
  assert.strictEqual(rbac.capabilities(asUser(seeded('sho.'))).canApproveAccounts, false);
});

test('auth: a station account reads one register whichever post holds it', () => {
  const auth = require('../api/services/auth');
  const q = require('../api/services/queries');
  for (const prefix of ['sho.', 'si.']) {
    const acct = [...auth.provisioned().values()].find((a) => a.email.startsWith(prefix));
    assert.ok(acct, `${prefix} account must be provisioned`);
    const u = rbac.userFromRequest({
      headers: { 'x-kadi-token': auth.issueToken(acct) },
      query: { district: '9', unit: '77' },
    });
    assert.strictEqual(u.roleMeta.tier, 'station', `${acct.role} is station tier`);
    assert.ok(rbac.caseInScope(u, { unitId: rbac.STATION_UNIT_ID, districtId: '1' }));
    assert.ok(!rbac.caseInScope(u, { unitId: '77', districtId: '9' }), 'cannot be moved by query params');
    for (const c of q.listCases(u, { pageSize: 50 }).items) {
      assert.strictEqual(String(c.unitId), rbac.STATION_UNIT_ID);
    }
  }
});

test('auth: sign-up is domain-gated and lands pending', async () => {
  const auth = require('../api/services/auth');
  // No Catalyst context in tests, so the Data Store write cannot succeed -- but every
  // validation ahead of it must still reject before reaching that point.
  const bad = [
    [{ email: 'someone@gmail.com', password: 'longenoughpw', fullName: 'A B', role: 'SP', districtId: '3' }, /ksp\.gov\.in/],
    [{ email: 'a@ksp.gov.in', password: 'short', fullName: 'A B', role: 'SP', districtId: '3' }, /10 characters/],
    [{ email: 'a@ksp.gov.in', password: 'longenoughpw', fullName: '', role: 'SP', districtId: '3' }, /full name/],
    // DGP and Admin decide who gets in, so they cannot be self-requested.
    [{ email: 'a@ksp.gov.in', password: 'longenoughpw', fullName: 'A B', role: 'DGP' }, /valid post/],
    [{ email: 'a@ksp.gov.in', password: 'longenoughpw', fullName: 'A B', role: 'Admin' }, /valid post/],
    [{ email: 'a@ksp.gov.in', password: 'longenoughpw', fullName: 'A B', role: 'SP' }, /district/],
  ];
  for (const [body, pattern] of bad) {
    const out = await auth.signup({ headers: {} }, body);
    assert.strictEqual(out.ok, false, `must reject ${JSON.stringify(body)}`);
    assert.match(out.error, pattern);
  }
  // An address that already belongs to a provisioned account cannot be claimed.
  const taken = await auth.signup({ headers: {} },
    { email: 'dgp@ksp.gov.in', password: 'longenoughpw', fullName: 'Not The DGP', role: 'SP', districtId: '3' });
  assert.strictEqual(taken.ok, false);
  assert.match(taken.error, /already exists/);
});

test('auth: an unapproved account is refused a token', async () => {
  const auth = require('../api/services/auth');
  // Refusal happens at the login endpoint, not in the interface -- a pending account that is
  // merely hidden from a menu is not an approval chain.
  const out = await auth.login({ headers: {} }, 'nobody@ksp.gov.in', 'whatever-password');
  assert.strictEqual(out.ok, false);
  assert.ok(!out.token);
  // The same message for a missing account and a wrong password: distinguishing them turns
  // the login form into a directory of who holds an account.
  const wrongPw = await auth.login({ headers: {} }, 'dgp@ksp.gov.in', 'definitely-not-it');
  assert.strictEqual(wrongPw.ok, false);
  assert.strictEqual(wrongPw.error, out.error);
});

// ---- the write path -------------------------------------------------------------------
// The rules that decide who may register a case and who may let it stand. These are the two
// predicates the interface and the server both read, so they are worth pinning: a drift here
// shows up as a button that renders and then 403s.
test('submissions: only the station tier may register a case', () => {
  const subs = require('../api/services/submissions');
  const as = (role) => ({ ...rbac.DEMO_USERS[role], roleMeta: rbac.ROLES[role] });
  for (const role of ['SI', 'SHO']) assert.ok(subs.canSubmit(as(role)), `${role} registers cases`);
  for (const role of ['SP', 'DSP', 'Analyst', 'DGP', 'Admin']) {
    assert.ok(!subs.canSubmit(as(role)), `${role} does not register cases`);
  }
});

test('submissions: approval authority ends at the approver district', () => {
  const subs = require('../api/services/submissions');
  const as = (role) => ({ ...rbac.DEMO_USERS[role], roleMeta: rbac.ROLES[role] });
  // null means unrestricted, which is exactly the difference between holding the state and
  // holding one district -- an SP must never be handed a null here.
  assert.strictEqual(subs.approvalDistrict(as('DGP')), null);
  assert.strictEqual(subs.approvalDistrict(as('Admin')), null);
  assert.strictEqual(subs.approvalDistrict(as('SP')), '1');
  for (const role of ['SP', 'DGP', 'Admin']) assert.ok(subs.canApprove(as(role)), `${role} approves`);
  for (const role of ['SI', 'SHO', 'DSP', 'Analyst']) assert.ok(!subs.canApprove(as(role)), `${role} does not approve`);
});

test('submissions: a submission is refused before it reaches the store', async () => {
  const subs = require('../api/services/submissions');
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI, email: 'si@ksp.gov.in' };
  const analyst = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const good = {
    crimeNo: '100010064202600099', crimeHeadId: '1', crimeSubHeadId: '12',
    crimeRegisteredDate: '2026-06-01', briefFacts: 'A chain snatching reported near the market.',
  };
  assert.strictEqual((await subs.submit({ headers: {} }, analyst, good)).status, 403, 'wrong tier');
  const bad = [
    [{ ...good, crimeNo: 'abc' }, /crime number/],
    [{ ...good, crimeSubHeadId: '' }, /head/],
    [{ ...good, crimeRegisteredDate: '01-06-2026' }, /date of registration/],
    [{ ...good, crimeRegisteredDate: '2099-01-01' }, /future/],
    [{ ...good, briefFacts: 'theft' }, /sentence/],
  ];
  for (const [body, pattern] of bad) {
    const out = await subs.submit({ headers: {} }, si, body);
    assert.strictEqual(out.ok, false, `must reject ${JSON.stringify(body).slice(0, 60)}`);
    assert.match(out.error, pattern);
  }

  // The form can only offer real crime heads, but the endpoint is reachable without the form,
  // and a case whose sub-head resolves to nothing renders as a blank crime type everywhere.
  const lookups = require('../api/services/queries').lookups();
  const real = lookups.subheads[0];
  const otherHead = lookups.heads.find((h) => String(h.id) !== String(real.headId));
  const cases = [
    [{ ...good, crimeHeadId: real.headId, crimeSubHeadId: '999999' }, /does not exist/],
    [{ ...good, crimeHeadId: otherHead.id, crimeSubHeadId: real.id }, /does not belong/],
    [{ ...good, crimeHeadId: real.headId, crimeSubHeadId: real.id, gravityId: '99' }, /gravity does not exist/],
  ];
  for (const [body, pattern] of cases) {
    const out = await subs.submit({ headers: {} }, si, body, lookups);
    assert.strictEqual(out.ok, false, `must reject ${JSON.stringify(body).slice(0, 70)}`);
    assert.match(out.error, pattern);
  }
});

test('submissions: live case ids cannot collide with corpus case ids', () => {
  const subs = require('../api/services/submissions');
  assert.ok(subs.isLiveId('LIVE-55468000000181028'));
  // An 18-digit CaseMasterID from the corpus must never read as live -- a collision would
  // attach one case's parties to another.
  assert.ok(!subs.isLiveId('100010064202300018'));
});

test('read model: approved cases union into the register but not into the derived surfaces', () => {
  const q = require('../api/services/queries');
  const sp = { ...rbac.DEMO_USERS.SP, roleMeta: rbac.ROLES.SP };
  const before = q.filterCases(sp, {}).rows.length;
  const live = {
    caseMasterId: 'LIVE-1', crimeNo: '100010064202600099', crimeRegisteredDate: '2026-06-02',
    unitId: '46', districtId: '1', crimeHeadId: '1', crimeSubHeadId: '12',
    statusId: '1', gravityId: '1', categoryId: '1', linkedCount: 0, healthSeverity: null,
    latitude: null, longitude: null, awaitingAnalysis: true, source: 'live',
  };
  const withLive = { ...sp, _live: [live] };
  assert.strictEqual(q.filterCases(withLive, {}).rows.length, before + 1, 'register grows by one');
  // Out of district, it must not be visible at all -- the live rows go through the same scope
  // filter as everything else rather than around it.
  const other = { ...rbac.DEMO_USERS.SP, roleMeta: rbac.ROLES.SP, districtId: '3', _live: [live] };
  assert.ok(!q.filterCases(other, {}).rows.some((c) => c.caseMasterId === 'LIVE-1'), 'scoped out');
  // And a user with no live rows sees exactly what the bundle holds.
  assert.strictEqual(q.filterCases(sp, {}).rows.length, before);
});

test('forecasting: a live case in a new month must not move the corpus clock', () => {
  const q = require('../api/services/queries');
  const fc = require('../api/services/forecasting');
  const user = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  const rows = q.scopeBaseline(user);

  // The write path broke this the day it shipped. Momentum and emerging risk both took "the
  // last complete month" to be months[length - 2] -- the last month minus one, assuming
  // exactly one trailing month is partial because the extract was pulled mid-month. One case
  // registered today opens a new month, the partial month slides one position, and both
  // analyses silently read a fortnight as a full month: the state reported -24% falling and
  // emerging risk returned nothing at all, on a corpus that had not changed.
  const live = {
    ...rows[0], caseMasterId: 'LIVE-x', crimeRegisteredDate: '2026-08-26',
    crimeSubHeadId: '203', districtId: '1',
  };
  const withLive = rows.concat([live, { ...live, caseMasterId: 'LIVE-y' }]);

  const before = fc.momentum(rows);
  const after = fc.momentum(withLive);
  assert.strictEqual(after.changePct, before.changePct, 'two live cases must not move the trend');
  assert.strictEqual(after.series[after.series.length - 1].month,
    before.series[before.series.length - 1].month, 'the last complete month must not move');

  const erBefore = fc.emergingRisk(rows);
  const erAfter = fc.emergingRisk(withLive);
  assert.strictEqual(erAfter.asOfMonth, erBefore.asOfMonth);
  assert.ok(erAfter.total > 0, 'emerging risk must not collapse to zero');
  assert.strictEqual(erAfter.total, erBefore.total);
});

// The scope label an officer reads must name the district whose cases they are being shown.
//
// rbac holds its own id -> name map so it stays importable without loading the corpus, and
// that copy had drifted: 25 of the 31 names disagreed with the district table, so ?district=6
// announced "Tumakuru" while returning Kalaburagi's stations. Every screen that reads
// capabilities().districtName was mislabelled, and nothing failed -- both halves were
// internally consistent, they simply disagreed with each other. This is the assertion that
// was missing.
test('rbac district names match the corpus district table', () => {
  const q = require('../api/services/queries');
  const districts = q.db().lookups.districts;
  const wrong = [];
  for (const [id, row] of districts) {
    const label = rbac.DISTRICT_NAMES[Number(id)];
    if (label !== row.DistrictName) wrong.push(`${id}: rbac="${label}" corpus="${row.DistrictName}"`);
  }
  assert.deepStrictEqual(wrong, [], `district name drift:\n  ${wrong.join('\n  ')}`);
  assert.strictEqual(Object.keys(rbac.DISTRICT_NAMES).length, districts.size,
    'rbac must name every district in the corpus and no others');
});

// A sibling target in a training file is the worst column a training file can carry, because
// the horizons NEST: a model predicting "back within a year" that is handed "back within 180
// days" as a feature is reading the answer. It would score near 1.0, and the endpoint it
// produced would then demand columns the serving code does not send.
//
// This is not a hypothetical — it is what the first multi-horizon file did. So the invariant
// is asserted rather than documented: every offender training file is exactly the seven shared
// features plus ONE target, and that target is the one the registry says it should be.
test('every offender training file carries one target and no sibling targets', () => {
  const fs = require('fs');
  const path = require('path');
  const q = require('../api/services/queries');
  const offenderrisk = require('../api/services/offenderrisk');
  const meta = q.offenderSetMeta();
  assert.ok(meta && Array.isArray(meta.tasks) && meta.tasks.length,
    'offender_set_meta.json should list the tasks — run the pipeline');

  const slugs = Object.keys(offenderrisk.MODELS).sort();
  assert.deepStrictEqual(meta.tasks.map((t) => t.slug).sort(), slugs,
    'the pipeline task list and the serving model registry must name the same models');

  const allTargets = new Set(meta.tasks.map((t) => t.target));
  for (const task of meta.tasks) {
    const p = path.join(q.dataDir(), 'derived', task.file);
    assert.ok(fs.existsSync(p), `${task.file} is missing — run the pipeline`);
    const header = fs.readFileSync(p, 'utf8').split('\n')[0].trim().split(',');
    assert.deepStrictEqual(header, [...offenderrisk.FEATURES, task.target],
      `${task.file} must be exactly the shared features plus its own target`);
    const strays = header.filter((c) => allTargets.has(c) && c !== task.target);
    assert.deepStrictEqual(strays, [],
      `${task.file} carries another task's target as a feature: ${strays.join(', ')}`);
  }
});

// Serving a model whose measured margin has gone negative is worse than serving no model,
// because the response still says "rankedBy: model". configured() reads the margin instead of
// a hand-set flag precisely so a revised measurement unplugs the model by itself.
test('a model is only served if it beat its baseline on both AUC and average precision', () => {
  const offenderrisk = require('../api/services/offenderrisk');
  for (const [slug, m] of Object.entries(offenderrisk.MODELS)) {
    const shouldServe = m.auc > m.rule && m.ap > m.apRule;
    assert.strictEqual(offenderrisk.configured(slug), shouldServe,
      `${slug}: configured() must follow the measured margins, not a flag`);
  }
});

// THE SIGNED-IN BOUNDARY. The demo path deliberately trusts x-kadi-role and lets a district
// user look at any one district -- that is a demo affordance, and it is fine while it is only
// that. A real account must not be widenable by anything the browser can set.
//
// This is asserted rather than read, because the difference between the two paths is four
// lines of tier check and nothing about a district officer's screen would look wrong if those
// four lines were deleted. The failure mode is silent by construction: the officer sees a
// perfectly ordinary district page, just not theirs.
test('a signed-in account cannot be widened by the URL', () => {
  const auth = require('../api/services/auth');
  const rbac = require('../api/services/rbac');
  const asUser = (payload, query) => rbac.userFromRequest({
    headers: { 'x-kadi-token': auth.issueToken(payload), 'x-kadi-role': 'DGP' },
    query: query || {},
  });

  // District tier: pinned to the district in the signed payload, whatever the URL asks for.
  const sp = asUser({ email: 'sp@example.test', fullName: 'SP', role: 'SP', districtId: '5' },
    { district: '1', unit: '999' });
  assert.strictEqual(sp.authenticated, true);
  assert.strictEqual(sp.districtId, '5', 'a signed-in SP must keep their own district');
  assert.ok(!sp.drillUnitId, 'a signed-in SP must not be movable to another unit by the URL');

  // Station tier: pinned to the unit, and caseInScope gates on it regardless of query.
  const sho = asUser({ email: 'sho@example.test', fullName: 'SHO', role: 'SHO', districtId: '1', unitId: '46' },
    { district: '30', unit: '999' });
  assert.strictEqual(sho.unitId, '46', 'a signed-in SHO must keep their own unit');
  assert.ok(rbac.caseInScope(sho, { unitId: '46', districtId: '1' }), 'own register is readable');
  assert.ok(!rbac.caseInScope(sho, { unitId: '999', districtId: '30' }), 'another register is not');

  // The header must not be able to promote a signed-in account either: this request carries a
  // DGP role header on an SP token, and the token wins.
  assert.strictEqual(sp.role, 'SP', 'x-kadi-role must be ignored when a valid token is present');

  // State tier keeps its drill-down, which is a narrowing rather than a widening.
  const dgp = asUser({ email: 'dgp@example.test', fullName: 'DGP', role: 'DGP', districtId: null },
    { district: '7' });
  assert.strictEqual(dgp.districtId, '7', 'a state account may drill into a district');
  assert.strictEqual(dgp.drilledFromState, true);
  assert.ok(!rbac.caseInScope(dgp, { unitId: '1', districtId: '9' }), 'and reads as that district while drilled');
});

// The pendency model's serving payload is computed by the PIPELINE, not by the API — the read model
// carries no charge-sheet date, so the API cannot rebuild a backlog panel. That split is the model's
// main structural risk: two pieces of code in two languages that must agree on 25 column names, where
// disagreement produces a confidently wrong score rather than an error.
test('the pendency serving rows match the trained feature contract exactly', () => {
  const q = require('../api/services/queries');
  const pendency = require('../api/services/pendencyrisk');
  const meta = q.pendencySetMeta();
  assert.ok(meta && meta.rows > 0, 'pendency_set_meta.json is missing — run the pipeline');

  assert.deepStrictEqual(meta.features, pendency.FEATURES,
    'the pipeline feature list and the serving feature list have drifted apart');

  const rows = q.pendencyCurrent();
  assert.ok(rows.length > 0, 'pendency_current.json is empty — run the pipeline');
  for (const f of pendency.FEATURES) {
    assert.ok(Number.isFinite(Number(rows[0][f])),
      `serving row is missing a numeric ${f}, which the endpoint will reject`);
  }
  // Every row is one month, and it is the month after the last training row: training needs a future
  // to label, serving needs the row that has none yet.
  assert.strictEqual(new Set(rows.map((r) => r.as_of)).size, 1, 'serving rows span more than one month');
  assert.ok(meta.servingMonth > meta.monthTo,
    `serving month ${meta.servingMonth} should be later than the last labelled month ${meta.monthTo}`);
});

// Same rule as the offender family: a model is served only if it beat its baseline on both AUC and
// average precision, read off the measurement rather than a hand-set flag.
test('pendency is served only while its measured margins hold', () => {
  const pendency = require('../api/services/pendencyrisk');
  const m = pendency.MEASURED;
  assert.strictEqual(pendency.configured(), m.auc > m.rule && m.ap > m.apRule);
  // The scale test is what separates this from the station-surge candidate, which was rejected for
  // scoring 0.738 and collapsing to 0.583 once absolute volumes were removed. If a future measurement
  // ever puts the scale-free score below the baseline, the model is learning station size again.
  assert.ok(m.scaleFreeAuc > m.rule,
    'scale-free AUC has fallen to the baseline — the model may be learning station size, not pendency');
});

// The bug this pins cost a live debugging session: the pendency key was pasted, the Admin screen read
// it back successfully, and the panel still said rankedBy: rule. Nothing was wrong with the key. The
// serving module had answered one earlier request, found no key, and cached the ABSENCE -- so every
// later request on that warm container skipped the lookup and reported a missing key forever.
//
// A negative cache is invisible in exactly the situation it hurts: while somebody is trying to fix
// the thing. So an empty lookup is never remembered, and this test is what says so.
test('an absent endpoint key is re-read rather than remembered as absent', async () => {
  const dsPath = require.resolve('../api/services/datastore');
  const qmPath = require.resolve('../api/services/quickml');
  const pendPath = require.resolve('../api/services/pendencyrisk');
  const realDs = require.cache[dsPath];
  const realQm = require.cache[qmPath];
  const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

  let lookups = 0;
  // Empty the first time, a real key the second: the sequence an operator actually produces.
  stub(dsPath, { query: async () => (++lookups === 1 ? [] : [{ configValue: 'a'.repeat(64) }]) });
  stub(qmPath, { accessToken: async () => null });
  delete require.cache[pendPath];
  const pendency = require('../api/services/pendencyrisk');

  try {
    const rows = [{ unit_id: '1' }];
    assert.strictEqual(await pendency.score({}, rows), null);
    assert.match(pendency.status().lastError, /no endpoint key/,
      'the first request should report the key as missing, because it is');

    assert.strictEqual(await pendency.score({}, rows), null);
    assert.strictEqual(lookups, 2,
      'the second request did not re-read AppConfig — an empty lookup is being cached');
    assert.doesNotMatch(pendency.status().lastError, /no endpoint key/,
      'still reporting a missing key after one was installed');
  } finally {
    if (realDs) require.cache[dsPath] = realDs; else delete require.cache[dsPath];
    if (realQm) require.cache[qmPath] = realQm; else delete require.cache[qmPath];
    delete require.cache[pendPath];
  }
});

// Found by standing at station rank rather than by reading the code. The SHO's scope is ONE
// register, so the shortlist is one row, so the set of returned scores is necessarily size one --
// and the degeneracy guard read that as "the endpoint answered the same thing for everything" and
// threw the score away. The endpoint had answered 0.857 for that station, correctly. The one
// reader with the strongest claim on the number was the only one who could not see it.
//
// A set of one is evidence of a narrow scope, not a broken model. Both servers carry the guard,
// so both are pinned here.
test('a single-candidate scope keeps its score instead of reading as a degenerate endpoint', () => {
  for (const [name, mod] of [
    ['pendency', require('../api/services/pendencyrisk')],
    ['offender', require('../api/services/offenderrisk')],
    // mlforecast was missed on the first pass through this bug -- a typo'd grep path returned
    // "no such file" and the sweep moved on, so the third copy of the guard went unfixed until
    // /ai/status was read and showed it tripping on "all 1 candidates". Enumerated here so the
    // set of servers carrying this guard is asserted rather than remembered.
    ['spike', require('../api/services/mlforecast')],
  ]) {
    assert.strictEqual(mod.discriminates([0.857]), true,
      `${name}: one station in scope must keep its score — this is the SHO case`);
    assert.strictEqual(mod.discriminates([]), true,
      `${name}: an empty set is handled by the all-null check above, not by this guard`);
    // The guard's real job, unchanged: an endpoint answering one value for a real shortlist has
    // not ranked anything, and sorting by it would leave the rule's order while claiming a model.
    assert.strictEqual(mod.discriminates([0.4, 0.4, 0.4]), false,
      `${name}: three identical scores is a degenerate endpoint and must fall back`);
    assert.strictEqual(mod.discriminates([0.4, 0.9]), true,
      `${name}: two distinct scores rank`);
  }
});

// The phrasing model is allowed to rewrite a sentence and is not allowed to invent a figure.
//
// Told to lead with the number that answers the question, it counted the five example FIRs it
// had been shown and wrote "Five cases are flagged as slipping" over a deterministic answer
// that said 16,136 — fluent, confident, and wrong by three orders of magnitude. Prompting alone
// does not fix that class of error, so the output is checked against its own input.
test('a phrased answer may not contain a number its facts did not', () => {
  // The guard as it runs in assistant.js: every digit run in the answer must exist in the facts.
  const check = (facts, answer) => {
    const factDigits = new Set((String(facts).replace(/,/g, '').match(/\d+/g) || []));
    return (String(answer).replace(/,/g, '').match(/\d+/g) || [])
      .filter((n) => n.length > 1 && !factDigits.has(n));
  };
  const facts = '16136 cases are flagged as slipping. The 5 highest-risk are listed.\n'
    + '- case 100290291202300008 (id 19674)';

  assert.deepStrictEqual(check(facts, '16,136 cases are slipping; the five most at risk are below.'), [],
    'a comma-formatted figure that IS in the facts must pass');
  assert.deepStrictEqual(check(facts, 'FIR 100290291202300008 is the most at risk.'), [],
    'an id taken from the facts must pass');
  assert.deepStrictEqual(check(facts, 'There are 4200 cases slipping.'), ['4200'],
    'a figure absent from the facts must be caught');
  // The real regression, in the exact shape it appeared.
  assert.deepStrictEqual(check(facts, 'Five cases are flagged as slipping.'), [],
    'a word-number is not caught by this guard — the prompt handles that, and the guard is '
    + 'the backstop for digits, which is where the damage is');
});

// The audit trail is read by an officer, so every action the server records must have a
// sentence to show for it. The map on the Audit page covered five of twelve, and the seven it
// missed printed raw: "install_model_key" where "Model endpoint key installed" belongs. Each
// was added by a change that audited something new and did not know a label was owed.
//
// Asserted against the source rather than against a copy, so adding an audited action without
// naming it fails here instead of surfacing later as a machine token on a police screen.
test('every audited action has a human label on the Audit page', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');

  const serverSrc = ['functions/api/app.js']
    .concat(fs.readdirSync(path.join(root, 'functions/api/services'))
      .filter((f) => f.endsWith('.js')).map((f) => `functions/api/services/${f}`))
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const recorded = new Set(
    [...serverSrc.matchAll(/action:\s*'([a-z_]+)'/g)].map((m) => m[1]),
  );

  const audit = fs.readFileSync(path.join(root, 'client/src/pages/Audit.tsx'), 'utf8');
  const block = audit.slice(audit.indexOf('ACTION_LABELS'), audit.indexOf('};', audit.indexOf('ACTION_LABELS')));
  const labelled = new Set([...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));

  const missing = [...recorded].filter((a) => !labelled.has(a)).sort();
  assert.deepStrictEqual(missing, [],
    `these actions are recorded by the server and have no label on the Audit page: ${missing.join(', ')}`);
});

// A mixed-script answer is spoken by two voices, one per run, because handing
// "ಈ ಪ್ರಕರಣ Dharwad Colony PS ನಲ್ಲಿ" to a single Kannada voice makes it read Latin script with
// Kannada phonetics — the stumble that gets reported as "robotic". The split must be LOSSLESS:
// an early version dropped leading digits, so "16,136 cases are flagged" was spoken as "cases
// are flagged" and the only figure in the sentence never reached the reader.
test('splitting an answer by script loses no characters', () => {
  const KN = /[ಀ-೿]/;
  // The same routine the Assistant page uses to segment before speaking.
  const segments = (text) => {
    const out = []; let buf = ''; let cur = null;
    for (const ch of text) {
      const isNeutral = !/[A-Za-zಀ-೿]/.test(ch);
      const want = isNeutral ? cur : (KN.test(ch) ? 'kn' : 'en');
      if (cur === null) { buf += ch; if (want !== null) cur = want; continue; }
      if (want === null || want === cur) { buf += ch; continue; }
      if (buf.trim()) out.push({ text: buf, lang: cur });
      cur = want; buf = ch;
    }
    if (buf.trim() && cur) out.push({ text: buf, lang: cur });
    return out.reduce((acc, seg) => {
      const prev = acc[acc.length - 1];
      if (prev && (seg.text.trim().length < 3 || prev.text.trim().length < 3)) {
        prev.text += seg.text; return acc;
      }
      acc.push({ ...seg }); return acc;
    }, []);
  };

  const cases = [
    '16,136 cases are flagged as slipping.',
    'ಈ ಪ್ರಕರಣ Dharwad Colony PS ನಲ್ಲಿ ದಾಖಲಾಗಿದೆ.',
    'ಎಫ್ಐಆರ್ 100310297202500003 — Crimes Against Body, ಸ್ಥಿತಿ Charge Sheeted.',
    '2026 ಸಾಲಿನ ಪ್ರಕರಣ',
    'Plain English with no Kannada at all.',
  ];
  for (const c of cases) {
    const segs = segments(c);
    assert.strictEqual(segs.map((s) => s.text).join(''), c,
      `segmentation dropped characters from: ${c}`);
    assert.ok(segs.every((s) => s.lang === 'en' || s.lang === 'kn'),
      'every run must be assigned a language');
  }
  // The mixed sentence genuinely splits; the single-script ones do not.
  assert.strictEqual(segments(cases[1]).length, 3, 'a mixed sentence should split into runs');
  assert.strictEqual(segments(cases[4]).length, 1, 'pure English should stay one run');
});

// THE SUITE PASSED 39/39 WHILE THE DEPLOYED FUNCTION WAS UNLOADABLE.
//
// An edit to a prompt string introduced an unescaped apostrophe -- "QUESTION's" inside a
// single-quoted literal -- and quickml.js stopped parsing. Every route on the deployment
// returned 408 EXECUTION_TIME_EXCEEDED, including /me, which does almost nothing: the module
// never loaded, so there was no app to answer with.
//
// The tests missed it because none of them required the entry point. They exercised services
// directly, so a file that could not be parsed was simply never asked for. This asserts the
// one thing every other test silently assumes.
test('the API entry point and every service module actually parse', () => {
  const fs = require('fs');
  const path = require('path');
  const api = path.join(__dirname, '..', 'api');

  assert.doesNotThrow(() => { require(path.join(api, 'app.js')); },
    'functions/api/app.js failed to load — the deployment would answer nothing at all');

  const services = fs.readdirSync(path.join(api, 'services')).filter((f) => f.endsWith('.js'));
  assert.ok(services.length > 10, 'expected the service directory to be populated');
  for (const f of services) {
    assert.doesNotThrow(() => { require(path.join(api, 'services', f)); },
      `functions/api/services/${f} failed to load`);
  }
});

// Reading an arbitrary uploaded image is a different permission from reading the register.
// The register is scoped; an upload is whatever the uploader chose to photograph. That belongs
// with the ranks holding state-wide read and not with a district or station account — and the
// sidebar hiding the link is decoration, so the boundary is asserted here.
test('evidence image reading is state tier only', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  const route = app.slice(app.indexOf("'/evidence/:capability'"));
  const guard = route.slice(0, route.indexOf('const cap'));
  assert.match(guard, /requireRole\(req\.user,\s*\[[^\]]*'DGP'[^\]]*\]\)/,
    'the evidence route must call requireRole');
  for (const allowed of ['DGP', 'Admin', 'Analyst']) {
    assert.ok(guard.includes(`'${allowed}'`), `${allowed} must be permitted`);
  }
  for (const denied of ['SP', 'DSP', 'SHO', 'SI']) {
    assert.ok(!guard.includes(`'${denied}'`), `${denied} must NOT be permitted to read uploads`);
  }
});

// ---- evidence readings filed against a case ------------------------------------------------
// These routes had no coverage at all when they shipped. The access boundary above is the one
// that matters most, but the filing path carries the two invariants that are silent when they
// break: scope taken from the register rather than the body, and a note that is withdrawn
// rather than deleted.

test('evidence notes: only the ranks that can read an image can file one', () => {
  const notes = require('../api/services/evidencenote');
  for (const role of ['DGP', 'Admin', 'Analyst']) {
    assert.ok(notes.canFile({ role }), `${role} may file a reading`);
  }
  // Filing a note is proof somebody read an uploaded image. If this list ever grew past the
  // route's, a district account could file readings it was never allowed to take.
  for (const role of ['SP', 'DSP', 'SHO', 'SI']) {
    assert.ok(!notes.canFile({ role }), `${role} may NOT file a reading`);
  }
});

test('evidence notes: a filing takes scope from the register, never the body', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const original = datastore.insertRows;
  let written = null;
  datastore.insertRows = async (_req, _table, rows) => { [written] = rows; return true; };
  try {
    const out = await notes.file(
      {},
      { role: 'Analyst', email: 'a@ksp' },
      {
        capability: 'ocr', extract: 'SEIZURE MEMO',
        // The lie a caller would tell. Every one of these must be ignored.
        caseMasterId: 'FORGED', crimeNo: '999', districtId: '9', unitId: '99',
      },
      { caseMasterId: 'REAL-1', crimeNo: '100010064202600099', districtId: '1', unitId: '55' },
    );
    assert.ok(out.ok, out.error);
    assert.strictEqual(written.caseMasterId, 'REAL-1', 'case id comes from the register');
    assert.strictEqual(written.districtId, '1', 'district comes from the register');
    assert.strictEqual(written.unitId, '55', 'station comes from the register');
    assert.strictEqual(written.crimeNo, '100010064202600099', 'crime number comes from the register');
    assert.strictEqual(written.noteStatus, 'filed');
  } finally {
    datastore.insertRows = original;
  }
});

test('evidence notes: an empty reading is refused rather than filed', async () => {
  const notes = require('../api/services/evidencenote');
  // The barcode scanner answers `content: ""` on an image with no code in it. That is a
  // correct answer and a useless attachment: filing it puts a blank entry on the case that a
  // reader has to open to discover says nothing.
  const out = await notes.file({}, { role: 'Analyst' }, { capability: 'barcode', extract: '   ' },
    { caseMasterId: 'REAL-1' });
  assert.ok(!out.ok);
  assert.strictEqual(out.status, 400);
});

test('evidence notes: an unknown capability is refused', async () => {
  const notes = require('../api/services/evidencenote');
  const out = await notes.file({}, { role: 'DGP' }, { capability: 'faces', extract: 'two people' },
    { caseMasterId: 'REAL-1' });
  assert.ok(!out.ok, 'a capability this screen does not offer must not become a note');
  assert.strictEqual(out.status, 400);
});

test('evidence notes: withdrawal is an UPDATE, never a DELETE', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const original = datastore.query;
  const statements = [];
  datastore.query = async (_req, sql) => {
    statements.push(sql);
    if (/^SELECT/i.test(sql)) return [{ noteKey: 'e1', createdBy: 'a@ksp', noteStatus: 'filed', caseMasterId: 'REAL-1' }];
    return [];
  };
  try {
    const out = await notes.withdraw({}, { role: 'Analyst', email: 'a@ksp' }, 'e1', 'attached to the wrong case');
    assert.ok(out.ok, out.error);
    const write = statements.find((s) => !/^SELECT/i.test(s));
    assert.match(write, /^UPDATE/i, 'a withdrawal must not remove the row');
    assert.match(write, /noteStatus='withdrawn'/);
    assert.match(write, /withdrawnBy=/, 'the withdrawal must name who did it');
    assert.match(write, /withdrawReason=/, 'and why');
    // A record that can be made to have never said something is worse than a wrong record.
    assert.ok(!statements.some((s) => /^\s*DELETE/i.test(s)), 'nothing is deleted');
  } finally {
    datastore.query = original;
  }
});

test('evidence notes: only the author or an Administrator may withdraw', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const original = datastore.query;
  datastore.query = async (_req, sql) => (/^SELECT/i.test(sql)
    ? [{ noteKey: 'e1', createdBy: 'analyst@ksp', noteStatus: 'filed', caseMasterId: 'REAL-1' }]
    : []);
  try {
    // Letting the case's own station retract a reading filed against it would let the subject
    // of a record remove the record.
    const other = await notes.withdraw({}, { role: 'DGP', email: 'dgp@ksp' }, 'e1', 'not mine to pull');
    assert.ok(!other.ok);
    assert.strictEqual(other.status, 403);
    const admin = await notes.withdraw({}, { role: 'Admin', email: 'admin@ksp' }, 'e1', 'records correction');
    assert.ok(admin.ok, 'an Administrator may withdraw anyone’s');
  } finally {
    datastore.query = original;
  }
});

test('evidence notes: the case view lists filed notes and hides withdrawn ones', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const original = datastore.query;
  let seen = '';
  datastore.query = async (_req, sql) => { seen = sql; return []; };
  try {
    await notes.forCase({}, 'REAL-1');
    assert.match(seen, /noteStatus = 'filed'/, 'a withdrawn note must not appear on the case');
    await notes.forCase({}, 'REAL-1', { includeWithdrawn: true });
    assert.ok(!/noteStatus = 'filed'/.test(seen), 'the audit view can see everything');
  } finally {
    datastore.query = original;
  }
});

test('evidence routes are wired and the read follows the case rather than the rank', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  for (const route of ["'/evidence/note'", "'/cases/:id/evidence'", "'/evidence/note/:id/withdraw'"]) {
    assert.ok(app.includes(route), `${route} must be registered`);
  }
  // The read is deliberately NOT role-gated: the station whose register holds the case needs
  // the transcription, and getCase already throws for a case out of their scope. A
  // requireRole here would silently take that away.
  const read = app.slice(app.indexOf("r.get('/cases/:id/evidence'"));
  const body = read.slice(0, read.indexOf('}));'));
  assert.ok(!/requireRole/.test(body), 'the case-scoped read must not carry a rank gate');
  assert.match(body, /q\.getCase\(req\.user/, 'and must resolve the case through the register');
  // getCase does NOT enforce scope -- its comment describes a check that was never written,
  // and probing found a station SI able to open cases in every other district sampled. A
  // filed reading is a transcription of a photographed document and must not travel further
  // than the case does, so this route checks scope itself. Deleting that line would silently
  // publish every seizure memo in the state to every account.
  assert.match(body, /rbac\.caseInScope\(req\.user, c\)/,
    'the evidence read must check scope itself rather than inherit a check that does not exist');
});

test('the literal evidence routes are declared before the :capability wildcard', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  // Express matches in declaration order. With ':capability' first, POST /evidence/note
  // resolves as "read an image using the capability named note" and answers 400 -- which is
  // what it did on the first deploy, in a file that already carries this same warning above
  // '/cases/:id'. Learning it twice is enough.
  // Anchored to the declaration -- with a trailing comma -- rather than to the path alone.
  // The path also appears in the prose above the routes explaining this very ordering, and
  // matching that made the assertion measure a comment instead of the code.
  const wildcard = app.indexOf("'/evidence/:capability',");
  assert.ok(wildcard > 0, 'the capability route must exist');
  for (const literal of ["r.post('/evidence/note'", "r.get('/evidence/notes'", "r.post('/evidence/note/:id/withdraw'"]) {
    const at = app.indexOf(literal);
    assert.ok(at > 0, `${literal} must exist`);
    assert.ok(at < wildcard, `${literal} must be declared before '/evidence/:capability'`);
  }
});

test('a reading can be filed against a case registered today', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  // Live rows -- approved but not yet analysed by the overnight pipeline -- are attached to
  // req.user only on the paths LIVE_PATHS names. The filing route resolves the case through
  // the scoped lookup, so a route missing from that list answers "case not found" for every
  // case registered since the last pipeline run. That is the seizure-memo case exactly: the
  // memo and the FIR arrive on the same afternoon.
  const m = app.match(/const LIVE_PATHS = (\/\^[^\n;]+\/);/);
  assert.ok(m, 'LIVE_PATHS must be findable');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  assert.ok(re.test('/evidence/note'), 'filing must see live cases');
  assert.ok(re.test('/cases/LIVE-abc/evidence'), 'and so must reading them back');
  assert.ok(!re.test('/evidence/notes'), 'the history list needs no register lookup');
  assert.ok(!re.test('/evidence/ocr'), 'nor does reading an image');
});

// ---- retained pages ------------------------------------------------------------------------
// Retention reverses a rule this feature originally stated absolutely ("the image is NEVER
// stored"). Reversing it is defensible only while the guarantees that replaced it hold, so they
// are asserted rather than described.

test('retention is off by default on every filed reading', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const original = datastore.insertRows;
  let written = null;
  datastore.insertRows = async (_r, _t, rows) => { [written] = rows; return true; };
  try {
    // Note the body ASKS to retain. Filing must ignore it: the bytes are not in this request,
    // and a row claiming to hold a page it never received would point at nothing.
    await notes.file({}, { role: 'Analyst', email: 'a@ksp' },
      { capability: 'ocr', extract: 'memo', retain: true, imageFileId: 'FORGED' },
      { caseMasterId: 'C1' });
    assert.strictEqual(written.imageFileId, '', 'a fresh note never references a stored page');
    assert.strictEqual(written.retainedBy, '');
    assert.strictEqual(written.pageCount, '1', 'one page unless told otherwise');
  } finally {
    datastore.insertRows = original;
  }
});

test('withdrawing a reading keeps the text and deletes the page', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const filestore = require('../api/services/filestore');
  const oq = datastore.query;
  const orm = filestore.remove;
  const statements = [];
  let deleted = null;
  datastore.query = async (_r, sql) => {
    statements.push(sql);
    return /^SELECT/i.test(sql)
      ? [{ noteKey: 'e1', createdBy: 'a@ksp', noteStatus: 'filed', caseMasterId: 'C1', imageFileId: 'F9' }]
      : [];
  };
  filestore.remove = async (_r, id) => { deleted = id; return { ok: true }; };
  try {
    const out = await notes.withdraw({}, { role: 'Analyst', email: 'a@ksp' }, 'e1', 'wrong case');
    assert.ok(out.ok, out.error);
    const write = statements.find((s) => /^UPDATE/i.test(s));
    // The asymmetry that makes retention acceptable: the record survives, the photograph does
    // not. A withdrawal that left the image behind would mean an officer who pulled a mis-filed
    // reading is still holding the page it came from.
    assert.match(write, /noteStatus='withdrawn'/);
    assert.ok(!/extract=/.test(write), 'the reading text is never cleared');
    assert.match(write, /imageFileId=''/, 'the note must stop pointing at the page');
    assert.strictEqual(deleted, 'F9', 'and the page itself must be deleted');
    assert.strictEqual(out.pageDeleted, true);
  } finally {
    datastore.query = oq;
    filestore.remove = orm;
  }
});

test('a failed page upload never costs the filed reading', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const filestore = require('../api/services/filestore');
  const oq = datastore.query;
  const op = filestore.put;
  datastore.query = async (_r, sql) => (/^SELECT/i.test(sql)
    ? [{ noteKey: 'e1', createdBy: 'a@ksp', imageFileId: '', caseMasterId: 'C1' }] : []);
  filestore.put = async () => ({ ok: false, error: 'timeout' });
  try {
    const out = await notes.retain({}, { role: 'Analyst', email: 'a@ksp' }, 'e1', Buffer.alloc(1024));
    // The reading is the record; the page is a convenience. This has to fail on its own so the
    // officer keeps the transcription rather than being sent back to retype the memo.
    assert.ok(!out.ok);
    assert.strictEqual(out.status, 503);
  } finally {
    datastore.query = oq;
    filestore.put = op;
  }
});

test('a stored page with no note pointing at it is cleaned up, not left behind', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const filestore = require('../api/services/filestore');
  const oq = datastore.query;
  const op = filestore.put;
  const orm = filestore.remove;
  let removed = null;
  datastore.query = async (_r, sql) => (/^SELECT/i.test(sql)
    ? [{ noteKey: 'e1', createdBy: 'a@ksp', imageFileId: '', caseMasterId: 'C1' }]
    // The UPDATE fails, so nothing will ever reference the file that was just uploaded.
    : null);
  filestore.put = async () => ({ ok: true, fileId: 'ORPHAN', bytes: 10 });
  filestore.remove = async (_r, id) => { removed = id; return { ok: true }; };
  try {
    const out = await notes.retain({}, { role: 'Analyst', email: 'a@ksp' }, 'e1', Buffer.alloc(1024));
    assert.ok(!out.ok);
    assert.strictEqual(removed, 'ORPHAN',
      'an unreferenced photograph must not be left in the store forever');
  } finally {
    datastore.query = oq;
    filestore.put = op;
    filestore.remove = orm;
  }
});

test('the file id of a retained page never reaches the browser', async () => {
  const notes = require('../api/services/evidencenote');
  const datastore = require('../api/services/datastore');
  const oq = datastore.query;
  datastore.query = async () => [{
    noteKey: 'e1', caseMasterId: 'C1', capability: 'ocr', extract: 'memo',
    imageFileId: 'SECRET-FILE-ID', retainedBy: 'a@ksp', noteStatus: 'filed', pageCount: '3',
  }];
  try {
    const [n] = await notes.forCase({}, 'C1');
    // A handle in a list response is a handle somebody can try. The page is fetched through the
    // note's own scoped route instead, which re-checks the case.
    assert.strictEqual(JSON.stringify(n).includes('SECRET-FILE-ID'), false,
      'the file id must not be serialised to a client');
    assert.strictEqual(n.retained, true, 'only WHETHER a page exists is exposed');
    assert.strictEqual(n.pages, 3);
  } finally {
    datastore.query = oq;
  }
});

test('the kept-page routes are scoped to the case, not to a rank', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  for (const route of ["'/evidence/note/:id/page'", "'/evidence/note/:id/reread'"]) {
    assert.ok(app.includes(route), `${route} must be registered`);
  }
  // Both fetch the note, resolve its case, and check scope. Skipping that on the page route
  // would publish a photograph to anyone holding a note id.
  const page = app.slice(app.indexOf("r.get('/evidence/note/:id/page'"));
  const body = page.slice(0, page.indexOf('}));'));
  assert.match(body, /q\.getCase\(req\.user, n\.caseMasterId\)/, 'the page route must resolve the case');
  assert.match(body, /rbac\.caseInScope\(req\.user, c\)/, 'and must check scope before sending bytes');
});

test('a stored page is found by name, because the upload response id is wrong', async () => {
  const filestore = require('../api/services/filestore');
  const https = require('https');
  const realRequest = https.request;
  // The upload claims one id; the listing shows the file actually took another. This is the
  // same lie Catalyst's row-insert endpoint tells (submissions.js documents rows drifting +3;
  // this file drifted -2), and it is silent: the row stores a plausible id that 404s forever.
  https.request = (opts, cb) => {
    const res = { statusCode: 200, headers: {}, on: (e, f) => { res[`_${e}`] = f; return res; } };
    const body = opts.method === 'POST'
      ? '{"data":{"id":"55468000000205060"}}'
      : '{"data":[{"id":"55468000000205058","file_name":"note-1.png","file_size":10}]}';
    setImmediate(() => { cb(res); res._data(body); res._end(); });
    return { on: () => {}, write: () => {}, end: () => {} };
  };
  try {
    const out = await filestore.put(
      { headers: { 'x-zc-admin-cred-token': 't', 'x-zc-project-secret-key': 's', 'x-zc-projectid': 'p' } },
      Buffer.alloc(64), 'note-1.png', 'image/png',
    );
    assert.ok(out.ok);
    assert.strictEqual(out.fileId, '55468000000205058', 'the id must come from the listing');
    assert.notStrictEqual(out.fileId, '55468000000205060', 'never from the upload response');
    assert.strictEqual(out.resolved, true);
  } finally {
    https.request = realRequest;
  }
});

test('no built asset is emitted as .mjs', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', '..', 'client', 'dist', 'assets');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return; } // no build present; nothing to check
  // Catalyst serves .js as application/javascript and .mjs as application/octet-stream, and a
  // browser refuses to execute an ES module with a non-JavaScript MIME type. pdf.js ships its
  // worker as .mjs, so the page 200s on the worker and dies with "Failed to fetch dynamically
  // imported module" -- a failure that reads like a missing file and is actually a content
  // type. vite.config.ts renames these on the way out; this fails if that stops working.
  const mjs = files.filter((f) => f.endsWith('.mjs'));
  assert.deepStrictEqual(mjs, [],
    `these assets will be served as application/octet-stream and will not execute: ${mjs.join(', ')}`);
});

// ---- human corrections to the machine's Kannada --------------------------------------------

test('a correction must actually contain Kannada', async () => {
  const fix = require('../api/services/translationfix');
  // Latin script in this box is somebody typing in the wrong field. Catching it here costs
  // nothing; catching it after it is live for every Kannada reader costs a lot more.
  const out = await fix.submit({}, { role: 'SI' }, { source: 'Cases', kannada: 'Prakaranagalu' });
  assert.ok(!out.ok);
  assert.strictEqual(out.status, 400);
});

test('a correction supersedes rather than overwrites', async () => {
  const fix = require('../api/services/translationfix');
  const datastore = require('../api/services/datastore');
  const oq = datastore.query;
  const oi = datastore.insertRows;
  const statements = [];
  let written = null;
  datastore.query = async (_r, sql) => { statements.push(sql); return []; };
  datastore.insertRows = async (_r, _t, rows) => { [written] = rows; return true; };
  try {
    const out = await fix.submit({}, { role: 'SI', email: 'si@ksp' },
      { source: 'Cases', kannada: 'ಪ್ರಕರಣಗಳು', machineText: 'ಕೇಸುಗಳು', note: 'what a station calls it' });
    assert.ok(out.ok, out.error);
    // The old row must be marked, not replaced: an interface string whose history is "it says
    // this now" cannot answer who changed it or what it said before.
    const update = statements.find((s) => /^UPDATE/i.test(s));
    assert.match(update, /fixStatus='superseded'/);
    assert.ok(!statements.some((s) => /^\s*DELETE/i.test(s)), 'nothing is deleted');
    assert.strictEqual(written.fixStatus, 'active');
    assert.strictEqual(written.machineText, 'ಕೇಸುಗಳು', 'what the machine said is kept for comparison');
    assert.strictEqual(written.fixedBy, 'si@ksp');
  } finally {
    datastore.query = oq;
    datastore.insertRows = oi;
  }
});

test('a long string is keyed by hash, because the text column caps at 255', async () => {
  const fix = require('../api/services/translationfix');
  const datastore = require('../api/services/datastore');
  const oq = datastore.query;
  const oi = datastore.insertRows;
  let written = null;
  datastore.query = async () => [];
  datastore.insertRows = async (_r, _t, rows) => { [written] = rows; return true; };
  // Deliberately ends in a space. The source is a lookup KEY, so trimming it would store a
  // correction against a string the interface never asks for -- saved, reported as saved, and
  // silently matching nothing.
  const long = 'Insights use evidence and behaviour only. '.repeat(12); // ~500 chars, trailing space
  try {
    await fix.submit({}, { role: 'SI' }, { source: long, kannada: 'ಒಳನೋಟಗಳು' });
    // Long paragraphs are exactly where machine translation goes wrong most, so keying on the
    // truncated column would exclude the strings that most need reviewing.
    assert.ok(long.length > 255);
    assert.strictEqual(written.sourceHash, fix.hash(long));
    assert.strictEqual(written.sourceFull, long, 'the whole string is kept');
    assert.ok(written.sourceText.length <= 255, 'and the capped column is only a display copy');
  } finally {
    datastore.query = oq;
    datastore.insertRows = oi;
  }
});

test('overrides return the newest correction per string', async () => {
  const fix = require('../api/services/translationfix');
  const datastore = require('../api/services/datastore');
  const oq = datastore.query;
  // Ordered newest-first by the query. Two rows for one string means an older correction that
  // a newer one superseded, and serving the older one would silently undo somebody's fix.
  datastore.query = async () => ([
    { sourceHash: 'h1', sourceFull: 'Cases', kannada: 'ಪ್ರಕರಣಗಳು', fixStatus: 'active' },
    { sourceHash: 'h1', sourceFull: 'Cases', kannada: 'ಹಳೆಯದು', fixStatus: 'active' },
    { sourceHash: 'h2', sourceFull: 'Health', kannada: 'ಆರೋಗ್ಯ', fixStatus: 'active' },
  ]);
  try {
    const out = await fix.overrides({});
    assert.strictEqual(out.map.Cases, 'ಪ್ರಕರಣಗಳು');
    assert.strictEqual(out.map.Health, 'ಆರೋಗ್ಯ');
    assert.strictEqual(out.count, 2);
  } finally {
    datastore.query = oq;
  }
});

test('corrections are the highest-priority translation layer, and are in the reverse map', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'i18n.ts'), 'utf8');
  // A correction always starts from a string the built dictionary already holds, so if `fixes`
  // were not first in this chain then every correction would be dead on arrival.
  assert.match(src, /const hit = fixes\[text\] \|\| BUILT\[text\] \|\| runtime\[text\]/,
    'human corrections must win over both machine layers');
  // Switching back to English works by looking up the Kannada on screen. A corrected string
  // missing from the reverse map stays Kannada while everything around it turns over.
  const rev = src.slice(src.indexOf('export function reverseKn'));
  assert.match(rev.slice(0, rev.indexOf('\n}')), /Object\.entries\(fixes\)/,
    'corrected strings must be restorable to English');
});

test('no ZCQL query asks for more than 300 rows', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'api', 'services');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // Literal limits: `LIMIT 400`, and the second half of `LIMIT 0, 400`.
    for (const m of src.matchAll(/LIMIT\s+(?:\d+\s*,\s*)?(\d+)/g)) {
      if (Number(m[1]) > 300) offenders.push(`${f}: LIMIT ${m[1]}`);
    }
    // Clamped limits: Math.min(x, 400) sitting inside a template literal that builds a LIMIT.
    for (const m of src.matchAll(/LIMIT[^`\n]*Math\.min\(\s*[^,)]+,\s*(\d+)\s*\)/g)) {
      if (Number(m[1]) > 300) offenders.push(`${f}: clamped to ${m[1]}`);
    }
  }
  // ZCQL answers "ZCQL CANNOT HAVE MORE THAN 300 ROWS in LIMIT" -- an ERROR, not a truncation,
  // so the whole query returns nothing. /audit?limit=400 fell back to the in-memory buffer and
  // served ONE row: asking for more history quietly gave less.
  assert.deepStrictEqual(offenders, [],
    `these queries exceed ZCQL's hard limit and will return nothing: ${offenders.join('; ')}`);
});

test('the page translator cannot outlive a switch back to English', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'PageTranslator.tsx'), 'utf8');
  // run() ends by calling observer.observe(). So a timer still in flight when the language
  // switches RE-ATTACHES the observer that cleanup just disconnected, and the Kannada
  // translator runs forever: the app reports English, renders Kannada, and keeps fetching new
  // runtime translations. It read 431 runtime entries in English mode when this was found.
  const cleanup = src.slice(src.lastIndexOf('return () => {'));
  assert.match(cleanup, /clearTimeout\(timer\)/, 'the pending translate timer must be cleared');
  assert.match(cleanup, /cancelled = true/, 'and a queued run must be told not to proceed');
  assert.match(src, /if \(cancelled\) return;/, 'run’s first act is to check it');
  assert.match(src, /timer = setTimeout\(run, 60\)/, 'the timer handle must be kept, not discarded');
});

// ---------------------------------------------------------------------------------------
// Case detail scoping. queries.getCase() carried a comment describing this rule and no code
// implementing it, so the register LIST was scoped and the register DETAIL was open to every
// authenticated account: a station SI returned 200 with named victims and accused for cases
// sampled across districts 2, 3, 5, 7, 11 and 19. These assert the rule in both directions,
// because a check that only ever refuses is as wrong as one that only ever allows.
// ---------------------------------------------------------------------------------------

test('case detail: a station officer is refused a case outside their register', () => {
  const q = require('../api/services/queries');
  const si = { ...rbac.DEMO_USERS.SI, roleMeta: rbac.ROLES.SI };
  const db = q.db();

  const mine = db.caseList.filter((c) => rbac.caseInScope(si, c));
  assert.ok(mine.length > 0, 'the station must hold a register to test against');
  const own = q.getCase(si, mine[0].caseMasterId);
  assert.strictEqual(own.visible, true, 'an SI reads their own case');
  assert.strictEqual(own.visibility, 'in_scope');
  assert.ok(own.parties, 'and reads it in full');

  // The station tier is excluded from the linked allowance on purpose, so EVERY case outside
  // its register must be refused -- including the 617 that are one evidence edge away. If
  // those opened, the station tier would hold 2.2x its own register and the silo the product
  // argues against would no longer be standable-in.
  let checked = 0;
  for (const c of db.caseList) {
    if (rbac.caseInScope(si, c)) continue;
    const got = q.getCase(si, c.caseMasterId);
    assert.strictEqual(got.visible, false, `case ${c.caseMasterId} in district ${c.districtId} must be refused`);
    assert.strictEqual(got.parties, undefined, 'a refusal carries no parties');
    assert.strictEqual(got.briefFacts, undefined, 'a refusal carries no narrative');
    assert.strictEqual(got.crimeNo, undefined, 'a refusal must not be usable to enumerate the register');
    if (++checked >= 400) break;
  }
  assert.ok(checked > 0, 'there must be out-of-scope cases to refuse');

  // The linked predicate itself is the thing being denied, not merely the outcome.
  const linkedElsewhere = db.caseList.find((c) => !rbac.caseInScope(si, c));
  assert.strictEqual(q.linkedIntoScope(si, linkedElsewhere), false, 'station tier never gets the linked allowance');
});

test('case detail: a district officer reads a case linked into their district', () => {
  const q = require('../api/services/queries');
  const sp = { ...rbac.DEMO_USERS.SP, roleMeta: rbac.ROLES.SP };
  const db = q.db();

  // A case in ANOTHER district that shares an evidence edge with one in this SP's district.
  // This is the silo-breaking case: the whole product argues it should open.
  const linked = db.caseList.find((c) => !rbac.caseInScope(sp, c) && q.linkedIntoScope(sp, c));
  assert.ok(linked, 'the corpus must contain a case linked across a district boundary');
  assert.notStrictEqual(String(linked.districtId), String(sp.districtId), 'and it must be another district');

  const got = q.getCase(sp, linked.caseMasterId);
  assert.strictEqual(got.visible, true, 'a linked case opens');
  assert.strictEqual(got.visibility, 'linked', 'and is labelled as linked rather than as the district\'s own work');
  assert.ok(got.parties, 'linked detail is not redacted');

  // The edge that let it through must be a real one, carrying the evidence it was matched on.
  const edges = db.adjacency[String(linked.caseMasterId)] || [];
  const bridge = edges.find((e) => {
    const n = db.cases.get(String(e.neighborId));
    return n && rbac.caseInScope(sp, n);
  });
  assert.ok(bridge, 'the allowance must rest on an actual adjacency edge');
  assert.ok(bridge.evidence && bridge.evidence.matched.length > 0, 'and that edge must carry matched evidence');

  // The other half of the rule: unlinked and out of district is still refused.
  const unlinked = db.caseList.find((c) => !rbac.caseInScope(sp, c) && !q.linkedIntoScope(sp, c));
  assert.ok(unlinked, 'the corpus must contain an unlinked out-of-district case');
  assert.strictEqual(q.getCase(sp, unlinked.caseMasterId).visible, false, 'no edge, no read');
});

test('case detail: linkage rests on adjacency, never on a shared clusterId', () => {
  const q = require('../api/services/queries');
  const sp = { ...rbac.DEMO_USERS.SP, roleMeta: rbac.ROLES.SP };
  const db = q.db();
  // clusterId is copied off the health record, so three quarters of the register has none.
  // Were it the join key, a case the pipeline never flagged could not be linked into anywhere
  // no matter how much evidence it shared -- so assert the allowance does not depend on it.
  const linkedWithoutCluster = db.caseList.find((c) => !rbac.caseInScope(sp, c)
    && !c.clusterId && q.linkedIntoScope(sp, c));
  assert.ok(linkedWithoutCluster, 'a case with no clusterId must still be reachable through its edges');
  assert.strictEqual(q.getCase(sp, linkedWithoutCluster.caseMasterId).visibility, 'linked');
});

test('case detail: a state officer drilled into a district is bounded by that drill', () => {
  const q = require('../api/services/queries');
  const db = q.db();
  const undrilled = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst };
  // Drilling is a narrowing, and it has to narrow the detail route too -- otherwise the drill
  // is a display filter with a scope label on it.
  const drilled = rbac.userFromRequest({ headers: { 'x-kadi-role': 'Analyst' }, query: { district: '3' } });
  assert.strictEqual(drilled.drilledFromState, true);

  const far = db.caseList.find((c) => String(c.districtId) !== '3' && !q.linkedIntoScope(drilled, c));
  assert.ok(far, 'there must be a case outside the drill with no edge into it');
  assert.strictEqual(q.getCase(undrilled, far.caseMasterId).visible, true, 'state tier reads everything');
  assert.strictEqual(q.getCase(drilled, far.caseMasterId).visible, false, 'the drill bounds the read');
});

test('case detail: requireInScope refuses the linked allowance that reads accept', () => {
  const q = require('../api/services/queries');
  const sp = { ...rbac.DEMO_USERS.SP, roleMeta: rbac.ROLES.SP };
  const db = q.db();
  const linked = db.caseList.find((c) => !rbac.caseInScope(sp, c) && q.linkedIntoScope(sp, c));
  assert.ok(linked, 'need a linked out-of-district case');

  // Reading that a case connects to yours is the thesis. Writing to it is not.
  assert.strictEqual(q.getCase(sp, linked.caseMasterId).visible, true, 'the read is allowed');
  assert.throws(
    () => q.getCase(sp, linked.caseMasterId, { requireInScope: true }),
    (e) => e.status === 403 && e.code === 'forbidden',
    'the write lookup refuses the same case',
  );

  // And a write lookup must throw rather than hand back a stub a caller might not check.
  const own = db.caseList.find((c) => rbac.caseInScope(sp, c));
  assert.strictEqual(q.getCase(sp, own.caseMasterId, { requireInScope: true }).visible, true);
});

test('writes take scope from a lookup that actually enforces it', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  // /case-updates admits station tier and DSP (submissions.requestUpdate), and its comment
  // has always said the district and unit come from the register rather than the body. That
  // stopped a body from lying but not a station SI from filing "arrest recorded" against any
  // case in all 31 districts, because the lookup checked nothing. Both write paths must pass
  // requireInScope; asserting on the source keeps the two from drifting apart again.
  for (const route of ["r.post('/case-updates'", "r.post('/evidence/note'"]) {
    const at = app.indexOf(route);
    assert.ok(at > 0, `${route} must exist`);
    const body = app.slice(at, at + 1600);
    const call = body.match(/q\.getCase\(req\.user,[^\n]*\)/);
    assert.ok(call, `${route} must resolve its case through q.getCase`);
    assert.ok(call[0].includes('requireInScope: true'), `${route} must require strict scope`);
  }
  // The evidence READ is stricter still: it does not honour the linked allowance either.
  const read = app.indexOf("r.get('/cases/:id/evidence'");
  assert.ok(read > 0);
  assert.ok(app.slice(read, read + 1600).includes('rbac.caseInScope(req.user, c)'),
    'readings stay at the case\'s own scope');
});

test('the kept-page routes fail closed on a refused case', () => {
  const rbac = require('../api/services/rbac');
  // These two routes were written BEFORE getCase enforced scope, so they resolve a case and
  // then check rbac.caseInScope themselves. getCase now answers an out-of-scope read with a
  // stub carrying the id and nothing else -- no districtId, no unitId -- and that stub is what
  // these routes now hand to caseInScope. It has to be refused rather than waved through: the
  // page behind a reading is a photograph of somebody's document.
  const stub = { caseMasterId: 'X', visible: false, visibility: 'out_of_scope' };
  for (const role of ['SP', 'DSP', 'SHO', 'SI']) {
    const u = { ...rbac.DEMO_USERS[role], roleMeta: rbac.ROLES[role] };
    assert.strictEqual(rbac.caseInScope(u, stub), false, `${role} must not pass a refusal stub`);
  }
  // A state account that has drilled into a district reads as that district, and the stub
  // carries no district to match -- so it is refused there too.
  const drilled = { ...rbac.DEMO_USERS.Analyst, roleMeta: rbac.ROLES.Analyst,
    drilledFromState: true, districtId: '1' };
  assert.strictEqual(rbac.caseInScope(drilled, stub), false,
    'a drilled state account must not pass a refusal stub either');

  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  for (const route of ["r.get('/evidence/note/:id/page'", "r.post('/evidence/note/:id/reread'"]) {
    const at = app.indexOf(route);
    assert.ok(at > 0, `${route} must exist`);
    const body = app.slice(at, at + 1400);
    assert.match(body, /rbac\.caseInScope\(req\.user, c\)/,
      `${route} must check scope on the case it resolved`);
  }
});

test('the sidebar does not hide role-gated items while /me is loading', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'client', 'src', 'components', 'Shell.tsx'), 'utf8');
  // `me && n.roles.includes(...)` made Audit and Administration absent for the first second of
  // every page load and then appear. On a screen a police officer is meant to trust, a tab
  // that flickers reads as a fault. The rail falls back to the locally known role instead --
  // safe, because the routes enforce rank themselves and this list is decoration.
  assert.ok(!/NAV\.filter\(\(n\) => !n\.roles \|\| \(me &&/.test(src),
    'the rail must not gate on me being loaded');
  assert.match(src, /const navRole = \(me && me\.user\.role\) \|\| role;/,
    'it falls back to the session role while /me is in flight');
});

test('the sidebar is resizable and the page is not centred away from it', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'client', 'src', 'components', 'Shell.tsx'), 'utf8');

  // The width travels as a CSS VARIABLE. An inline `width` beats every class including the
  // `w-16` that keeps the rail an icon strip on a phone, so setting it directly would drag the
  // mobile layout along with the desktop one.
  assert.match(src, /\['--rail' as any\]: `\$\{rail\}px`/, 'width must ride on a custom property');
  assert.match(src, /md:w-\[var\(--rail\)\]/, 'and be consumed only inside the md breakpoint');
  assert.ok(!/style=\{collapsed \? undefined : \{ width: rail \}\}/.test(src),
    'never set an inline width — it would override the mobile rail');

  // mx-auto inside a max-width put ~90px of nothing between the rail and the page on a wide
  // screen, which reads as the layout having come apart rather than as breathing room.
  const page = src.slice(src.indexOf('page-enter'), src.indexOf('page-enter') + 120);
  assert.ok(!/mx-auto/.test(page), 'the page must not be centred away from the sidebar');

  // Forecast sits with the analytical screens; Evidence with the restricted ones above Audit.
  assert.ok(src.indexOf("key: 'forecast'") < src.indexOf("key: 'evidence'"),
    'Forecast comes before Evidence in the rail');
});

test('no mermaid classDef uses a reserved keyword', () => {
  const fs = require('fs');
  const path = require('path');
  // `graph` is how mermaid used to open a flowchart, so `classDef graph` is a parse error and
  // GitHub renders the whole diagram as "Unable to render rich display". It cost one deploy.
  const RESERVED = new Set(['graph', 'flowchart', 'subgraph', 'end', 'class', 'classdef',
    'click', 'style', 'linkstyle', 'direction', 'default', 'call', 'href', 'link']);
  const root = path.join(__dirname, '..', '..');
  const files = ['README.md', ...fs.readdirSync(path.join(root, 'docs'))
    .filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f))];
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/classDef\s+(\w+)/g)) {
      if (RESERVED.has(m[1].toLowerCase())) offenders.push(`${f}: classDef ${m[1]}`);
    }
    // A semicolon ends a statement in the sequence grammar; it cost another deploy.
    for (const block of src.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
      if (/^\s*Note[^\n]*;/m.test(block[1])) offenders.push(`${f}: semicolon in a Note`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `these diagrams will not render: ${offenders.join('; ')}`);
});

test('no mermaid diagram names a font the renderer may not have', () => {
  const fs = require('fs');
  const path = require('path');
  // Mermaid MEASURES a label with the font named in the init directive and DRAWS it with
  // whatever the renderer actually resolved. Naming a font the renderer lacks makes every
  // subgraph title come out a character or two short -- "SERVERLESS FUNCTION" rendered as
  // "SERVERLESS FUNCTIC", on GitHub and locally. Let mermaid pick its own face.
  const root = path.join(__dirname, '..', '..');
  const files = ['README.md', ...fs.readdirSync(path.join(root, 'docs'))
    .filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f))];
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const block of src.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
      if (/fontFamily/.test(block[1])) offenders.push(f);
    }
  }
  assert.deepStrictEqual([...new Set(offenders)], [],
    `these files set a mermaid fontFamily, which clips subgraph titles: ${offenders.join(', ')}`);
});

test('a question about open cases is not answered with the whole corpus', () => {
  const assistant = require('../api/services/assistant');
  // "How many cases are open?" carries "case" and "how many", so it fell into the catch-all
  // count branch, which filtered on nothing and answered 59,985 -- the entire register -- when
  // 16,868 are open. Worse than a hallucination: the number is real, it is cited, and it
  // survives the numeric guard, because it is the right answer to a question nobody asked.
  const d = assistant.detectStatus;
  assert.ok(typeof d === 'function', 'the status detector must be exported');
  for (const q of ['How many cases are open?', 'open cases in Bengaluru', 'pending cases',
    'cases still under investigation', 'how many are unsolved']) {
    assert.strictEqual((d(q) || {}).id, '1', `"${q}" is an open-cases question`);
  }
  assert.strictEqual((d('how many chargesheeted cases') || {}).id, '2');
  assert.strictEqual((d('closed cases last month') || {}).id, '3');
  assert.strictEqual((d('undetected cases in Kodagu') || {}).id, '4');
  // Kannada carries its own words; the English patterns never match them.
  assert.strictEqual((d('ಎಷ್ಟು ಪ್ರಕರಣಗಳು ತೆರೆದಿವೆ?') || {}).id, '1');
  // A question with no status qualifier still means "all".
  assert.strictEqual(d('cyber-crime FIRs in Bengaluru this quarter'), null);
  assert.strictEqual(d('how many cases are there in total'), null);
});

test('a count that is not a number of cases is not answered with a case count', () => {
  const assistant = require('../api/services/assistant');
  const d = assistant.detectStatCount;
  // Each of these carries "how many", so each fell into the case branch and was answered with
  // the size of the register: 59,985 for a figure that was 60, or 127, or 26,168.
  const cases = [
    ['How many offenders are high risk?', 'highRiskOffenders'],
    ['How many networks are active?', 'activeNetworks'],
    ['How many cases carry a health flag?', 'flaggedCases'],
    ['how many cross-district networks', 'crossDistrictNetworks'],
    ['number of emerging hotspots', 'emergingHotspots'],
  ];
  for (const [q, field] of cases) {
    assert.strictEqual((d(q) || {}).field, field, `"${q}" must map to ${field}`);
  }
  // A plain case question is still a case question.
  assert.strictEqual(d('How many cases are open?'), null);
  assert.strictEqual(d('cyber-crime FIRs in Bengaluru'), null);
  // And a statement that merely mentions networks is not a count.
  assert.strictEqual(d('show me the network around this FIR'), null);
});

test('the case-count branch never lets the model re-word its answer', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'services', 'assistant.js'), 'utf8');
  // The branch counts by head, district, date and status and by nothing else, so its sentence
  // is honestly generic. Handed a generic sentence and a specific question, the phrasing model
  // closes the gap by inventing the claim -- "59,985 cases carry a health flag". The number is
  // real, so the numeric guard passes it. Only the claim is false, and no digit check sees that.
  const branch = src.slice(src.indexOf("intent = 'cases_query'"));
  const body = branch.slice(0, branch.indexOf('} else {'));
  assert.match(body, /noPhrase = true/, 'the case-count branch must be served verbatim');
  const stat = src.slice(src.indexOf("intent = 'stat_count'"));
  assert.match(stat.slice(0, 600), /noPhrase = true/, 'so must the stat-count branch');
});

test('the more specific stat pattern wins over the broader one', () => {
  const d = require('../api/services/assistant').detectStatCount;
  // `networks` matches inside "cross-district networks" and `flagged` inside "serious flagged".
  // If the broad pattern is reached first the narrow one is never reachable at all.
  assert.strictEqual(d('how many cross-district networks').field, 'crossDistrictNetworks');
  assert.strictEqual(d('how many networks').field, 'activeNetworks');
  assert.strictEqual(d('how many seriously flagged cases').field, 'seriousFlaggedCases');
  assert.strictEqual(d('how many flagged cases').field, 'flaggedCases');
});

test('the README test badge matches the suite', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const suite = fs.readFileSync(path.join(__dirname, 'api.test.js'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  // Counted from the source rather than from a run, so this cannot depend on its own result.
  const declared = (suite.match(/^test\(/gm) || []).length;
  const badge = Number((readme.match(/tests-(\d+)_passing/) || [])[1]);
  // It has drifted twice: 74 while the suite ran 76, then 76 while it ran 81. A badge nobody
  // rechecks is exactly the kind of stale claim the README rewrite existed to remove.
  assert.strictEqual(badge, declared,
    `README badge says ${badge}, the suite declares ${declared}`);
  // Every place the README states the Node count, including inside code fences -- the two
  // fenced ones drifted to 74 while the suite ran 83, because the first version of this test
  // only looked at prose.
  for (const re of [/\*\*(\d+) Node tests\*\*/, /\| Test suite \| \*\*(\d+) passing\*\* \|/,
                    /npm test\s+# (\d+) tests/, /test\/api\.test\.js\s+(\d+) tests/]) {
    const n = Number((readme.match(re) || [])[1]);
    assert.strictEqual(n, declared, `a README test count says ${n}, the suite declares ${declared}`);
  }
});

test('the diagrams kept their arrows when the emoji were stripped', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');
  // The regex that removed the emoji used the range ←-⇿ (U+2190–U+21FF), which is arrows, not
  // pictographs — so it also ate the → in "54,337 → 52,928 identities" and left a double space
  // that read as a typo.
  assert.match(src, /54,337 → 52,928 identities/, 'the entity-resolution arrow must be present');
  for (const block of src.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    assert.ok(!/[A-Za-z0-9,]  +[A-Za-z0-9]/.test(
      block[1].split('\n').filter((l) => !/^\s*(classDef|style)\s/.test(l)).join('\n')),
    'a double space inside a diagram label means a character was stripped');
  }
});
