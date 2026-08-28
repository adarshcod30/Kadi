// offenderrisk.js — serving the repeat-offending model, with recency as the floor.
//
// THE ONE MODEL THAT EARNED ITS PLACE.
//
// Six candidate forecasting tasks were built and scored against the BEST simple rule available
// on the same information, on time-ordered hold-outs. Five lost (see research/README.md and
// appsail/pipeline/offender_set.py). This is the survivor:
//
//     recency rule (what this replaces)   AUC 0.565   AP 0.401
//     model, on the shipped training file AUC 0.769   AP 0.589
//
// A margin of +0.204 AUC over the honest baseline, where the existing spike classifier manages
// +0.058 over its own. Recency is a strong baseline here -- "who was active lately" explains
// most of who is active next -- and beating it by that much is the whole justification.
//
// WHY THIS IS A REGRESSOR ON A 0/1 TARGET, WHICH LOOKS ODD AND IS DELIBERATE.
//
// QuickML's classification nodes emit a hard class LABEL. There is no predict_proba option
// anywhere in the palette -- searching the operation list for "prob" returns nothing -- and a
// label cannot rank: at the default threshold on a 36% positive rate the endpoint answers the
// same value for most candidates, and sorting by it is sorting by nothing. That is exactly the
// failure the spike endpoint has been silently hitting.
//
// A regressor trained on the same 0/1 column returns a float, and measured on both datasets it
// ranks as well as the classifier's own probabilities or better:
//
//                        offender      spike
//     classifier LABEL     0.602        0.565     <- what a classification endpoint returns
//     classifier proba     0.758        0.639     <- unavailable through this platform
//     REGRESSOR on 0/1     0.760        0.677     <- what ships
//
// So the constraint turned out not to cost anything. It is still a constraint worth recording,
// because the obvious reading of "regression on a binary target" is that someone made a mistake.
const https = require('https');

const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '55468000000013048';
const ENDPOINT = process.env.QUICKML_OFFENDER_ENDPOINT
  || `https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}/endpoints/predict`;
// Same storage as the spike key: a live prediction credential does not belong in a committed
// config file, so it lives in the AppConfig Data Store table beside the auth signing secret.
const KEY_CONFIG = 'quickml.offenderEndpointKey';
const TIMEOUT_MS = Number(process.env.QUICKML_OFFENDER_TIMEOUT_MS || 6000);
const MODEL_AUC = Number(process.env.QUICKML_OFFENDER_AUC || 0.769);
const RULE_AUC = Number(process.env.QUICKML_OFFENDER_RULE_AUC || 0.565);
const MAX_SCORED = Number(process.env.QUICKML_OFFENDER_MAX || 24);
const CONCURRENCY = 6;
const HORIZON_DAYS = 180;

let lastError = null;
let lastServed = 'rule';
let cachedKey = null;

// The contract with appsail/pipeline/offender_set.py. Order and spelling both matter: the
// endpoint validates against the columns it was trained from.
const FEATURES = [
  'prior_cases', 'days_since_last', 'span_days', 'rate_per_yr',
  'n_districts', 'n_heads', 'heinous',
];

const dayDiff = (fromIso, toIso) => {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};

/**
 * Build one scoring row per offender, as at `asOf`.
 *
 * Every feature is computed from cases registered ON OR BEFORE asOf. That is not a formality:
 * the first version of this measurement scored 0.851 because it used the offender record's
 * lifetime coOffenders and arrestCount, which are computed over the whole file including cases
 * registered later. Those two fields are absent here for that reason, and adding them back
 * would quietly restore the leak.
 */
