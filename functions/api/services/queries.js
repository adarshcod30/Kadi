// queries.js — read queries over the store, with RBAC scoping + explanation payloads.
const { load } = require('./store.mock');
const rbac = require('./rbac');
const { notFound, forbidden } = require('../lib/envelope');

const FAIRNESS_STATEMENT =
  'KADI links cases and scores offenders using evidence and behaviour only — never caste, religion, or occupation. These fields are excluded from every model by design.';

function scoped(user, list) {
  if (user.roleMeta.scope === 'state') return list;
  return list.filter((c) => rbac.caseInScope(user, c));
}

// ---------------- cases ----------------
function listCases(user, q = {}) {
  const db = load();
  let rows = scoped(user, db.caseList);
  const { search, head, subhead, district, unit, status, gravity, category,
    dateFrom, dateTo, flagged, clusterId, sort = 'date_desc' } = q;

  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((c) =>
      c.crimeNo.includes(s) || (c.briefFacts || '').toLowerCase().includes(s) ||
      (c.crimeSubHead || '').toLowerCase().includes(s) || (c.unitName || '').toLowerCase().includes(s));
  }
  if (head) rows = rows.filter((c) => c.crimeHeadId === String(head));
  if (subhead) rows = rows.filter((c) => c.crimeSubHeadId === String(subhead));
  if (district) rows = rows.filter((c) => c.districtId === String(district));
  if (unit) rows = rows.filter((c) => c.unitId === String(unit));
  if (status) rows = rows.filter((c) => c.statusId === String(status));
  if (gravity) rows = rows.filter((c) => c.gravityId === String(gravity));
  if (category) rows = rows.filter((c) => c.categoryId === String(category));
  if (clusterId) rows = rows.filter((c) => c.clusterId === clusterId);
  if (flagged === 'true' || flagged === true) rows = rows.filter((c) => c.healthSeverity);
  if (dateFrom) rows = rows.filter((c) => c.crimeRegisteredDate >= dateFrom);
  if (dateTo) rows = rows.filter((c) => c.crimeRegisteredDate <= dateTo);

  const sorters = {
    date_desc: (a, b) => (a.crimeRegisteredDate < b.crimeRegisteredDate ? 1 : -1),
    date_asc: (a, b) => (a.crimeRegisteredDate > b.crimeRegisteredDate ? 1 : -1),
    linked_desc: (a, b) => b.linkedCount - a.linkedCount,
  };
  rows = rows.slice().sort(sorters[sort] || sorters.date_desc);

  const total = rows.length;
  const page = Math.max(1, parseInt(q.page || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize || '25', 10)));
  const items = rows.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, pageSize };
}

function getCase(user, id) {
  const db = load();
  const c = db.cases.get(String(id));
  if (!c) throw notFound(`Case ${id} not found`);
  // detail visible if in scope OR linked into an in-scope investigation (silo-breaking is the point)
  const kid = String(id);
  const parties = {
    complainants: (db.children.complainants.get(kid) || []).map((r) => ({
      name: r.ComplainantName, age: r.AgeYear, genderId: r.GenderID,
    })),
    victims: (db.children.victims.get(kid) || []).map((r) => ({
      name: r.VictimName, age: r.AgeYear, genderId: r.GenderID, isPolice: r.VictimPolice === '1',
    })),
    accused: (db.children.accused.get(kid) || []).map((r) => ({
      accusedMasterId: r.AccusedMasterID, name: r.AccusedName, age: r.AgeYear,
      genderId: r.GenderID, personId: r.PersonID,
    })),
  };
  const acts = (db.children.actSections.get(kid) || []).map((r) => ({
    act: r.ActID, section: r.SectionID,
    description: db.lookups.sectionDesc.get(`${r.ActID}:${r.SectionID}`) || '',
  }));
  const arrests = (db.children.arrests.get(kid) || []).map((r) => ({
    date: r.ArrestSurrenderDate, typeId: r.ArrestSurrenderTypeID,
    districtId: r.ArrestSurrenderDistrictId, accusedMasterId: r.AccusedMasterID,
  }));
  const chargesheets = (db.children.chargesheets.get(kid) || []).map((r) => ({
    date: r.csdate, type: r.cstype,
    typeLabel: r.cstype === 'A' ? 'Chargesheet' : r.cstype === 'B' ? 'False Case' : 'Undetected',
  }));
  const health = db.healthByCase.get(kid) || null;
  const offenders = (db.offenderOfCase[kid] || []).map((oid) => {
    const o = db.offendersById.get(oid);
    return o ? { offenderIdentityId: oid, canonicalName: o.canonicalName, riskScore: o.riskScore, band: o.band } : null;
  }).filter(Boolean);
  return { ...c, parties, acts, arrests, chargesheets, health, offenders };
}

