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
      `stats:${req.user.role}:${req.user.districtId || 'state'}:${req.user.drillUnitId || 'all'}`,
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
    const stateView = req.user.roleMeta.tier === 'state' && !req.user.drilledFromState;
    const body = stateView ? q.stateCommand(req.user) : q.districtCommand(req.user);
    const out = { view: stateView ? 'state' : 'district', ...body };
    if (String(req.query.explain) !== 'true') return out;
    const zoneLabel = (z) => ZONE_LABEL_TEXT[z] || z || 'at baseline';
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
    return q.graphForCase(req.user, req.params.id, { maxNeighbors: Number(req.query.maxNeighbors) || 60 });
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
    // Catalyst path: SmartBrowz -> PDF -> Stratus signed URL. Local: return HTML.
    return { format: 'html', filename: `KADI_briefing_${Date.now()}.html`, html };
  }));

  // audit (role-gated)
  r.get('/audit', handle(async (req) => {
    rbac.requireRole(req.user, ['ACP', 'Admin']);
    return { items: audit.list({ limit: Number(req.query.limit) || 100, action: req.query.action }) };
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
