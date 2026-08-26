// app.js — the KADI API surface (Express). Runs locally and, wrapped, as a Catalyst
// Advanced I/O Function. Every route: RBAC-scoped, returns the standard envelope, and
// insight endpoints carry an `explanation`/`fairness` payload. Reads only precomputed
// data — no heavy compute here (that lives in AppSail/Jobs).
const express = require('express');
const cors = require('cors');
const { handle, forbidden } = require('./lib/envelope');
const rbac = require('./services/rbac');
const q = require('./services/queries');
const assistant = require('./services/assistant');
const audit = require('./services/audit');
const cache = require('./services/cache');
const quickml = require('./services/quickml');
const zia = require('./services/zia');
const datastore = require('./services/datastore');
const insight = require('./services/insight');
const intel = require('./services/intelligence');
const smartbrowz = require('./services/smartbrowz');

// Zone values are machine tokens and the model copies facts verbatim, so anything reaching
// it must already be language. Shared by /command and /zones.
const ZONE_LABEL_TEXT = {
  red_pulsing: 'sharply rising', red: 'well above baseline',
  yellow: 'above baseline', normal: 'at baseline',
};

function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = rbac.userFromRequest(req);
    req.clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local';
    next();
  });

  const r = express.Router();

  r.get('/health', handle(async () => ({ status: 'ok', service: 'kadi-api', time: new Date().toISOString() })));

  r.get('/me', handle(async (req) => ({
    user: { appUserId: req.user.appUserId, name: req.user.name, role: req.user.role,
      unitId: req.user.unitId, districtId: req.user.districtId },
    capabilities: rbac.capabilities(req.user),
    fairness: q.FAIRNESS_STATEMENT,
    roles: Object.keys(rbac.DEMO_USERS),
  })));

  r.get('/lookups', handle(async () => q.lookups()));
  r.get('/stations', handle(async (req) => q.stations(req.user, req.query)));
  r.get('/anomalies', handle(async (req) => q.anomalies(req.user, req.query)));
  r.get('/diag/zia', handle(async (req) => zia.probe(req)));
  // Round-trips a value through Cache so the read/write path is verifiable from outside
  // rather than inferred from whether /stats felt fast.
  r.get('/diag/cache', handle(async (req) => {
    const key = 'kadi:diag';
    const wrote = await cache.put(req, key, { at: new Date().toISOString() });
    const readBack = await cache.get(req, key);
    return { wrote, readBack, roundTrip: !!(wrote && readBack), ...cache.diag() };
  }));
  // Dashboard KPIs are identical for every user in a role and only change when the
  // pipeline reruns, so they are served through Catalyst Cache. A cache miss (or no
  // Catalyst context at all, e.g. local dev) just computes as before.
  r.get('/stats', handle(async (req) => {
    // Served through the Catalyst Cache adapter over raw HTTPS with the credential
    // headers Catalyst puts on the request. The old 401 PERMISSION_NEEDED was never a
    // missing Cache scope -- it was the SDK failing to find a credential that was in
    // the headers all along, the same root cause that blocked Data Store.
    const { data } = await cache.through(
      // Every axis scoped() filters on must appear in the key. drillUnitId was missing:
      // two SIs in different stations of one district would have shared a cache entry.
      req,
      `stats:${q.buildId()}:${req.user.role}:${req.user.districtId || 'state'}:${req.user.drillUnitId || 'all'}`,
      async () => q.stats(req.user),
    );
    if (String(req.query.explain) !== 'true') return data;
    const sb = data.statusBreakdown || {};
    const { text, source } = await insight.generate(req, 'command dashboard briefing', {
      scope: data.scope, district: data.districtName || 'Karnataka',
      totalFIRs: data.totalCases, open: data.openCases,
      chargeSheeted: sb.chargeSheeted, undetected: sb.undetected,
      clearancePct: data.totalCases ? Math.round(1000 * (sb.chargeSheeted || 0) / data.totalCases) / 10 : 0,
      flaggedSlipping: data.flaggedCases, seriousFlags: data.seriousFlaggedCases,
      repeatOffenders: data.resolvedOffenders, offenderNetworks: data.activeNetworks,
      operatingAcrossDistricts: data.crossDistrictNetworks,
      topCrimeHeads: (data.topCrimeHeads || []).slice(0, 3).map((h) => `${h.name} ${h.count}`),
    });
    return { ...data, insight: text, insightSource: source };
  }));
  // One route, two products. The tier decides which command view you get, and the payload
  // says which one so the client renders the right thing rather than guessing from shape.
  r.get('/command', handle(async (req) => {
    const tier = req.user.roleMeta.tier;
    const stateView = tier === 'state' && !req.user.drilledFromState;
    const stationView = tier === 'station';
    const body = stationView ? q.stationCommand(req.user)
      : stateView ? q.stateCommand(req.user) : q.districtCommand(req.user);
    const out = { view: stationView ? 'station' : stateView ? 'state' : 'district', ...body };
    if (String(req.query.explain) !== 'true') return out;
    const zoneLabel = (z) => ZONE_LABEL_TEXT[z] || z || 'at baseline';
    if (stationView) {
      // Narrated through SIGNALS_SYSTEM, not the generic prompt. Handed a loose fact bag the
      // model welded two independent figures into one claim -- "83 open cases, which is 108
      // carrying a health flag" -- the same re-nouning failure the intelligence bands hit.
      // Self-contained findings with their units attached remove the opportunity.
      const f = {
        findings: [
          `1. ${body.unitName} holds ${body.total.toLocaleString('en-IN')} FIRs on its own register, of which ${body.open.toLocaleString('en-IN')} are still open.`,
          `2. ${body.flagged.toLocaleString('en-IN')} of those FIRs carry an investigation-health flag. This is a separate count from the open figure above.`,
          `3. ${body.linkedWithinStation.toLocaleString('en-IN')} of this station's cases connect to a case registered elsewhere, and those connect out to ${body.linkedOutTotal.toLocaleString('en-IN')} cases beyond this register — ${body.linkedOutOtherDistricts.toLocaleString('en-IN')} of them in another district. This officer cannot open any of them.`,
          `4. Against its own historical average this station is ${zoneLabel(body.zone)}.`,
        ],
        recordsInView: body.total.toLocaleString('en-IN'),
      };
      const r2 = await insight.generate(req, 'a single police station register and what it cannot see', f,
        { maxTokens: 190, system: insight.SIGNALS_SYSTEM });
      return { ...out, insight: r2.text, insightSource: r2.source };
    }
    const facts = stateView ? {
      scope: 'Karnataka, 31 districts',
      districtsNeedingAttention: body.needsAttention,
      zoneSummary: body.zoneSummary,
      stationsPulsing: body.stationsPulsing.length,
      topByConcern: body.districts.slice(0, 4).map((d) => ({
        district: d.districtName, zone: zoneLabel(d.zone), change: `${d.changePct}%`,
        driver: d.driverHead, seriousFlags: d.seriousFlags })),
    } : {
      district: body.districtName,
      shareOfStateVolume: `${body.shareOfState}%`,
      stations: body.stations.length,
      stationsAboveBaseline: body.stationsFlagged,
      casesLinkedInFromOtherDistricts: body.linkedInTotal,
      busiestStations: body.stations.slice(0, 3).map((s) => ({
        station: s.unitName, cases: s.total, open: s.open, zone: zoneLabel(s.zone) })),
    };
    const kind = stateView ? 'state command picture' : 'district command picture';
    const { text, source } = await insight.generate(req, kind, facts, { maxTokens: 200 });
    return { ...out, insight: text, insightSource: source };
  }));

  r.get('/alerts', handle(async (req) => q.alerts(req.user)));

  // Zone board -- the brief's "emerging trend alerts / red-zone pulsing", computed against
  // each area's own baseline rather than by volume. ?explain=true adds an AI reading of it.
  r.get('/zones', handle(async (req) => {
    const z = q.zones(req.user);
    if (String(req.query.explain) !== 'true') return z;
    const s = z.summary || {};
    const districtScope = z.scope === 'district';
    const hot = (z.stations || []).filter((x) => x.zone === 'red_pulsing').slice(0, 3);
    // Category alerts carry the signal a total-volume summary averages away, so they lead.
    const alerts = (z.alerts || []).slice(0, 4).map((a) => ({
      category: a.crimeHead, district: a.districtName, status: ZONE_LABEL_TEXT[a.zone] || a.zone,
      current: a.current, ownAverage: a.baseline, sigmasAboveOwnAverage: a.z,
      // Self-describing, because a bare "+9 cases" reads as a margin rather than a bar:
      // the model wrote "exceeds the red line by 9 cases" when the red line WAS +9.
      // The figure was copied correctly and the relationship invented, so the fix belongs
      // in the label, not the prompt.
      redThresholdRule: `in this area a rise of +${a.thresholds && a.thresholds.redAt} or more above its own average counts as red`,
    }));
    // A drilled-in officer must not be told about the other 30 districts. Counting units
    // that are not theirs under their own district heading is how "Normal 31" ended up on
    // a Shivamogga page.
    const facts = districtScope ? {
      scope: `${(z.districts[0] || {}).districtName || 'this district'} only`,
      month: s.month, baselineMonths: s.baselineMonths,
      stationsHere: s.totalStations,
      stationsRed: s.red, stationsPulsing: s.red_pulsing, stationsYellow: s.yellow,
      stationsNormal: s.normal,
      categoryAlertsHere: alerts,
      stationsAboveOwnBaseline: (z.stations || []).slice(0, 3).map((x) => ({
        unitId: x.unitId, current: x.current, ownAverage: x.baseline,
        sigmasAboveOwnAverage: x.z, change: `${x.changePct}%`,
      })),
    } : {
      scope: 'Karnataka, 31 districts',
      month: s.month, baselineMonths: s.baselineMonths,
      districtsRed: s.red, districtsPulsing: s.red_pulsing, districtsYellow: s.yellow,
      districtsNormal: s.normal,
      categoryAlerts: alerts,
      biggestMovers: (z.districts || []).slice(0, 3).map((d) => ({
        district: d.districtName, change: `${d.changePct}%`, driver: d.driverHead,
        current: d.current, ownAverage: d.baseline, sigmasAboveOwnAverage: d.z,
      })),
      stationsPulsing: hot.map((x) => ({ unitId: x.unitId, current: x.current,
        baseline: x.baseline, change: `${x.changePct}%` })),
    };
    const { text, source } = await insight.generate(
      req, districtScope ? 'zone status for one district' : 'district and station zone status', facts,
    );
    return { ...z, insight: text, insightSource: source };
  }));
  r.get('/eval', handle(async () => q.evalReport()));
  r.get('/clusters', handle(async () => q.clusters().slice(0, 100)));

  // cases
  // Deliberately NOT routed through Data Store. The mapper exists and works
  // (datastore.enrich), but the Data Store copy is a snapshot from before the corpus was
  // regenerated -- it returns 40,836 rows against the bundle's 40,829, and its lookup tables
  // are stale too. Serving slightly wrong data to look architecturally purer is a bad trade.
  //
  // ?source=datastore opts in for demonstration; /datastore/cases shows the live ZCQL path
  // on its own. Re-import CaseMaster via Stratus bulk-write and this becomes a one-line flip.
  r.get('/cases', handle(async (req) => {
    if (String(req.query.source) === 'datastore') {
      const live = await datastore.listCases(req, req.query, q.scopeUnitIds(req.user));
      if (live && Array.isArray(live.items)) {
        return { ...live, items: datastore.enrich(live.items, q.db()),
          source: 'datastore', warning: 'Data Store snapshot predates the current corpus.' };
      }
    }
    return { ...q.listCases(req.user, req.query), source: 'bundle' };
  }));
  // NOTE: registered before '/cases/:id' and '/offenders/:id' on purpose. Express matches
  // routes in order, so a ':id' pattern declared first captures the literal segment and
  // /cases/intelligence resolves as "the case whose id is 'intelligence'".
  // ---- contextual intelligence -------------------------------------------------------
  // One shape for four surfaces: deterministic signals computed over the CURRENT slice, then
  // narrated. The narration is optional and additive -- if the model is unreachable the
  // signals still render, because they were never the model's to produce.
  //
  // Cached on the exact query string. Two officers looking at the same filtered view get the
  // same answer, and the second one does not pay for the model call.
  // Cache keys go into Catalyst's cache_name field, which will not take raw JSON: the first
  // version embedded JSON.stringify(req.query) and every write silently failed, so the model
  // was re-run on every request (3.2s each) while the code looked like it was caching.
  // Hashed to a short alphanumeric token instead.
  const keyHash = (s2) => {
    let h = 5381;
    for (let i = 0; i < s2.length; i += 1) h = ((h * 33) ^ s2.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };
  const withNarrative = async (req, kind, out, maxTokens) => {
    if (String(req.query.explain) === 'false' || !out.total) return out;
    const key = `intel_${keyHash(`${kind}:${req.user.role}:${req.user.districtId || 'state'}:${JSON.stringify(req.query)}`)}`;
    const hit = await cache.get(req, key);
    if (hit) return { ...out, insight: hit, insightSource: 'cache' };
    // Narrate from the ranked findings rather than the raw fact bag. The findings are
    // already prose-shaped and already ordered by materiality, so the model cannot open on a
    // trivial item or miss the strongest one -- both of which it did when handed loose facts.
    const { text, source } = await insight.generate(req, kind, {
      findings: out.signals.map((sg, i) => `${i + 1}. ${sg.title} — ${sg.detail}`),
      recordsInView: (out.total || 0).toLocaleString('en-IN'),
    }, { maxTokens, system: insight.SIGNALS_SYSTEM });
    if (text) await cache.put(req, key, text);
    return { ...out, insight: text, insightSource: source };
  };

  r.get('/cases/intelligence', handle(async (req) => {
    const { rows } = q.filterCases(req.user, req.query);
    const applied = Object.fromEntries(Object.entries(req.query)
      .filter(([k]) => !['page', 'pageSize', 'sort', 'explain', 'district'].includes(k)));
    const out = intel.caseIntelligence(rows, q.scopeBaseline(req.user), applied);

    return withNarrative(req, 'what stands out in this filtered slice of the case register', out, 200);
  }));

  // Zia reads the free-text narratives that the structured fields cannot reach. A sub-head
  // says a case is Online Financial Fraud; only the narrative says whether the method was a
  // fake KYC call or a QR-code scam -- and a series shares the method, not the sub-head.
  //
  // Deliberately its own route rather than part of /cases/intelligence. Zia is an external
  // call and took ~9s against a 40-narrative sample, which would have held the whole panel
  // behind it. The deterministic signals render immediately; this arrives when it arrives.
  // Same reasoning as /cases/:id/entities, which is split out for exactly this reason.
  r.get('/cases/themes', handle(async (req) => {
    const { rows } = q.filterCases(req.user, req.query);
    if (rows.length < 8) return { themes: [], available: false, reason: 'too few narratives to find a recurring pattern' };
    const key = `themes_${keyHash(`${req.user.role}:${req.user.districtId || 'state'}:${JSON.stringify(req.query)}`)}`;
    const hit = await cache.get(req, key);
    if (hit) return { ...hit, cached: true };
    const out = await zia.narrativeThemes(req, rows.slice(0, 40).map((c) => c.briefFacts));
    if (!out) return { themes: [], available: false, reason: zia.status().lastError || 'Zia unavailable' };
    const body = { ...out, available: true };
    await cache.put(req, key, body);
    return body;
  }));

  r.get('/offenders/intelligence', handle(async (req) => {
    const list = q.listOffenders(req.user, { ...req.query, page: 1, pageSize: 200 });
    const out = intel.offenderIntelligence(list.items, q.db().cases, q.db().offendersById);
    return withNarrative(req, 'repeat-offender watchlist priorities', out, 200);
  }));

  r.get('/health/intelligence', handle(async (req) => {
    const rows = q.filterHealth(req.user, req.query);
    const out = intel.healthIntelligence(rows, q.db().cases);
    return withNarrative(req, 'investigation health — where supervision should intervene', out, 190);
  }));

  r.get('/geo/intelligence', handle(async (req) => {
    const { rows } = q.filterCases(req.user, req.query);
    // q.hotspots returns { hotspots, scope, spatiotemporal }, not a bare array.
    const spots = q.hotspots(req.user, req.query);
    const out = intel.geoIntelligence(rows, spots.hotspots || []);
    return withNarrative(req, 'spatiotemporal patterns and patrol timing', out, 190);
  }));

  r.get('/cases/:id', handle(async (req) => {
    audit.record({ user: req.user, action: 'view_case', targetType: 'case', targetId: req.params.id, ip: req.clientIp, req });
    return q.getCase(req.user, req.params.id);
  }));

  // Entities pulled out of the FIR's own narrative by Zia. Separate from /cases/:id so the
  // case view renders immediately and this fills in -- it is a network call to an external
  // service and must never hold up the page.
  r.get('/cases/:id/entities', handle(async (req) => {
    const c = q.getCase(req.user, req.params.id);
    if (!c) return { entities: {}, keyphrases: [], available: false };
    const out = await zia.analyseNarrative(req, c.briefFacts || c.BriefFacts || '');
    if (!out) return { entities: {}, keyphrases: [], available: false, reason: zia.status().lastError };
    return { ...out, available: true, caseMasterId: String(req.params.id) };
  }));

  // graph (the hero)
  r.get('/graph/case/:id', handle(async (req) => {
    audit.record({ user: req.user, action: 'view_graph', targetType: 'case', targetId: req.params.id, ip: req.clientIp, req });
    const g = q.graphForCase(req.user, req.params.id, { maxNeighbors: Number(req.query.maxNeighbors) || 60 });
    if (String(req.query.explain) !== 'true') return g;

    const caseNodes = g.nodes.filter((n) => n.type === 'case');
    const offNodes = g.nodes.filter((n) => n.type === 'offender');
    const realEdges = g.edges.filter((e) => e.edgeType !== 'appears_in');
    const outside = caseNodes.filter((n) => n.outsideScope);
    const districts = new Set(caseNodes.map((n) => n.district).filter(Boolean));
    const kindCounts = {};
    for (const e of realEdges) {
      for (const t of new Set([e.edgeType, ...(e.allTypes || [])])) kindCounts[t] = (kindCounts[t] || 0) + 1;
    }
    const corroborated = realEdges.filter((e) => new Set([e.edgeType, ...(e.allTypes || [])]).size >= 2).length;
    const topOffenders = offNodes.filter((o) => o.band === 'High').sort((a, b) => b.riskScore - a.riskScore);
    const center = caseNodes.find((n) => n.isCenter);

    // homeDistrict (set inside graphForCase) only exists for a district-tier or drilled-in
    // viewer. For a state-tier viewer with no drill, "outside my district" is not a
    // meaningful question, and outside.length is always 0 by construction -- not a finding.
    // Including it unconditionally previously produced "spans 15 districts ... all
    // originating within this district", a self-contradiction: the model read the always-0
    // count as a real fact and invented a relationship between it and districtsSpanned that
    // does not hold. Omitted entirely rather than sent in as a misleading zero.
    const districtScoped = Boolean(req.user && ((req.user.roleMeta && req.user.roleMeta.tier === 'district')
      || req.user.drilledFromState));
    const facts = {
      case: center ? center.label : req.params.id,
      crimeType: center ? `${center.crimeSubHead} (${center.crimeHead})` : '',
      linkedCases: caseNodes.length - 1,
      districtsSpanned: districts.size,
      ...(districtScoped ? { casesLinkedFromOutsideMyDistrict: outside.length } : {}),
      offendersInNetwork: offNodes.length,
      highRiskOffenders: topOffenders.length,
      topHighRiskOffender: topOffenders[0] ? topOffenders[0].label : null,
      evidenceKindCounts: kindCounts,
      linksWithTwoPlusEvidenceKinds: corroborated,
    };
    const { text, source } = await insight.generate(req, 'case-linkage network briefing', facts, { maxTokens: 180 });
    return { ...g, insight: text, insightSource: source };
  }));
  r.get('/graph/featured', handle(async (req) => {
    // ~20 for state, ~12 for a district -- enough variety to browse, few enough to scan.
    const stateTier = req.user.roleMeta.tier === 'state';
    const limit = Number(req.query.limit) || (stateTier ? 20 : 12);
    return q.featuredNetworks(limit, req.user);
  }));
  r.get('/graph/cluster/:id', handle(async (req) => q.getCluster(req.user, req.params.id)));
  r.get('/graph/search', handle(async (req) => ({ clusters: q.clusters().filter((c) => {
    if (req.query.crossDistrict === 'true' && !c.crossDistrict) return false;
    if (req.query.minSize && c.size < Number(req.query.minSize)) return false;
    return true;
  }).slice(0, 60) })));

  // offenders
  r.get('/offenders', handle(async (req) => q.listOffenders(req.user, req.query)));

  // Association detection -- who works with whom, cross-district pairs first.
  r.get('/offenders/associations', handle(async (req) => {
    const a = q.associations(req.user, req.query);
    if (String(req.query.explain) !== 'true') return a;
    const { text, source } = await insight.generate(req, 'co-offending associations', {
      totalPairs: a.total, crossDistrictPairs: a.crossDistrictPairs, scope: a.scope,
      strongest: (a.items || []).slice(0, 4).map((p) => ({
        pair: `${p.a.name} + ${p.b.name}`, sharedCases: p.sharedCases,
        districts: p.districts.length, combinedRisk: p.combinedRisk })),
    }, { maxTokens: 190 });
    return { ...a, insight: text, insightSource: source };
  }));
  r.get('/offenders/:id', handle(async (req) => {
    audit.record({ user: req.user, action: 'view_offender', targetType: 'offender', targetId: req.params.id, ip: req.clientIp, req });
    const o = await q.getOffender(req.user, req.params.id);
    if (String(req.query.explain) !== 'true') return o;
    // Facts only. The model never sees, and never invents, an FIR number.
    const { text, source } = await insight.generate(req, 'repeat offender behavioural summary', {
      cases: o.distinctCases, districts: o.distinctDistricts,
      firstSeen: o.firstSeenDate, lastSeen: o.lastSeenDate,
      nameVariantsResolved: (o.nameVariants || []).length,
      riskScore: o.riskScore, riskBand: o.band,
      riskFactors: (o.factors || []).map((f) => `${f.label} +${f.value}`),
      crimeTypes: [...new Set((o.cases || []).map((c) => c.crimeSubHead).filter(Boolean))].slice(0, 6),
      stations: [...new Set((o.cases || []).map((c) => c.unitName).filter(Boolean))].slice(0, 6),
      coOffenders: (o.coOffenders || []).length,
      note: 'Protected attributes are excluded from the score by construction.',
    }, { maxTokens: 200 });
    return { ...o, insight: text, insightSource: source };
  }));

  // investigation health
  r.get('/health/cases', handle(async (req) => q.listHealth(req.user, req.query)));
  r.get('/health/summary', handle(async (req) => {
    const h = await q.healthSummary(req.user);
    if (String(req.query.explain) !== 'true') return h;
    const { text, source } = await insight.generate(req, 'investigation health worklist', {
      flaggedTotal: h.flaggedTotal, high: h.high, medium: h.medium,
      avgInvestigationAgeDays: h.avgAgeDays,
      stationAnomalies: (h.anomalies || []).length,
      topReasons: (h.reasons || []).slice(0, 4),
    }, { maxTokens: 180 });
    return { ...h, insight: text, insightSource: source };
  }));

  // geo
  r.get('/geo/points', handle(async (req) => q.geoPoints(req.user, req.query)));
  r.get('/geo/grid', handle(async (req) => q.geoGrid(req.user, req.query)));
  r.get('/geo/hotspots', handle(async (req) => q.hotspots(req.user, req.query)));
  r.get('/geo/districts', handle(async () => q.districtStats()));
  r.get('/geo/national', handle(async () => q.national()));

  // analytics (role-gated)
  r.get('/analytics/vulnerability', handle(async (req) => q.vulnerability(req.user)));
  // Sociological + predictive intelligence (problem statement pillar 3). Both are
  // state-wide, area-level aggregates — no person-level rows, so no RBAC scoping.
  r.get('/analytics/socio', handle(async (req) => q.socio(req.user)));

  // How crime behaves on festivals and holidays versus ordinary days. The brief asks for
  // temporal pattern discovery, and in India the calendar is where the structure is.
  r.get('/analytics/occasions', handle(async (req) => {
    const o = q.occasions();
    if (String(req.query.explain) !== 'true') return o;
    const { text, source } = await insight.generate(req, 'crime on festivals and holidays vs ordinary days', {
      baselineCasesPerDay: o.baselineCasesPerDay,
      byDayClass: (o.classes || []).map((c) => ({ dayClass: c.dayClass, perDay: c.casesPerDay,
        vsNormal: `${c.vsNormalPct}%`, peakHour: c.peakHour })),
      topOccasions: (o.occasions || []).slice(0, 4).map((x) => ({ occasion: x.occasion,
        perDay: x.casesPerDay, vsNormal: `${x.vsNormalPct}%`, topHead: x.topHead })),
    });
    return { ...o, insight: text, insightSource: source };
  }));
  r.get('/analytics/forecast', handle(async (req) => {
    const f = q.forecast(req.user);
    if (String(req.query.explain) !== 'true') return f;
    const districtView = f.scope === 'district';
    const facts = districtView ? {
      scope: `${f.focus.districtName} only`,
      horizonMonths: f.horizonMonths,
      recentMonthlyAverage: f.focus.recentAvg,
      nextMonthProjection: f.focus.nextMonth,
      changeVsRecentAverage: `${f.focus.changePct}%`,
      direction: f.focus.direction,
      rankAmongDistrictsByChange: `${f.focus.rankByChange} of ${f.focus.ofDistricts}`,
      comparedWithStateTrend: `${f.focus.vsStateChangePct}% points`,
      backtestErrorPct: f.accuracy && f.accuracy.mape,
    } : {
      scope: 'Karnataka, 31 districts',
      horizonMonths: f.horizonMonths,
      stateNextMonth: f.state && f.state.nextMonth,
      stateChange: f.state && `${f.state.changePct}%`,
      backtestErrorPct: f.accuracy && f.accuracy.mape,
      districtsRising: (f.movers.rising || []).length,
      fastestRising: (f.movers.rising || []).slice(0, 4).map((d) => ({
        district: d.districtName, nextMonth: d.nextMonth,
        recentAverage: d.recentAvg, change: `${d.changePct}%`,
      })),
      fastestFalling: (f.movers.falling || []).slice(0, 3).map((d) => ({
        district: d.districtName, change: `${d.changePct}%`,
      })),
    };
    const { text, source } = await insight.generate(
      req, districtView ? 'three-month projection for one district'
        : 'three-month crime projection across Karnataka', facts, { maxTokens: 220 },
    );
    return { ...f, insight: text, insightSource: source };
  }));

  // assistant
  r.post('/assistant/query', handle(async (req) => {
    const text = (req.body && req.body.text) || '';
    const lang = (req.body && req.body.lang) || 'en';
    audit.record({ user: req.user, action: 'assistant_query', targetType: 'nl', queryText: text, ip: req.clientIp, req });
    return assistant.queryEnhanced(req.user, text, lang, req);
  }));
  r.post('/assistant/voice', handle(async (req) => {
    // Local fallback: client does Web Speech STT/TTS; here we answer the transcribed text.
    const text = (req.body && req.body.text) || '';
    const lang = (req.body && req.body.lang) || 'en';
    audit.record({ user: req.user, action: 'assistant_voice', targetType: 'nl', queryText: text, ip: req.clientIp, req });
    const ans = await assistant.queryEnhanced(req.user, text, lang, req);
    // Zia TTS when available; otherwise the client speaks it with Web Speech.
    const spoken = await zia.translateThenSpeak(req, ans.answer, lang);
    return {
      ...ans,
      ttsText: ans.answer,
      tts: spoken && !spoken.unsupported
        ? { engine: 'zia', lang: spoken.lang, note: spoken.note }
        : { engine: 'browser-web-speech', reason: (spoken && spoken.reason) || 'Zia not configured' },
    };
  }));
  r.post('/assistant/export', handle(async (req) => {
    const { title, messages } = req.body || {};
    const html = renderBriefingHtml(title || 'KADI Briefing', messages || [], req.user);
    const stamp = Date.now();
    // SmartBrowz renders it properly. If it is unreachable the export still succeeds as
    // HTML rather than failing -- a briefing an officer cannot open is worse than one in
    // the wrong format.
    const pdf = await smartbrowz.convertToPdf(req, html);
    if (pdf) {
      return {
        format: 'pdf',
        filename: `KADI_briefing_${stamp}.pdf`,
        contentType: 'application/pdf',
        base64: pdf.toString('base64'),
        bytes: pdf.length,
      };
    }
    return {
      format: 'html',
      filename: `KADI_briefing_${stamp}.html`,
      html,
      pdfUnavailable: smartbrowz.status().lastError,
    };
  }));

  // audit (role-gated) — the state tier plus SP, matching capabilities().canViewAudit.
  // This used to require ['ACP', 'Admin'] (DSP/SP/Admin), which meant an Analyst or DGP —
  // both told by the UI that they *can* view audit — got a silent 403 here and the page
  // just rendered "No audit entries yet", indistinguishable from a genuinely empty log.
  r.get('/audit', handle(async (req) => {
    rbac.requireRole(req.user, ['Analyst', 'DGP', 'Admin', 'SP']);
    const limit = Number(req.query.limit) || 100;
    const buffered = audit.list({ limit, action: req.query.action });
    // The buffer is this container's in-memory session only, so a fresh cold start —
    // routine on a low-traffic serverless function — reads back empty even though every
    // event was written through to the AuditLog table. Fall through to a live read there
    // whenever the buffer looks thin, so the log reflects real history, not just uptime.
    if (buffered.length >= limit) return { items: buffered, source: 'buffer' };
    const persisted = await audit.listPersisted(req, { limit, action: req.query.action });
    if (persisted) return { items: persisted, source: 'datastore' };
    return { items: buffered, source: 'buffer' };
  }));

  // Row counts read live from Data Store via ZCQL. Exists so the claim "40,836 FIRs are
  // in Data Store" can be verified by hitting a URL rather than taken on trust.
  r.get('/datastore/status', handle(async (req) => datastore.status(req)));
  r.get('/datastore/probe', handle(async (req) => datastore.probe(req)));
  // The FIR register read live from Data Store, not from the bundle. Kept separate from
  // /cases deliberately: ZCQL returns raw CaseMaster columns while /cases returns rows
  // enriched with district, health and link counts from the bundle. Swapping /cases over
  // needs that mapper, and the mapper cannot be tested until the function can present a
  // credential (see /datastore/probe). Until then this route proves the capability
  // without putting untested code on the path the UI depends on.
  r.get('/datastore/cases', handle(async (req) => {
    const live = await datastore.listCases(req, req.query, null);
    if (!live) {
      return {
        source: 'unavailable',
        reason: 'Data Store refused the read - the deployed function presents no credential. See /datastore/probe.',
        diag: datastore.diag(),
      };
    }
    return { source: 'datastore', ...live };
  }));

  // One call to see whether the Catalyst AI services are actually wired.
  // One-shot bootstrap for tables the app writes to but the pipeline does not create.
  // Idempotent, admin-only, and reports what it found rather than what it assumed.
  r.post('/admin/bootstrap', handle(async (req) => {
    rbac.requireRole(req.user, ['Admin']);
    // The table now exists (created from the console). Add the columns it needs.
    const tableId = String(req.query.tableId || '55468000000187002');
    const results = [];
    for (const col of datastore.AUDIT_COLUMNS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await datastore.addColumn(req, tableId, col);
      results.push({ column: col.column_name, ...r });
    }
    const audit_ = { tableId, columns: results,
      added: results.filter((r) => r.ok && !r.existed).length,
      alreadyThere: results.filter((r) => r.existed).length,
      failed: results.filter((r) => !r.ok).length };
    return {
      AuditLog: audit_,
      columns: datastore.AUDIT_COLUMNS.map((c) => `${c.column_name}:${c.data_type}`),
      note: audit_.failed === 0 ? 'Table ready.'
        : 'Schema changes are console-only: a deployed function\'s credential returns '
          + 'OAUTH_SCOPE_MISMATCH for DDL, though row writes and ZCQL reads work over the '
          + 'same path. Add the columns above under Data Store > AuditLog > New Column. '
          + 'Write-through is already live and starts persisting immediately after.',
    };
  }));

  // Refresh DistrictInsight from the current read-model. Non-destructive: it UPDATEs the
  // 31 existing rows rather than truncating, so a partial failure leaves the table coherent
  // rather than empty.
  //
  // This table matters more than its size suggests -- it backs the showcase ZCQL that answers
  // "the why behind the where" directly from the database. It had drifted after the corpus
  // was regenerated and was reporting Kodagu at 335 cases and rank 30, against the current
  // 332 and rank 31.
  r.post('/admin/sync-districts', handle(async (req) => {
    rbac.requireRole(req.user, ['Admin']);
    const socio = q.socio();
    const results = { updated: 0, failed: 0, errors: [] };
    for (const d of (socio.districts || [])) {
      const sql = `UPDATE DistrictInsight SET TotalCases=${Number(d.total)}, `
        + `RatePer100k=${Number(d.ratePer100k)}, RankByCount=${Number(d.rankByCount)}, `
        + `RankByRate=${Number(d.rankByRate)}, RankShift=${Number(d.rankShift)}, `
        + `Population=${Number(d.population)}, LiteracyPct=${Number(d.literacyPct)}, `
        + `UrbanPct=${Number(d.urbanPct)}, PopDensity=${Number(d.popDensity)}, `
        + `Band='${String(d.band).replace(/'/g, "''")}' `
        + `WHERE DistrictID=${Number(d.districtId)}`;
      // eslint-disable-next-line no-await-in-loop
      const out = await datastore.query(req, sql);
      if (out === null) {
        results.failed += 1;
        if (results.errors.length < 3) results.errors.push({ district: d.districtName, err: datastore.diag().httpError });
      } else results.updated += 1;
    }
    return results;
  }));

  r.get('/audit/health', handle(async () => ({
    buffered: audit.list({ limit: 1 }).length ? 'yes' : 'empty',
    persistence: audit.persistence(),
    note: 'Rows are written through to the AuditLog Data Store table. The buffer answers reads.',
  })));

  r.get('/ai/quickml-test', handle(async (req) => quickml.selfTest(req)));

  r.get('/ai/status', handle(async () => ({
    quickml: quickml.status(),
    zia: zia.status(),
    smartbrowz: smartbrowz.status(),
    assistant: { grounded: true, fallback: 'deterministic intent engine over the case DB' },
  })));

  app.use('/', r);
  app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'not_found', message: `No route ${req.method} ${req.path}` } }));
  return app;
}

function renderBriefingHtml(title, messages, user) {
  const rows = messages.map((m) => `<div class="msg ${m.role}"><b>${m.role === 'user' ? 'Q' : 'KADI'}:</b> ${escapeHtml(m.content || '')}
    ${(m.citations || []).map((c) => `<span class="cite">${c.label}</span>`).join(' ')}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>body{font-family:Inter,Arial,sans-serif;color:#1C2A3A;margin:40px;}
  h1{color:#0B3D75}.msg{margin:10px 0;padding:10px;border-left:3px solid #1A6FC4;background:#F5F7FA}
  .cite{background:#EAF3FB;color:#1A6FC4;border-radius:999px;padding:1px 8px;font-size:12px;margin-left:6px}
  .foot{margin-top:30px;color:#5B6B7E;font-size:12px}</style></head>
  <body><h1>${escapeHtml(title)}</h1>
  <p>Generated by KADI · Karnataka State Police · ${new Date().toLocaleString()} · Role: ${user.role}</p>
  ${rows}
  <div class="foot">Insights use evidence &amp; behaviour only — never caste, religion or occupation. Demo dataset (synthetic).</div>
  </body></html>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = { buildApp };
