// store.mock.js — local backend: loads generated CSVs + pipeline-derived JSON into
// memory and answers all read queries. Mirrors what the Catalyst adapter will do via
// ZCQL (Data Store) + NoSQL (graph/scores) + Cache. Loaded once (singleton).
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Two possible data roots:
//   FULL    repo-root data/output - 121MB, every CSV and derived artifact. Present in
//           development, but gitignored and far too large to ship.
//   BUNDLED functions/api/data - a self-contained ~48MB subset (derived artifacts
//           + lookup CSVs) that IS shipped, so the deployed function has something to read.
// Prefer FULL when it exists: locally and in tests we want the complete dataset. Only the
// deployed function, where FULL is absent, falls back to the bundle.
const BUNDLED = path.resolve(__dirname, '../data');
const FULL = path.resolve(__dirname, '../../../data/output');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : fs.existsSync(path.join(FULL, 'derived'))
    ? FULL
    : BUNDLED;
const DERIVED = path.join(DATA_DIR, 'derived');

let DB = null;

function readCsv(name) {
  const p = path.join(DATA_DIR, `${name}.csv`);
  if (!fs.existsSync(p)) return [];
  return parse(fs.readFileSync(p), { columns: true, skip_empty_lines: true, bom: true });
}
function readJson(name, fallback) {
  const p = path.join(DERIVED, `${name}.json`);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
// Rehydrate one case's interned edges back to the shape the queries expect.
function makeLazyAdjacency({ typeTable, detailTable, adj }) {
  const T = typeTable || [];
  const D = detailTable || [];
  const cache = new Map();
  const expand = (edges) => edges.map((e) => ({
    neighborId: e.n,
    neighborCrimeNo: e.c,
    edgeType: T[e.t],
    allTypes: (e.a || []).map((i) => T[i]),
    strength: e.s,
    clusterId: e.k,
    evidence: { matched: (e.m || []).map(([ti, di]) => ({ type: T[ti], detail: D[di] })) },
  }));
  return new Proxy(adj, {
    get(target, prop) {
      if (typeof prop !== 'string' || !(prop in target)) return target[prop];
      if (!cache.has(prop)) cache.set(prop, expand(target[prop]));
      return cache.get(prop);
    },
    has: (target, prop) => prop in target,
    ownKeys: (target) => Reflect.ownKeys(target),
    getOwnPropertyDescriptor: (target, prop) =>
      Reflect.getOwnPropertyDescriptor(target, prop),
  });
}

function indexBy(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(String(r[key]), r);
  return m;
}
function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function load() {
  if (DB) return DB;
  const t0 = Date.now();

  const districts = indexBy(readCsv('District'), 'DistrictID');
  const unitsRows = readCsv('Unit');
  const units = indexBy(unitsRows, 'UnitID');
  const employees = indexBy(readCsv('Employee'), 'EmployeeID');
  const heads = indexBy(readCsv('CrimeHead'), 'CrimeHeadID');
  const subheads = indexBy(readCsv('CrimeSubHead'), 'CrimeSubHeadID');
  const statuses = indexBy(readCsv('CaseStatusMaster'), 'CaseStatusID');
  const categories = indexBy(readCsv('CaseCategory'), 'CaseCategoryID');
  const gravities = indexBy(readCsv('GravityOffence'), 'GravityOffenceID');
  const genders = indexBy(readCsv('GenderMaster'), 'GenderID');
  const religions = indexBy(readCsv('ReligionMaster'), 'ReligionID');
  const castes = indexBy(readCsv('CasteMaster'), 'caste_master_id');
  const occupations = indexBy(readCsv('OccupationMaster'), 'OccupationID');
  const sections = readCsv('Section');
  const sectionDesc = new Map(sections.map((s) => [`${s.ActCode}:${s.SectionCode}`, s.SectionDescription]));

  const complainants = groupBy(readCsv('ComplainantDetails'), 'CaseMasterID');
  const victims = groupBy(readCsv('Victim'), 'CaseMasterID');
  const accused = groupBy(readCsv('Accused'), 'CaseMasterID');
  const actSections = groupBy(readCsv('ActSectionAssociation'), 'CaseMasterID');
  const arrests = groupBy(readCsv('ArrestSurrender'), 'CaseMasterID');
  const chargesheets = groupBy(readCsv('ChargesheetDetails'), 'CaseMasterID');

  const unitDistrict = new Map();
  for (const u of unitsRows) unitDistrict.set(String(u.UnitID), String(u.DistrictID));

  // Denormalized case display objects
  const caseRows = readCsv('CaseMaster');
  const cases = new Map();
  const linkedCount = readJson('case_linked_count', {});
  const healthList = readJson('case_health', []);
  const healthByCase = indexBy(healthList, 'caseMasterId');
  for (const c of caseRows) {
    const unit = units.get(String(c.PoliceStationID));
    const distId = unitDistrict.get(String(c.PoliceStationID)) || '';
    const io = employees.get(String(c.PolicePersonID));
    const h = healthByCase.get(String(c.CaseMasterID));
    cases.set(String(c.CaseMasterID), {
      caseMasterId: String(c.CaseMasterID),
      crimeNo: c.CrimeNo, caseNo: c.CaseNo,
      crimeRegisteredDate: c.CrimeRegisteredDate,
      incidentFromDate: c.IncidentFromDate, incidentToDate: c.IncidentToDate,
      infoReceivedPSDate: c.InfoReceivedPSDate,
      unitId: String(c.PoliceStationID), unitName: unit ? unit.UnitName : '',
      districtId: distId, districtName: districts.get(distId) ? districts.get(distId).DistrictName : '',
      crimeHeadId: String(c.CrimeMajorHeadID),
      crimeHead: heads.get(String(c.CrimeMajorHeadID)) ? heads.get(String(c.CrimeMajorHeadID)).CrimeGroupName : '',
      crimeSubHeadId: String(c.CrimeMinorHeadID),
      crimeSubHead: subheads.get(String(c.CrimeMinorHeadID)) ? subheads.get(String(c.CrimeMinorHeadID)).CrimeHeadName : '',
      statusId: String(c.CaseStatusID),
      status: statuses.get(String(c.CaseStatusID)) ? statuses.get(String(c.CaseStatusID)).CaseStatusName : '',
      categoryId: String(c.CaseCategoryID),
      category: categories.get(String(c.CaseCategoryID)) ? categories.get(String(c.CaseCategoryID)).LookupValue : '',
      gravityId: String(c.GravityOffenceID),
      gravity: gravities.get(String(c.GravityOffenceID)) ? gravities.get(String(c.GravityOffenceID)).LookupValue : '',
      latitude: c.latitude ? Number(c.latitude) : null,
      longitude: c.longitude ? Number(c.longitude) : null,
      briefFacts: c.BriefFacts,
      ioId: String(c.PolicePersonID || ''), ioName: io ? io.FirstName : '',
      linkedCount: linkedCount[String(c.CaseMasterID)] || 0,
      healthSeverity: h ? h.severity : null,
      healthFlags: h ? h.flagKeys : [],
      clusterId: h ? h.clusterId : null,
    });
  }

  const offenders = readJson('offenders', []);
  const offendersById = indexBy(offenders, 'offenderIdentityId');
  // build_bundle.py ships the adjacency interned: edge fields are single letters and every
  // type/reason string is an index into a shared table. Rehydrating the whole thing would
  // undo the saving (~50MB resident), so expose a Proxy that rehydrates one case's edges on
  // access. Callers keep using db.adjacency[caseId] and see the original shape.
  const rawAdj = readJson('graph_adjacency', {});
  const adjacency = rawAdj && rawAdj.adj && rawAdj.typeTable
    ? makeLazyAdjacency(rawAdj)
    : rawAdj;
  const offenderOfCase = readJson('offender_of_case', {});
  const clusters = readJson('clusters', []);
  const clustersById = indexBy(clusters, 'clusterId');
  const anomalies = readJson('hotspots', {}); // placeholder guard
  const hotspots = readJson('hotspots', { hotspots: [], districtCounts: {} });
  const caseAnomalies = readJson('anomalies', { caseAnomalies: [], stationAnomalies: [] });
  const alerts = readJson('alerts', []);
  const stats = readJson('stats', {});
  const zones = readJson('zones', { districts: [], stations: [], summary: {} });
  const occasions = readJson('occasions', { classes: [], occasions: [] });
  const evalReport = readJson('eval_report', {});
  const districtStats = readJson('district_stats', { districts: [], maxCount: 0 });
  const national = readJson('national', { states: [] });
  const socio = readJson('socio', { districts: [], correlations: [], composition: [] });
  const forecast = readJson('forecast', { districts: [], state: null, accuracy: null });

  DB = {
    dataDir: DATA_DIR,
    loadedMs: Date.now() - t0,
    lookups: { districts, units, employees, heads, subheads, statuses, categories, gravities,
      genders, religions, castes, occupations, sectionDesc, unitDistrict },
    children: { complainants, victims, accused, actSections, arrests, chargesheets },
    cases, caseList: [...cases.values()],
    offenders, offendersById, adjacency, offenderOfCase,
    clusters, clustersById,
    hotspots, caseAnomalies, alerts, stats, zones, occasions, evalReport, districtStats, national,
    socio, forecast,
    healthList, healthByCase,
  };
  console.log(`[store.mock] loaded ${cases.size} cases, ${offenders.length} offenders in ${DB.loadedMs}ms`);
  return DB;
}

module.exports = { load, DATA_DIR };
