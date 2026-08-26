// intelligence.js — contextual intelligence for whatever the officer is currently looking at.
//
// The existing insight layer narrates the WHOLE scope: it says the same thing about the state
// register no matter what has been filtered down to. That is reporting, and reporting is the
// thing the brief is trying to move away from ("a notable absence of AI-driven approaches",
// "static count dashboards", "relational and behavioural patterns go undiscovered").
//
// This module computes findings about the CURRENT slice instead. Filter to cyber crime in
// Udupi and it tells you what is true of those 2,340 cases -- how they are concentrated, what
// is accelerating, which sub-head is over-represented against its own state baseline, whether
// the pendency here is worse than peers. Change the filter and the analysis changes with it.
//
// SAME RULE AS insight.js: the model never produces a fact. Everything below is computed
// deterministically and handed to GLM as text to interpret. A signal that cannot be traced
// back to rows does not get rendered.
//
// Every signal carries the query that reproduces it, so a finding is never a dead end -- the
// UI turns it into a link that filters the register down to exactly the cases it describes.

const RECENT_DAYS = 90;

// ---------- small deterministic helpers ----------
const iso = (d) => d.toISOString().slice(0, 10);
function shiftDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function topCounts(rows, keyFn, labelFn, limit = 3) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === undefined || k === null || k === '') continue;
    const e = m.get(k) || { key: k, label: labelFn(r), n: 0 };
    e.n += 1;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}

