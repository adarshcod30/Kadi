// queries.js — read queries over the store, with RBAC scoping + explanation payloads.
const { load } = require('./store.mock');
const rbac = require('./rbac');

// Zone severity order, shared wherever zones are ranked.
const ZONE_RANK = { red_pulsing: 0, red: 1, yellow: 2, normal: 3 };
// Case-health severity as a sortable number. Unflagged cases rank below every flagged one.
const SEVERITY_RANK = (s) => (s === 'high' ? 2 : s === 'medium' ? 1 : 0);
const { notFound, forbidden } = require('../lib/envelope');

const FAIRNESS_STATEMENT =
  'KADI links cases and scores offenders using evidence and behaviour only — never caste, religion, or occupation. These fields are excluded from every model by design.';

// Paging parsed from user-supplied query strings, which are not guaranteed to be numbers.
// parseInt('abc') is NaN, and NaN survives Math.max/Math.min untouched -- so a junk ?page=
// reached rows.slice(NaN, NaN) and returned an empty list, which reads as "no results" rather
// than as the bad input it is. `|| fallback` collapses NaN before any clamping happens.
function pageOf(q) { return Math.max(1, parseInt(q.page, 10) || 1); }
function pageSizeOf(q, fallback) { return Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || fallback)); }

// The scope label a response reports. Centralised because the three tiers now have to agree
// across every endpoint, and inlining the ternary in each was how a bad edit reached three
// call sites at once.
function scopeLabel(user, narrowed) {
  if (user && user.roleMeta && user.roleMeta.tier === 'station') return 'unit';
  return narrowed ? 'district' : 'state';
}

function scoped(user, list) {
  // The fast path must not skip a state user who has drilled into a district. This
  // short-circuit was defeating drill-down across every query that goes through here: the
  // response said scope=district while returning all 40,829 rows, because caseInScope --
  // which knows about the drill -- was never reached.
  const narrowed = user.roleMeta.scope !== 'state' || user.drilledFromState || user.drillUnitId;
  if (!narrowed) return list;
  return list.filter((c) => rbac.caseInScope(user, c));
}

// The register this officer is actually reading: the bundled corpus plus any case approved
// since the last pipeline run. Live rows are attached to the user by the route layer (see
// app.js `withLive`), so this stays synchronous and the fallback is simply "no live rows".
//
// Deliberately NOT applied to the derived surfaces -- linkage, health, hotspots, offenders --
// because those are pipeline output. A case nothing has analysed does not belong in a hotspot
// cluster or a health summary; it belongs in the register, flagged as awaiting analysis.
// corpusAsOf is excluded for a sharper reason: one case registered today would move the corpus
// clock forward and empty every "last 90 days" window in the product.
function universe(user) {
  const db = load();
  const live = (user && user._live) || [];
  return live.length ? live.concat(db.caseList) : db.caseList;
}

// ---------------- cases ----------------
// Filtering and sorting live apart from pagination so the intelligence layer can analyse the
// WHOLE filtered set. Reading a page and calling it the picture is how a "38% concentrated in
// three stations" finding becomes 38% of twenty-five rows.
function filterCases(user, q = {}) {
  let rows = scoped(user, universe(user));
  const { search, head, subhead, district, unit, status, gravity, category,
    dateFrom, dateTo, flagged, clusterId, severity, io, linked, sort = 'date_desc' } = q;

  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((c) =>
      c.crimeNo.includes(s) || (c.briefFacts || '').toLowerCase().includes(s) ||
      (c.crimeSubHead || '').toLowerCase().includes(s) || (c.unitName || '').toLowerCase().includes(s) ||
      // The IO is who a supervisor actually searches by when chasing a specific officer's
      // pendency, and it was the one indexed name the search could not reach.
      (c.ioName || '').toLowerCase().includes(s));
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
  if (severity) rows = rows.filter((c) => c.healthSeverity === String(severity));
  if (io) rows = rows.filter((c) => String(c.ioId) === String(io));
  // "Only cases that connect to something" is the whole premise of the product, and it was
  // the one thing the register could not be filtered down to.
  if (linked === 'true' || linked === true) rows = rows.filter((c) => (c.linkedCount || 0) > 0);
  if (dateFrom) rows = rows.filter((c) => c.crimeRegisteredDate >= dateFrom);
  if (dateTo) rows = rows.filter((c) => c.crimeRegisteredDate <= dateTo);

  const sorters = {
    date_desc: (a, b) => (a.crimeRegisteredDate < b.crimeRegisteredDate ? 1 : -1),
    date_asc: (a, b) => (a.crimeRegisteredDate > b.crimeRegisteredDate ? 1 : -1),
    linked_desc: (a, b) => b.linkedCount - a.linkedCount || (a.crimeRegisteredDate < b.crimeRegisteredDate ? 1 : -1),
    // Heinous first, then newest -- the order a supervisor triaging a register actually wants.
    gravity_desc: (a, b) => Number(a.gravityId) - Number(b.gravityId) || (a.crimeRegisteredDate < b.crimeRegisteredDate ? 1 : -1),
    severity_desc: (a, b) => SEVERITY_RANK(b.healthSeverity) - SEVERITY_RANK(a.healthSeverity)
      || (a.crimeRegisteredDate < b.crimeRegisteredDate ? 1 : -1),
    crimeno_asc: (a, b) => String(a.crimeNo).localeCompare(String(b.crimeNo)),
  };
  return { rows: rows.slice().sort(sorters[sort] || sorters.date_desc), sort: sorters[sort] ? sort : 'date_desc' };
}

// The officer's whole scope, unfiltered -- the denominator every "above the expected rate"
// finding is measured against.
function scopeBaseline(user) { return scoped(user, universe(user)); }

function listCases(user, q = {}) {
  const { rows, sort } = filterCases(user, q);
  const total = rows.length;
  const page = pageOf(q);
  const pageSize = pageSizeOf(q, 25);
  const items = rows.slice((page - 1) * pageSize, page * pageSize);
  // Counts for the whole filtered set, not just this page -- so the header can say what the
  // filter actually selected rather than what happened to land on page 1.
  const summary = {
    flagged: rows.reduce((n, c) => n + (c.healthSeverity ? 1 : 0), 0),
    highSeverity: rows.reduce((n, c) => n + (c.healthSeverity === 'high' ? 1 : 0), 0),
    linked: rows.reduce((n, c) => n + (c.linkedCount > 0 ? 1 : 0), 0),
    heinous: rows.reduce((n, c) => n + (String(c.gravityId) === '1' ? 1 : 0), 0),
  };
  return { items, total, page, pageSize, summary, sort };
}