function candidates(offenders, casesById, asOf, { limit = 40 } = {}) {
  const rows = [];
  for (const o of offenders || []) {
    const dates = [];
    for (const cid of (o.caseIds || [])) {
      const c = casesById.get(String(cid));
      if (c && c.crimeRegisteredDate && c.crimeRegisteredDate <= asOf) dates.push(c);
    }
    if (dates.length < 2) continue;                   // the watchlist population, as trained
    dates.sort((a, b) => (a.crimeRegisteredDate < b.crimeRegisteredDate ? -1 : 1));
    const first = dates[0].crimeRegisteredDate;
    const last = dates[dates.length - 1].crimeRegisteredDate;
    const span = dayDiff(first, asOf);
    if (span === null) continue;
    const districts = new Set(dates.map((c) => String(c.districtId)).filter(Boolean));
    const heads = new Set(dates.map((c) => String(c.crimeHeadId)).filter(Boolean));
    rows.push({
      offenderIdentityId: o.offenderIdentityId,
      canonicalName: o.canonicalName,
      riskScore: o.riskScore,
      lastSeen: last,
      districtNames: [...new Set(dates.map((c) => c.districtName).filter(Boolean))],
      prior_cases: dates.length,
      days_since_last: dayDiff(last, asOf),
      span_days: span,
      rate_per_yr: Math.round((dates.length / Math.max(1, span / 365.25)) * 10000) / 10000,
      n_districts: districts.size,
      n_heads: heads.size,
      heinous: dates.filter((c) => c.gravity === 'Heinous').length,
    });
  }
  // The rule's own ordering, which stands whenever the model cannot be reached. Recency is the
  // baseline the model was measured against, so falling back to it is falling back to a known
  // quantity rather than to an arbitrary sort.
  rows.sort((a, b) => a.days_since_last - b.days_since_last);
  return { items: rows.slice(0, limit), total: rows.length, asOf };
}

async function endpointKey(req) {
  if (cachedKey !== null) return cachedKey;
  if (process.env.QUICKML_OFFENDER_KEY) { cachedKey = process.env.QUICKML_OFFENDER_KEY; return cachedKey; }
  // eslint-disable-next-line global-require
  const datastore = require('./datastore');
  const rows = await datastore.query(req,
    `SELECT configValue FROM AppConfig WHERE configKey = '${KEY_CONFIG}'`, 'AppConfig');
  cachedKey = (rows && rows[0] && rows[0].configValue) || '';
  return cachedKey;
}

function configured() {
  return Boolean(ENDPOINT) && Number.isFinite(MODEL_AUC) && MODEL_AUC > RULE_AUC;
}

function status() {
  return {
    task: `repeat offending — will this resolved offender appear on a new FIR within ${HORIZON_DAYS} days?`,
    configured: configured(),
    endpoint: ENDPOINT,
    modelAuc: MODEL_AUC,
    ruleAuc: RULE_AUC,
    ruleName: 'recency (days since last case)',
    lastServed,
    lastError,
    keyLoaded: cachedKey === null ? 'not-attempted' : Boolean(cachedKey),
    outputKind: 'regressor on a 0/1 target — a float that ranks, because this platform\'s '
      + 'classification endpoints return a hard label and a label cannot rank',
    fairness: 'Behaviour and evidence only. No age, no gender, and no caste, religion or '
      + 'occupation — the feature list is asserted against the protected set before the '
      + 'training file is written.',
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

/**
 * Score a shortlist. Returns null on ANY failure, and every caller treats null as "keep the
 * rule's ordering" — an unreachable model must degrade the ranking, never fail the request.
 */
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
      // Seven numbers, nothing else. The training file carries no key column -- QuickML's
      // model stages reject a non-numeric column outright -- so the endpoint's schema is
      // exactly FEATURES, and sending anything more would fail validation.
      const rec = {};
      for (const f of FEATURES) rec[f] = Number(shortlist[i][f]) || 0;
      out[i] = await postOne(rec, token, key);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, shortlist.length) }, worker));
  if (out.every((v) => v === null)) return null;

  // The same degeneracy guard the spike server carries, and for the same reason: an endpoint
  // that answers one identical value for every candidate has not ranked anything, and sorting
  // by it would leave the rule's order untouched while the response claimed a model produced
  // it. A regressor should never trip this — if it does, something is wrong with the model
  // rather than with the request, and the honest move is to say so and fall back.
  const seen = out.filter((v) => v !== null);
  if (new Set(seen).size < 2) {
    lastError = `endpoint returned one value (${seen[0]}) for all ${seen.length} candidates — cannot rank`;
    return null;
  }
  lastServed = 'model';
  return out;
}

module.exports = { FEATURES, candidates, score, configured, status, HORIZON_DAYS };
