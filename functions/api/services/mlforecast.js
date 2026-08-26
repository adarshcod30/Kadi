// mlforecast.js — serving a trained QuickML model, with the rule it replaces as the floor.
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
// its own normal. It only has to rank, never to name a number, so the noise that defeats
// regression does not defeat it. Against the z-score rule the Forecast tab uses today it scores
// average precision 0.425 to 0.199, and it beat the rule on all four rolling hold-out windows.
//
// So this file serves a SPIKE CLASSIFIER and falls back to the z-score rule -- and it says
// which one answered. A model that does not beat the rule it replaces should not ship just
// because it is a model.
//
// See appsail/pipeline/training_set.py for the full measurement, including why pooling grains
// for more rows was tried and abandoned.
const https = require('https');

const ENDPOINT = process.env.QUICKML_SPIKE_ENDPOINT || process.env.QUICKML_FORECAST_ENDPOINT || '';
const DEPLOYMENT_ID = process.env.QUICKML_SPIKE_DEPLOYMENT_ID || '';
const TIMEOUT_MS = Number(process.env.QUICKML_FORECAST_TIMEOUT_MS || 8000);
// The model's measured average precision, recorded when it was built in the console. It is
// configuration rather than something readable back: QuickML does not expose a model's
// evaluation over HTTP, and a model whose score nobody wrote down cannot be compared to
// anything -- so an unset value means "do not serve it", not "assume it is good".
const MODEL_AP = process.env.QUICKML_SPIKE_AP ? Number(process.env.QUICKML_SPIKE_AP) : null;
// What the rule it would replace scores on the same folds. Measured, not assumed.
const RULE_AP = Number(process.env.QUICKML_RULE_AP || 0.199);

let lastError = null;
let lastServed = 'rule';

function configured() {
  return Boolean(ENDPOINT) && Number.isFinite(MODEL_AP);
}

function status() {
  const wins = configured() && MODEL_AP > RULE_AP;
  return {
    task: 'spike classification — which district and crime type will run well above its own normal',
    configured: configured(),
    endpointSet: Boolean(ENDPOINT),
    deploymentIdSet: Boolean(DEPLOYMENT_ID),
    modelAveragePrecision: MODEL_AP,
    ruleAveragePrecision: RULE_AP,
    servedBy: wins ? 'model' : 'rule',
    lastServed,
    lastError,
    note: configured()
      ? (wins
        ? `A trained model is deployed and beats the z-score rule (${MODEL_AP} against ${RULE_AP}), so it ranks emerging risk.`
        : `A trained model is deployed but does not beat the z-score rule (${MODEL_AP} against ${RULE_AP}), so the rule still ranks emerging risk.`)
      : 'No trained model is deployed. Emerging risk is ranked by z-score against each series\' own history, and that rule scores '
        + `${RULE_AP} average precision on a rolling hold-out.`,
    // Said out loud because "we did not ship a regression model" reads as an omission unless
    // the reason is given.
    whyNotVolumeForecasting: 'Measured and rejected: monthly volume regression loses to a '
      + 'three-month moving average at every grain and feature set tried, because the residual '
      + 'is the arrival process rather than a pattern. The statistical forecaster in the '
      + 'pipeline serves projections instead, with its own backtest error shown beside them.',
  };
}

// Column order is the contract with appsail/pipeline/training_set.py FEATURES. The two live in
// different runtimes so the list cannot be imported; it is asserted against the training-set
// metadata at call time instead, and a mismatch is reported rather than silently scored.
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

function postJson(body, token) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(ENDPOINT); } catch { lastError = 'bad endpoint url'; return resolve(null); }
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Zoho-oauthtoken ${token}`,
        'CATALYST-ORG': process.env.CATALYST_ORG_ID || '60078029367',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastError = `http ${res.statusCode}: ${out.slice(0, 180)}`;
          return resolve(null);
        }
        try { resolve(JSON.parse(out)); } catch (e) { lastError = `parse: ${e.message}`; resolve(null); }
      });
    });
    // A hanging model call inside a 30s function would burn the whole budget and return
    // nothing. Time out well below it and fall back to the rule.
    req.on('timeout', () => { lastError = 'timeout'; req.destroy(); resolve(null); });
    req.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    req.write(payload);
    req.end();
  });
}

/**
 * Score candidate series for spike risk. Returns null on ANY failure, and every caller treats
 * null as "use the z-score rule" -- an unreachable model must degrade the ranking, never fail
 * the request.
 */
async function scoreSpikes(req, rows, token) {
  if (!configured() || !rows.length) return null;
  const body = { data: rows.map((r) => FEATURES.map((f) => Number(r[f]) || 0)), columns: FEATURES };
  if (DEPLOYMENT_ID) body.deployment_id = DEPLOYMENT_ID;
  const out = await postJson(body, token);
  if (!out) return null;
  const preds = out.predictions || out.data || out.result || null;
  if (!Array.isArray(preds) || preds.length !== rows.length) {
    lastError = 'unexpected prediction shape';
    return null;
  }
  lastServed = 'model';
  return preds.map((p) => (typeof p === 'number' ? p
    : Number(p && (p.probability ?? p.score ?? p.prediction ?? p[1] ?? p[0])) || 0));
}

/**
 * Which ranker answers, and what both scored. Attached to the forecast response whether or not
 * a model is deployed: "the rule ranks because no model is deployed" is a statement worth
 * making out loud, and it is the same field that will read "the model ranks" once one is.
 */
function chooseServed(baseline) {
  const baselineMape = baseline && baseline.accuracy ? baseline.accuracy.mape : null;
  const wins = configured() && MODEL_AP > RULE_AP;
  lastServed = wins ? 'model' : 'rule';
  return {
    // Projections always come from the statistical forecaster -- see whyNotVolumeForecasting.
    projectionsBy: 'statistical forecaster',
    projectionBacktestMape: baselineMape,
    // Emerging-risk RANKING is the part a model can win.
    emergingRiskRankedBy: lastServed,
    modelAveragePrecision: configured() ? MODEL_AP : null,
    ruleAveragePrecision: RULE_AP,
    reason: configured()
      ? (wins
        ? `The trained spike classifier scores ${MODEL_AP} average precision against the z-score rule's ${RULE_AP}, so it ranks emerging risk.`
        : `The trained spike classifier scores ${MODEL_AP} against the rule's ${RULE_AP}, so the rule still ranks emerging risk.`)
      : 'No trained model is deployed, so emerging risk is ranked by z-score against each series\' own history.',
  };
}

module.exports = { FEATURES, chooseServed, scoreSpikes, configured, status };