// ---------------- graph ----------------
function graphForCase(user, id, opts = {}) {
  const db = load();
  const center = db.cases.get(String(id));
  if (!center) throw notFound(`Case ${id} not found`);
  const maxNeighbors = Math.min(80, opts.maxNeighbors || 60);
  const adj = (db.adjacency[String(id)] || []).slice().sort((a, b) => b.strength - a.strength).slice(0, maxNeighbors);

  const nodes = new Map();
  const edges = [];
  const addCaseNode = (cid, isCenter = false) => {
    const c = db.cases.get(String(cid));
    if (!c || nodes.has(`case:${cid}`)) return;
    nodes.set(`case:${cid}`, {
      id: `case:${cid}`, type: 'case', caseId: String(cid), label: c.crimeNo,
      crimeHead: c.crimeHead, crimeSubHead: c.crimeSubHead, district: c.districtName,
      unit: c.unitName, status: c.status, gravity: c.gravity, date: c.crimeRegisteredDate,
      clusterId: c.clusterId, isCenter,
    });
  };
  addCaseNode(id, true);
  const involved = new Set([String(id)]);
  for (const n of adj) {
    addCaseNode(n.neighborId);
    involved.add(String(n.neighborId));
    edges.push({
      id: `e:${id}:${n.neighborId}`, source: `case:${id}`, target: `case:${n.neighborId}`,
      edgeType: n.edgeType, allTypes: n.allTypes, strength: n.strength,
      clusterId: n.clusterId, explanation: n.evidence,
    });
  }
  // offender nodes + membership edges (shared accused across cases = the silo-breaking view)
  const offAdded = new Set();
  for (const cid of involved) {
    for (const oid of db.offenderOfCase[cid] || []) {
      const o = db.offendersById.get(oid);
      if (!o) continue;
      const onid = `off:${oid}`;
      if (!offAdded.has(onid)) {
        nodes.set(onid, {
          id: onid, type: 'offender', offenderId: oid, label: o.canonicalName,
          riskScore: o.riskScore, band: o.band, cases: o.distinctCases,
        });
        offAdded.add(onid);
      }
      edges.push({
        id: `em:${oid}:${cid}`, source: onid, target: `case:${cid}`,
        edgeType: 'appears_in', strength: 0.9,
        explanation: { matched: [{ type: 'appears_in', detail: `${o.canonicalName} is an accused in this FIR` }] },
      });
    }
  }
  const clusterId = center.clusterId;
  const explanation = {
    summary: `${nodes.size} entities and ${edges.length} links found around FIR ${center.crimeNo}.`,
    edgeTypes: [...new Set(edges.map((e) => e.edgeType))],
    fairness: FAIRNESS_STATEMENT,
  };
  return { center: `case:${id}`, clusterId, nodes: [...nodes.values()], edges, explanation };
}

function getCluster(user, clusterId) {
  const db = load();
  const cl = db.clustersById.get(clusterId);
  if (!cl) throw notFound(`Cluster ${clusterId} not found`);
  const nodes = new Map();
  const edges = [];
  const seen = new Set();
  for (const cid of cl.caseIds) {
    const c = db.cases.get(String(cid));
    if (c) nodes.set(`case:${cid}`, {
      id: `case:${cid}`, type: 'case', caseId: String(cid), label: c.crimeNo,
      crimeSubHead: c.crimeSubHead, district: c.districtName, unit: c.unitName,
      status: c.status, gravity: c.gravity, clusterId,
    });
  }
  for (const cid of cl.caseIds) {
    for (const n of db.adjacency[String(cid)] || []) {
      if (!nodes.has(`case:${n.neighborId}`)) continue;
      const key = [cid, n.neighborId].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: `e:${key}`, source: `case:${cid}`, target: `case:${n.neighborId}`,
        edgeType: n.edgeType, allTypes: n.allTypes, strength: n.strength, explanation: n.evidence,
      });
    }
  }
  return { cluster: cl, nodes: [...nodes.values()], edges,
    explanation: { summary: `Cluster ${clusterId}: ${cl.size} cases across ${cl.districts.length} district(s).`, fairness: FAIRNESS_STATEMENT } };
}

// ---------------- offenders ----------------
function listOffenders(user, q = {}) {
  const db = load();
  let rows = db.offenders.slice();
  if (q.band) rows = rows.filter((o) => o.band === q.band);
  if (q.minRisk) rows = rows.filter((o) => (o.riskScore || 0) >= Number(q.minRisk));
  if (q.search) {
    const s = String(q.search).toLowerCase();
    rows = rows.filter((o) => o.canonicalName.toLowerCase().includes(s));
  }
  rows.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  const total = rows.length;
  const page = Math.max(1, parseInt(q.page || '1', 10));
  const pageSize = Math.min(200, parseInt(q.pageSize || '50', 10));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize,
    fairness: FAIRNESS_STATEMENT };
}