function getCase(user, id) {
  const db = load();
  // An approved-but-unanalysed case exists only in the live rows, so look there before
  // declaring it missing -- otherwise the register lists a case whose detail page 404s.
  const c = db.cases.get(String(id))
    || ((user && user._live) || []).find((r) => String(r.caseMasterId) === String(id));
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
  // Was computed with only raw ids -- typeId, districtId -- and never rendered anywhere in
  // the client. Joined out to names here, plus the two flags (IsAccused,
  // IsComplainantAccused) that were generated with full referential integrity and dropped:
  // a complainant who is ALSO listed as accused is a real investigative flag (a fabricated
  // complaint, a mutual-combat case), not a detail to discard.
  const accusedNameById = new Map(
    (db.children.accused.get(kid) || []).map((a) => [String(a.AccusedMasterID), a.AccusedName]),
  );
  const arrests = (db.children.arrests.get(kid) || []).map((r) => ({
    date: r.ArrestSurrenderDate,
    typeId: r.ArrestSurrenderTypeID,
    typeLabel: (db.lookups.arrestSurrenderTypes.get(String(r.ArrestSurrenderTypeID)) || {}).LookupValue || '',
    districtId: r.ArrestSurrenderDistrictId,
    districtName: (db.lookups.districts.get(String(r.ArrestSurrenderDistrictId)) || {}).DistrictName || '',
    accusedMasterId: r.AccusedMasterID,
    accusedName: accusedNameById.get(String(r.AccusedMasterID)) || '',
    isAccused: r.IsAccused === '1',
    isComplainantAccused: r.IsComplainantAccused === '1',
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
      // So the graph's "Map" button can fly straight to and pin this exact incident,
      // instead of dropping the viewer on the state-wide view with no idea where to look.
      latitude: c.latitude, longitude: c.longitude,
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
  const tier = user && user.roleMeta ? user.roleMeta.tier : null;

  // Station tier: the watchlist must narrow to people who actually appear in THIS station's
  // register. It was falling through to the state list because the narrowing test only knew
  // about the district tier -- an SHO saw 276 cases and all 578 offenders, which is both a
  // scoping hole and the opposite of the point the station view exists to make.
  if (tier === 'station' && user.unitId) {
    const db2 = load();
    const mine = new Set();
    for (const c of db2.caseList) if (String(c.unitId) === String(user.unitId)) mine.add(String(c.caseMasterId));
    rows = rows.filter((o) => (o.caseIds || []).some((id) => mine.has(String(id))));
    // Reach is the finding here: someone with cases at this station AND elsewhere is exactly
    // what a single register cannot show, so it is computed rather than left to be inferred.
    rows = rows.map((o) => {
      const here = (o.caseIds || []).filter((id) => mine.has(String(id))).length;
      return { ...o, casesAtMyStation: here, casesElsewhere: (o.distinctCases || 0) - here };
    });
    if (q.origin === 'visiting') rows = rows.filter((o) => o.casesElsewhere > 0);
    if (q.origin === 'local') rows = rows.filter((o) => o.casesElsewhere === 0);
  }

  const narrowed = user && (tier === 'district' || user.drilledFromState);
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
  // Operates with co-offenders -- a group, not a lone repeat offender. Same definition the
  // dashboard's "active networks" figure uses, so the two agree.
  if (q.networked === 'true') rows = rows.filter((o) => (o.coOffenders || []).length > 0);
  if (q.lowConfidence === 'true') rows = rows.filter((o) => o.lowConfidence);
  // "Still active" is the question that decides whether a watchlist entry is worth acting on
  // today. Measured against the corpus's own latest activity rather than wall-clock now, so
  // it stays meaningful no matter when the demo is run.
  if (q.activeDays) {
    const cutoff = daysBefore(offenderAsOf(db), Number(q.activeDays));
    if (cutoff) rows = rows.filter((o) => o.lastSeen && o.lastSeen >= cutoff);
  }
  if (q.search) {
    const s = String(q.search).toLowerCase();
    // Variants are the point of entity resolution: someone searching an alias should find the
    // identity it resolved into, not nothing.
    rows = rows.filter((o) => o.canonicalName.toLowerCase().includes(s)
      || (o.nameVariants || []).some((v) => String(v).toLowerCase().includes(s)));
  }

  const sorters = {
    risk_desc: (a, b) => (b.riskScore || 0) - (a.riskScore || 0),
    risk_asc: (a, b) => (a.riskScore || 0) - (b.riskScore || 0),
    cases_desc: (a, b) => (b.distinctCases || 0) - (a.distinctCases || 0) || (b.riskScore || 0) - (a.riskScore || 0),
    districts_desc: (a, b) => (b.distinctDistricts || 0) - (a.distinctDistricts || 0) || (b.riskScore || 0) - (a.riskScore || 0),
    arrests_desc: (a, b) => (b.arrestCount || 0) - (a.arrestCount || 0) || (b.riskScore || 0) - (a.riskScore || 0),
    network_desc: (a, b) => (b.coOffenders || []).length - (a.coOffenders || []).length || (b.riskScore || 0) - (a.riskScore || 0),
    recent_desc: (a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || (b.riskScore || 0) - (a.riskScore || 0),
    name_asc: (a, b) => String(a.canonicalName).localeCompare(String(b.canonicalName)),
  };
  const sort = sorters[q.sort] ? q.sort : 'risk_desc';
  rows = rows.slice().sort(sorters[sort]);

  const total = rows.length;
  const page = pageOf(q);
  const pageSize = pageSizeOf(q, 50);
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, sort,
    scope: tier === 'station' ? 'unit' : (narrowed ? 'district' : 'state'),
    reachingIn: tier === 'station'
      ? rows.filter((o) => o.casesElsewhere > 0).length
      : (narrowed ? rows.filter((o) => o.reachesIn).length : null),
    basedHere: tier === 'station'
      ? rows.filter((o) => o.casesElsewhere === 0).length
      : (narrowed ? rows.filter((o) => o.basedHere).length : null),
    // Whole-filtered-set counts, so the summary describes the selection rather than the page.
    summary: {
      high: rows.reduce((n, o) => n + (o.band === 'High' ? 1 : 0), 0),
      crossDistrict: rows.reduce((n, o) => n + ((o.distinctDistricts || 0) >= 2 ? 1 : 0), 0),
      networked: rows.reduce((n, o) => n + ((o.coOffenders || []).length ? 1 : 0), 0),
      needsReview: rows.reduce((n, o) => n + (o.lowConfidence ? 1 : 0), 0),
    },
    asOf: offenderAsOf(db),
    fairness: FAIRNESS_STATEMENT,
  };
}

// The corpus's own latest offending date. Cached on the db object because it is a scan over
// every identity and the underlying bundle is immutable for the container's lifetime.
function offenderAsOf(db) {
  if (db.__offenderAsOf === undefined) {
    let max = null;
    for (const o of db.offenders) if (o.lastSeen && (!max || o.lastSeen > max)) max = o.lastSeen;
    db.__offenderAsOf = max;
  }
  return db.__offenderAsOf;
}

function daysBefore(isoDate, days) {
  if (!isoDate || !Number.isFinite(days)) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
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

// ---------------- statutory deadline clock ----------------
//
// Health measures a case against its PEER MEDIAN -- useful, but a comparison, not a deadline.
// Nothing on screen tells an officer what the law actually requires. This computes that.
//
// Under the BNSS the chargesheet clock is tied to custody: 90 days for offences punishable
// with death, life, or over ten years, and 60 days otherwise, counted from the date of
// arrest. The corpus carries no punishment field on a section, so GRAVITY is used as a
// documented PROXY -- Heinous stands in for the ten-year test. That inference is stated on
// screen wherever the number appears; it is an indicator, not legal advice, and the exact
// mapping is flagged for KSP confirmation.
//
// Only open cases with a recorded arrest have a running clock -- the custody deadline starts
// at arrest, and a chargesheeted or closed case has already stopped it.
const HEINOUS_DAYS = 90;
const OTHER_DAYS = 60;
function dayDiff(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// The band a countdown falls in. Kept separate from health severity: a case can be perfectly
// healthy by peer comparison and still be four days from a statutory breach.
function deadlineBand(daysRemaining) {
  if (daysRemaining == null) return null;
  if (daysRemaining < 0) return 'breached';
  if (daysRemaining <= 7) return 'critical';
  if (daysRemaining <= 21) return 'soon';
  return 'ok';
}
// Returns the clock for one case, or null when no clock runs (already disposed).
//
// THE ANCHOR. In the ideal case the clock runs from arrest — that is the custody deadline. But
// this corpus never models "arrested, chargesheet pending": an arrest only ever appears on a
// case that has already moved to chargesheeted or closed, so no open case carries one. The
// clock that actually matters for an open case is therefore the INVESTIGATION timeline, run
// from the registration date — which BNSS s.193 also governs (investigation concluded and the
// informant updated within the window). So: anchor on the earliest arrest when one exists
// (custody basis), otherwise on registration (investigation basis), and say which on screen.
function caseDeadline(db, c) {
  if (!c) return null;
  if (String(c.statusId) !== '1') return null;            // only Under Investigation
  const arrests = db.children.arrests.get(String(c.caseMasterId)) || [];
  let arrestDate = null;
  for (const a of arrests) {
    const d = a.ArrestSurrenderDate;
    if (d && (!arrestDate || d < arrestDate)) arrestDate = d;
  }
  const basis = arrestDate ? 'custody' : 'investigation';
  const anchor = arrestDate || c.crimeRegisteredDate;
  if (!anchor) return null;
  const heinous = c.gravity === 'Heinous';
  const allowed = heinous ? HEINOUS_DAYS : OTHER_DAYS;
  const dueDate = addDays(anchor, allowed);
  const asOf = corpusAsOf(db);
  const daysRemaining = asOf ? dayDiff(asOf, dueDate) : null;
  return {
    hasClock: true, basis, anchorDate: anchor, arrestDate, dueDate, allowedDays: allowed,
    gravity: c.gravity, heinous, daysRemaining, band: deadlineBand(daysRemaining),
  };
}
// The station deadline board: every open, arrested case in scope, soonest first. This is the
// single most actionable list in the product -- it is a queue of legal obligations with dates.
function deadlines(user, q = {}) {
  const db = load();
  const rows = [];
  for (const c of scoped(user, db.caseList)) {
    const dl = caseDeadline(db, c);
    if (!dl) continue;
    if (q.band && q.band !== 'all' && dl.band !== q.band) continue;
    rows.push({
      caseMasterId: c.caseMasterId, crimeNo: c.crimeNo, crimeSubHead: c.crimeSubHead,
      crimeHead: c.crimeHead, district: c.districtName, unit: c.unitName, ioName: c.ioName,
      status: c.status, ...dl,
    });
  }
  rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));
  const tally = { breached: 0, critical: 0, soon: 0, ok: 0 };
  for (const r of rows) tally[r.band] += 1;
  const page = pageOf(q);
  const pageSize = pageSizeOf(q, 30);
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length, page, pageSize, tally,
    method: 'Chargesheet deadline inferred from recorded gravity (Heinous → 90 days, '
      + 'otherwise → 60), counted from the earliest arrest. A proxy for the BNSS custody test, '
      + 'which turns on the punishment the offence carries — an indicator, not legal advice.',
  };
}

// Status × crime-head crosstab over the scoped universe, for the linked double pie on Home.
// Independent status and head distributions cannot answer "which crime types are driving the
// undetected pile" — that needs the joint counts, so this computes them at request time.
function statusHeadMix(user) {
  const db = load();
  const STATUS = { 1: 'Under Investigation', 2: 'Charge-sheeted', 3: 'Closed', 4: 'Undetected' };
  const statusTotals = {};
  const headTotals = {};
  const matrix = {};      // matrix[statusId][head] = count
  for (const c of scoped(user, universe(user))) {
    const sid = String(c.statusId);
    const head = c.crimeHead || 'Other';
    statusTotals[sid] = (statusTotals[sid] || 0) + 1;
    headTotals[head] = (headTotals[head] || 0) + 1;
    (matrix[sid] = matrix[sid] || {})[head] = (matrix[sid][head] || 0) + 1;
  }
  const heads = Object.entries(headTotals).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const statuses = Object.keys(STATUS).map((sid) => ({ id: sid, name: STATUS[sid], count: statusTotals[sid] || 0 }))
    .filter((s) => s.count > 0);
  return { statuses, heads, matrix, total: scoped(user, universe(user)).length };
}

// Where a district stands among the 31, by both raw count and rate per 100k. Returned to
// district-scoped callers so a chart can say "7th of 31, and 3rd per capita" instead of
// handing over a state total the officer has to place themselves.
let _rankCache;
function districtRankContext(db, did) {
  if (!_rankCache) {
    const stats = (db.districtStats && db.districtStats.districts) || [];
    const byCount = [...stats].sort((a, b) => (b.total || b.count || 0) - (a.total || a.count || 0));
    const socio = (db.socio && db.socio.districts) || [];
    const byRate = [...socio].sort((a, b) => (b.ratePer100k || 0) - (a.ratePer100k || 0));
    const countRank = new Map(); byCount.forEach((d, i) => countRank.set(String(d.districtId), i + 1));
    const rateRank = new Map(); byRate.forEach((d, i) => rateRank.set(String(d.districtId), i + 1));
    const rateById = new Map(socio.map((d) => [String(d.districtId), d.ratePer100k]));
    _rankCache = { countRank, rateRank, rateById, total: Math.max(byCount.length, byRate.length, 31) };
  }
  const r = _rankCache;
  return {
    rankByCount: r.countRank.get(String(did)) || null,
    rankByRate: r.rateRank.get(String(did)) || null,
    ratePer100k: r.rateById.get(String(did)) ?? null,
    ofDistricts: r.total,
  };
}

// ---------------- near-repeat (Where, P4-2) ----------------
//
// One of the most replicated findings in crime science: after a burglary or theft, the risk to
// nearby addresses is elevated for a short window afterward — the "near-repeat" pattern. It is
// what turns a hotspot from an observation ("crime clusters here") into an instruction ("having
// just had one, watch these streets for the next fortnight"). This measures it directly.
//
// Computed over the emerging-hotspot clusters only, not the whole corpus: each cluster carries
// tens of cases, so the pairwise pass is cheap, and a cluster is exactly where the pattern
// matters. For each incident, is there a PRIOR incident in the same cluster within R metres and
// D days? The share that are is the near-repeat rate; a rate well above what a random reshuffle
// of the same dates would give is the signal.
function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat); const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function nearRepeat(user, q = {}) {
  const db = load();
  const R = Number(q.radiusM) || 400;      // "near" — a couple of streets
  const D = Number(q.days) || 14;          // "soon" — the classic near-repeat window
  const scopedIds = user && user.roleMeta.tier !== 'state'
    ? new Set(scoped(user, db.caseList).map((c) => String(c.caseMasterId))) : null;
  const clusters = (db.hotspots.hotspots || []).filter((h) => h.emergingFlag);
  const out = [];
  for (const h of clusters) {
    if (scopedIds && !(h.caseIds || []).some((id) => scopedIds.has(String(id)))) continue;
    const pts = (h.caseIds || []).map((id) => db.cases.get(String(id)))
      .filter((c) => c && c.latitude && c.longitude && c.incidentFromDate)
      .map((c) => ({ t: new Date(`${c.incidentFromDate.slice(0, 10)}T00:00:00Z`).getTime(), lat: c.latitude, lng: c.longitude }))
      .sort((a, b) => a.t - b.t);
    if (pts.length < 6) continue;
    let repeats = 0;
    let sumGapDays = 0; let gapN = 0;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const gap = (pts[i].t - pts[j].t) / 86400000;
        if (gap > 0 && gap <= D && haversineM(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng) <= R) {
          repeats += 1; sumGapDays += gap; gapN += 1; break;   // count each follow-on once
        }
      }
    }
    const rate = Math.round((repeats / pts.length) * 100);
    if (rate < 15) continue;   // only clusters where the pattern is actually present
    out.push({
      cellId: h.cellId, districtId: String(h.districtId),
      districtName: (db.lookups.districts.get(String(h.districtId)) || {}).DistrictName || `District ${h.districtId}`,
      incidents: pts.length, repeats, repeatRatePct: rate,
      medianGapDays: gapN ? Math.round(sumGapDays / gapN) : null,
      centroidLat: h.centroidLat, centroidLng: h.centroidLng,
    });
  }
  out.sort((a, b) => b.repeatRatePct - a.repeatRatePct);
  return {
    radiusM: R, windowDays: D, clusters: out.slice(0, 12),
    method: `A near-repeat is an incident with a prior incident in the same cluster within ${R} m `
      + `and ${D} days. The rate is the share of a cluster's incidents that follow an earlier one `
      + 'so closely — a signal that the location is being re-targeted, not merely busy.',
  };
}

