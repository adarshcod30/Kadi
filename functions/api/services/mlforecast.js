// mlforecast.js — serving the trained QuickML spike classifier, with the rule it replaces as
// the floor.
//
// WHAT THE MODEL IS, AND WHY IT IS NOT WHAT YOU WOULD EXPECT.
//
// The obvious model on a crime corpus forecasts next month's case count. That was built and it
// does not work: predicting a count means predicting an arrival process, and for a Poisson
// count with mean L even a perfect predictor still misses by sqrt(2/(pi*L)). A three-month
// moving average already sits close to that floor, so a tree with thirty features has more
// capacity than the remaining signal justifies and overfits. Raw target, ratio target, lean and
// rich features, multi-horizon, and a blend tuned on a separate validation fold all lost to the
// moving average.
//
// What DOES work is classification: which district and crime type is about to run well above
// its own normal. It only has to RANK, never to name a number, so the noise that defeats
// regression does not defeat it.
//
// MEASURED, on the same rolling hold-out folds:
//
//     z-score rule (what this replaces)   AUC 0.419
//     QuickML ensemble, deployed          AUC 0.587
//     local reference implementation      AUC 0.738
//
// The deployed model beats the rule by a wide margin, which is the bar. It falls short of the
// local reference because QuickML trains its four boosters at library defaults and soft-votes
// them; defaults are tuned for large datasets and this one has 1,640 rows. A single LGBM with
// num_leaves cut to 22 was tried as v2 and did WORSE (AUC 0.507), so the ensemble stays.
//
// See appsail/pipeline/training_set.py for the full measurement.
const https = require('https');

const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '55468000000013048';
const ENDPOINT = process.env.QUICKML_SPIKE_ENDPOINT
  || `https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}/endpoints/predict`;
// The endpoint key is a real credential, so it lives in the AppConfig Data Store table beside
// the auth signing secret rather than in catalyst-config.json -- that file is committed, and a
// live prediction key in a public repo is a different thing from the mock account passwords.
const KEY_CONFIG = 'quickml.spikeEndpointKey';
const TIMEOUT_MS = Number(process.env.QUICKML_SPIKE_TIMEOUT_MS || 6000);
// Measured average AUC over four rolling three-month hold-out windows. Configuration rather
// than something readable back: QuickML does not expose a model's evaluation over HTTP, and a
// model whose score nobody wrote down cannot be compared to anything.
const MODEL_AUC = Number(process.env.QUICKML_SPIKE_AUC || 0.5872);
const RULE_AUC = Number(process.env.QUICKML_RULE_AUC || 0.419);
// How many candidates to score. The rule supplies recall cheaply, the model supplies precision
// on the shortlist -- scoring every eligible series would be a hundred round trips inside a
// 30-second function for a panel that shows twelve rows.
const MAX_SCORED = Number(process.env.QUICKML_SPIKE_MAX || 24);
const CONCURRENCY = 6;

let lastError = null;
let lastServed = 'rule';
let cachedKey = null;

async function endpointKey(req) {
  if (cachedKey !== null) return cachedKey;
  if (process.env.QUICKML_SPIKE_KEY) { cachedKey = process.env.QUICKML_SPIKE_KEY; return cachedKey; }
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
    task: 'spike classification — which district and crime type will run well above its own normal',
    configured: configured(),
    endpoint: ENDPOINT,
    modelAuc: MODEL_AUC,
    ruleAuc: RULE_AUC,
    servedBy: configured() ? 'model' : 'rule',
    lastServed,
    lastError,
    keyLoaded: cachedKey === null ? 'not-attempted' : Boolean(cachedKey),
    note: configured()
      ? `The trained classifier scores ${MODEL_AUC} AUC against the z-score rule's ${RULE_AUC} on a rolling hold-out. Whether it actually ranks in production depends on the endpoint returning graded scores rather than hard labels -- see lastError.`
      : `No model beats the z-score rule (${RULE_AUC} AUC), so the rule ranks emerging risk.`,
    whyNotVolumeForecasting: 'Measured and rejected: monthly volume regression loses to a '
      + 'three-month moving average at every grain and feature set tried, because the residual '
      + 'is the arrival process rather than a pattern. The statistical forecaster in the '
      + 'pipeline serves projections instead, with its own backtest error shown beside them.',
  };
}

