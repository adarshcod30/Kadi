// offenderrisk.js — serving the repeat-offending model family, with recency as the floor.
//
// SIX QUESTIONS ABOUT THE SAME PEOPLE, ON ONE PAYLOAD.
//
// Every model here is fitted on the same panel -- one row per repeat offender per observation
// date, features computed strictly from cases registered on or before that date -- and differs
// only in what it was asked to predict. So the scoring record is identical across all six, and
// picking a model means picking an endpoint, not rebuilding the request.
//
//     slug          question                                       model   rule   margin
//     ----------------------------------------------------------------------------------
//     h90           back on a new FIR within 90 days               0.699   0.584  +0.115
//     h180          back on a new FIR within 180 days              0.746   0.562  +0.184
//     h365          back on a new FIR within a year                0.733   0.512  +0.221
//     new365        next FIR is in a district never worked         0.762   0.561  +0.201
//     heinous365    next FIR is recorded Heinous                   0.661   0.502  +0.159
//     women365      next FIR is a crime against women              0.638   0.459  +0.179
//
// Eleven tasks were measured to get these six. The rejections and the reasoning are in
// appsail/pipeline/offender_set.py; the short version is that a target of "comes back AND it
// is a property crime" inherits the predictability of "comes back", and three crime-family
// models that looked like wins turned out to be ranking who returns rather than what they
// return with. women365 and heinous365 survive that test, which is why they are here.
//
// THE FOUR YEAR-LONG MODELS NAME DIFFERENT PEOPLE. Their top-20 shortlists share at most one
// person with each other. That is the point of having four: a list is a product, and four
// lists of the same twenty names would be one product shown four times.
//
// WHY THESE ARE REGRESSORS ON 0/1 TARGETS, WHICH LOOKS ODD AND IS DELIBERATE.
//
// QuickML's classification nodes emit a hard class LABEL. There is no predict_proba option
// anywhere in the palette -- searching the operation list for "prob" returns nothing -- and a
// label cannot rank: at the default threshold on a 36% positive rate the endpoint answers the
// same value for most candidates, and sorting by it is sorting by nothing. That is exactly the
// failure the spike endpoint was silently hitting.
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
// One key per model. The six share a feature set and a panel and differ only in which target
// column they were fitted to, but each is a separate QuickML endpoint with its own credential
// -- so the model has to select the key, not just the label.
//
// `auc` and `rule` are the measured hold-out numbers from offender_set.py's MEASURED table.
// configured() compares them, so a model whose margin is ever revised below zero stops being
// served automatically rather than needing anyone to remember to unplug it.
const MODELS = {
  h90: {
    key: 'quickml.offenderH90EndpointKey',
    question: 'back on a new FIR within 90 days',
    short: 'Back within 90 days',
    horizonDays: 90,
    auc: 0.699, rule: 0.584, ap: 0.319, apRule: 0.257, testPositives: 775,
    ruleName: 'recency (days since last case)',
    use: 'A station-level list. Short enough that an SHO can act on it inside one posting.',
  },
  h180: {
    key: 'quickml.offenderEndpointKey',
    question: 'back on a new FIR within 180 days',
    short: 'Back within six months',
    horizonDays: 180,
    auc: 0.746, rule: 0.562, ap: 0.538, apRule: 0.387, testPositives: 1051,
    ruleName: 'recency (days since last case)',
    use: 'The default. The widest margin on average precision, which is what matters for a '
      + 'list read from the top.',
  },
  h365: {
    key: 'quickml.offenderH365EndpointKey',
    question: 'back on a new FIR within a year',
    short: 'Back within a year',
    horizonDays: 365,
    auc: 0.733, rule: 0.512, ap: 0.720, apRule: 0.517, testPositives: 1318,
    ruleName: 'recency (days since last case)',
    use: 'A watchlist review horizon. Shares 12 of its top 20 with the six-month list, so it '
      + 'is a longer view of much the same people rather than a different set.',
  },
  new365: {
    key: 'quickml.offenderNew365EndpointKey',
    question: 'next FIR is in a district they have never worked',
    short: 'Surfaces somewhere new',
    horizonDays: 365,
    auc: 0.762, rule: 0.561, ap: 0.452, apRule: 0.309, testPositives: 732,
    ruleName: 'districts worked so far',
    use: 'The question no single SP can answer from their own register, and the reason the '
      + 'state tier exists. Shares ONE of its top 20 with the year-long return list.',
  },
  heinous365: {
    key: 'quickml.offenderHeinous365EndpointKey',
    question: 'next FIR is recorded Heinous',
    short: 'Escalates to Heinous',
    horizonDays: 365,
    auc: 0.661, rule: 0.502, ap: 0.089, apRule: 0.057, testPositives: 155,
    ruleName: 'recency (days since last case)',
    use: 'Severity rather than frequency. Survives the test that killed the crime-family '
      + 'models: conditioned on the offender returning at all, it still beats the rule by '
      + '+0.121, so it is ranking what they come back with, not whether.',
  },
  women365: {
    key: 'quickml.offenderWomen365EndpointKey',
    question: 'next FIR is a crime against women',
    short: 'Returns with a crime against women',
    horizonDays: 365,
    auc: 0.638, rule: 0.459, ap: 0.040, apRule: 0.021, testPositives: 60,
    ruleName: 'recency (days since last case)',
    use: 'The thinnest evidence base on the list -- 60 positives in the hold-out -- and the '
      + 'one with the clearest operational claim. Read it as a prompt to look, not a finding. '
      + 'Its conditional margin is +0.146, the strongest of the targeted models.',
  },
};
const DEFAULT_MODEL = 'h180';