// ---------------- reporting propensity (Why, P4-3) ----------------
//
// The strongest confounder in any crime-RATE comparison, and one the corpus can measure: the
// gap between when an incident happened and when the FIR was registered. A district that reports
// faster and more completely will show a higher rate for the same underlying crime — so before
// concluding "more urban = more crime", you have to see whether urban districts simply report
// more of it. This gives the Why tab a driver built on evidence, not assertion.
function reportingPropensity(user) {
  const db = load();
  const rows = user && user.roleMeta.tier === 'state' ? db.caseList : scoped(user, db.caseList);
  const byDistrict = new Map();
  for (const c of rows) {
    if (!c.incidentFromDate || !c.infoReceivedPSDate) continue;
    const inc = new Date(`${c.incidentFromDate.slice(0, 10)}T00:00:00Z`).getTime();
    const rep = new Date(`${c.infoReceivedPSDate.slice(0, 10)}T00:00:00Z`).getTime();
    const days = (rep - inc) / 86400000;
    if (days < 0 || days > 365) continue;
    const k = String(c.districtId);
    if (!byDistrict.has(k)) byDistrict.set(k, { name: c.districtName, delays: [] });
    byDistrict.get(k).delays.push(days);
  }
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const districts = [...byDistrict.entries()].map(([districtId, v]) => ({
    districtId, districtName: v.name, medianDelayDays: Math.round(median(v.delays) * 10) / 10,
    sameDayPct: Math.round((v.delays.filter((d) => d <= 1).length / v.delays.length) * 100), n: v.delays.length,
  })).sort((a, b) => a.medianDelayDays - b.medianDelayDays);
  const all = [].concat(...[...byDistrict.values()].map((v) => v.delays));
  return {
    districts,
    stateMedianDelayDays: all.length ? Math.round(median(all) * 10) / 10 : null,
    method: 'Reporting delay is the gap between the incident date on the FIR and the date the '
      + 'police received the information. A district that reports faster records more of the same '
      + 'crime, so a lower delay inflates its measured rate — which is why a rate comparison must '
      + 'account for it before reading urbanisation as cause.',
  };
}