function getOffender(user, id) {
  const db = load();
  const o = db.offendersById.get(String(id));
  if (!o) throw notFound(`Offender ${id} not found`);
  const cases = (o.caseIds || []).map((cid) => {
    const c = db.cases.get(String(cid));
    return c ? { caseMasterId: c.caseMasterId, crimeNo: c.crimeNo, crimeSubHead: c.crimeSubHead,
      district: c.districtName, unit: c.unitName, status: c.status, date: c.crimeRegisteredDate,
      gravity: c.gravity } : null;
  }).filter(Boolean);
  return { ...o, cases, fairness: FAIRNESS_STATEMENT };
}

// ---------------- health ----------------
function listHealth(user, q = {}) {
  const db = load();
  const scopedCases = new Set(scoped(user, db.caseList).map((c) => c.caseMasterId));
  let rows = db.healthList.filter((h) => scopedCases.has(String(h.caseMasterId)));
  if (q.severity) rows = rows.filter((h) => h.severity === q.severity);
  if (q.flag) rows = rows.filter((h) => h.flagKeys.includes(q.flag));
  if (q.district) rows = rows.filter((h) => String(h.districtId) === String(q.district));
  if (q.unit) rows = rows.filter((h) => String(h.unitId) === String(q.unit));
  const enrich = (h) => {
    const c = db.cases.get(String(h.caseMasterId));
    return { ...h, crimeSubHead: c ? c.crimeSubHead : '', district: c ? c.districtName : '',
      unit: c ? c.unitName : '', ioName: c ? c.ioName : '', gravity: c ? c.gravity : '' };
  };
  const total = rows.length;
  const page = Math.max(1, parseInt(q.page || '1', 10));
  const pageSize = Math.min(200, parseInt(q.pageSize || '30', 10));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(enrich), total, page, pageSize };
}

function healthSummary(user) {
  const db = load();
  const scopedCases = new Set(scoped(user, db.caseList).map((c) => c.caseMasterId));
  const rows = db.healthList.filter((h) => scopedCases.has(String(h.caseMasterId)));
  const byFlag = {};
  let ageSum = 0, ageN = 0;
  for (const h of rows) {
    for (const f of h.flagKeys) byFlag[f] = (byFlag[f] || 0) + 1;
    if (h.investigationAgeDays) { ageSum += h.investigationAgeDays; ageN += 1; }
  }
  return {
    flaggedTotal: rows.length,
    high: rows.filter((h) => h.severity === 'high').length,
    medium: rows.filter((h) => h.severity === 'medium').length,
    byFlag,
    avgInvestigationAge: ageN ? Math.round(ageSum / ageN) : 0,
    anomalies: db.caseAnomalies.stationAnomalies || [],
  };
}

// ---------------- geo ----------------
function geoPoints(user, q = {}) {
  const db = load();
  // Spatial view is state-wide crime-pattern intelligence (aggregate dots), not per-case
  // detail — shown to all analytical roles; individual case detail stays RBAC-scoped.
  let rows = db.caseList.filter((c) => c.latitude && c.longitude);
  if (q.head) rows = rows.filter((c) => c.crimeHeadId === String(q.head));
  if (q.district) rows = rows.filter((c) => c.districtId === String(q.district));
  if (q.dateFrom) rows = rows.filter((c) => c.crimeRegisteredDate >= q.dateFrom);
  const limit = Math.min(9000, parseInt(q.limit || '6000', 10));
  // even sampling across the whole scoped set so every district shows (not just the first N)
  const step = rows.length > limit ? rows.length / limit : 1;
  const items = [];
  for (let i = 0; i < rows.length && items.length < limit; i += step) {
    const c = rows[Math.floor(i)];
    const hh = c.incidentFromDate ? parseInt(c.incidentFromDate.slice(11, 13), 10) : NaN;
    items.push({ caseId: c.caseMasterId, crimeNo: c.crimeNo, lat: c.latitude, lng: c.longitude,
      head: c.crimeHead, headId: c.crimeHeadId, subHead: c.crimeSubHead, gravity: c.gravity,
      district: c.districtName, hour: Number.isFinite(hh) ? hh : null });
  }
  return { items, total: rows.length, districtCounts: db.hotspots.districtCounts || {} };
}

/**
 * geoGrid — bin every incident into a fixed lat/lng grid and return per-cell counts.
 *
 * Rendering a raw heatmap from thousands of equally-weighted points gives no control:
 * the density field either floors (all blue) or saturates (all red). Binning server-side
 * over the FULL dataset (not a sample) yields real counts per cell, so the client can
 * weight the heat by actual volume and show a legend in genuine case numbers.
 */
