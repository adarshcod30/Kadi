// queries.js — read queries over the store, with RBAC scoping + explanation payloads.
const { load } = require('./store.mock');
const rbac = require('./rbac');

// Zone severity order, shared wherever zones are ranked.
const ZONE_RANK = { red_pulsing: 0, red: 1, yellow: 2, normal: 3 };
const { notFound, forbidden } = require('../lib/envelope');

const FAIRNESS_STATEMENT =
  'KADI links cases and scores offenders using evidence and behaviour only — never caste, religion, or occupation. These fields are excluded from every model by design.';

function scoped(user, list) {
  // The fast path must not skip a state user who has drilled into a district. This
  // short-circuit was defeating drill-down across every query that goes through here: the
  // response said scope=district while returning all 40,829 rows, because caseInScope --
  // which knows about the drill -- was never reached.
  const narrowed = user.roleMeta.scope !== 'state' || user.drilledFromState || user.drillUnitId;
  if (!narrowed) return list;
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

  // A district viewer needs to see which nodes are OUTSIDE their district. Those are the
  // ones their own register cannot show them, and they should be visually obvious rather
  // than hidden among the local cases. Marked, never removed: a link that leaves the
  // district is the finding, not something to filter away.
  const homeDistrict = (user && ((user.roleMeta && user.roleMeta.tier === 'district')
    || user.drilledFromState)) ? String(user.districtId) : null;

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
      outsideScope: Boolean(homeDistrict && String(c.districtId) !== homeDistrict),
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
  // District tier sees offenders with at least one case in their district. An offender who
  // also works elsewhere stays visible -- that cross-jurisdiction reach is the finding, not
  // something to hide from the district that is dealing with them.
  const did = user && user.districtId ? String(user.districtId) : null;
  const narrowed = user && ((user.roleMeta && user.roleMeta.tier === 'district') || user.drilledFromState);
  if (narrowed && did) {
    rows = rows.filter((o) => (o.districts || []).map(String).includes(did));
    // Two very different people share this list. One is based here and works only here. The
    // other is based elsewhere and reaches in -- and that second group is the whole reason a
    // district needs a state-linked system, so it should not be buried among the locals.
    rows = rows.map((o) => {
      const ds = (o.districts || []).map(String);
      return { ...o, basedHere: ds.length === 1 && ds[0] === did, reachesIn: ds.length > 1 };
    });
    if (q.origin === 'visiting') rows = rows.filter((o) => o.reachesIn);
    if (q.origin === 'local') rows = rows.filter((o) => o.basedHere);
  }
  if (q.crossDistrict === 'true') rows = rows.filter((o) => (o.distinctDistricts || 0) >= 2);
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
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize,
    scope: narrowed ? 'district' : 'state',
    reachingIn: narrowed ? rows.filter((o) => o.reachesIn).length : null,
    basedHere: narrowed ? rows.filter((o) => o.basedHere).length : null,
    fairness: FAIRNESS_STATEMENT,
  };
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

  // districtId is now assigned during clustering, since the density parameters are
  // per district. Older bundles lack it, so fall back to the cases inside the cluster.
  const districtOf = (h) => {
    if (h.districtId != null && h.districtId !== '') return String(h.districtId);
    for (const id of (h.caseIds || [])) {
      const c = db.cases.get(String(id));
      if (c && c.districtId != null) return String(c.districtId);
    }
    return null;
  };
  hs = hs.map((h) => {
    const did = districtOf(h);
    let districtName = '';
    for (const id of (h.caseIds || [])) {
      const c = db.cases.get(String(id));
      if (c && c.districtName) { districtName = c.districtName; break; }
    }
    return { ...h, districtId: did, districtName };
  });

  const narrowed = user && (user.roleMeta.scope !== 'state' || user.drilledFromState);
  if (narrowed) {
    const did = String(user.districtId);
    hs = hs.filter((h) => h.districtId === did);
  }
  if (q.emerging === 'true') hs = hs.filter((h) => h.emergingFlag);
  if (q.window) hs = hs.filter((h) => h.temporal && h.temporal.peakWindow === q.window);

  return {
    hotspots: hs,
    scope: narrowed ? 'district' : 'state',
    districtCounts: db.hotspots.districtCounts || {},
    // A spatial cluster answers "where". Adding "when to be there" is the deployable half.
    // Filtered on the binomial test rather than raw share: with 190 clusters and four
    // windows, several small ones land entirely in one window by chance, and ranking on
    // percentage would put exactly those at the top.
    spatiotemporal: [...hs]
      .filter((h) => h.temporal && h.temporal.timeConcentrated)
      .sort((a, b) => a.temporal.pValue - b.temporal.pValue || b.count - a.count)
      .slice(0, 8),
  };
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
  // Genuinely scoped. This used to return the precomputed state-wide blob to everyone, so
  // a Sub-Inspector and the DGP saw identical KPIs on the first screen of the product --
  // which made the whole role model look decorative. State tier still gets the precomputed
  // figures (they are the same thing, and free); district tier is computed from its own
  // case list.
  // Expose the loaded store so the ZCQL mapper can reuse lookups rather than re-querying
  // a few hundred rows that never change between pipeline runs.
  db: () => load(),

  // Units a user may read, or null for state tier (no WHERE clause needed).
  scopeUnitIds: (user) => {
    if (!user || (user.roleMeta.tier === 'state' && !user.drilledFromState)) {
      return user && user.drillUnitId ? [user.drillUnitId] : null;
    }
    if (user.drillUnitId) return [user.drillUnitId];
    const db = load();
    const did = String(user.districtId);
    return Object.entries(db.lookups.unitDistrict)
      .filter(([, d]) => String(d) === did).map(([u]) => u);
  },

  stats: (user) => {
    const db = load();
    if (!user || (user.roleMeta.tier === 'state' && !user.drilledFromState)) return { ...db.stats, scope: 'state' };

    const rows = scoped(user, db.caseList);
    const ids = new Set(rows.map((c) => String(c.caseMasterId)));
    const status = { open: 0, chargeSheeted: 0, closed: 0, undetected: 0 };
    const heads = new Map();
    const trend = new Map();
    const heat = new Map();
    let heinous = 0;
    for (const c of rows) {
      const st = String(c.statusId);
      if (st === '1') status.open += 1;
      else if (st === '2') status.chargeSheeted += 1;
      else if (st === '4') status.undetected += 1;
      else status.closed += 1;
      if (String(c.gravityId) === '1') heinous += 1;
      const h = c.crimeHead || 'Other';
      heads.set(h, (heads.get(h) || 0) + 1);
      const m = String(c.crimeRegisteredDate || '').slice(0, 7);
      if (m) trend.set(m, (trend.get(m) || 0) + 1);
      if (c.dow !== undefined && c.hour !== undefined) {
        const k = `${c.dow}:${c.hour}`;
        heat.set(k, (heat.get(k) || 0) + 1);
      }
    }
    const health = db.healthList.filter((h) => ids.has(String(h.caseMasterId)));
    const did = String(user.districtId);
    const offs = db.offenders.filter((o) => (o.districts || []).map(String).includes(did));
    const zones = (db.zones && db.zones.stations) || [];

    return {
      scope: 'district',
      districtId: did,
      districtName: (rows[0] && rows[0].districtName) || '',
      totalCases: rows.length,
      openCases: status.open,
      chargeSheeted: status.chargeSheeted,
      undetected: status.undetected,
      flaggedCases: health.length,
      seriousFlaggedCases: health.filter((h) => h.severity === 'high').length,
      // Same definition as the state figure: offenders who operate with co-offenders.
      // Counting distinct case clusters instead gave 2,545 for one district against 127
      // state-wide, which is not a smaller number of the same thing.
      activeNetworks: offs.filter((o) => (o.coOffenders || []).length > 0).length,
      crossDistrictNetworks: offs.filter((o) => (o.distinctDistricts || 0) >= 2).length,
      resolvedOffenders: offs.length,
      highRiskOffenders: offs.filter((o) => o.band === 'High').length,
      emergingHotspots: zones.filter((z) => String(z.districtId) === did && z.zone === 'red_pulsing').length,
      caseAnomalies: db.stats.caseAnomalies,
      topCrimeHeads: [...heads.entries()].sort((a, b) => b[1] - a[1])
        .map(([name, count], i) => ({ headId: String(i + 1), name, count })),
      trend: [...trend.entries()].sort().map(([month, count]) => ({ month, count })),
      heat: [...heat.entries()].map(([k, count]) => {
        const [dow, hour] = k.split(':').map(Number);
        return { dow, hour, count };
      }),
      statusBreakdown: status,
      gravitySplit: { heinous, nonHeinous: rows.length - heinous },
      computedTs: db.stats.computedTs,
    };
  },
  // Association detection. The brief names this as its own capability -- "identifying hidden
  // criminal associations that are impossible to spot in isolated Excel sheets" -- and the
  // data was there on every offender record without a view of its own.
  //
  // Returns the co-offending network as pairs, ranked by how much the two share, with the
  // cross-district pairs surfaced first: those are precisely the associations no single
  // station's register can see.
  associations: (user, q = {}) => {
    const db = load();
    const byId = new Map(db.offenders.map((o) => [o.offenderIdentityId, o]));
    const districtScoped = user && (user.roleMeta.tier === 'district' || user.drilledFromState)
      ? String(user.districtId) : null;

    const seen = new Set();
    const pairs = [];
    for (const o of db.offenders) {
      for (const co of (o.coOffenders || [])) {
        const other = byId.get(co.offenderIdentityId);
        if (!other) continue;
        // one row per pair, not two
        const key = [o.offenderIdentityId, other.offenderIdentityId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        const dA = (o.districts || []).map(String);
        const dB = (other.districts || []).map(String);
        if (districtScoped && !dA.includes(districtScoped) && !dB.includes(districtScoped)) continue;

        const union = new Set([...dA, ...dB]);
        pairs.push({
          a: { id: o.offenderIdentityId, name: o.canonicalName, risk: o.riskScore, band: o.band,
            cases: o.distinctCases },
          b: { id: other.offenderIdentityId, name: other.canonicalName, risk: other.riskScore,
            band: other.band, cases: other.distinctCases },
          sharedCases: co.sharedCases || 1,
          districts: [...union],
          crossDistrict: union.size > 1,
          combinedRisk: Math.round(((o.riskScore || 0) + (other.riskScore || 0)) / 2),
        });
      }
    }
    if (q.crossDistrict === 'true') {
      return { items: pairs.filter((p) => p.crossDistrict), total: pairs.length };
    }
    // cross-district first, then by how much they operate together, then by risk
    pairs.sort((x, y) => (Number(y.crossDistrict) - Number(x.crossDistrict))
      || (y.sharedCases - x.sharedCases) || (y.combinedRisk - x.combinedRisk));

    const limit = Math.min(200, Number(q.limit) || 60);
    return {
      items: pairs.slice(0, limit),
      total: pairs.length,
      crossDistrictPairs: pairs.filter((p) => p.crossDistrict).length,
      scope: districtScoped ? 'district' : 'state',
      fairness: FAIRNESS_STATEMENT,
    };
  },

  // ---- tier-specific command views -------------------------------------------------
  // The two tiers do different jobs, so they get different panels rather than the same
  // panels with smaller numbers. State is strategic: which districts need attention, where
  // to move resources. District is operational: which of my stations, which of my cases,
  // and -- the part only this platform can offer -- which cases from ELSEWHERE are linked
  // into mine.

  // STATE: districts ranked, so the question "where do I put attention" is answerable.
  stateCommand: (user) => {
    const db = load();
    const zonesByDistrict = new Map(((db.zones || {}).districts || [])
      .map((z) => [String(z.districtId), z]));
    const health = new Map();
    for (const h of db.healthList) {
      const k = String(h.districtId);
      const e = health.get(k) || { flagged: 0, high: 0 };
      e.flagged += 1; if (h.severity === 'high') e.high += 1;
      health.set(k, e);
    }
    const offByDistrict = new Map();
    for (const o of db.offenders) {
      for (const d of (o.districts || [])) {
        const k = String(d);
        const e = offByDistrict.get(k) || { offenders: 0, crossDistrict: 0 };
        e.offenders += 1;
        if ((o.distinctDistricts || 0) >= 2) e.crossDistrict += 1;
        offByDistrict.set(k, e);
      }
    }
    const rows = (db.districtStats.districts || []).map((d) => {
      const k = String(d.districtId);
      const z = zonesByDistrict.get(k) || {};
      const h = health.get(k) || { flagged: 0, high: 0 };
      const o = offByDistrict.get(k) || { offenders: 0, crossDistrict: 0 };
      return {
        districtId: k, districtName: d.district, total: d.total, open: d.open,
        zone: z.zone || 'normal', changePct: z.changePct ?? 0, driverHead: z.driverHead || null,
        flagged: h.flagged, seriousFlags: h.high,
        offenders: o.offenders, crossDistrictOffenders: o.crossDistrict,
        topHead: (d.topHeads && d.topHeads[0] && d.topHeads[0].name) || '',
      };
    });
    // needs-attention first: zone severity, then how far above baseline
    const rank = { red_pulsing: 0, red: 1, yellow: 2, normal: 3 };
    rows.sort((a, b) => (rank[a.zone] - rank[b.zone]) || (b.changePct - a.changePct));
    return {
      districts: rows,
      zoneSummary: (db.zones || {}).summary || {},
      stationsPulsing: ((db.zones || {}).stations || []).filter((x) => x.zone === 'red_pulsing'),
      needsAttention: rows.filter((r) => r.zone !== 'normal').length,
    };
  },

  // DISTRICT: my stations, and what is reaching into my district from outside it.
  districtCommand: (user) => {
    const db = load();
    const did = String(user.districtId);
    const mine = db.caseList.filter((c) => String(c.districtId) === did);
    const mineIds = new Set(mine.map((c) => String(c.caseMasterId)));

    const byStation = new Map();
    for (const c of mine) {
      const k = String(c.unitId);
      const e = byStation.get(k) || { unitId: k, unitName: c.unitName || k, total: 0, open: 0, flagged: 0 };
      e.total += 1;
      if (String(c.statusId) === '1') e.open += 1;
      if (c.healthSeverity) e.flagged += 1;
      byStation.set(k, e);
    }
    const zoneByUnit = new Map(((db.zones || {}).stations || []).map((z) => [String(z.unitId), z]));
    const stations = [...byStation.values()].map((st) => {
      const z = zoneByUnit.get(st.unitId) || {};
      return { ...st, zone: z.zone || 'normal', changePct: z.changePct ?? 0 };
    });
    const rank = { red_pulsing: 0, red: 1, yellow: 2, normal: 3 };
    stations.sort((a, b) => (rank[a.zone] - rank[b.zone]) || (b.total - a.total));

    // The silo-breaking view: cases OUTSIDE my district that link to cases inside it. This
    // is the thing a station register structurally cannot show, and it is the reason the
    // platform exists.
    const linkedIn = [];
    const seen = new Set();
    for (const id of mineIds) {
      for (const e of (db.adjacency[id] || [])) {
        const nid = String(e.neighborId);
        if (mineIds.has(nid) || seen.has(nid)) continue;
        const nc = db.cases.get(nid);
        if (!nc) continue;
        seen.add(nid);
        linkedIn.push({
          caseMasterId: nid, crimeNo: nc.crimeNo,
          districtName: nc.districtName, unitName: nc.unitName,
          crimeSubHead: nc.crimeSubHead,
          edgeType: e.edgeType, strength: e.strength,
          linkedToLocalCase: id,
        });
      }
    }
    const strong = { shared_offender: 0, co_accused: 1, mo_similarity: 2 };
    linkedIn.sort((a, b) => (strong[a.edgeType] ?? 9) - (strong[b.edgeType] ?? 9));

    const stateTotal = db.stats.totalCases || 1;
    return {
      districtId: did,
      districtName: (mine[0] && mine[0].districtName) || '',
      stations,
      stationsFlagged: stations.filter((s) => s.zone !== 'normal').length,
      linkedInFromOtherDistricts: linkedIn.slice(0, 40),
      linkedInTotal: linkedIn.length,
      shareOfState: Math.round((mine.length / stateTotal) * 1000) / 10,
    };
  },

  occasions: () => load().occasions,   // calendar effects are state-level by nature
  // Zone board. State tier sees every district plus the station alerts; district tier sees
  // only its own district and the stations inside it -- the same two-tier rule as everywhere
  // else, applied to alerting.
  zones: (user) => {
    const db = load();
    const z = db.zones || { districts: [], stations: [], summary: {} };
    // Category rows are what make an alert nameable, so surface them at the top level too:
    // "Missing / UDR in Bengaluru City, 2.8 sigma above its own baseline" rather than a
    // district that is merely coloured.
    const alerts = (rows) => rows.flatMap((d) => (d.categories || []).map((c) => ({
      ...c, districtId: d.districtId, districtName: d.districtName, month: d.month,
    }))).sort((a, b) => b.z - a.z);

    if (user.roleMeta.tier === 'state' && !user.drilledFromState) {
      return { ...z, scope: 'state', alerts: alerts(z.districts) };
    }

    const did = String(user.districtId);
    const districts = z.districts.filter((d) => String(d.districtId) === did);
    const stations = z.stations.filter((s) => String(s.districtId) === did);

    // A district officer's summary must count THEIR STATIONS, not the one district they are.
    // Passing the state summary through is what made a drilled-in Shivamogga view report
    // "Normal 31" -- a state fact rendered under a district heading.
    //
    // zones.stations only carries non-normal entries, so the normal count has to come from
    // the district's real station roster rather than from the payload.
    const totalStations = new Set(
      db.caseList.filter((c) => String(c.districtId) === did).map((c) => String(c.unitId)),
    ).size;
    const tally = { red_pulsing: 0, red: 0, yellow: 0 };
    for (const s of stations) if (tally[s.zone] !== undefined) tally[s.zone] += 1;

    return {
      ...z,
      districts,
      stations,
      scope: 'district',
      scopedTo: did,
      unit: 'stations',
      alerts: alerts(districts),
      summary: {
        ...z.summary,
        ...tally,
        normal: Math.max(0, totalStations - tally.red_pulsing - tally.red - tally.yellow),
        totalStations,
      },
    };
  },
  // The full police-station roster, scoped to the viewer. Every station appears, including
  // quiet ones -- a list that only shows stations in trouble cannot answer "how is my
  // district doing overall", and an SI looking for their own station would not find it.
  stations: (user, q = {}) => {
    const db = load();
    let rows = db.stations || [];
    const narrowed = user && (user.roleMeta.scope !== 'state' || user.drilledFromState);
    if (narrowed) {
      const did = String(user.districtId);
      rows = rows.filter((r) => String(r.districtId) === did);
    }
    if (q.zone && q.zone !== 'all') rows = rows.filter((r) => r.zone === q.zone);
    if (q.q) {
      const needle = String(q.q).toLowerCase();
      rows = rows.filter((r) => (r.unitName || '').toLowerCase().includes(needle)
        || (r.districtName || '').toLowerCase().includes(needle));
    }
    const sort = q.sort || 'cases_desc';
    const cmp = {
      cases_desc: (a, b) => b.cases - a.cases,
      cases_asc: (a, b) => a.cases - b.cases,
      name: (a, b) => String(a.unitName).localeCompare(String(b.unitName)),
      // Severity first, then how far outside its own range it sits.
      zone: (a, b) => (ZONE_RANK[a.zone] - ZONE_RANK[b.zone]) || (b.zoneZ - a.zoneZ),
    }[sort] || ((a, b) => b.cases - a.cases);
    rows = [...rows].sort(cmp);
    const tally = { red_pulsing: 0, red: 0, yellow: 0, normal: 0 };
    for (const r of rows) if (tally[r.zone] !== undefined) tally[r.zone] += 1;
    return {
      items: rows,
      total: rows.length,
      scope: narrowed ? 'district' : 'state',
      districtId: narrowed ? String(user.districtId) : null,
      summary: tally,
      mappable: rows.filter((r) => r.lat != null).length,
    };
  },
  districtStats: () => load().districtStats,
  national: () => load().national,
  // Cases whose ego-network actually demonstrates the product: several shared-offender
  // links and more than one kind of evidence. Sorting the case list by raw link count
  // surfaces pure modus-operandi clusters instead, which all look identical.
  // Cases worth opening the graph on. Sorting by raw link count surfaces pure
  // modus-operandi clusters that all look identical -- twelve teal blobs of the same crime
  // type teach a viewer nothing. Selection therefore maximises VARIETY: different crime
  // heads, different evidence mixes, different network shapes. State scope returns ~20,
  // district scope ~12 drawn from that district only.
  featuredNetworks: (limit = 20, user = null) => {
    const db = load();
    const districtOnly = user && ((user.roleMeta && user.roleMeta.tier === 'district') || user.drilledFromState)
      ? String(user.districtId) : null;

    const cand = [];
    for (const [caseId, edges] of Object.entries(db.adjacency)) {
      if (!Array.isArray(edges) || !edges.length) continue;
      const c = db.cases.get(String(caseId));
      if (!c) continue;
      if (districtOnly && String(c.districtId) !== districtOnly) continue;
      let offenderLinks = 0;
      const signals = new Set();
      for (const e of edges) {
        if (e.edgeType === 'shared_offender') offenderLinks += 1;
        for (const t of (e.allTypes || [e.edgeType])) signals.add(t);
      }
      cand.push({
        caseMasterId: caseId,
        crimeNo: c.crimeNo,
        districtId: c.districtId,
        districtName: c.districtName || '',
        crimeHead: c.crimeHead || '',
        crimeSubHead: c.crimeSubHead || '',
        links: edges.length,
        offenderLinks,
        signalTypes: [...signals],
        // richness: evidence diversity first, then people, then raw size
        score: signals.size * 100 + Math.min(offenderLinks, 12) * 8 + Math.min(edges.length, 40),
      });
    }
    cand.sort((a, b) => b.score - a.score);

    // Round-robin across crime head, then across evidence-mix signature, so the picker
    // shows genuinely different networks rather than twenty of the strongest one kind.
    const byHead = new Map();
    for (const x of cand) {
      const k = x.crimeHead || 'Other';
      if (!byHead.has(k)) byHead.set(k, []);
      byHead.get(k).push(x);
    }
    const heads = [...byHead.keys()];
    const picked = [];
    const seenSig = new Set();
    for (let round = 0; picked.length < limit && round < 40; round += 1) {
      let addedThisRound = false;
      for (const h of heads) {
        if (picked.length >= limit) break;
        const list = byHead.get(h);
        while (list.length) {
          const x = list.shift();
          const sig = x.signalTypes.slice().sort().join('|');
          // allow a signature twice, so a common-but-real mix is not starved out
          const n = seenSig.has(sig) ? 2 : 0;
          if (n && round < 2) continue;
          seenSig.add(sig);
          picked.push({ ...x, why: `${x.offenderLinks} case(s) tied to the same resolved `
            + `offender, across ${x.signalTypes.length} kinds of evidence` });
          addedThisRound = true;
          break;
        }
      }
      if (!addedThisRound) break;
    }
    return {
      items: picked.slice(0, limit),
      scope: districtOnly ? 'district' : 'state',
      districtId: districtOnly,
      variety: {
        crimeHeads: new Set(picked.map((p) => p.crimeHead)).size,
        evidenceMixes: new Set(picked.map((p) => p.signalTypes.slice().sort().join('|'))).size,
      },
    };
  },
  // State tier gets the whole correlation picture. A district officer gets that plus where
  // THEY sit -- the "why here" question only has an answer relative to comparable places.
  // Previously this ignored `user` entirely, so the socio-economic capability was simply
  // hidden from district tier rather than answered for it.
  socio: (user) => {
    const base = load().socio;
    const narrowed = user && (user.roleMeta.scope !== 'state' || user.drilledFromState);
    if (!narrowed) return base;

    const did = String(user.districtId);
    const rows = base.districts || [];
    const me = rows.find((d) => String(d.districtId) === did);
    if (!me) return base;

    // Percentile among all 31, so "high" and "low" are stated rather than implied.
    const pct = (key) => {
      const vals = rows.map((d) => d[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
      if (!vals.length) return null;
      const below = vals.filter((v) => v < me[key]).length;
      return Math.round((100 * below) / vals.length);
    };

    // Peers are districts of the same urbanisation band. Comparing Bengaluru City with
    // Kodagu explains nothing -- they are different kinds of place. Comparing it with other
    // urban districts is the comparison an officer can actually act on.
    const peers = rows
      .filter((d) => d.band === me.band && String(d.districtId) !== did)
      .sort((a, b) => Math.abs(a.popDensity - me.popDensity) - Math.abs(b.popDensity - me.popDensity))
      .slice(0, 5)
      .map((d) => ({
        districtId: d.districtId, districtName: d.districtName,
        ratePer100k: d.ratePer100k, total: d.total, popDensity: d.popDensity,
      }));
    const peerRates = peers.map((p) => p.ratePer100k).filter((v) => typeof v === 'number');
    const peerMedian = peerRates.length
      ? peerRates.slice().sort((a, b) => a - b)[Math.floor(peerRates.length / 2)] : null;

    return {
      ...base,
      scope: 'district',
      focus: {
        ...me,
        percentiles: {
          ratePer100k: pct('ratePer100k'), urbanPct: pct('urbanPct'),
          literacyPct: pct('literacyPct'), popDensity: pct('popDensity'),
        },
        band: me.band,
        peers,
        peerMedianRate: peerMedian,
        vsPeerMedian: peerMedian != null
          ? Math.round((me.ratePer100k - peerMedian) * 10) / 10 : null,
      },
    };
  },
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