// ---------------- scope profile (the "Why" for a district or a station) ----------------
//
// "Why is crime distributed like this across Karnataka" is a state question, answered by the
// socio-economic correlation. It is NOT the question an SP or an SHO asks. Theirs is "why does
// MY register look like this" — and the only honest way to answer it is to compare their own
// composition against the tier above them, because a number with nothing beside it explains
// nothing. A station that is 60% property crime is unremarkable if its district is too, and
// worth a briefing if the district is 30%.
//
// So this returns the reader's own mix, clearance and reporting speed set against their parent:
// a station against its district, a district against the state.
function scopeProfile(user) {
  const db = load();
  const tier = (user.roleMeta && user.roleMeta.tier) || 'state';
  const drilledUnit = user.drillUnitId;
  const isStation = tier === 'station' || Boolean(drilledUnit);
  const unitId = String(drilledUnit || user.unitId || '');
  const districtId = String(user.districtId || '');

  // The reader's own rows, and the rows of the tier above them.
  let mine; let parent; let mineName; let parentName; let mineLabel; let parentLabel;
  if (isStation) {
    mine = db.caseList.filter((c) => String(c.unitId) === unitId);
    parent = db.caseList.filter((c) => String(c.districtId) === String(mine[0]?.districtId || districtId));
    mineName = mine[0]?.unitName || 'This station';
    parentName = mine[0]?.districtName || 'its district';
    mineLabel = 'station'; parentLabel = 'district';
  } else if (tier === 'district' || user.drilledFromState) {
    mine = db.caseList.filter((c) => String(c.districtId) === districtId);
    parent = db.caseList;
    mineName = mine[0]?.districtName || 'This district';
    parentName = 'Karnataka';
    mineLabel = 'district'; parentLabel = 'state';
  } else {
    return { available: false, reason: 'The state has no tier above it to compare against — read the socio-economic correlation instead.' };
  }
  if (!mine.length) return { available: false, reason: 'No cases in this scope.' };

  // Crime-head composition, as SHARES, then the lift of mine over the parent's. Shares rather
  // than counts because the two populations differ by an order of magnitude.
  const share = (rows) => {
    const m = new Map();
    for (const c of rows) m.set(c.crimeHead || 'Other', (m.get(c.crimeHead || 'Other') || 0) + 1);
    const total = rows.length || 1;
    return { map: m, pct: (h) => ((m.get(h) || 0) / total) * 100 };
  };
  const a = share(mine); const b = share(parent);
  const heads = [...new Set([...a.map.keys()])];
  const headMix = heads.map((h) => {
    const minePct = a.pct(h); const parentPct = b.pct(h);
    return {
      head: h, count: a.map.get(h) || 0,
      minePct: Math.round(minePct * 10) / 10,
      parentPct: Math.round(parentPct * 10) / 10,
      // How many times over-represented. 1.0 means exactly the parent's share.
      lift: parentPct > 0 ? Math.round((minePct / parentPct) * 100) / 100 : null,
    };
  }).sort((x, y) => y.count - x.count);

  const clearance = (rows) => {
    const cs = rows.filter((c) => String(c.statusId) === '2').length;
    return rows.length ? Math.round((cs / rows.length) * 1000) / 10 : 0;
  };
  const medianDelay = (rows) => {
    const d = [];
    for (const c of rows) {
      if (!c.incidentFromDate || !c.infoReceivedPSDate) continue;
      const days = (new Date(`${c.infoReceivedPSDate.slice(0, 10)}T00:00:00Z`).getTime()
        - new Date(`${c.incidentFromDate.slice(0, 10)}T00:00:00Z`).getTime()) / 86400000;
      if (days >= 0 && days <= 365) d.push(days);
    }
    if (!d.length) return null;
    d.sort((x, y) => x - y);
    const m = Math.floor(d.length / 2);
    return Math.round((d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2) * 10) / 10;
  };
  const flagged = (rows) => {
    const ids = new Set(rows.map((c) => String(c.caseMasterId)));
    const h = db.healthList.filter((x) => ids.has(String(x.caseMasterId)));
    return rows.length ? Math.round((h.length / rows.length) * 1000) / 10 : 0;
  };

  return {
    available: true,
    mineLabel, parentLabel, mineName, parentName,
    totals: { mine: mine.length, parent: parent.length,
      shareOfParent: parent.length ? Math.round((mine.length / parent.length) * 1000) / 10 : 0 },
    headMix,
    // Three comparisons an officer is actually judged on.
    metrics: [
      { key: 'clearance', label: 'Charge-sheet rate', mine: clearance(mine), parent: clearance(parent), unit: '%', higherIsBetter: true,
        note: 'Share of registered FIRs that reached a charge sheet.' },
      { key: 'flagged', label: 'Cases carrying a health flag', mine: flagged(mine), parent: flagged(parent), unit: '%', higherIsBetter: false,
        note: 'Share flagged by the pipeline for ageing, pendency or undetected-risk.' },
      { key: 'delay', label: 'Median reporting delay', mine: medianDelay(mine), parent: medianDelay(parent), unit: 'd', higherIsBetter: false,
        note: 'Gap between the incident date on the FIR and the date police received the information. A longer delay depresses the measured rate.' },
    ],
    method: 'Composition is compared as SHARES, not counts, because the two populations differ by '
      + 'an order of magnitude. Lift is this scope’s share divided by the parent’s: 1.0 means '
      + 'identical to the tier above, 2.0 means twice as concentrated here. Nothing on this panel '
      + 'reads caste, religion or occupation.',
  };
}

