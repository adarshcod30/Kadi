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
