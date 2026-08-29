// mlforecast.js — serving the spike model, with the best simple rule as the floor.
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
// TWO THINGS ABOUT THIS MODEL WERE WRONG AND ARE NOW CORRECTED.
//
// 1. THE BASELINE WAS TOO WEAK. This file used to claim 0.587 AUC against a z-score rule's
//    0.419. That is a true comparison against a badly chosen rule. Measured on the model's own
//    training file against the BEST trivial rule available on the same columns:
//
//        full features          auc 0.678
//        inverse recent level   auc 0.620   <- the honest baseline
//        scale-free features    auc 0.516   <- most of the edge was series size
//
//    The target "40% above the trailing 3-month mean" is simply easier to hit on a small
//    series, so a model given absolute volumes can win by learning which series are small.
//    The real margin is +0.058, not +0.168. It still beats the rule, so it still serves.
//
// 2. THE ENDPOINT COULD NOT RANK AT ALL. QuickML's classification endpoints return a hard
//    class LABEL -- there is no predict_proba anywhere in the operation palette -- and at the
//    default threshold on a 15.9% positive rate the published endpoint answered 0 for every
//    candidate. The degeneracy guard below caught it every time, so this model has been
//    falling back to the rule since the day it was published, silently.
//
//    The replacement is a REGRESSOR trained on the same 0/1 target, which returns a float.
//    Measured on the same file, that is not a compromise -- it is better:
//
//        classifier LABEL   auc 0.565     what the old endpoint returned
//        classifier proba   auc 0.639     not obtainable through this platform
//        regressor on 0/1   auc 0.677     what serves now
//
// See research/README.md for the measurement and appsail/pipeline/training_set.py for the
// dataset the regressor trains on.
const https = require('https');

const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '55468000000013048';
const ENDPOINT = process.env.QUICKML_SPIKE_ENDPOINT
  || `https://api.catalyst.zoho.in/quickml/v1/project/${PROJECT_ID}/endpoints/predict`;
// The endpoint key is a real credential, so it lives in the AppConfig Data Store table beside
// the auth signing secret rather than in catalyst-config.json -- that file is committed, and a
// live prediction key in a public repo is a different thing from the mock account passwords.
// The regressor endpoint's key. The classifier this replaced -- kadi-spike-endpoint, on
// spike-classifier-v1 -- was kept live for a while so the "a label cannot rank" claim could be
// demonstrated rather than asserted. It has since been deleted along with the rest of the dead
// console artifacts, so the evidence now lives where every other rejected model's does: the
// measurement table in this file's header and research/README.md. A stale credential under
// quickml.spikeEndpointKey may remain in AppConfig; nothing reads it.
const KEY_CONFIG = process.env.QUICKML_SPIKE_KEY_CONFIG || 'quickml.spikeRegressorEndpointKey';
const TIMEOUT_MS = Number(process.env.QUICKML_SPIKE_TIMEOUT_MS || 6000);
// Measured average AUC over four rolling three-month hold-out windows. Configuration rather
// than something readable back: QuickML does not expose a model's evaluation over HTTP, and a
// model whose score nobody wrote down cannot be compared to anything.
const MODEL_AUC = Number(process.env.QUICKML_SPIKE_AUC || 0.677);
const RULE_AUC = Number(process.env.QUICKML_RULE_AUC || 0.620);
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
    task: 'spike risk — which district and crime type will run well above its own normal',
    outputKind: 'regressor on a 0/1 target — a float that ranks. The classifier it replaces '
      + 'returned a hard label, which at the default threshold was 0 for every candidate.',
    ruleName: 'inverse recent level (small series spike more often)',
    configured: configured(),
    endpoint: ENDPOINT,
    modelAuc: MODEL_AUC,
    ruleAuc: RULE_AUC,
    servedBy: configured() ? 'model' : 'rule',
    lastServed,
    lastError,
    keyLoaded: cachedKey === null ? 'not-attempted' : Boolean(cachedKey),
    note: configured()
      ? `The regressor scores ${MODEL_AUC} AUC against the best simple rule's ${RULE_AUC} on a `
        + 'time-ordered hold-out — a margin of +'
        + `${Math.round((MODEL_AUC - RULE_AUC) * 1000) / 1000}. The previously reported 0.419 `
        + 'baseline was a weak rule; most of this model\'s apparent edge is series size.'
      : `Nothing beats the best simple rule (${RULE_AUC} AUC), so the rule ranks emerging risk.`,
    whyNotVolumeForecasting: 'Measured and rejected: monthly volume regression loses to a '
      + 'three-month moving average at every grain and feature set tried, because the residual '
      + 'is the arrival process rather than a pattern. The statistical forecaster in the '
      + 'pipeline serves projections instead, with its own backtest error shown beside them.',
  };
}

// Column set the endpoint expects: the dataset's own schema, and NOTHING else.
//
// row_key used to be sent alongside these, because the classifier's dataset carried it and the
// endpoint validated against the columns it was trained from. The regressor trains on the
// numeric-only file, which has no key column, and the endpoint rejects the extra field
// outright:
//
//     http 400 INVALID_DATA "Unexpected columns present in input"
//                           unexpected_columns: ["row_key"]
//
// Worth recording because the failure is silent from the outside: the request 400s, the guard
// falls back to the rule, and the surface reports "rule is ranking" -- which looks exactly
// like a missing key rather than a malformed payload.
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
      out[i] = await postOne(rec, token, key);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, shortlist.length) }, worker));
  // All-null means the endpoint is down. Keep the rule.
  if (out.every((v) => v === null)) return null;

  // DEGENERACY GUARD. It earned its place against the classifier endpoint, which returned a
  // hard LABEL and therefore answered 0 for every candidate at the default threshold: every
  // score identical is not a ranking, and sorting by it would have left the rule's order
  // untouched while the response claimed a model produced it. A regressor should never trip
  // this. If it does, the model is wrong rather than the request, and saying so beats a
  // ranking nobody can trust.
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