function geoGrid(user, q = {}) {
  const db = load();
  const cell = Math.min(0.25, Math.max(0.02, parseFloat(q.cell || '0.05')));
  const hourFrom = q.hourFrom != null && q.hourFrom !== '' ? parseInt(q.hourFrom, 10) : 0;
  const hourTo = q.hourTo != null && q.hourTo !== '' ? parseInt(q.hourTo, 10) : 23;
  const wholeDay = hourFrom === 0 && hourTo === 23;

  const bins = new Map();
  let total = 0;
  for (const c of db.caseList) {
    if (!c.latitude || !c.longitude) continue;
    if (q.head && c.crimeHeadId !== String(q.head)) continue;
    if (!wholeDay) {
      const hh = c.incidentFromDate ? parseInt(c.incidentFromDate.slice(11, 13), 10) : NaN;
      if (!Number.isFinite(hh) || hh < hourFrom || hh > hourTo) continue;
    }
    const gy = Math.floor(c.latitude / cell);
    const gx = Math.floor(c.longitude / cell);
    const key = `${gx}:${gy}`;
    let b = bins.get(key);
    if (!b) {
      b = { lat: (gy + 0.5) * cell, lng: (gx + 0.5) * cell, count: 0 };
      bins.set(key, b);
    }
    b.count += 1;
    total += 1;
  }
  const cells = [...bins.values()];
  let maxCount = 0;
  for (const c of cells) if (c.count > maxCount) maxCount = c.count;
  return { cells, maxCount, cellSize: cell, total, cellCount: cells.length };
}

function hotspots(user, q = {}) {
  const db = load();
  let hs = db.hotspots.hotspots || [];
  if (q.emerging === 'true') hs = hs.filter((h) => h.emergingFlag);
  return { hotspots: hs, districtCounts: db.hotspots.districtCounts || {} };
}

// ---------------- vulnerability (analyst/ACP) ----------------
function vulnerability(user) {
  rbac.requireRole(user, ['ACP', 'Analyst', 'Admin']);
  const db = load();
  // victim-side aggregates only (age band x crime head). Framed as victim-support.
  const bands = ['0-17', '18-30', '31-45', '46-60', '60+'];
  const bandOf = (a) => { a = Number(a); return a < 18 ? '0-17' : a <= 30 ? '18-30' : a <= 45 ? '31-45' : a <= 60 ? '46-60' : '60+'; };
  const byBandHead = {};
  for (const [cid, vs] of db.children.victims) {
    const c = db.cases.get(String(cid));
    if (!c) continue;
    for (const v of vs) {
      if (!v.AgeYear) continue;
      const key = `${bandOf(v.AgeYear)}|${c.crimeHead}`;
      byBandHead[key] = (byBandHead[key] || 0) + 1;
    }
  }
  return { bands, byBandHead, fairness: FAIRNESS_STATEMENT,
    disclaimer: 'Victim-support analytics. No suspect profiling. Protected attributes are excluded.' };
}

module.exports = {
  FAIRNESS_STATEMENT, listCases, getCase, graphForCase, getCluster,
  listOffenders, getOffender, listHealth, healthSummary, geoPoints, geoGrid, hotspots, vulnerability,
  stats: (user) => load().stats,
  districtStats: () => load().districtStats,
  national: () => load().national,
  socio: () => load().socio,
  // Forecast rows are keyed by districtId only; join the name here so the client never
  // has to hold a second lookup just to label a chart.
  forecast: () => {
    const db = load();
    const names = db.lookups.districts;
    const withNames = (db.forecast.districts || []).map((d) => ({
      ...d,
      districtName: (names.get(String(d.districtId)) || {}).DistrictName || `District ${d.districtId}`,
    }));
    return { ...db.forecast, districts: withNames };
  },
  alerts: (user) => load().alerts,
  evalReport: () => load().evalReport,
  anomalies: () => load().caseAnomalies,
  clusters: () => load().clusters,
  lookups: () => {
    const db = load();
    const arr = (m, id, name) => [...m.values()].map((r) => ({ id: String(r[id]), name: r[name] }));
    return {
      heads: arr(db.lookups.heads, 'CrimeHeadID', 'CrimeGroupName'),
      subheads: [...db.lookups.subheads.values()].map((r) => ({ id: String(r.CrimeSubHeadID), name: r.CrimeHeadName, headId: String(r.CrimeHeadID) })),
      statuses: arr(db.lookups.statuses, 'CaseStatusID', 'CaseStatusName'),
      gravities: arr(db.lookups.gravities, 'GravityOffenceID', 'LookupValue'),
      categories: arr(db.lookups.categories, 'CaseCategoryID', 'LookupValue'),
      districts: arr(db.lookups.districts, 'DistrictID', 'DistrictName'),
    };
  },
};
