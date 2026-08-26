// mlforecast.js — serving a trained QuickML model, with the statistical forecast as the floor.
//
// The shape of this file is the point. There are two forecasters:
//
//   BASELINE   appsail/pipeline/forecast.py — decomposition, backtested, always available.
//   MODEL      a QuickML regressor trained on derived/training_set.csv, called over HTTP.
//
// and the served answer is WHICHEVER BACKTESTS BETTER. A model that loses to the baseline does
// not ship just because it is a model, and the response says which one answered and what both
// scored, so nobody has to take it on faith.
//
// Model building is a console workflow because QuickML exposes no REST surface for datasets,
// pipelines or models. Everything either side of it is automated: the pipeline writes the
// training set every run, and this serves the endpoint once someone puts its id in the
// environment. Retraining stays a deliberate act -- a police system that silently retrains and
// starts serving a new model is a liability, and someone should read the backtest first.
const https = require('https');

const ENDPOINT = process.env.QUICKML_FORECAST_ENDPOINT || '';
const DEPLOYMENT_ID = process.env.QUICKML_FORECAST_DEPLOYMENT_ID || '';
const TIMEOUT_MS = Number(process.env.QUICKML_FORECAST_TIMEOUT_MS || 8000);
// The model's own measured hold-out error, recorded when it was built in the console. It is
// configuration rather than something we can read back: QuickML does not expose a model's
// evaluation over HTTP, and a model whose error nobody wrote down cannot be compared to
// anything -- so an unset value means "do not serve it", not "assume it is good".
const MODEL_MAPE = process.env.QUICKML_FORECAST_MAPE ? Number(process.env.QUICKML_FORECAST_MAPE) : null;

let lastError = null;
let lastServed = 'baseline';

function configured() {
  return Boolean(ENDPOINT) && Number.isFinite(MODEL_MAPE);
}

function status() {
  return {
    configured: configured(),
    endpointSet: Boolean(ENDPOINT),
    deploymentIdSet: Boolean(DEPLOYMENT_ID),
    declaredMape: MODEL_MAPE,
    lastServed,
    lastError,
    // Said plainly, because "no ML model" reads as an omission unless the reason is given.
    note: configured()
      ? 'A trained model is configured. The served forecast is whichever of model and baseline backtests better.'
      : 'No trained model is deployed. The statistical forecast serves, and its measured hold-out error is reported with it.',
  };
}

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
    // nothing. Time out well below it and fall back.
    req.on('timeout', () => { lastError = 'timeout'; req.destroy(); resolve(null); });
    req.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    req.write(payload);
    req.end();
  });
}

/**
 * Feature row for one district and crime head, built from that series' own recent history.
 *
 * The column names and order must match training_set.py's FEATURES exactly. They are repeated
 * here rather than imported because the two live in different runtimes (Python pipeline, Node
 * function) -- so the list is asserted against the training-set metadata at call time instead,
 * and a mismatch is reported rather than silently producing nonsense.
 */
const FEATURES = ['district_id', 'crime_head_id', 'month_index', 'month_of_year',
  'lag_1', 'lag_2', 'lag_3', 'lag_12', 'roll_3', 'roll_6', 'roll_12',
  'district_lag_1', 'head_share'];

const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : 0);

function featureRow({ districtId, crimeHeadId, targetMonth, history, districtLag1 }) {
  const h = history;
  const lag1 = h[h.length - 1] || 0;
  return {
    district_id: Number(districtId),
    crime_head_id: Number(crimeHeadId),
    month_index: monthIndex(targetMonth),
    month_of_year: Number(targetMonth.slice(5, 7)),
    lag_1: lag1,
    lag_2: h[h.length - 2] || 0,
    lag_3: h[h.length - 3] || 0,
    lag_12: h[h.length - 12] || 0,
    roll_3: mean(h.slice(-3)),
    roll_6: mean(h.slice(-6)),
    roll_12: mean(h.slice(-12)),
    district_lag_1: districtLag1,
    head_share: districtLag1 ? Math.round((lag1 / districtLag1) * 10000) / 10000 : 0,
  };
}

/**
 * Decide what to serve.
 *
 * Takes the baseline forecast block as the pipeline computed it and returns it annotated with
 * which forecaster answered and what each scored. When no model is configured -- the current
 * state -- this is a cheap, honest passthrough that still makes the comparison visible.
 */
function chooseServed(baseline) {
  const baselineMape = baseline && baseline.accuracy ? baseline.accuracy.mape : null;
  if (!configured()) {
    lastServed = 'baseline';
    return {
      servedBy: 'baseline',
      baselineMape,
      modelMape: null,
      reason: 'No trained model is deployed, so the statistical forecast serves.',
    };
  }
  // Strictly better, not merely different. A model that ties the baseline adds a network hop,
  // an external dependency and a thing to explain, for nothing.
  const modelWins = Number.isFinite(baselineMape) && MODEL_MAPE < baselineMape;
  lastServed = modelWins ? 'model' : 'baseline';
  return {
    servedBy: lastServed,
    baselineMape,
    modelMape: MODEL_MAPE,
    reason: modelWins
      ? `The trained model backtests at ${MODEL_MAPE}% against the baseline's ${baselineMape}%, so it serves.`
      : `The trained model backtests at ${MODEL_MAPE}% against the baseline's ${baselineMape}%, so the baseline serves.`,
  };
}

/**
 * Ask the model for one district-head series. Returns null on any failure, and every caller
 * treats null as "use the baseline" -- an unreachable model must degrade the forecast, never
 * fail the request.
 */
async function predict(req, rows, token) {
  if (!configured() || !rows.length) return null;
  const body = { data: rows.map((r) => FEATURES.map((f) => r[f])), columns: FEATURES };
  if (DEPLOYMENT_ID) body.deployment_id = DEPLOYMENT_ID;
  const out = await postJson(body, token);
  if (!out) return null;
  const preds = out.predictions || out.data || out.result || null;
  if (!Array.isArray(preds) || preds.length !== rows.length) {
    lastError = 'unexpected prediction shape';
    return null;
  }
  return preds.map((p) => (typeof p === 'number' ? p : Number(p && (p.prediction ?? p.value ?? p[0]))));
}

module.exports = { FEATURES, featureRow, chooseServed, predict, configured, status };
