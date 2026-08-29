// pendencyrisk.js — serving the station pendency-trajectory model.
//
// THE ONLY MODEL HERE THAT SCORES A REGISTER RATHER THAN A PERSON.
//
// The question: will this station's stock of past-window cases be at least a fifth larger in three
// months? It exists because the Indian econometric literature keeps pointing at the same lever and it
// is not the one the Western predictive-policing literature points at. Hazra (2020), across 32 states
// and union territories, finds that of the available deterrence variables "charge-sheeting rate,
// conviction rate, pendency in police cases are important in explaining various categories of crime
// rates in India"; Dutta & Husain (2009) reach the same conclusion on earlier state panel data. The
// lever is DISPOSAL, not patrol saturation -- and a FIR register can speak to disposal.
//
//     model                                  AUC 0.870   AP 0.560
//     best rule (inflow / recent clearance)  AUC 0.701   AP 0.274
//     margin                                      +0.169      +0.286
//
// That is the widest margin any model in this project has earned, and unlike the station-surge
// candidate it survives having every absolute volume stripped out: scale-free it scores 0.860, where
// station-surge collapsed from 0.738 to 0.583 and was rejected. What carries it are ratios -- the
// stale share of the register, the pile's own recent growth, the heinous share, the clearance rate.
//
// WHY THE FEATURES ARE PRECOMPUTED RATHER THAN DERIVED HERE. Scoring needs four months of backlog,
// inflow and clearance per station, and clearance needs a charge-sheet date that the read model does
// not carry. Rebuilding that per request would mean re-deriving a monthly panel over 60,000 cases for
// a twelve-row panel. The pipeline already builds it, so the pipeline writes the row and this file
// reads it -- and both come out of one helper in pendency_set.py, so training and serving cannot drift.
//
// WHAT THIS MUST NOT BECOME. It scores registers. A station whose backlog is forecast to grow is a
// place to send help, not a person to suspect and not a unit to punish -- and because the strongest
// feature is the stale share of the register, an officer who could improve the number by declining to
// register cases would be improving it in the worst possible way. That is a supervision instrument
// with a supervision failure mode, and it belongs in front of an SP who knows the difference.
const https = require('https');

const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '55468000000013048';
const ENDPOINT = process.env.QUICKML_PENDENCY_ENDPOINT
  || `https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}/endpoints/predict`;
const KEY_CONFIG = process.env.QUICKML_PENDENCY_KEY_CONFIG || 'quickml.pendencyEndpointKey';
const TIMEOUT_MS = Number(process.env.QUICKML_PENDENCY_TIMEOUT_MS || 6000);
const MAX_SCORED = Number(process.env.QUICKML_PENDENCY_MAX || 24);
const CONCURRENCY = 6;

// Measured on the file the pipeline writes, under the protocol in pendency_set.py's docstring.
// configured() compares these rather than reading a flag, so a revised measurement unplugs the model
// by itself.
const MEASURED = {
  auc: 0.870, rule: 0.701, ap: 0.560, apRule: 0.274,
  ruleName: 'load (inflow over recent clearance)',
  scaleFreeAuc: 0.860, testPositives: 386,
};
const HORIZON_MONTHS = 3;
const GROWTH_THRESHOLD = 1.20;

// The contract with appsail/pipeline/pendency_set.py FEATURES. Order and spelling both matter: the
// endpoint validates against the columns it was trained from.
const FEATURES = [
  'backlog', 'open_cases', 'inflow', 'cleared', 'backlog_heinous',
  'backlog_lag1', 'backlog_lag2', 'backlog_lag3',
  'cleared_lag1', 'cleared_lag2', 'cleared_lag3',
  'inflow_lag1', 'inflow_lag2', 'inflow_lag3',
  'backlog_mean3', 'cleared_mean3', 'inflow_mean3',
  'growth_3mo', 'growth_1mo', 'clearance_rate', 'clearance_rate_3mo',
  'load', 'stale_share', 'heinous_share', 'month_of_year',
];

let lastError = null;
let lastServed = 'rule';
let cachedKey;

/**
 * The stations in this reader's scope, with the row the model scores.
 *
 * Ordered by the rule the model was measured against -- load, meaning arrivals against recent
 * clearance -- so that when the endpoint is unreachable the fallback ordering is a known quantity
 * rather than an arbitrary one.
 */
function candidates(db, user, { limit = 24 } = {}) {
  const rows = (db.pendencyCurrent || []).slice();
  if (!rows.length) return { items: [], total: 0, month: null };

  // Scope. A station officer sees their own register; a district officer their stations; the state
  // sees all of them. Same rule as every other surface, applied here rather than left to the caller.
  const tier = (user && user.roleMeta && user.roleMeta.tier) || 'state';
  const stations = new Map();
  for (const s of (db.stations || [])) stations.set(String(s.unitId), s);
  const did = (tier === 'station' ? null : (user && user.districtId)) || null;
  const uid = tier === 'station' ? String(user.unitId) : (user && user.drillUnitId) || null;

  let scoped = rows.filter((r) => {
    const st = stations.get(String(r.unit_id));
    if (uid) return String(r.unit_id) === String(uid);
    if (tier !== 'state' || (user && user.drilledFromState)) {
      return st && String(st.districtId) === String(did);
    }
    return true;
  });

  scoped = scoped.map((r) => {
    const st = stations.get(String(r.unit_id));
    return {
      ...r,
      unitName: (st && st.unitName) || `Station ${r.unit_id}`,
      districtName: (st && st.districtName) || '',
    };
  });
  scoped.sort((a, b) => (b.load || 0) - (a.load || 0));
  return { items: scoped.slice(0, limit), total: scoped.length, month: rows[0].as_of };
}