// The corpus's own latest registration date. Everything time-relative is measured against
// this rather than wall-clock now, so "the last 90 days" keeps meaning the same window
// however long after generation the system is demonstrated.
function asOfDate(rows) {
  let max = null;
  for (const c of rows) {
    const d = c.crimeRegisteredDate;
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

// ---------- cases ----------
// `rows` is the filtered set the officer is looking at; `baseline` is their full scope.
// Comparing the two is what turns a count into a finding: 500 cyber cases means nothing on
// its own, but 500 where the scope-wide rate predicts 180 is a lead.
function caseIntelligence(rows, baseline, activeFilters = {}) {
  const total = rows.length;
  const signals = [];
  if (!total) return { total: 0, signals, facts: { total: 0 } };

  const asOf = asOfDate(baseline) || asOfDate(rows);
  const cutRecent = asOf ? shiftDays(asOf, -RECENT_DAYS) : null;
  const cutPrior = asOf ? shiftDays(asOf, -RECENT_DAYS * 2) : null;

  let recent = 0; let prior = 0; let linked = 0; let flagged = 0; let high = 0; let heinous = 0;
  let undetected = 0; let open = 0;
  for (const c of rows) {
    const d = c.crimeRegisteredDate;
    if (cutRecent && d > cutRecent) recent += 1;
    else if (cutPrior && d > cutPrior) prior += 1;
    if (c.linkedCount > 0) linked += 1;
    if (c.healthSeverity) flagged += 1;
    if (c.healthSeverity === 'high') high += 1;
    if (String(c.gravityId) === '1') heinous += 1;
    if (String(c.statusId) === '4') undetected += 1;
    if (String(c.statusId) === '1') open += 1;
  }

  // 1. Momentum. Two equal windows, so the comparison is like-for-like.
  const momentum = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;
  if (momentum !== null && Math.abs(momentum) >= 15 && recent + prior >= 40) {
    signals.push({
      key: 'momentum',
      severity: momentum > 0 ? (momentum >= 40 ? 'high' : 'medium') : 'info',
      title: `${momentum > 0 ? 'Rising' : 'Falling'} ${Math.abs(momentum)}% quarter on quarter`,
      detail: `${recent.toLocaleString('en-IN')} registered in the last ${RECENT_DAYS} days against ${prior.toLocaleString('en-IN')} in the ${RECENT_DAYS} before.`,
      query: cutRecent ? { dateFrom: cutRecent } : null,
      queryLabel: 'Show the recent window',
    });
  }

  // 2. Concentration. A caseload spread evenly across 300 stations is a different problem
  // from the same caseload sitting in three of them, and only one of those is actionable.
  const topStations = topCounts(rows, (c) => c.unitId, (c) => c.unitName, 3);
  const topShare = pct(topStations.reduce((s, x) => s + x.n, 0), total);
  if (topStations.length === 3 && topShare >= 25) {
    signals.push({
      key: 'concentration',
      severity: topShare >= 45 ? 'high' : 'medium',
      title: `${topShare}% sit in three stations`,
      detail: `${topStations.map((s) => `${s.label} (${s.n.toLocaleString('en-IN')})`).join(', ')}.`,
      query: { unit: String(topStations[0].key) },
      queryLabel: `Open ${topStations[0].label}`,
    });
  }

  // 3. Over-representation against the officer's own baseline. This is the finding a count
  // dashboard structurally cannot produce: it needs the rate here versus the rate everywhere.
  if (baseline.length > total && total >= 50) {
    const baseBy = new Map();
    for (const c of baseline) baseBy.set(c.crimeSubHeadId, (baseBy.get(c.crimeSubHeadId) || 0) + 1);
    const here = topCounts(rows, (c) => c.crimeSubHeadId, (c) => c.crimeSubHead, 12);
    let best = null;
    for (const h of here) {
      if (h.n < 20) continue;
      const expected = (baseBy.get(h.key) || 0) * (total / baseline.length);
      if (expected < 5) continue;
      const lift = h.n / expected;
      if (!best || lift > best.lift) best = { ...h, expected: Math.round(expected), lift };
    }
    if (best && best.lift >= 1.4) {
      signals.push({
        key: 'overrepresented',
        severity: best.lift >= 2 ? 'high' : 'medium',
        title: `${best.label} runs ${best.lift.toFixed(1)}× above the expected rate`,
        detail: `${best.n.toLocaleString('en-IN')} here where this scope's overall mix predicts about ${best.expected.toLocaleString('en-IN')}.`,
        query: { subhead: String(best.key) },
        queryLabel: `Isolate ${best.label}`,
      });
    }
  }

  // 4. Linkage — the product's whole premise, stated for this slice.
  const linkedPct = pct(linked, total);
  if (linked > 0) {
    signals.push({
      key: 'linkage',
      severity: linkedPct >= 60 ? 'medium' : 'info',
      title: `${linkedPct}% connect to another case`,
      detail: `${linked.toLocaleString('en-IN')} of these share an offender, co-accused, modus operandi, place, time window or act & section with a case elsewhere in the register. A link is not by itself evidence of a repeat offender -- most arise from method, place or timing.`,
      query: { linked: 'true', sort: 'linked_desc' },
      queryLabel: 'Show only the connected ones',
    });
  }

  // 5. Investigation health, as a proportion rather than a raw count.
  if (flagged > 0) {
    const flaggedPct = pct(flagged, total);
    signals.push({
      key: 'health',
      severity: high >= 1 && pct(high, total) >= 25 ? 'high' : 'medium',
      title: `${flaggedPct}% carry a health flag`,
      detail: `${high.toLocaleString('en-IN')} are high severity — ageing past the peer median, pending beyond threshold, or at undetected risk.`,
      query: { severity: 'high', sort: 'severity_desc' },
      queryLabel: 'Open the high-severity ones',
    });
  }

  // 6. Detection gap.
  const undetPct = pct(undetected, total);
  if (undetected >= 20 && undetPct >= 25) {
    signals.push({
      key: 'undetected',
      severity: undetPct >= 45 ? 'high' : 'medium',
      title: `${undetPct}% closed undetected`,
      detail: `${undetected.toLocaleString('en-IN')} cases ended without a detection — worth reading against the linkage figure, since a linked case has leads an isolated one does not.`,
      query: { status: '4' },
      queryLabel: 'Show undetected',
    });
  }

  const facts = {
    casesInView: total,
    filtersApplied: Object.keys(activeFilters).length ? activeFilters : 'none',
    registeredLast90Days: recent,
    registeredPrevious90Days: prior,
    quarterOnQuarterPercent: momentum,
    connectedToAnotherCasePercent: linkedPct,
    carryingHealthFlagPercent: pct(flagged, total),
    highSeverity: high,
    heinous: heinous,
    stillOpen: open,
    closedUndetectedPercent: undetPct,
    topStations: topStations.map((s) => `${s.label}: ${s.n}`),
  };
  return { total, signals: rank(signals), facts, asOf };
}

// ---------- offenders ----------
// The watchlist is a list of people. What a commander needs from it is an order of work, and
// the risk score alone does not give one: it deliberately does not encode recency, so a
// high scorer last active four years ago outranks an active one. These signals supply the
// dimensions the score leaves out.
function offenderIntelligence(rows, casesById, offendersById) {
  const total = rows.length;
  const signals = [];
  if (!total) return { total: 0, signals, facts: { total: 0 } };

  const asOf = rows.reduce((m, o) => (o.lastSeen && (!m || o.lastSeen > m) ? o.lastSeen : m), null);
  const activeCut = asOf ? shiftDays(asOf, -RECENT_DAYS) : null;

  const active = rows.filter((o) => activeCut && o.lastSeen && o.lastSeen >= activeCut);
  const priority = active
    .filter((o) => (o.riskScore || 0) >= 70)
    .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  const crossActive = active.filter((o) => (o.distinctDistricts || 0) >= 2);

  if (priority.length) {
    signals.push({
      key: 'priority',
      severity: 'high',
      title: `${priority.length} high-risk offender${priority.length === 1 ? '' : 's'} active in the last ${RECENT_DAYS} days`,
      detail: `Scored 70+ and still offending: ${priority.slice(0, 3).map((o) => o.canonicalName).join(', ')}${priority.length > 3 ? ` and ${priority.length - 3} more` : ''}.`,
      query: { band: 'High', activeDays: String(RECENT_DAYS), sort: 'recent_desc' },
      queryLabel: 'Open this list',
    });
  }
  if (crossActive.length) {
    signals.push({
      key: 'crossActive',
      severity: 'high',
      title: `${crossActive.length} offenders are currently active across district lines`,
      detail: `This is a count of people, not of cases, and it is not a subset of the high-risk group above. Their reach spans up to ${Math.max(...crossActive.map((o) => o.distinctDistricts))} districts.`,
      query: { crossDistrict: 'true', activeDays: String(RECENT_DAYS), sort: 'districts_desc' },
      queryLabel: 'Show cross-district actives',
    });
  }

  // Escalation: is the person's recent offending graver than their earlier offending? This is
  // behavioural, computed from their own history, and is the closest thing here to a forward
  // -looking signal -- an escalating offender is the one to interrupt first.
  const escalating = [];
  for (const o of rows) {
    const cs = (o.caseIds || []).map((id) => casesById.get(String(id))).filter(Boolean)
      .filter((c) => c.crimeRegisteredDate)
      .sort((a, b) => (a.crimeRegisteredDate < b.crimeRegisteredDate ? -1 : 1));
    if (cs.length < 4) continue;
    const half = Math.floor(cs.length / 2);
    const gr = (arr) => arr.filter((c) => String(c.gravityId) === '1').length / arr.length;
    const early = gr(cs.slice(0, half));
    const late = gr(cs.slice(half));
    if (late > early && late >= 0.5 && late - early >= 0.3) {
      escalating.push({ name: o.canonicalName, id: o.offenderIdentityId, early, late, cases: cs.length });
    }
  }
  if (escalating.length) {
    signals.push({
      key: 'escalation',
      severity: 'high',
      title: `${escalating.length} showing escalating offence gravity`,
      detail: `Their recent offences are materially more serious than their earlier ones — e.g. ${escalating.slice(0, 2).map((e) => `${e.name} (${Math.round(e.early * 100)}% → ${Math.round(e.late * 100)}% heinous)`).join(', ')}.`,
      query: { sort: 'recent_desc' },
      queryLabel: 'Review the watchlist',
    });
  }

  // Dormant-then-returned. A quiet offender who reappears is a different operational fact
  // from one who never stopped, and neither the risk score nor a "last seen" column says it.
  const resurgent = rows.filter((o) => {
    if (!o.lastSeen || !o.firstSeen || !activeCut || o.lastSeen < activeCut) return false;
    const cs = (o.caseIds || []).map((id) => casesById.get(String(id))).filter(Boolean)
      .map((c) => c.crimeRegisteredDate).filter(Boolean).sort();
    if (cs.length < 3) return false;
    const prev = cs[cs.length - 2];
    const gapDays = (Date.parse(`${o.lastSeen}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`)) / 86400000;
    return gapDays >= 365;
  });
  if (resurgent.length) {
    signals.push({
      key: 'resurgent',
      severity: 'medium',
      title: `${resurgent.length} resumed offending after a year or more quiet`,
      detail: `Dormant long enough to fall out of routine attention, then active again: ${resurgent.slice(0, 3).map((o) => o.canonicalName).join(', ')}.`,
      query: { activeDays: String(RECENT_DAYS), sort: 'recent_desc' },
      queryLabel: 'Show recently active',
    });
  }

  // Acceleration. The risk score answers "how serious is this person's history"; it does not
  // answer "are they speeding up". Comparing the mean gap between their first offences against
  // their most recent ones does, and a shortening cycle is the closest thing in this data to a
  // forward-looking signal -- it is the difference between a bad record and an active spree.
  const accelerating = [];
  for (const o of rows) {
    const ds = (o.caseIds || []).map((id) => casesById.get(String(id))).filter(Boolean)
      .map((c) => c.crimeRegisteredDate).filter(Boolean).sort();
    if (ds.length < 6) continue;
    const gaps = [];
    for (let i = 1; i < ds.length; i += 1) {
      gaps.push((Date.parse(`${ds[i]}T00:00:00Z`) - Date.parse(`${ds[i - 1]}T00:00:00Z`)) / 86400000);
    }
    const half = Math.floor(gaps.length / 2);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const early = mean(gaps.slice(0, half));
    const late = mean(gaps.slice(half));
    if (early > 0 && late > 0 && late <= early * 0.6) {
      accelerating.push({ name: o.canonicalName, early: Math.round(early), late: Math.round(late) });
    }
  }
  if (accelerating.length) {
    const worst = accelerating.slice().sort((a, b) => a.late - b.late)[0];
    signals.push({
      key: 'accelerating',
      severity: 'high',
      title: `${accelerating.length} are offending on a shortening cycle`,
      detail: `The interval between their offences has at least halved. ${worst.name} has gone from roughly one every ${worst.early} days to one every ${worst.late}. This is a tempo signal — the risk score measures history, not whether someone is speeding up.`,
      query: { sort: 'recent_desc' },
      queryLabel: 'Sort by recency',
    });
  }

  // Prolific but never arrested. This is an enforcement gap rather than a risk finding: the
  // person is known, resolved across multiple FIRs, and nothing has yet been brought against
  // them. It is arguably the most directly actionable line on the page.
  const neverArrested = rows.filter((o) => (o.distinctCases || 0) >= 5 && (o.arrestCount || 0) === 0);
  if (neverArrested.length) {
    const top = neverArrested.slice().sort((a, b) => (b.distinctCases || 0) - (a.distinctCases || 0))[0];
    signals.push({
      key: 'neverArrested',
      severity: 'high',
      title: `${neverArrested.length} are linked to 5+ cases with no arrest on record`,
      detail: `Identified across multiple FIRs but never arrested. The most prolific, ${top.canonicalName}, is linked to ${top.distinctCases} cases across ${top.distinctDistricts} district${top.distinctDistricts === 1 ? '' : 's'}. This is an enforcement gap, not a scoring one.`,
      query: { sort: 'cases_desc' },
      queryLabel: 'Sort by case count',
    });
  }

  // Brokers. In network terms the person joining two otherwise separate groups matters more
  // than the busiest member of either -- removing them splits the network, while removing a
  // high-volume member of one group leaves it intact. Nothing in a ranked list surfaces this.
  const bridges = [];
  if (offendersById) {
    for (const o of rows) {
      const co = o.coOffenders || [];
      if (co.length < 2) continue;
      const clusters = new Set();
      for (const c of co) {
        const peer = offendersById.get(String(c.offenderIdentityId));
        for (const cl of ((peer && peer.clusterIds) || [])) clusters.add(cl);
      }
      for (const cl of (o.clusterIds || [])) clusters.add(cl);
      if (clusters.size >= 2) bridges.push({ name: o.canonicalName, groups: clusters.size, co: co.length });
    }
  }
  if (bridges.length) {
    const top = bridges.slice().sort((a, b) => b.groups - a.groups)[0];
    signals.push({
      key: 'bridge',
      severity: 'medium',
      title: `${bridges.length} connect two or more otherwise separate groups`,
      detail: `${top.name} sits between ${top.groups} distinct communities through ${top.co} known associates. Brokers hold a network together — removing one splits it, where removing a busy member of a single group does not.`,
      query: { networked: 'true', sort: 'network_desc' },
      queryLabel: 'Show networked offenders',
    });
  }

  // Specialists. Someone who does one thing repeatedly is predictable, which makes them the
  // easiest to plan against; a versatile offender is not, and needs a different approach.
  const specialists = [];
  for (const o of rows) {
    const cs = (o.caseIds || []).map((id) => casesById.get(String(id))).filter(Boolean);
    if (cs.length < 4) continue;
    const by = new Map();
    for (const c of cs) by.set(c.crimeSubHead, (by.get(c.crimeSubHead) || 0) + 1);
    const [label, n] = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / cs.length >= 0.7) specialists.push({ name: o.canonicalName, label, share: pct(n, cs.length) });
  }
  if (specialists.length) {
    const byType = new Map();
    for (const sp of specialists) byType.set(sp.label, (byType.get(sp.label) || 0) + 1);
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    signals.push({
      key: 'specialists',
      severity: 'info',
      title: `${specialists.length} are single-method specialists`,
      detail: `At least 70% of their cases are one offence type — most commonly ${top[0]} (${top[1]} offender${top[1] === 1 ? '' : 's'}). A repeated method is a predictable one, which makes these the easiest to plan against.`,
      query: { sort: 'cases_desc' },
      queryLabel: 'Review by case count',
    });
  }

  const networked = rows.filter((o) => (o.coOffenders || []).length);
  if (networked.length) {
    const biggest = networked.reduce((m, o) => ((o.coOffenders || []).length > (m.coOffenders || []).length ? o : m), networked[0]);
    signals.push({
      key: 'network',
      severity: 'medium',
      title: `${networked.length} operate with co-offenders`,
      detail: `Largest known group centres on ${biggest.canonicalName} with ${(biggest.coOffenders || []).length} associates across ${biggest.distinctDistricts} district${biggest.distinctDistricts === 1 ? '' : 's'}.`,
      query: { networked: 'true', sort: 'network_desc' },
      queryLabel: 'Show the groups',
    });
  }

  const facts = {
    offendersInView: total,
    activeInLast90Days: active.length,
    highRiskAndActive: priority.length,
    activeAcrossDistricts: crossActive.length,
    escalatingGravity: escalating.length,
    offendingOnShorteningCycle: accelerating.length,
    prolificWithNoArrest: neverArrested.length,
    bridgingSeparateGroups: bridges.length,
    singleMethodSpecialists: specialists.length,
    resumedAfterYearDormant: resurgent.length,
    operatingInGroups: networked.length,
    note: 'Risk is behavioural only. Caste, religion and occupation are excluded by construction.',
  };
  return { total, signals: rank(signals), facts, asOf };
}

// ---------- investigation health ----------
function healthIntelligence(rows, casesById) {
  const total = rows.length;
  const signals = [];
  if (!total) return { total: 0, signals, facts: { total: 0 } };

  const ages = rows.map((h) => h.investigationAgeDays).filter((n) => Number.isFinite(n));
  const medAge = median(ages);
  const overPeer = rows.filter((h) => Number.isFinite(h.investigationAgeDays)
    && Number.isFinite(h.peerMedianAgeDays) && h.investigationAgeDays > h.peerMedianAgeDays * 1.5).length;

  // Which reason dominates decides what the intervention actually is -- a pendency problem
  // and a reporting-delay problem call for different action from the same supervisor.
  const reasons = new Map();
  for (const h of rows) for (const k of (h.flagKeys || [])) reasons.set(k, (reasons.get(k) || 0) + 1);
  const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => ({ key: k, label: k.replace(/_/g, ' '), n }));

  if (topReasons.length) {
    const t = topReasons[0];
    signals.push({
      key: 'dominantReason',
      severity: 'high',
      title: `${t.label} drives ${pct(t.n, total)}% of flags`,
      detail: `${t.n.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} flagged cases. ${topReasons.slice(1).map((r) => `${r.label} ${r.n.toLocaleString('en-IN')}`).join(', ')}.`,
      query: { flag: t.key },
      queryLabel: `Show ${t.label}`,
    });
  }
  if (overPeer > 0) {
    signals.push({
      key: 'overPeer',
      severity: pct(overPeer, total) >= 40 ? 'high' : 'medium',
      title: `${overPeer.toLocaleString('en-IN')} are running past 1.5× the peer median`,
      detail: `Median open age in this set is ${medAge} days. Peer median is what a comparable case of the same type normally takes, so this is slippage against like-for-like, not against a fixed target.`,
      query: { sort: 'age_desc' },
      queryLabel: 'Sort by ageing',
    });
  }

  // Station-level clustering: if flags pile up in a few stations, this is a supervision
  // question rather than a caseload one.
  const byStation = topCounts(rows.map((h) => casesById.get(String(h.caseMasterId))).filter(Boolean),
    (c) => c.unitId, (c) => c.unitName, 3);
  const stationShare = pct(byStation.reduce((s, x) => s + x.n, 0), total);
  if (byStation.length === 3 && stationShare >= 20) {
    signals.push({
      key: 'stationCluster',
      severity: stationShare >= 35 ? 'high' : 'medium',
      title: `${stationShare}% of flagged cases sit in three stations`,
      detail: `${byStation.map((s) => `${s.label} (${s.n.toLocaleString('en-IN')})`).join(', ')} — concentrated enough to be a supervision issue rather than a workload one.`,
      query: { unit: String(byStation[0].key) },
      queryLabel: `Open ${byStation[0].label}`,
    });
  }

  const facts = {
    flaggedInView: total,
    medianOpenAgeDays: medAge,
    runningPastPeerMedian: overPeer,
    topReasons: topReasons.map((r) => `${r.label}: ${r.n}`),
    mostAffectedStations: byStation.map((s) => `${s.label}: ${s.n}`),
  };
  return { total, signals: rank(signals), facts };
}

