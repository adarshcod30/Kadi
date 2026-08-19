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

// ---- the register, read live from Data Store -------------------------------------
// CaseMaster is the one table with real volume in Data Store (40,836 rows), so it is the
// one worth reading live. Lookups stay in the bundle: they are a few hundred rows, they
// never change between pipeline runs, and joining them in ZCQL would cost a round trip to
// save nothing.
//
// Returns null on ANY failure -- no credential, bad query, timeout -- and the caller falls
// back to the bundled read-model. A Data Store outage must degrade to slightly staler data,
// never to a 500 on the case register.
const COLS = ['CaseMasterID', 'CrimeNo', 'CaseNo', 'CrimeRegisteredDate', 'PoliceStationID',
  'CaseCategoryID', 'GravityOffenceID', 'CrimeMajorHeadID', 'CrimeMinorHeadID',
  'CaseStatusID', 'IncidentFromDate', 'latitude', 'longitude', 'BriefFacts'];

const esc = (v) => String(v).replace(/'/g, "''");

async function listCases(req, q = {}, scopeUnitIds = null) {
  const where = [];
  // RBAC first, so an out-of-scope read cannot be widened by a filter below it.
  if (Array.isArray(scopeUnitIds)) {
    if (!scopeUnitIds.length) return { items: [], total: 0 };
    where.push(`PoliceStationID IN (${scopeUnitIds.map((u) => `'${esc(u)}'`).join(',')})`);
  }
  if (q.head) where.push(`CrimeMajorHeadID = '${esc(q.head)}'`);
  if (q.subhead) where.push(`CrimeMinorHeadID = '${esc(q.subhead)}'`);
  if (q.unit) where.push(`PoliceStationID = '${esc(q.unit)}'`);
  if (q.status) where.push(`CaseStatusID = '${esc(q.status)}'`);
  if (q.gravity) where.push(`GravityOffenceID = '${esc(q.gravity)}'`);
  if (q.category) where.push(`CaseCategoryID = '${esc(q.category)}'`);
  if (q.dateFrom) where.push(`CrimeRegisteredDate >= '${esc(q.dateFrom)}'`);
  if (q.dateTo) where.push(`CrimeRegisteredDate <= '${esc(q.dateTo)}'`);
  if (q.search) where.push(`CrimeNo like '%${esc(q.search)}%'`);

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, parseInt(q.page || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize || '25', 10)));
  const offset = (page - 1) * pageSize;
  const asc = q.sort === 'date_asc';

  const countRows = await query(req, `SELECT COUNT(ROWID) FROM CaseMaster${clause}`, 'CaseMaster');
  if (countRows === null) return null;
  const total = Number(Object.values(countRows[0] || {})[0] || 0);

  const rows = await query(req,
    `SELECT ${COLS.join(', ')} FROM CaseMaster${clause}`
    + ` ORDER BY CrimeRegisteredDate ${asc ? 'ASC' : 'DESC'}`
    + ` LIMIT ${offset}, ${pageSize}`, 'CaseMaster');
  if (rows === null) return null;

  return { items: rows, total, page, pageSize };
}

module.exports = {
  available: () => !!catalyst,
  probe,
  listCases,
  diag: () => ({ sdkLoaded: !!catalyst, lastError }),
  query,
  status,
};