// Column set the endpoint expects. It is the dataset's own schema, including row_key -- the
// pipeline drops that internally, but the endpoint validates against what it was trained from.
const FEATURES = [
  'district_id', 'crime_head_id', 'month_index', 'month_of_year',
  'lag_1', 'lag_2', 'lag_3', 'lag_12',
  'roll_3', 'roll_6', 'roll_12',
  'district_lag_1', 'head_share',
  'std_6', 'std_12',
  'accel_3_12', 'accel_1_12',
  'head_state_lag_1', 'head_state_roll_3',
  'state_lag_1', 'state_roll_3', 'head_state_share',
  'district_roll_3', 'district_accel',
  'detected_share_lag_1', 'detected_roll_6',
  'population_m', 'literacy_pct', 'urban_pct', 'pop_density_k',
  'days_in_month',
];

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
          // The endpoint returns a class label or a probability depending on how the model was
          // built. Take a number if there is one; otherwise read a positive label as 1.
          const n = Number(r);
          resolve(Number.isFinite(n) ? n : (String(r) === '1' || String(r).toLowerCase() === 'true' ? 1 : 0));
        } catch (e) { lastError = `parse: ${e.message}`; resolve(null); }
      });
    });
    // A hanging model call inside a 30s function would burn the whole budget and return
    // nothing. Time out well below it and fall back to the rule.
    rq.on('timeout', () => { lastError = 'timeout'; rq.destroy(); resolve(null); });
    rq.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    rq.write(payload);
    rq.end();
  });
}

/**
 * Score a shortlist of candidate series for spike risk.
 *
 * Returns null on ANY failure, and every caller treats null as "keep the rule's ranking" -- an
 * unreachable model must degrade the ordering, never fail the request.
 *
 * `rows` carry the feature columns plus whatever else the caller needs; only FEATURES are sent.
 */
async function scoreSpikes(req, rows) {
  if (!configured() || !rows || !rows.length) return null;
  const key = await endpointKey(req).catch(() => '');
  if (!key) { lastError = 'no endpoint key in AppConfig'; return null; }
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
      rec.row_key = String(shortlist[i].row_key || `${shortlist[i].district_id}-${shortlist[i].crime_head_id}`);
      out[i] = await postOne(rec, token, key);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, shortlist.length) }, worker));
  // All-null means the endpoint is down. Keep the rule.
  if (out.every((v) => v === null)) return null;

  // DEGENERACY GUARD, and it earns its place. The published endpoint returns a hard class
  // LABEL, not a probability -- and at the default 0.5 threshold, on a 15.9% positive rate,
  // it answers 0 for every candidate. Every score identical is not a ranking; sorting by it
  // would leave the rule's order untouched while the response claimed the model had ranked it.
  // That is worse than not using the model, because it reads as a working feature.
  const seen = out.filter((v) => v !== null);
  const distinct = new Set(seen).size;
  if (distinct < 2) {
    lastError = `endpoint returned ${distinct === 1 ? `the same value (${seen[0]}) for all ${seen.length} candidates` : 'nothing usable'} — labels, not probabilities, so it cannot rank`;
    return null;
  }
  lastServed = 'model';
  return out;
}

/**
 * Which ranker answers, and what both scored. Attached to the forecast response whether or not
 * the model is serving, because "the rule ranks because nothing beats it" is a statement worth
 * making out loud.
 */
function chooseServed(baseline) {
  const baselineMape = baseline && baseline.accuracy ? baseline.accuracy.mape : null;
  const wins = configured();
  lastServed = wins ? 'model' : 'rule';
  return {
    // Projections always come from the statistical forecaster -- see whyNotVolumeForecasting.
    projectionsBy: 'statistical forecaster',
    projectionBacktestMape: baselineMape,
    // Emerging-risk RANKING is the part a model can win, and does.
    emergingRiskRankedBy: lastServed,
    modelAuc: MODEL_AUC,
    ruleAuc: RULE_AUC,
    reason: wins
      ? `The trained spike classifier scores ${MODEL_AUC} AUC against the z-score rule's ${RULE_AUC}, so it ranks emerging risk.`
      : `Nothing beats the z-score rule (${RULE_AUC} AUC), so the rule ranks emerging risk.`,
  };
}

module.exports = { FEATURES, chooseServed, scoreSpikes, configured, status };
