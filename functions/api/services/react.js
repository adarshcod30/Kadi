// react.js — one queue, ordered by what fails first.
//
// The signals on this page all exist already, and that is the problem it solves. Health flags
// live on Health, pulsing stations on Map, active offenders on Offenders, inbound cross-district
// links on Cases. Four screens, four orderings, and nothing anywhere that says which to do
// first. An officer with an hour before a review meeting has no way to spend it well.
//
// So this merges them into a single ranked list. The ranking is the whole contribution:
// severity first, then urgency within severity, so the thing nearest failing surfaces above
// the thing that is merely large.
//
// Everything here is present tense and already recorded. Nothing is predicted — that is the
// Forecast surface, deliberately kept separate. React answers "what do I do today"; Forecast
// answers "what is coming".

const KIND_WEIGHT = {
  case_failing: 0,
  offender_active: 1,
  station_pulsing: 2,
  linked_in: 3,
};
const SEV_WEIGHT = { high: 0, medium: 1, info: 2 };

const daysBetween = (a, b) => {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round((y - x) / 86400000);
};

/**
 * Build the worklist.
 *
 * `ctx` carries the already-scoped inputs, so this stays a pure ranking function over data the
 * query layer has already filtered — it never widens anyone's scope by accident.
 */
function worklist(ctx, { limit = 40 } = {}) {
  const { health = [], casesById, offenders = [], stations = [], linkedIn = [], asOf } = ctx;
  const items = [];

  // 1. Cases running past their peer median. The peer median matters: a property case and a
  //    murder are not held to the same clock, so "overdue" has to mean overdue for its own type.
  for (const h of health) {
    const c = casesById.get(String(h.caseMasterId));
    if (!c) continue;
    const over = Number.isFinite(h.investigationAgeDays) && Number.isFinite(h.peerMedianAgeDays)
      ? h.investigationAgeDays - h.peerMedianAgeDays
      : null;
    // Rank within severity by how far past peer, not by raw age — an old case of a slow type
    // is not in trouble, and a young one of a fast type may be.
    const urgency = over !== null && h.peerMedianAgeDays > 0 ? over / h.peerMedianAgeDays : 0;
    items.push({
      id: `case-${h.caseMasterId}`,
      kind: 'case_failing',
      severity: h.severity === 'high' ? 'high' : 'medium',
      urgency,
      title: `${c.crimeSubHead} — ${c.crimeNo}`,
      where: `${c.unitName}, ${c.districtName}`,
      why: (h.flags || []).map((f) => f.reason).slice(0, 2).join(' · ')
        || 'Flagged by the investigation-health rules.',
      action: h.recommendationText || 'Review and record the next investigative step.',
      metric: over !== null ? `${over > 0 ? '+' : ''}${over}d vs peer median` : null,
      link: { page: 'case', id: String(h.caseMasterId) },
    });
  }

  // 2. Offenders who are high risk AND still active. The intersection is the point: the
  //    watchlist sorts by risk, which puts someone last active four years ago above someone
  //    offending this quarter. Neither list on its own produces this set.
  const activeCut = asOf ? (() => {
    const d = new Date(`${asOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  })() : null;
  for (const o of offenders) {
    if (!activeCut || !o.lastSeen || o.lastSeen < activeCut) continue;
    if ((o.riskScore || 0) < 70) continue;
    const since = daysBetween(o.lastSeen, asOf);
    items.push({
      id: `offender-${o.offenderIdentityId}`,
      kind: 'offender_active',
      severity: (o.arrestCount || 0) === 0 ? 'high' : 'medium',
      urgency: since !== null ? 1 - Math.min(1, since / 90) : 0,
      title: o.canonicalName,
      where: `${o.distinctDistricts} district${o.distinctDistricts === 1 ? '' : 's'} · ${o.distinctCases} cases`,
      why: (o.arrestCount || 0) === 0
        ? `Risk ${o.riskScore}, active ${since}d ago, and no arrest on record.`
        : `Risk ${o.riskScore}, active ${since}d ago.`,
      action: (o.distinctDistricts || 0) > 1
        ? 'Operates across district lines — coordinate rather than pursue locally.'
        : 'Review the linked cases for a current lead.',
      metric: `risk ${o.riskScore}`,
      link: { page: 'offender', id: String(o.offenderIdentityId) },
    });
  }

  // 3. Stations sharply above their own average.
  for (const s of stations) {
    if (s.zone !== 'red_pulsing') continue;
    const base = Number(s.baseline) || 0;
    const cur = Number(s.current) || 0;
    items.push({
      id: `station-${s.unitId}`,
      kind: 'station_pulsing',
      severity: 'medium',
      urgency: base > 0 ? (cur - base) / base : 0,
      title: s.unitName,
      where: s.districtName || '',
      why: `${cur} recent cases against a baseline of ${base} — sharply above this station's own average.`,
      action: 'Check what is driving the rise before allocating resource.',
      metric: base > 0 ? `+${Math.round(((cur - base) / base) * 100)}%` : null,
      link: { page: 'cases', query: { unit: String(s.unitId) } },
    });
  }

  // 4. Cases outside this scope that link into it. The one thing a local register cannot show,
  //    and therefore the one thing that has to be pushed rather than waited for.
  for (const l of linkedIn.slice(0, 12)) {
    items.push({
      id: `linked-${l.caseMasterId}`,
      kind: 'linked_in',
      severity: 'info',
      urgency: Number(l.strength) || 0,
      title: `${l.crimeSubHead} — ${l.crimeNo}`,
      where: `${l.unitName}, ${l.districtName}`,
      why: `Registered outside your scope but shares ${String(l.edgeType).replace(/_/g, ' ')} with one of your cases.`,
      action: 'Open the network to see which of your cases it connects to.',
      metric: null,
      link: { page: 'graph', id: String(l.caseMasterId) },
    });
  }

  items.sort((a, b) => (SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity])
    || (KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind])
    || (b.urgency - a.urgency));

  const counts = {};
  for (const i of items) counts[i.kind] = (counts[i.kind] || 0) + 1;

  return {
    items: items.slice(0, limit),
    total: items.length,
    counts,
    highCount: items.filter((i) => i.severity === 'high').length,
    asOf,
  };
}

module.exports = { worklist };