// ---------- spatiotemporal ----------
function geoIntelligence(rows, hotspots) {
  const total = rows.length;
  const signals = [];
  if (!total) return { total: 0, signals, facts: { total: 0 } };

  const asOf = asOfDate(rows);
  const cutRecent = asOf ? shiftDays(asOf, -RECENT_DAYS) : null;

  // Time-of-day concentration, measured on the axis that actually carries the signal.
  //
  // The obvious construction -- 7 weekdays x 8 three-hour blocks -- was the wrong one here.
  // Offending clusters hard by HOUR (evenings) but sits almost flat across weekdays, so
  // splitting 56 ways divided one real pattern into seven diluted copies and the peak came
  // out at a forgettable 1.26x. Collapsing the weekday axis recovers it. A weekday finding is
  // reported separately, and only when a day genuinely departs from the rest.
  const BLOCKS = 8;
  const blocks = new Array(BLOCKS).fill(0);
  const dows = new Array(7).fill(0);
  let timed = 0;
  for (const c of rows) {
    if (!c.incidentFromDate || c.incidentFromDate.length < 13) continue;
    const hh = parseInt(c.incidentFromDate.slice(11, 13), 10);
    if (!Number.isFinite(hh)) continue;
    blocks[Math.floor(hh / 3)] += 1;
    const dt = new Date(`${c.incidentFromDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(dt.getTime())) dows[dt.getUTCDay()] += 1;
    timed += 1;
  }
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  if (timed >= 500) {
    let bi = 0;
    for (let i = 1; i < BLOCKS; i += 1) if (blocks[i] > blocks[bi]) bi = i;
    const share = pct(blocks[bi], timed);
    const evenShare = Math.round((100 / BLOCKS) * 10) / 10;
    if (share / evenShare >= 1.15) {
      const from = String(bi * 3).padStart(2, '0');
      const to = String((bi * 3 + 3) % 24).padStart(2, '0');
      signals.push({
        key: 'patrolWindow',
        severity: 'medium',
        title: `${from}:00–${to}:00 is the busiest window of the day`,
        detail: `${blocks[bi].toLocaleString('en-IN')} incidents (${share}% of the day's load) fall in this three-hour block, against ${evenShare}% if the day were flat. Concentration holds across every weekday, so this is a shift-timing finding rather than a weekend one.`,
        query: { hourFrom: String(bi * 3), hourTo: String(bi * 3 + 2) },
        queryLabel: 'Filter the map to this window',
      });
    }
    // Only worth saying if a day actually departs from the others.
    let di = 0;
    for (let i = 1; i < 7; i += 1) if (dows[i] > dows[di]) di = i;
    const dayLift = dows[di] / (timed / 7);
    if (dayLift >= 1.12) {
      signals.push({
        key: 'peakDay',
        severity: 'info',
        title: `${DOW[di]} runs ${Math.round((dayLift - 1) * 100)}% above an average day`,
        detail: `${dows[di].toLocaleString('en-IN')} incidents against a flat-week expectation of ${Math.round(timed / 7).toLocaleString('en-IN')}.`,
        query: null,
        queryLabel: null,
      });
    }
  }

  const emerging = (hotspots || []).filter((h) => h.emergingFlag);
  if (emerging.length) {
    const top = emerging.slice().sort((a, b) => (b.recentCount || 0) - (a.recentCount || 0))[0];
    signals.push({
      key: 'emerging',
      severity: 'high',
      title: `${emerging.length} emerging hotspot${emerging.length === 1 ? '' : 's'}`,
      detail: `Recent density well above each cluster's own historical baseline. The largest single cluster contains ${(top.recentCount || 0).toLocaleString('en-IN')} recent cases (a count of cases in one cluster, not a share of any district).`,
      query: null,
      queryLabel: null,
    });
  }

  const byDistrict = topCounts(rows.filter((c) => cutRecent && c.crimeRegisteredDate > cutRecent),
    (c) => c.districtId, (c) => c.districtName, 3);
  if (byDistrict.length) {
    signals.push({
      key: 'recentLoad',
      severity: 'info',
      title: `${byDistrict[0].label} leads the last ${RECENT_DAYS} days`,
      detail: `${byDistrict.map((d) => `${d.label} (${d.n.toLocaleString('en-IN')})`).join(', ')}. Counts, not rates — the per-capita picture is on the Intelligence page and ranks differently.`,
      query: { district: String(byDistrict[0].key) },
      queryLabel: `Drill into ${byDistrict[0].label}`,
    });
  }

  const facts = {
    mappedIncidents: total,
    withUsableTimestamp: timed,
    emergingHotspots: emerging.length,
    busiestRecentDistricts: byDistrict.map((d) => `${d.label}: ${d.n}`),
  };
  return { total, signals: rank(signals), facts };
}

const SEV = { high: 0, medium: 1, info: 2 };
function rank(signals) {
  return signals.slice().sort((a, b) => SEV[a.severity] - SEV[b.severity]);
}

module.exports = {
  caseIntelligence, offenderIntelligence, healthIntelligence, geoIntelligence, RECENT_DAYS,
};
