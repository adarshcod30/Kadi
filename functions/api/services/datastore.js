// datastore.js — Catalyst Data Store adapter (ZCQL).
//
// The read-model that powers the graph is precomputed and bundled, because no heavy
// compute may sit behind an HTTP request (see docs/02 §10). The *register*, though, is
// genuinely relational and belongs in Data Store — so case and offender reads go through
// here, against live ZCQL, rather than against the bundle.
//
// Same two-environment contract as cache.js: deployed on Catalyst it talks to Data Store;
// locally and in tests there is no Catalyst context, so `available()` is false and every
// caller falls back to the file-backed store. A Data Store outage must degrade to the
// bundle, never to a 500.
let catalyst = null;
try {
  catalyst = require('zcatalyst-sdk-node');
} catch {
  catalyst = null;
}

let lastError = null;

function zcql(req) {
  if (!catalyst) { lastError = 'sdk-not-loaded'; return null; }
  if (!req) { lastError = 'no-request'; return null; }
  try {
    // scope:'admin' for the same reason cache.js needs it — the FIR register is
    // project-owned data, not the calling user's data, and an anonymous HTTP request
    // carries no user credential to resolve against.
    return catalyst.initialize(req, { scope: 'admin' }).zcql();
  } catch (e) {
    lastError = `initialize: ${e && e.message ? e.message : e}`;
    return null;
  }
}

// ZCQL returns rows shaped { TableName: { col: value } }. Flatten the single-table case
// so callers deal in plain objects.
function flatten(rows, table) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (r && r[table] ? r[table] : r));
}

async function query(req, sql, table) {
  const z = zcql(req);
  if (!z) return null;
  try {
    const rows = await z.executeZCQLQuery(sql);
    return table ? flatten(rows, table) : rows;
  } catch (e) {
    lastError = `query: ${e && e.message ? e.message : e}`;
    return null;
  }
}

// Row counts straight from Data Store. Doubles as the honest answer to "is Data Store
// actually on the read path, or just provisioned?" — the same job /ai/status does for
// the AI services.
const TABLES = ['CaseMaster', 'Accused', 'OffenderIdentity', 'District', 'Unit',
  'CrimeHead', 'CrimeSubHead', 'CaseStatusMaster', 'DistrictInsight',
  'CrimeForecast', 'Hotspot'];

async function status(req) {
  const z = zcql(req);
  if (!z) {
    return { reachable: false, reason: lastError || 'no-catalyst-context', tables: {} };
  }
  const tables = {};
  for (const t of TABLES) {
    try {
      const rows = await z.executeZCQLQuery(`SELECT COUNT(ROWID) FROM ${t}`);
      const first = rows && rows[0] ? (rows[0][t] || rows[0]) : {};
      const n = first.ROWID ?? first['COUNT(ROWID)'] ?? Object.values(first)[0];
      tables[t] = Number(n);
    } catch (e) {
      tables[t] = { error: e && e.message ? e.message : String(e) };
    }
  }
  return { reachable: true, tables, lastError };
}

// One deploy, several hypotheses. The 401 is identical to the one Cache returns, so the
// question is not "is ZCQL broken" but "what credential does a deployed function actually
// run as, and can any init mode reach project-owned data?"
async function probe(req) {
  const modes = [
    ['default', () => catalyst.initialize(req)],
    ['admin', () => catalyst.initialize(req, { scope: 'admin' })],
    ['user', () => catalyst.initialize(req, { scope: 'user' })],
    ['no-req', () => catalyst.initialize()],
  ];
  const out = {};
  for (const [name, init] of modes) {
    try {
      const app = init();
      try {
        const rows = await app.zcql().executeZCQLQuery('SELECT ROWID FROM District LIMIT 1');
        out[name] = { ok: true, sample: rows && rows[0] ? rows[0] : null };
      } catch (e) {
        const m = e && e.message ? e.message : String(e);
        out[name] = { ok: false, err: m.slice(0, 160) };
      }
    } catch (e) {
      out[name] = { init: false, err: (e && e.message ? e.message : String(e)).slice(0, 160) };
    }
  }
  // What identity is the function running as?
  try {
    const app = catalyst.initialize(req, { scope: 'admin' });
    out._user = await app.userManagement().getCurrentUser();
  } catch (e) {
    out._user = { err: (e && e.message ? e.message : String(e)).slice(0, 160) };
  }
  out._env = {
    hasProjectKey: !!process.env.X_ZOHO_CATALYST_PROJECT_KEY,
    hasProjectId: !!process.env.CATALYST_PROJECT_ID,
    keys: Object.keys(process.env).filter((k) => /CATALYST|ZOHO/i.test(k)).slice(0, 20),
  };
  return out;
}

module.exports = {
  available: () => !!catalyst,
  probe,
  diag: () => ({ sdkLoaded: !!catalyst, lastError }),
  query,
  status,
};