// ---------------- concentration (the state "Where", read strategically) ----------------
//
// "Which district is worst" is the question a count map answers and it is the wrong one, because
// the answer is always the most populous district. The strategic question underneath it is
// WHERE THE CONCENTRATION ACTUALLY LIVES — because that decides whether the lever is moving
// resources between areas or working differently inside them.
//
// Measured at three grains, which disagree in a way that is itself the finding:
//   districts  heavily skewed — but that skew is population, and per-capita erases most of it
//   stations   near-uniform once you are inside the administrative layer
//   clusters   skewed again, tightly, at sub-station geography
//
// A DGP reading that should conclude: do not reallocate between stations on volume; the
// actionable concentration is below them.
function concentrationCurve(values) {
  const v = [...values].filter((x) => x > 0).sort((a, b) => b - a);
  const total = v.reduce((a, b) => a + b, 0);
  if (!total || v.length < 4) return null;
  const at = (pct) => {
    const n = Math.max(1, Math.round(v.length * pct));
    return { topPct: Math.round(pct * 100), units: n,
      sharePct: Math.round((v.slice(0, n).reduce((a, b) => a + b, 0) / total) * 1000) / 10 };
  };
  // Gini over the units, as a single summary of how uneven the load is.
  const asc = [...v].sort((a, b) => a - b);
  let cum = 0; let weighted = 0;
  for (let i = 0; i < asc.length; i += 1) { cum += asc[i]; weighted += cum; }
  const gini = Math.round((1 - (2 * weighted) / (asc.length * total) + 1 / asc.length) * 1000) / 1000;
  return { units: v.length, total, gini, points: [0.05, 0.1, 0.2, 0.5].map(at) };
}
function concentration(user) {
  const db = load();
  const narrowed = user && (user.roleMeta.scope !== 'state' || user.drilledFromState);

  const districts = narrowed ? null
    : concentrationCurve((db.districtStats.districts || []).map((d) => d.total || d.count || 0));
  const stationRows = (db.stations || []).filter((s) => !narrowed || String(s.districtId) === String(user.districtId));
  const stations = concentrationCurve(stationRows.map((s) => s.cases || 0));
  const clusterRows = (db.hotspots.hotspots || [])
    .filter((h) => !narrowed || String(h.districtId) === String(user.districtId));
  const clusters = concentrationCurve(clusterRows.map((h) => h.count || 0));

  // The reading. Stated from the numbers rather than asserted, so it stays true if the corpus
  // changes: if stations ARE concentrated the sentence flips on its own.
  let reading = null;
  if (stations && clusters) {
    const stTop = stations.points.find((p) => p.topPct === 10);
    const clTop = clusters.points.find((p) => p.topPct === 10);
    const evenStations = stTop && stTop.sharePct < stTop.topPct * 1.5;
    reading = evenStations
      ? `The busiest ${stTop.topPct}% of stations carry only ${stTop.sharePct}% of the load — `
        + 'across the administrative layer the caseload is close to even, so moving resource '
        + `between stations on volume alone buys little. The concentration is below them: the top `
        + `${clTop.topPct}% of spatial clusters hold ${clTop.sharePct}% of clustered incidents.`
      : `The busiest ${stTop.topPct}% of stations carry ${stTop.sharePct}% of the load — the `
        + 'administrative layer is genuinely uneven, so station-level reallocation is a real lever.';
  }

  return {
    scope: scopeLabel(user, narrowed),
    districts, stations, clusters, reading,
    method: 'Each curve is the share of recorded crime held by the busiest N% of units at that '
      + 'grain, plus a Gini coefficient: 0 is perfectly even, 1 is all load in one unit. District '
      + 'volume is not corrected for population here — the per-capita ranking on this tab is what '
      + 'separates size from risk.',
  };
}

// ---------------- health ----------------
function filterHealth(user, q = {}) {
  const db = load();
  const scopedCases = new Set(scoped(user, db.caseList).map((c) => c.caseMasterId));
  let rows = db.healthList.filter((h) => scopedCases.has(String(h.caseMasterId)));
  if (q.severity) rows = rows.filter((h) => h.severity === q.severity);
  if (q.flag) rows = rows.filter((h) => h.flagKeys.includes(q.flag));
  if (q.district) rows = rows.filter((h) => String(h.districtId) === String(q.district));
  if (q.unit) rows = rows.filter((h) => String(h.unitId) === String(q.unit));
  return rows;
}

function listHealth(user, q = {}) {
  const db = load();
  const rows = filterHealth(user, q);
  const enrich = (h) => {
    const c = db.cases.get(String(h.caseMasterId));
    const dl = caseDeadline(db, c);
    return { ...h, crimeSubHead: c ? c.crimeSubHead : '', district: c ? c.districtName : '',
      unit: c ? c.unitName : '', ioName: c ? c.ioName : '', gravity: c ? c.gravity : '',
      // The statutory clock rides along on every health row, so the worklist can sort or
      // colour by it without a second request. Null when no clock runs.
      deadline: dl };
  };
  let all = rows.map(enrich);
  // Deadline-first ordering, opt-in via ?sort=deadline. Cases with a running clock rise to the
  // top, soonest due first; everything without a clock keeps the pipeline's health order below.
  if (q.sort === 'deadline') {
    all = all.sort((a, b) => {
      const ax = a.deadline ? (a.deadline.daysRemaining ?? 1e9) : 1e9 + 1;
      const bx = b.deadline ? (b.deadline.daysRemaining ?? 1e9) : 1e9 + 1;
      return ax - bx;
    });
  } else if (q.sort === 'age') {
    all = all.sort((a, b) => (b.investigationAgeDays || 0) - (a.investigationAgeDays || 0));
  }
  const total = all.length;
  const page = pageOf(q);
  const pageSize = pageSizeOf(q, 30);
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
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
  // Deadline tally across the whole scope (not just flagged cases): a case can be perfectly
  // healthy and still be days from a statutory breach, so this counts every open arrested case.
  const dlTally = { breached: 0, critical: 0, soon: 0, running: 0 };
  for (const c of scoped(user, db.caseList)) {
    const dl = caseDeadline(db, c);
    if (!dl) continue;
    dlTally.running += 1;
    if (dl.band === 'breached') dlTally.breached += 1;
    else if (dl.band === 'critical') dlTally.critical += 1;
    else if (dl.band === 'soon') dlTally.soon += 1;
  }
  return {
    flaggedTotal: rows.length,
    high: rows.filter((h) => h.severity === 'high').length,
    medium: rows.filter((h) => h.severity === 'medium').length,
    byFlag,
    avgInvestigationAge: ageN ? Math.round(ageSum / ageN) : 0,
    anomalies: db.caseAnomalies.stationAnomalies || [],
    deadlines: dlTally,
  };
}