const TIMEOUT_MS = Number(process.env.QUICKML_OFFENDER_TIMEOUT_MS || 6000);
const MAX_SCORED = Number(process.env.QUICKML_OFFENDER_MAX || 24);
const CONCURRENCY = 6;


let lastError = null;
let lastServed = 'rule';
const cachedKey = {};

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

async function endpointKey(req, slug) {
  const m = MODELS[slug];
  if (!m) return '';
  if (cachedKey[slug] !== undefined) return cachedKey[slug];
  // eslint-disable-next-line global-require
  const datastore = require('./datastore');
  const rows = await datastore.query(req,
    `SELECT configValue FROM AppConfig WHERE configKey = '${m.key}'`, 'AppConfig');
  cachedKey[slug] = (rows && rows[0] && rows[0].configValue) || '';
  return cachedKey[slug];
}

/** Resolve whatever the caller asked for to a real slug, defaulting rather than failing. */
function resolve(want) {
  const s = String(want || '').trim();
  if (MODELS[s]) return s;
  // Tolerate the older ?horizon=180 form, and a bare number, so existing links keep working.
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    const hit = Object.keys(MODELS).find((k) => k === `h${n}`);
    if (hit) return hit;
  }
  return DEFAULT_MODEL;
}

/**
 * A model is served only if it beat its baseline on BOTH AUC and average precision. Reading
 * that off the measured numbers rather than a hand-set boolean means a revised measurement
 * unplugs the model by itself -- which is what should have happened to the spike classifier
 * when its margin was corrected from +0.168 to +0.058, and did not.
 */
function configured(slug = DEFAULT_MODEL) {
  const m = MODELS[slug];
  return Boolean(ENDPOINT) && Boolean(m) && m.auc > m.rule && m.ap > m.apRule;
}

function status() {
  return {
    task: 'repeat offending — six questions about a known repeat offender, one panel',
    defaultModel: DEFAULT_MODEL,
    models: Object.entries(MODELS).map(([slug, m]) => ({
      slug,
      question: m.question,
      short: m.short,
      horizonDays: m.horizonDays,
      modelAuc: m.auc,
      ruleAuc: m.rule,
      margin: Math.round((m.auc - m.rule) * 1000) / 1000,
      modelAp: m.ap,
      ruleAp: m.apRule,
      apMargin: Math.round((m.ap - m.apRule) * 1000) / 1000,
      ruleName: m.ruleName,
      testPositives: m.testPositives,
      use: m.use,
      configKey: m.key,
      served: configured(slug),
      keyLoaded: cachedKey[slug] === undefined ? 'not-attempted' : Boolean(cachedKey[slug]),
    })),
    configured: configured(),
    endpoint: ENDPOINT,
    ruleName: 'recency (days since last case)',
    lastServed,
    lastError,
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
async function score(req, rows, model = DEFAULT_MODEL) {
  const slug = resolve(model);
  if (!configured(slug) || !rows || !rows.length) return null;
  const key = await endpointKey(req, slug).catch(() => '');
  if (!key) { lastError = `no endpoint key in AppConfig under ${MODELS[slug].key}`; return null; }
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

module.exports = {
  FEATURES, candidates, score, configured, status, resolve, MODELS, DEFAULT_MODEL, MAX_SCORED,
};