async function endpointKey(req) {
  if (cachedKey !== undefined) return cachedKey;
  // eslint-disable-next-line global-require
  const datastore = require('./datastore');
  const r = await datastore.query(req,
    `SELECT configValue FROM AppConfig WHERE configKey = '${KEY_CONFIG}'`, 'AppConfig');
  cachedKey = (r && r[0] && r[0].configValue) || '';
  return cachedKey;
}

function configured() {
  return Boolean(ENDPOINT) && MEASURED.auc > MEASURED.rule && MEASURED.ap > MEASURED.apRule;
}

function status() {
  return {
    task: 'station pendency trajectory — will this register\'s stock of past-window cases be at least '
      + `${Math.round((GROWTH_THRESHOLD - 1) * 100)}% larger in ${HORIZON_MONTHS} months?`,
    grain: 'police station × month',
    modelAuc: MEASURED.auc,
    ruleAuc: MEASURED.rule,
    margin: Math.round((MEASURED.auc - MEASURED.rule) * 1000) / 1000,
    modelAp: MEASURED.ap,
    ruleAp: MEASURED.apRule,
    apMargin: Math.round((MEASURED.ap - MEASURED.apRule) * 1000) / 1000,
    ruleName: MEASURED.ruleName,
    scaleFreeAuc: MEASURED.scaleFreeAuc,
    testPositives: MEASURED.testPositives,
    horizonMonths: HORIZON_MONTHS,
    configured: configured(),
    configKey: KEY_CONFIG,
    endpoint: ENDPOINT,
    keyLoaded: cachedKey === undefined ? 'not-attempted' : Boolean(cachedKey),
    lastServed,
    lastError,
    outputKind: 'regressor on a 0/1 target — a float that ranks, for the same reason the offender '
      + 'models are: this platform\'s classification endpoints return a hard label, and a label '
      + 'cannot rank',
    fairness: 'This model scores registers, not people. No person is a feature or a unit of analysis.',
    caveat: 'A case leaves this backlog only when a charge-sheet is recorded, because that is the only '
      + 'dated disposal event in the schema. Cases closed or filed undetected by another route keep '
      + 'counting, so the level is not a pendency statistic — the trajectory is what is modelled.',
  };
}

function postOne(record, token, key) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(ENDPOINT); } catch { lastError = 'bad endpoint url'; return resolve(null); }
    const payload = JSON.stringify({ data: record });
    const rq = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-QUICKML-ENDPOINT-KEY': key,
        Authorization: `Zoho-oauthtoken ${token}`,
        'CATALYST-ORG': process.env.CATALYST_ORG_ID || '60078029367',
        Environment: process.env.CATALYST_ENVIRONMENT || 'Development',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastError = `http ${res.statusCode}: ${out.slice(0, 160)}`;
          return resolve(null);
        }
        try {
          const j = JSON.parse(out);
          const r = Array.isArray(j.result) ? j.result[0] : j.result;
          const n = Number(r);
          resolve(Number.isFinite(n) ? n : null);
        } catch (e) { lastError = `parse: ${e.message}`; resolve(null); }
      });
    });
    rq.on('timeout', () => { lastError = 'timeout'; rq.destroy(); resolve(null); });
    rq.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    rq.write(payload);
    rq.end();
  });
}

/** Score a shortlist. Returns null on ANY failure; every caller keeps the rule's ordering. */
async function score(req, rows) {
  if (!configured() || !rows || !rows.length) return null;
  const key = await endpointKey(req).catch(() => '');
  if (!key) { lastError = `no endpoint key in AppConfig under ${KEY_CONFIG}`; return null; }
  // eslint-disable-next-line global-require
  const token = await require('./quickml').accessToken(req).catch(() => null);
  if (!token) { lastError = 'no oauth token'; return null; }

  const shortlist = rows.slice(0, MAX_SCORED);
  const out = new Array(shortlist.length).fill(null);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= shortlist.length) return;
      const rec = {};
      for (const f of FEATURES) rec[f] = Number(shortlist[i][f]) || 0;
      out[i] = await postOne(rec, token, key);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, shortlist.length) }, worker));
  if (out.every((v) => v === null)) return null;

  // The same degeneracy guard the other endpoints carry: one identical value for every station is
  // not a ranking, and saying "rankedBy: model" over it would be a lie the reader cannot check.
  const seen = out.filter((v) => v !== null);
  if (new Set(seen).size < 2) {
    lastError = `endpoint returned one value (${seen[0]}) for all ${seen.length} stations — cannot rank`;
    return null;
  }
  lastServed = 'model';
  return out;
}

module.exports = {
  FEATURES, candidates, score, configured, status, MEASURED, HORIZON_MONTHS, GROWTH_THRESHOLD,
};