// ---------------- geo ----------------
// "Last N days", measured against the corpus's own latest registration rather than wall-clock
// now. A fixed synthetic corpus would otherwise return nothing for "last week" the moment the
// demo runs a month after generation.
let _corpusAsOf;
function corpusAsOf(db) {
  if (_corpusAsOf === undefined) {
    let max = null;
    for (const c of db.caseList) if (c.crimeRegisteredDate && (!max || c.crimeRegisteredDate > max)) max = c.crimeRegisteredDate;
    _corpusAsOf = max;
  }
  return _corpusAsOf;
}
function cutoffFor(db, days) {
  const n = parseInt(days, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const asOf = corpusAsOf(db);
  if (!asOf) return null;
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function geoPoints(user, q = {}) {
  const db = load();
  // Spatial view is state-wide crime-pattern intelligence (aggregate dots), not per-case
  // detail — shown to all analytical roles; individual case detail stays RBAC-scoped.
  //
  // The station tier is the exception. Its entire purpose is to show how little one register
  // holds, so handing it a state-wide dot map would contradict the view it demonstrates.
  let rows = universe(user).filter((c) => c.latitude && c.longitude);
  if (user && user.roleMeta && user.roleMeta.tier === 'station') {
    rows = rows.filter((c) => String(c.unitId) === String(user.unitId));
  }
  if (q.head) rows = rows.filter((c) => c.crimeHeadId === String(q.head));
  if (q.district) rows = rows.filter((c) => c.districtId === String(q.district));
  if (q.dateFrom) rows = rows.filter((c) => c.crimeRegisteredDate >= q.dateFrom);
  // Filtered here rather than in the client so the even-sampling below draws from the chosen
  // period. Sampling first and filtering after would return a thin, unrepresentative slice.
  const cut = cutoffFor(db, q.days);
  if (cut) rows = rows.filter((c) => c.crimeRegisteredDate >= cut);
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
  return { items, total: rows.length, districtCounts: db.hotspots.districtCounts || {}, periodFrom: cut || null };
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
  const gcut = cutoffFor(db, q.days);
  for (const c of db.caseList) {
    if (!c.latitude || !c.longitude) continue;
    if (q.head && c.crimeHeadId !== String(q.head)) continue;
    if (gcut && c.crimeRegisteredDate < gcut) continue;
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
  // A station desk gets ITS OWN clusters, not the district's. geoPoints already filters to the
  // unit at station tier and this was the inconsistency: the dot map showed one station's
  // incidents while the hotspot list beside it showed the whole district's, which is not
  // "where crime happens" for the officer reading it.
  const unitId = user && (user.drillUnitId || (user.roleMeta.tier === 'station' ? user.unitId : null));
  if (unitId) {
    hs = hs.filter((h) => (h.caseIds || []).some((id) => {
      const c = db.cases.get(String(id));
      return c && String(c.unitId) === String(unitId);
    }));
  }
  if (q.emerging === 'true') hs = hs.filter((h) => h.emergingFlag);
  if (q.window) hs = hs.filter((h) => h.temporal && h.temporal.peakWindow === q.window);

  return {
    hotspots: hs,
    scope: scopeLabel(user, narrowed),
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
  FAIRNESS_STATEMENT, buildId: () => load().buildId, listCases, filterCases, scopeBaseline, universe,
  filterHealth, getCase, graphForCase, getCluster,
  corpusAsOf: () => corpusAsOf(load()), caseDeadline, statusHeadMix, nearRepeat, reportingPropensity, scopeProfile, concentration,
  listOffenders, getOffender, listHealth, healthSummary, deadlines, geoPoints, geoGrid, hotspots, vulnerability,
  // Genuinely scoped. This used to return the precomputed state-wide blob to everyone, so
  // a Sub-Inspector and the DGP saw identical KPIs on the first screen of the product --
  // which made the whole role model look decorative. State tier still gets the precomputed
  // figures (they are the same thing, and free); district tier is computed from its own
  // case list.
  // Expose the loaded store so the ZCQL mapper can reuse lookups rather than re-querying
  // a few hundred rows that never change between pipeline runs.
  db: () => load(),
  dataDir: () => load().dataDir,
  // Area-level indicators keyed by district, for the model's feature set. Population, literacy,
  // urbanisation and density describe a PLACE and are never joined to a person -- the same rule
  // the socio-economic screen works under.
  socioByDistrict: () => {
    const db = load();
    const out = {};
    for (const d of ((db.socio && db.socio.districts) || [])) out[String(d.districtId)] = d;
    return out;
  },
  // The repeat-offending set's metadata, written by the pipeline beside its CSV.
  offenderSetMeta: () => {
    const db = load();
    return db.offenderSetMeta || { rows: 0, reason: 'The pipeline has not built the offender set yet.' };
  },
  // What the current training set holds, for the console upload step. Written by the pipeline
  // alongside the CSV so the two can never disagree about row count or date range.
  trainingSetMeta: () => {
    const db = load();
    return db.trainingSetMeta || { rows: 0, reason: 'The pipeline has not built a training set yet.' };
  },

  // Units a user may read, or null for state tier (no WHERE clause needed).
  scopeUnitIds: (user) => {
    if (!user || (user.roleMeta.tier === 'state' && !user.drilledFromState)) {
      return user && user.drillUnitId ? [user.drillUnitId] : null;
    }
    if (user.drillUnitId) return [user.drillUnitId];
    const db = load();
    const did = String(user.districtId);
    // unitDistrict is a Map, and Object.entries on a Map returns [] -- which silently gave
    // every district and station user an empty unit scope, so the ?source=datastore path
    // answered "0 cases" rather than theirs.
    return [...db.lookups.unitDistrict.entries()]
      .filter(([, d]) => String(d) === did).map(([u]) => u);
  },

  stats: (user) => {
    const db = load();
    if (!user || (user.roleMeta.tier === 'state' && !user.drilledFromState)) return { ...db.stats, scope: 'state' };
    // (districtRankContext defined below, hoisted)

    const rows = scoped(user, universe(user));
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
      // Derived from the incident timestamp, NOT read off the case. This used to test
      // `c.dow !== undefined && c.hour !== undefined`, and a case object carries neither
      // field -- so the condition never fired and every district and station was served an
      // empty hour-by-weekday grid. Only the state view looked right, because that path
      // returns the pipeline's precomputed heat instead of computing its own.
      //
      // incidentFromDate is 'YYYY-MM-DD HH:MM:SS'. Parsed by slice rather than by Date so the
      // hour is the one written on the FIR, not the one the server's timezone shifts it to.
      const ts = c.incidentFromDate || '';
      if (ts.length >= 13) {
        const hour = parseInt(ts.slice(11, 13), 10);
        const d = new Date(`${ts.slice(0, 10)}T00:00:00Z`);
        const day = d.getUTCDay();                 // 0 = Sunday
        if (Number.isFinite(hour) && !Number.isNaN(day)) {
          // The grid runs Mon..Sun, so Sunday moves from 0 to 6.
          const dow = (day + 6) % 7;
          const k = `${dow}:${hour}`;
          heat.set(k, (heat.get(k) || 0) + 1);
        }
      }
    }
    const health = db.healthList.filter((h) => ids.has(String(h.caseMasterId)));
    const did = String(user.districtId);
    const offs = db.offenders.filter((o) => (o.districts || []).map(String).includes(did));
    const zones = (db.zones && db.zones.stations) || [];

    // RANK IN CONTEXT (D5). A district officer does not want Karnataka's totals — they want
    // their own number and where it stands. Rank by raw count and, separately, by rate per
    // 100k, because the two disagree and that disagreement is the product's headline finding.
    const rank = districtRankContext(db, did);

    return {
      scope: 'district',
      districtId: did,
      districtName: (rows[0] && rows[0].districtName) || '',
      rankContext: rank,
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

  // STATION: one register, and the exact size of what it cannot see.
  //
  // A station user was falling through to districtCommand, which handed them all 120
  // Bengaluru City stations and the district's 41.1% share of state volume -- a scope leak,
  // and the opposite of what this tier exists to show.
  //
  // The headline figure here is deliberately the uncomfortable one: how many of this
  // station's own cases link to a case it has no visibility of. That number IS the argument
  // for the platform, and at station level it can be stated exactly rather than described.
  stationCommand: (user) => {
    const db = load();
    // A state/district user drilling into one station carries the target as drillUnitId; a
    // station-tier officer carries their own unitId. Either way, this view is that one station.
    const uid = String(user.drillUnitId || user.unitId);
    // universe(), not db.caseList: this block's headline figures are a REGISTER read, and the
    // register includes cases approved since the last pipeline run. Reading the bundle alone
    // put "278 registered / 85 open" in the stat cards and "holds 276 FIRs, of which 83 are
    // still open" in the narration directly beneath them -- two answers to one question, six
    // inches apart, on the one screen whose entire argument is that this is the whole of what
    // the desk can read.
    //
    // The link counts below stay honest without special-casing: a case approved since the last
    // run has no graph entry yet, so it contributes to the register totals and to no linkage,
    // which is exactly the truth about it.
    const mine = universe(user).filter((c) => String(c.unitId) === uid);
    const mineIds = new Set(mine.map((c) => String(c.caseMasterId)));

    const linkedOut = [];
    const seen = new Set();
    let sameDistrict = 0;
    for (const id of mineIds) {
      for (const e of (db.adjacency[id] || [])) {
        const nid = String(e.neighborId);
        if (mineIds.has(nid) || seen.has(nid)) continue;
        const nc = db.cases.get(nid);
        if (!nc) continue;
        seen.add(nid);
        if (String(nc.districtId) === String(user.districtId)) sameDistrict += 1;
        linkedOut.push({
          caseMasterId: nid, crimeNo: nc.crimeNo,
          districtName: nc.districtName, unitName: nc.unitName,
          crimeSubHead: nc.crimeSubHead, edgeType: e.edgeType, strength: e.strength,
          linkedToLocalCase: id,
        });
      }
    }
    const zoneByUnit = new Map(((db.zones || {}).stations || []).map((z) => [String(z.unitId), z]));
    const z = zoneByUnit.get(uid) || {};
    const stateTotal = db.stats.totalCases || 1;

    return {
      unitId: uid,
      unitName: (mine[0] && mine[0].unitName) || '',
      districtName: (mine[0] && mine[0].districtName) || '',
      total: mine.length,
      open: mine.filter((c) => String(c.statusId) === '1').length,
      flagged: mine.filter((c) => c.healthSeverity).length,
      heinous: mine.filter((c) => String(c.gravityId) === '1').length,
      linkedWithinStation: mine.filter((c) => (c.linkedCount || 0) > 0).length,
      // The cases beyond this register that its own cases connect to.
      linkedOutTotal: linkedOut.length,
      linkedOutSameDistrict: sameDistrict,
      linkedOutOtherDistricts: linkedOut.length - sameDistrict,
      linkedOutSample: linkedOut.slice(0, 40),
      zone: z.zone || 'normal',
      changePct: z.changePct ?? 0,
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

    // NAME THE STATIONS. db.zones.stations carries unitId and districtId and nothing else,
    // because the pipeline writes it keyed rather than labelled. Passed through unjoined it
    // surfaced as "Station 46" in the zone board and, worse, as "unit 46 with a change of
    // 575%" in the AI reading -- a sentence addressed to an officer who cannot act on a
    // number. The roster join is the same one anomalies() already does.
    const roster = new Map();
    for (const st of (db.stations || [])) roster.set(String(st.unitId), st);
    const named = (rows) => (rows || []).map((s) => {
      const st = roster.get(String(s.unitId));
      return st
        ? { ...s, unitName: st.unitName, districtName: st.districtName }
        : { ...s, unitName: `Station ${s.unitId}`, districtName: s.districtName || '' };
    });

    if (user.roleMeta.tier === 'state' && !user.drilledFromState) {
      return { ...z, stations: named(z.stations), scope: 'state', alerts: alerts(z.districts) };
    }

    const did = String(user.districtId);
    const districts = z.districts.filter((d) => String(d.districtId) === did);
    // AT STATION RANK, THE STATION LIST IS THEIR OWN.
    //
    // A station officer was being handed the whole district's zone board -- 25 registers for
    // Bengaluru City -- which the Insights reading then turned into "focus resources on the
    // three stations showing the highest deviation: Bengaluru Bazaar PS, Bengaluru New Town PS
    // and Bengaluru South PS". Two of those are registers this officer cannot open, cannot
    // task and is not answerable for, on the same product whose station view says in as many
    // words that it is the whole of what this desk can read.
    //
    // The district ROW stays: "how the mix here differs from the district" is what the page
    // promises, and a comparison against the parent is not a peek into it. This is the same
    // narrowing anomalies() already applies at this rank, and for the same reason.
    const uid = user.roleMeta.tier === 'station' ? String(user.unitId) : null;
    const stations = named(z.stations.filter((s) => String(s.districtId) === did
      && (!uid || String(s.unitId) === uid)));

    // A district officer's summary must count THEIR STATIONS, not the one district they are.
    // Passing the state summary through is what made a drilled-in Shivamogga view report
    // "Normal 31" -- a state fact rendered under a district heading.
    //
    // zones.stations only carries non-normal entries, so the normal count has to come from
    // the district's real station roster rather than from the payload.
    // Counted over the same set the tally below runs on. A station officer whose board shows
    // one register must not be told it is one of twenty-five: the denominator has to describe
    // what they can actually see, or the summary contradicts the list beneath it.
    const totalStations = uid ? 1 : new Set(
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
      scope: scopeLabel(user, narrowed),
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

    // Reads the precomputed link_summary rather than db.adjacency. Iterating every case's
    // full evidence-linked neighbour list here (edges.length, an edge-type set) was doing
    // real work the pipeline had already done once -- and against db.adjacency specifically,
    // which is lazily rehydrated from an interned, string-deduplicated format on first
    // access, so this loop forced a full decode of every linked case's evidence on every
    // request. At 40K cases that stayed fast by accident; at 60K it measured 0.6-24s per
    // call in production. link_summary carries only the three numbers this needs.
    const cand = [];
    for (const [caseId, ls] of Object.entries(db.linkSummary)) {
      if (!ls || !ls.links) continue;
      const c = db.cases.get(String(caseId));
      if (!c) continue;
      if (districtOnly && String(c.districtId) !== districtOnly) continue;
      const signals = ls.signalTypes || [];
      cand.push({
        caseMasterId: caseId,
        crimeNo: c.crimeNo,
        districtId: c.districtId,
        districtName: c.districtName || '',
        crimeHead: c.crimeHead || '',
        crimeSubHead: c.crimeSubHead || '',
        links: ls.links,
        offenderLinks: ls.offenderLinks,
        signalTypes: signals,
        // richness: evidence diversity first, then people, then raw size
        score: signals.length * 100 + Math.min(ls.offenderLinks, 12) * 8 + Math.min(ls.links, 40),
      });
    }
    cand.sort((a, b) => b.score - a.score);

    // Round-robin across crime head, then across evidence-mix signature, so the picker
    // shows genuinely different networks rather than twenty of the strongest one kind.
    //
    // Was Array.shift() inside this loop: shift() is O(n) (it re-indexes every remaining
    // element), called inside a while-loop that can itself run the length of the list, inside
    // an outer 40-round loop -- effectively O(rounds x n^2) per head in the worst case. At the
    // ~23K-linked-case corpus this stayed fast by accident; at 60K's ~34K it measured 14-22s
    // in production and the gateway returned an empty 200 rather than a real error, silently
    // breaking the Graph tab's own landing page. Walking each head's list with an index
    // cursor instead of mutating it makes every step O(1): same selection semantics (same
    // round-robin order, same "allow a duplicate signature after round 2" rule), no shift().
    const byHead = new Map();
    for (const x of cand) {
      const k = x.crimeHead || 'Other';
      if (!byHead.has(k)) byHead.set(k, []);
      byHead.get(k).push(x);
    }
    const heads = [...byHead.keys()];
    const cursor = new Map(heads.map((h) => [h, 0]));
    const picked = [];
    const seenSig = new Set();
    for (let round = 0; picked.length < limit && round < 40; round += 1) {
      let addedThisRound = false;
      for (const h of heads) {
        if (picked.length >= limit) break;
        const list = byHead.get(h);
        let i = cursor.get(h);
        while (i < list.length) {
          const x = list[i];
          i += 1;
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
        cursor.set(h, i);
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
  // Took no user at all, so a district officer's "what next" tab showed the state
  // projection -- the one number they cannot act on. Scoped, it leads with their own.
  forecast: (user) => {
    const db = load();
    const names = db.lookups.districts;
    const withNames = (db.forecast.districts || []).map((d) => ({
      ...d,
      districtName: (names.get(String(d.districtId)) || {}).DistrictName || `District ${d.districtId}`,
    }));
    const base = { ...db.forecast, districts: withNames };

    // Ranked movers are useful at both tiers: state needs to know where to look, a
    // district needs to know where it stands among comparable places.
    const rising = withNames.filter((d) => d.direction === 'rising')
      .sort((a, b) => b.changePct - a.changePct);
    const falling = withNames.filter((d) => d.direction !== 'rising')
      .sort((a, b) => a.changePct - b.changePct);
    base.movers = { rising: rising.slice(0, 6), falling: falling.slice(0, 6) };

    const narrowed = user && (user.roleMeta.scope !== 'state' || user.drilledFromState);
    if (!narrowed) return { ...base, scope: 'state' };

    const did = String(user.districtId);
    const me = withNames.find((d) => String(d.districtId) === did);
    if (!me) return { ...base, scope: 'state' };
    const rank = [...withNames].sort((a, b) => b.changePct - a.changePct)
      .findIndex((d) => String(d.districtId) === did) + 1;

    return {
      ...base,
      scope: 'district',
      focus: {
        ...me,
        rankByChange: rank,
        ofDistricts: withNames.length,
        // A projection is only actionable next to what it is projecting from.
        vsStateChangePct: Math.round((me.changePct - (base.state?.changePct ?? 0)) * 10) / 10,
      },
    };
  },
  // Alerts were returned unscoped to everyone -- a station officer saw the state-wide
  // watchlist, which both leaks beyond their tier and buries the handful that concern them.
  // Filtered to alerts whose subject actually touches their register.
  alerts: (user) => {
    const db = load();
    const all = db.alerts || [];
    if (!user || !user.roleMeta) return all;
    const { tier } = user.roleMeta;
    if (tier === 'state' && !user.drilledFromState) return all;

    const inScope = new Set();
    for (const c of db.caseList) if (rbac.caseInScope(user, c)) inScope.add(String(c.caseMasterId));
    const offInScope = new Set();
    for (const o of db.offenders) {
      if ((o.caseIds || []).some((id) => inScope.has(String(id)))) offInScope.add(String(o.offenderIdentityId));
    }
    return all.filter((a) => {
      if (a.caseMasterId) return inScope.has(String(a.caseMasterId));
      if (a.offenderIdentityId) return offInScope.has(String(a.offenderIdentityId));
      // Cluster, hotspot and anomaly alerts carry no single owning case; keep them for the
      // district tier (they are district-level findings) and drop them at station level,
      // where they describe ground the officer does not hold.
      return tier !== 'station';
    });
  },
  evalReport: () => load().evalReport,
  // Behavioural outliers, scoped to the viewer. The pipeline has computed these all along
  // and only a count ever reached the UI, so the reasoning behind each one -- which is the
  // useful part for an investigator -- was never shown.
  anomalies: (user, q = {}) => {
    const db = load();
    const src = load().caseAnomalies || {};
    const narrowed = user && (user.roleMeta.scope !== 'state' || user.drilledFromState);
    const did = narrowed ? String(user.districtId) : null;
    // This endpoint stopped at the district for everyone below state, so an SHO was handed
    // 763 flagged files from 120 stations -- and the response then labelled itself scope
    // 'unit', which the screen read as neither district nor unit and printed "state-wide".
    // Both halves were wrong in different directions. A station reads its own register.
    const tier = (user && user.roleMeta && user.roleMeta.tier) || 'state';
    const uid = (tier === 'station' ? user.unitId : (user && user.drillUnitId)) || null;

    let cases = (src.caseAnomalies || []).map((a) => {
      const c = db.cases.get(String(a.caseMasterId));
      return {
        ...a,
        districtId: c ? String(c.districtId) : null,
        districtName: c ? c.districtName : '',
        unitId: c ? String(c.unitId) : null,
        unitName: c ? c.unitName : '',
        crimeHead: c ? c.crimeHead : '',
        crimeSubHead: c ? c.crimeSubHead : '',
        status: c ? c.status : '',
      };
    });
    if (did) cases = cases.filter((a) => a.districtId === did);
    if (uid) cases = cases.filter((a) => a.unitId === String(uid));
    cases.sort((a, b) => b.anomalyScore - a.anomalyScore);

    const unitDistrict = new Map();
    for (const st of (db.stations || [])) unitDistrict.set(String(st.unitId), st);
    let stations = (src.stationAnomalies || []).map((a) => {
      const st = unitDistrict.get(String(a.unitId));
      return { ...a, unitName: st ? st.unitName : `Station ${a.unitId}`,
        districtId: st ? String(st.districtId) : null,
        districtName: st ? st.districtName : '' };
    });
    if (did) stations = stations.filter((a) => a.districtId === did);
    // The station list is a supervisory instrument: it names registers whose false-case rate
    // sits above their peers. An SHO cannot act on another station's, so at station rank it
    // narrows to their own -- present when they ARE the outlier, which they need to know,
    // and empty when they are not.
    if (uid) stations = stations.filter((a) => String(a.unitId) === String(uid));
    stations.sort((a, b) => (b.falseRate - a.falseRate));

    return {
      cases: cases.slice(0, Number(q.limit) || 12),
      caseTotal: cases.length,
      stations,
      stationTotal: stations.length,
      // The scope this response's DATA was filtered to, which is what the screen labels. It
      // is not the same question as the reader's rank: a state officer drilled into one
      // station holds state rank and is reading a unit.
      scope: uid ? 'unit' : (did ? 'district' : 'state'),
    };
  },
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
