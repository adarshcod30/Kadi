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
  // Dashboard KPIs are identical for every user in a role and only change when the
  // pipeline reruns, so they are served through Catalyst Cache. A cache miss (or no
  // Catalyst context at all, e.g. local dev) just computes as before.
  r.get('/stats', handle(async (req) => {
    // Served through the Catalyst Cache adapter. NOTE: writes currently return 401
    // PERMISSION_NEEDED because the deployed function runs without a credential that
    // has Cache scope, so every call is a miss and falls through to compute. The
    // adapter is a no-op until that permission is granted - see docs/08.
    const { data } = await cache.through(
      req, `stats:${req.user.role}`, async () => q.stats(req.user),
    );
    return data;
  }));
  r.get('/alerts', handle(async (req) => q.alerts(req.user)));

  // Zone board -- the brief's "emerging trend alerts / red-zone pulsing", computed against
  // each area's own baseline rather than by volume. ?explain=true adds an AI reading of it.
  r.get('/zones', handle(async (req) => {
    const z = q.zones(req.user);
    if (String(req.query.explain) !== 'true') return z;
    const s = z.summary || {};
    const top = (z.districts || []).slice(0, 3).map((d) => ({
      district: d.districtName, change: `${d.changePct}%`, driver: d.driverHead,
      current: d.current, baseline: d.baseline,
    }));
    const hot = (z.stations || []).filter((x) => x.zone === 'red_pulsing').slice(0, 3);
    const { text, source } = await insight.generate(req, 'district and station zone status', {
      month: s.month, baselineMonths: s.baselineMonths,
      districtsRed: s.red, districtsPulsing: s.red_pulsing, districtsYellow: s.yellow,
      districtsNormal: s.normal,
      biggestMovers: top,
      stationsPulsing: hot.map((x) => ({ unitId: x.unitId, current: x.current,
        baseline: x.baseline, change: `${x.changePct}%` })),
    });
    return { ...z, insight: text, insightSource: source };
  }));
  r.get('/eval', handle(async () => q.evalReport()));
  r.get('/clusters', handle(async () => q.clusters().slice(0, 100)));

  // cases
  r.get('/cases', handle(async (req) => q.listCases(req.user, req.query)));
  r.get('/cases/:id', handle(async (req) => {
    audit.record({ user: req.user, action: 'view_case', targetType: 'case', targetId: req.params.id, ip: req.clientIp });
    return q.getCase(req.user, req.params.id);
  }));

  // graph (the hero)
  r.get('/graph/case/:id', handle(async (req) => {
    audit.record({ user: req.user, action: 'view_graph', targetType: 'case', targetId: req.params.id, ip: req.clientIp });
    return q.graphForCase(req.user, req.params.id, { maxNeighbors: Number(req.query.maxNeighbors) || 60 });
  }));
  r.get('/graph/featured', handle(async () => q.featuredNetworks(6)));
  r.get('/graph/cluster/:id', handle(async (req) => q.getCluster(req.user, req.params.id)));
  r.get('/graph/search', handle(async (req) => ({ clusters: q.clusters().filter((c) => {
    if (req.query.crossDistrict === 'true' && !c.crossDistrict) return false;
    if (req.query.minSize && c.size < Number(req.query.minSize)) return false;
    return true;
  }).slice(0, 60) })));

  // offenders
  r.get('/offenders', handle(async (req) => q.listOffenders(req.user, req.query)));
  r.get('/offenders/:id', handle(async (req) => {
    audit.record({ user: req.user, action: 'view_offender', targetType: 'offender', targetId: req.params.id, ip: req.clientIp });
    return q.getOffender(req.user, req.params.id);
  }));

  // investigation health
  r.get('/health/cases', handle(async (req) => q.listHealth(req.user, req.query)));
  r.get('/health/summary', handle(async (req) => q.healthSummary(req.user)));

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
  r.get('/analytics/socio', handle(async () => q.socio()));

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
  r.get('/analytics/forecast', handle(async () => q.forecast()));

  // assistant
  r.post('/assistant/query', handle(async (req) => {
    const text = (req.body && req.body.text) || '';
    const lang = (req.body && req.body.lang) || 'en';
    audit.record({ user: req.user, action: 'assistant_query', targetType: 'nl', queryText: text, ip: req.clientIp });
    return assistant.queryEnhanced(req.user, text, lang, req);
  }));
  r.post('/assistant/voice', handle(async (req) => {
    // Local fallback: client does Web Speech STT/TTS; here we answer the transcribed text.
    const text = (req.body && req.body.text) || '';
    const lang = (req.body && req.body.lang) || 'en';
    audit.record({ user: req.user, action: 'assistant_voice', targetType: 'nl', queryText: text, ip: req.clientIp });
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
