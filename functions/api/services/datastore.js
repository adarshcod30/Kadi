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
let httpError = null;   // kept separate so the SDK fallback cannot mask it

// ---- raw ZCQL over HTTPS ----------------------------------------------------------
// The SDK's initialize(req) returns 401 for every scope, but the function DOES receive a
// full admin credential -- as request headers, not environment variables:
//   x-zc-admin-cred-token   (70-char OAuth token)
//   x-zc-project-secret-key (64 chars)
//   x-zc-user-type = admin
// quickml.js already proved these work: it reaches Zoho over raw HTTPS with that token and
// gets a 400 body-contract error, not a 401. So talk to the ZCQL REST endpoint directly and
// skip the SDK entirely.
const https = require('https');

function httpZcql(req, sql) {
  return new Promise((resolve) => {
    const h = (req && req.headers) || {};
    const token = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
    const projectId = h['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID;
    if (!token || !projectId) {
      httpError = 'no admin-cred-token header';
      return resolve(null);
    }
    const body = JSON.stringify({ query: sql });
    const r = https.request({
      hostname: 'api.catalyst.zoho.in',
      path: `/baas/v1/project/${projectId}/query`,
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
        Environment: h['x-zc-environment'] || 'Development',
        // The BaaS endpoint rejects the OAuth token alone with
        // 404 INVALID_RESOURCE "X-ZC-PROJECT-SECRET-KEY not found".
        'X-ZC-PROJECT-SECRET-KEY': h['x-zc-project-secret-key'] || '',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          httpError = `http ${res.statusCode}: ${out.slice(0, 220)}`;
          return resolve(null);
        }
        try {
          const j = JSON.parse(out);
          resolve(j.data || []);
        } catch (e) {
          httpError = `parse: ${e.message}`;
          resolve(null);
        }
      });
    });
    r.on('error', (e) => { httpError = `net: ${e.message}`; resolve(null); });
    r.write(body);
    r.end();
  });
}

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
  // HTTP first: it is the path that actually authenticates here.
  const viaHttp = await httpZcql(req, sql);
  if (viaHttp !== null) return table ? flatten(viaHttp, table) : viaHttp;
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
  const tables = {};
  let reachable = false;
  for (const t of TABLES) {
    const rows = await query(req, `SELECT COUNT(ROWID) FROM ${t}`, t);
    if (rows === null) { tables[t] = { error: lastError }; continue; }
    const first = rows[0] || {};
    tables[t] = Number(first.ROWID ?? first['COUNT(ROWID)'] ?? Object.values(first)[0] ?? 0);
    reachable = true;
  }
  return { reachable, via: reachable ? 'https + x-zc-admin-cred-token' : 'none', tables, httpError, lastError };
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
  // The earlier probe only dumped process.env and concluded there was no credential.
  // quickml.js gets a working token out of a REQUEST HEADER (x-zc-admin-cred-token) and
  // reaches Zoho with it -- its 400 is a body-contract error, not a 401. So check headers.
  out._headers = Object.keys((req && req.headers) || {})
    .filter((h) => /zc|zoho|catalyst|cred|token|auth|cookie/i.test(h))
    .reduce((acc, h) => {
      const v = String(req.headers[h] || '');
      acc[h] = v.length > 12 ? `<${v.length} chars>` : v;
      return acc;
    }, {});
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

// Map raw CaseMaster columns onto the enriched shape /cases returns. Lookups come from the
// bundle: a few hundred rows that only change when the pipeline reruns, so joining them in
// ZCQL would cost a round trip to save nothing. Health and link counts likewise -- those are
// pipeline output, not register data, and Data Store has no table for them.
function enrich(rows, db) {
  const L = db.lookups;
  return rows.map((r) => {
    const unitId = String(r.PoliceStationID);
    const districtId = String(L.unitDistrict[unitId] || '');
    const id = String(r.CaseMasterID);
    const health = db.healthByCase && db.healthByCase.get(id);
    return {
      caseMasterId: id,
      crimeNo: r.CrimeNo,
      caseNo: r.CaseNo,
      crimeRegisteredDate: r.CrimeRegisteredDate,
      incidentFromDate: r.IncidentFromDate,
      unitId,
      unitName: L.units[unitId] || '',
      districtId,
      districtName: L.districts[districtId] || '',
      statusId: String(r.CaseStatusID),
      statusName: L.statuses[String(r.CaseStatusID)] || '',
      crimeHeadId: String(r.CrimeMajorHeadID),
      crimeHead: L.heads[String(r.CrimeMajorHeadID)] || '',
      crimeSubHeadId: String(r.CrimeMinorHeadID),
      crimeSubHead: L.subheads[String(r.CrimeMinorHeadID)] || '',
      gravityId: String(r.GravityOffenceID),
      categoryId: String(r.CaseCategoryID),
      briefFacts: r.BriefFacts,
      latitude: r.latitude,
      longitude: r.longitude,
      linkedCount: (db.linkedCount && db.linkedCount[id]) || 0,
      healthSeverity: health ? health.severity : null,
      source: 'datastore',
    };
  });
}

module.exports = {
  available: () => !!catalyst,
  probe,
  listCases,
  enrich,
  diag: () => ({ sdkLoaded: !!catalyst, httpError, lastError }),
  query,
  status,
};
