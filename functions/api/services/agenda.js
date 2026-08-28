// agenda.js — the React surface: what carries a clock, and whose desk it sits on.
//
// The page this replaces was a merged worklist: every health flag in scope, ranked by how far
// past its peer median it had run. That is a defensible ordering and it produced an unusable
// screen, for three reasons worth writing down so they are not rebuilt by accident.
//
//   1. It could not be finished. 26,212 items state-wide, 16,136 of them "urgent". A queue an
//      officer can never empty is a report with a misleading name.
//   2. It could not change. Ranking by days-past-peer pins the oldest murders to the top
//      permanently — the same sixty rows today, tomorrow and next quarter. Nothing an officer
//      does moves the list, so nothing an officer does is worth doing.
//   3. It ignored rank. A DGP was handed individual case files to open. A DGP does not open
//      case files; an SHO does. The state's response to a failing investigation is to press
//      the officer who owns it, which is a different object entirely.
//
// So the admission rule here is narrow and it is the whole design:
//
//      An item belongs on React only if it has a DATE by which it must be done
//      and exactly one POST responsible for doing it.
//
// Everything without both belongs on Health (which case is unhealthy), Cases (the register) or
// Insights (why the ground behaves as it does). That rule alone separates this surface from
// Health: Health is a diagnosis and never empties; React is a diary and clears.
//
// The consequence is that each tier gets a different SHAPE, not a filtered copy of one list:
//
//      STATION   cases      — the post that actually investigates
//      DISTRICT  stations   — the post that supervises stations, one visit at a time
//      STATE     districts  — the post that presses SPs and owns what no district can
//
// The statutory clock is the spine at every tier. In this corpus no open case carries a
// recorded arrest, so every clock is anchored on registration rather than custody — see
// caseDeadline() in queries.js. That is stated on the surface rather than hidden, because a
// deadline whose basis is wrong is worse than no deadline.

const DAY = 86400000;

const dayDiff = (fromIso, toIso) => {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY);
};

// How a due date is spoken. "Due in 0 days" is not a sentence anyone says out loud, and the
// difference between overdue and due-today is the difference between an explanation and a
// task, so the two never share a phrasing.
function dueLabel(days) {
  if (days == null) return { label: 'no clock', tone: 'open' };
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'past' };
  if (days === 0) return { label: 'due today', tone: 'now' };
  if (days === 1) return { label: 'due tomorrow', tone: 'now' };
  if (days <= 7) return { label: `due in ${days} days`, tone: 'now' };
  return { label: `due in ${days} days`, tone: 'soon' };
}

const agoLabel = (days) => (days === 0 ? 'registered today'
  : days === 1 ? 'registered yesterday' : `registered ${days} days ago`);

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

// What a link between two cases actually IS. The pipeline names these in snake_case and the
// old surface printed them raw, so an officer read "mo similarity" and had to guess. The kind
// of evidence is the whole reason to open the other file, so it is spelled out.
const EDGE = {
  shared_offender: { chip: 'shared offender', phrase: 'names an offender who also appears on a case here' },
  mo_similarity: { chip: 'shared MO', phrase: 'was committed the same way as a case here' },
  same_location: { chip: 'same location', phrase: 'happened at the same place as a case here' },
  time_window: { chip: 'same time window', phrase: 'happened in the same window as a case here' },
  act_section: { chip: 'same sections', phrase: 'was registered under the same sections as a case here' },
};
const edgeOf = (t) => EDGE[t] || { chip: String(t || 'linked').replace(/_/g, ' '), phrase: 'shares evidence with a case here' };

// Shared-offender links are worth more than shared-MO ones: an offender is a name to arrest,
// a modus operandi is a hypothesis. When both are present the stronger evidence leads.
const EDGE_RANK = { shared_offender: 0, act_section: 1, same_location: 2, time_window: 3, mo_similarity: 4 };
const byEdgeStrength = (a, b) => (EDGE_RANK[a.edgeType] ?? 9) - (EDGE_RANK[b.edgeType] ?? 9)
  || (Number(b.strength) || 0) - (Number(a.strength) || 0);

// ---------------------------------------------------------------------------------------
// The clock, computed once over the scoped register and then sliced every way the three
// tiers need it. Doing this once matters for more than speed: when the station board and the
// district scoreboard are derived from separate passes they eventually disagree about how
// many cases fall due this week, and the officer who spots it stops believing both.
// ---------------------------------------------------------------------------------------
function buildClock(cases, deadlineOf) {
  const rows = [];
  for (const c of cases) {
    const dl = deadlineOf(c);
    if (!dl) continue;
    rows.push({ c, ...dl });
  }
  rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));
  const tally = { breached: 0, critical: 0, soon: 0, ok: 0 };
  for (const r of rows) if (tally[r.band] !== undefined) tally[r.band] += 1;
  return { rows, tally, total: rows.length };
}

const byKey = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = String(r.c[key] || '');
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

const countBands = (rows) => {
  const t = { breached: 0, critical: 0, soon: 0, ok: 0 };
  for (const r of rows) if (t[r.band] !== undefined) t[r.band] += 1;
  return t;
};

// ---------------------------------------------------------------------------------------
// STATION — the post that does the work. Objects are cases; the owner is the named IO.
// ---------------------------------------------------------------------------------------
function stationBlocks(ctx, clock) {
  const { asOf, cases, db, zoneRow, nearRepeat, linkedIn, offenders, scopeName } = ctx;
  const blocks = [];

  // A. The statutory clock. Critical and soon only: a board that also lists the 44 already
  //    breached is a board nobody reads, and the breached are reported as a standing debt
  //    beneath it instead, which is what they are.
  const due = clock.rows.filter((r) => r.band === 'critical' || r.band === 'soon');
  blocks.push({
    key: 'due',
    title: 'Falls due on this register',
    subtitle: `${clock.tally.critical} within 7 days, ${clock.tally.soon} within 21. `
      + `${clock.tally.breached} already past the window.`,
    kind: 'case',
    total: due.length,
    clearedNote: 'No charge-sheet on this register falls due in the next three weeks.',
    items: due.slice(0, 14).map((r) => {
      const when = dueLabel(r.daysRemaining);
      return {
        id: `due-${r.c.caseMasterId}`,
        title: `${r.c.crimeSubHead} — ${r.c.crimeNo}`,
        where: r.c.unitName,
        owner: r.c.ioName ? `IO ${r.c.ioName}` : 'No IO recorded',
        when,
        metric: `${r.allowedDays}-day window`,
        why: `${r.gravity} offence registered ${r.anchorDate}, so the ${r.allowedDays}-day `
          + `window closes ${r.dueDate}.`,
        action: r.daysRemaining < 0
          ? 'Past the window — record the reason for delay on the file before the next review.'
          : 'File the charge-sheet, or record on the file why more time is needed.',
        link: { page: 'case', id: String(r.c.caseMasterId) },
      };
    }),
  });

  // B. The first fortnight. Not a health flag — nothing is wrong with these yet, and that is
  //    exactly why they belong on a page about what to do today. A case is most solvable in
  //    the days after it is registered, and this is the only surface in the product that
  //    treats freshness as a reason to act rather than a reason to wait.
  const fresh = cases
    .filter((c) => String(c.statusId) === '1')
    .map((c) => ({ c, age: dayDiff(c.crimeRegisteredDate, asOf) }))
    .filter((x) => x.age != null && x.age >= 0 && x.age <= 14)
    .sort((a, b) => a.age - b.age);
  blocks.push({
    key: 'fresh',
    title: 'Registered in the last fortnight',
    subtitle: 'Still open, and still fresh. Evidence and witness memory decay fastest here.',
    kind: 'case',
    total: fresh.length,
    clearedNote: 'Nothing registered here in the last fortnight is still open.',
    items: fresh.slice(0, 12).map(({ c, age }) => {
      const accused = (db.children.accused.get(String(c.caseMasterId)) || []).length;
      return {
        id: `fresh-${c.caseMasterId}`,
        title: `${c.crimeSubHead} — ${c.crimeNo}`,
        where: c.unitName,
        owner: c.ioName ? `IO ${c.ioName}` : 'No IO recorded',
        when: { label: agoLabel(age), days: age, tone: age <= 3 ? 'now' : 'open' },
        metric: accused ? `${accused} accused named` : 'no accused named',
        why: accused
          ? `${accused} accused already named. ${c.linkedCount || 0} other case${c.linkedCount === 1 ? '' : 's'} share evidence with this one.`
          : `No accused named yet.${c.linkedCount ? ` ${c.linkedCount} other cases already share evidence with this one.` : ''}`,
        action: c.linkedCount
          ? 'Open the network first — a named offender on a linked case is the cheapest lead here.'
          : 'Record the next investigative step while the trail is warm.',
        link: { page: c.linkedCount ? 'graph' : 'case', id: String(c.caseMasterId) },
      };
    }),
  });

  // C. Windows that expire on their own. A near-repeat cluster and a pulsing head are not
  //    tasks with a filing date, but they do have an end — which is the only reason they
  //    qualify. Patrol instructions that never expire stop being followed.
  const windows = [];
  for (const cl of (nearRepeat.clusters || []).slice(0, 3)) {
    windows.push({
      id: `nr-${cl.cellId}`,
      title: `Repeat-victimisation window · ${cl.districtName}`,
      where: `${cl.incidents} incidents inside one ${nearRepeat.radiusM} m cluster`,
      owner: `Beat constable, ${scopeName}`,
      when: { label: `${nearRepeat.windowDays}-day window`, days: nearRepeat.windowDays, tone: 'now' },
      metric: `${cl.repeatRatePct}% near-repeat`,
      why: `${cl.repeatRatePct}% of incidents here follow an earlier one within `
        + `${nearRepeat.radiusM} m and ${nearRepeat.windowDays} days — median gap ${cl.medianGapDays} days. `
        + 'The address is being re-targeted, not merely busy.',
      action: 'Put the beat through these streets for the next fortnight and record the visits.',
      link: { page: 'map', query: { lat: String(cl.centroidLat), lng: String(cl.centroidLng) } },
    });
  }
  if (zoneRow && zoneRow.zone !== 'normal') {
    const up = Math.round((zoneRow.current - zoneRow.baseline) * 10) / 10;
    windows.push({
      id: `zone-${zoneRow.unitId}`,
      title: `This register is ${zoneRow.zone === 'red_pulsing' ? 'pulsing' : 'on watch'} this month`,
      where: zoneRow.unitName,
      owner: `SHO, ${zoneRow.unitName}`,
      when: { label: 'this month', days: null, tone: 'now' },
      metric: `+${up} over baseline`,
      why: `${zoneRow.current} cases against this station's own 12-month average of `
        + `${zoneRow.baseline} — ${zoneRow.zoneZ}σ out. Its own red line is `
        + `+${Math.round((zoneRow.thresholds?.redAt - zoneRow.baseline) * 10) / 10}.`,
      action: 'Identify what is driving the rise before the month closes and the figure is reported.',
      link: { page: 'cases', query: { unit: String(zoneRow.unitId) } },
    });
  }
  blocks.push({
    key: 'ground',
    title: 'Live on this ground',
    subtitle: 'Windows that close on their own, whether or not anyone acts.',
    kind: 'window',
    total: windows.length,
    clearedNote: 'No repeat-victimisation window is open and the register is inside its normal range.',
    items: windows,
  });

  // D. What arrives from outside. The one class of item a station register structurally
  //    cannot surface for itself, which is why it has to be pushed rather than waited for —
  //    and the clearest single demonstration of what the whole product is for.
  const reaching = [];
  for (const l of [...(linkedIn || [])].sort(byEdgeStrength).slice(0, 6)) {
    const e = edgeOf(l.edgeType);
    const mine = l.linkedToLocalCase ? db.cases.get(String(l.linkedToLocalCase)) : null;
    reaching.push({
      id: `in-${l.caseMasterId}`,
      title: `${l.crimeSubHead} — ${l.crimeNo}`,
      where: `${l.unitName}, ${l.districtName}`,
      owner: `IO at ${l.unitName}`,
      when: { label: 'standing', days: null, tone: 'open' },
      metric: e.chip,
      why: `Registered at ${l.unitName} and ${e.phrase}`
        + (mine ? ` — ${mine.crimeSubHead} ${mine.crimeNo}.` : '.')
        + ' Nothing in this station\'s own sheets would ever show the connection.',
      action: 'Open the network, then speak to the IO holding the other file.',
      link: { page: 'graph', id: String(l.caseMasterId) },
    });
  }
  for (const o of (offenders || []).slice(0, 4)) {
    reaching.push({
      id: `off-${o.offenderIdentityId}`,
      title: o.canonicalName,
      where: `${o.distinctCases} cases across ${o.distinctDistricts} district${o.distinctDistricts === 1 ? '' : 's'}`,
      owner: (o.distinctDistricts || 0) > 1 ? 'Needs district coordination' : `SHO, ${scopeName}`,
      when: { label: `active ${dayDiff(o.lastSeen, asOf)}d ago`, days: dayDiff(o.lastSeen, asOf), tone: 'now' },
      metric: `risk ${o.riskScore}`,
      why: (o.arrestCount || 0) === 0
        ? `Behaviour-based risk ${o.riskScore} and no arrest on record.`
        : `Behaviour-based risk ${o.riskScore}, ${o.arrestCount} prior arrests.`,
      action: (o.distinctDistricts || 0) > 1
        ? 'Works across district lines — raise it with the SP rather than pursuing locally.'
        : 'Review the linked cases for a current lead.',
      link: { page: 'offender', id: String(o.offenderIdentityId) },
    });
  }
  blocks.push({
    key: 'reaching',
    title: 'Reaching in from outside',
    subtitle: 'What this register cannot see for itself.',
    kind: 'link',
    total: reaching.length,
    clearedNote: 'No case outside this station currently links into it.',
    items: reaching,
  });

  return blocks;
}

// ---------------------------------------------------------------------------------------
// DISTRICT — the post that supervises. Objects are STATIONS, not cases.
//
// Karnataka practice is the design input here: a DCP visits roughly one station a day and an
// ACP two, and the visit is where cases under investigation are actually reviewed. So the
// district's first question is not "which case is worst" but "where do I go today, and what
// do I ask when I arrive" — and the second is answerable, because the clock knows.
// ---------------------------------------------------------------------------------------
function districtBlocks(ctx, clock) {
  const { stations, linkedIn, scopeName } = ctx;
  const blocks = [];

  const byUnit = byKey(clock.rows, 'unitId');
  const zoneByUnit = new Map(stations.map((s) => [String(s.unitId), s]));
  const districtBreachRate = pct(clock.tally.breached, clock.total);

  // Rank stations for the visit list. Weighted so an imminent statutory breach outruns a
  // large register: three points a case falling due this week, one a case due this month,
  // plus how far the station sits outside its own normal range. Volume is deliberately
  // absent — the biggest station is always the biggest, and visiting it every day is not
  // supervision, it is a habit.
  const ranked = [...byUnit.entries()].map(([unitId, rows]) => {
    const t = countBands(rows);
    const st = zoneByUnit.get(unitId) || {};
    const rate = pct(t.breached, rows.length);
    return {
      unitId,
      unitName: rows[0].c.unitName,
      districtName: rows[0].c.districtName,
      open: rows.length,
      ...t,
      breachRate: rate,
      zone: st.zone || 'normal',
      zoneZ: Number(st.zoneZ) || 0,
      changePct: st.changePct,
      score: t.critical * 3 + t.soon + Math.max(0, Number(st.zoneZ) || 0),
      ask: rows.filter((r) => r.band === 'critical' || r.band === 'soon').slice(0, 3),
    };
  }).sort((a, b) => b.score - a.score);

  const visits = ranked.filter((s) => s.score > 0).slice(0, 3);
  blocks.push({
    key: 'visit',
    title: 'Where to be, and what to ask',
    subtitle: 'One station a day is the supervisory cadence. These three are ordered by what '
      + 'is closest to failing, not by how large the register is.',
    kind: 'station',
    total: visits.length,
    clearedNote: 'No station in this district has a charge-sheet falling due inside three weeks.',
    items: visits.map((s, i) => ({
      id: `visit-${s.unitId}`,
      title: s.unitName,
      where: s.districtName,
      owner: `SHO, ${s.unitName}`,
      when: { label: i === 0 ? 'visit today' : i === 1 ? 'visit tomorrow' : 'this week', days: i, tone: i === 0 ? 'now' : 'soon' },
      metric: s.critical ? `${s.critical} due in 7d` : `${s.soon} due in 21d`,
      why: `${s.critical} charge-sheet${s.critical === 1 ? '' : 's'} fall${s.critical === 1 ? 's' : ''} due within a week and `
        + `${s.soon} within three; ${s.breached} of ${s.open} open cases are already past the window `
        + `(${s.breachRate}% against ${districtBreachRate}% across the district).`
        + (s.zone !== 'normal' ? ` The register is also ${s.zone === 'red_pulsing' ? 'pulsing' : 'on watch'} at ${s.zoneZ}σ.` : ''),
      action: s.ask.length
        ? `Ask about ${s.ask.map((r) => r.c.crimeNo).join(', ')} — the files closest to their window.`
        : 'Review the pendency register and the reasons recorded for delay.',
      refs: s.ask.map((r) => ({
        crimeNo: r.c.crimeNo, subHead: r.c.crimeSubHead, io: r.c.ioName,
        due: r.dueDate, days: r.daysRemaining, id: String(r.c.caseMasterId),
      })),
      link: { page: 'cases', query: { unit: s.unitId } },
    })),
  });

  // The scoreboard. A supervisor is not choosing between case files, they are choosing
  // between officers, so the unit of comparison is the station and the comparison is against
  // the district's own median rather than an absolute anyone can dispute.
  const board = ranked.filter((s) => s.critical || s.soon).slice(0, 12);
  blocks.push({
    key: 'clock',
    title: 'The charge-sheet clock, by station',
    subtitle: `${clock.tally.critical} cases fall due across ${scopeName} within 7 days, `
      + `${clock.tally.soon} within 21, and ${clock.tally.breached} are already past.`,
    kind: 'board',
    total: board.length,
    clearedNote: 'Nothing in this district falls due inside three weeks.',
    columns: ['Station', 'Due 7d', 'Due 21d', 'Past window', 'Open'],
    items: board.map((s) => ({
      id: `clk-${s.unitId}`,
      title: s.unitName,
      owner: `SHO, ${s.unitName}`,
      cells: [s.critical, s.soon, s.breached, s.open],
      breachRate: s.breachRate,
      districtRate: districtBreachRate,
      link: { page: 'cases', query: { unit: s.unitId } },
    })),
  });

  // Where supervision still buys something.
  //
  // The obvious block here would rank stations by pendency rate — and in this register that
  // would be noise, because the rate is nearly uniform (the spread is computed below and
  // printed, rather than assumed). When every station sits within a few points of the same
  // figure, the rate cannot tell a supervisor where to spend an afternoon.
  //
  // What does separate them is how many open cases are still INSIDE their window. A breached
  // pile is a standing debt that no visit next Tuesday will unmake; the cases still running
  // are the ones a supervisor can actually save, and they are distributed unevenly.
  // Describe the spread with quartiles rather than min-max. One unusually good station drags
  // the range from 93% down to 53% and makes "near-uniform" a false sentence; the middle half
  // is what actually tells a supervisor whether the rate discriminates between stations.
  const rates = ranked.filter((s) => s.open >= 20).map((s) => s.breachRate).sort((a, b) => a - b);
  const at = (f) => rates[Math.min(rates.length - 1, Math.floor(rates.length * f))];
  const spread = rates.length
    ? { lo: rates[0], hi: rates[rates.length - 1], p25: at(0.25), median: at(0.5), p75: at(0.75), n: rates.length }
    : null;
  const tight = spread && (spread.p75 - spread.p25) <= 12;
  const recover = ranked
    .map((s) => ({ ...s, recoverable: s.critical + s.soon + s.ok }))
    .filter((s) => s.recoverable > 0)
    .sort((a, b) => b.recoverable - a.recoverable)
    .slice(0, 8);
  blocks.push({
    key: 'recover',
    title: 'Where the effort still pays',
    subtitle: !spread ? 'Open cases still inside their statutory window, by station.'
      : tight
        ? `Half of these ${spread.n} stations sit between ${spread.p25}% and ${spread.p75}% past `
          + `their window, so the rate barely separates them. What does separate them is how many `
          + `cases are still inside it — and that is the only part a visit can change.`
        : `Pendency runs from ${spread.lo}% to ${spread.hi}% across ${spread.n} stations `
          + `(median ${spread.median}%). Rate tells you who is behind; this list tells you where `
          + `there is still something left to save.`,
    kind: 'station',
    total: recover.length,
    clearedNote: 'Every open case in this district is already past its window.',
    items: recover.map((s) => ({
      id: `rec-${s.unitId}`,
      title: s.unitName,
      where: s.districtName,
      owner: `SHO, ${s.unitName}`,
      when: { label: `${s.critical + s.soon} inside 21 days`, days: null, tone: s.critical ? 'now' : 'soon' },
      metric: `${s.recoverable} still running`,
      why: `${s.recoverable} of ${s.open} open cases have not yet passed their window — `
        + `${s.critical} due within 7 days, ${s.soon} within 21, ${s.ok} with longer to run. `
        + `The other ${s.breached} are a standing debt, not this week's work.`,
      action: 'Take the disposal plan for the cases still running, not the pendency total.',
      link: { page: 'cases', query: { unit: s.unitId } },
    })),
  });

  const refer = [...(linkedIn || [])].sort(byEdgeStrength).slice(0, 6).map((l) => {
    const e = edgeOf(l.edgeType);
    return {
      id: `ref-${l.caseMasterId}`,
      title: `${l.crimeSubHead} — ${l.crimeNo}`,
      where: `${l.unitName}, ${l.districtName}`,
      owner: `SP, ${l.districtName}`,
      when: { label: 'standing', days: null, tone: 'open' },
      metric: e.chip,
      why: `Registered at ${l.unitName} and ${e.phrase}. Neither SP sees the whole chain `
        + 'from their own register, so it is nobody\'s file until one of them takes it.',
      action: 'Refer to the other district and agree who leads before both investigate separately.',
      link: { page: 'graph', id: String(l.caseMasterId) },
    };
  });
  blocks.push({
    key: 'refer',
    title: 'Needs another district',
    subtitle: 'Cases whose evidence crosses your boundary.',
    kind: 'link',
    total: refer.length,
    clearedNote: 'No case outside this district currently links into it.',
    items: refer,
  });

  return blocks;
}

// ---------------------------------------------------------------------------------------
// STATE — the post that presses SPs. Objects are DISTRICTS, plus the one class of work no
// district can own. Deliberately contains no case rows at all: if the state's response to a
// problem is to open a file, the tier below has already failed and the file is not the fix.
// ---------------------------------------------------------------------------------------
function stateBlocks(ctx, clock) {
  const { zones, offenders, stations } = ctx;
  const blocks = [];

  const byDistrict = byKey(clock.rows, 'districtId');
  const stateRate = pct(clock.tally.breached, clock.total);
  const pulsingByDistrict = new Map();
  for (const s of stations) {
    if (s.zone !== 'red_pulsing') continue;
    const k = String(s.districtId);
    pulsingByDistrict.set(k, (pulsingByDistrict.get(k) || 0) + 1);
  }
  const zoneByDistrict = new Map((zones.districts || []).map((d) => [String(d.districtId), d]));

  const ranked = [...byDistrict.entries()].map(([districtId, rows]) => {
    const t = countBands(rows);
    const z = zoneByDistrict.get(districtId) || {};
    const rate = pct(t.breached, rows.length);
    const pulsing = pulsingByDistrict.get(districtId) || 0;
    return {
      districtId,
      districtName: rows[0].c.districtName,
      open: rows.length,
      ...t,
      breachRate: rate,
      excess: Math.round((rate - stateRate) * 10) / 10,
      pulsing,
      zone: z.zone || 'normal',
      driverHead: z.driverHead,
      score: t.critical * 2 + Math.max(0, rate - stateRate) + pulsing * 2,
    };
  }).sort((a, b) => b.score - a.score);

  // Who to speak to today, and the one sentence to open with. A DGP's scarcest resource is
  // attention, so this deliberately names five districts rather than ranking all thirty-one:
  // a list nobody can get through is the failure this whole page exists to correct.
  const calls = ranked.slice(0, 5);
  blocks.push({
    key: 'call',
    title: 'Superintendents to speak to today',
    subtitle: 'Ranked by what is closest to failing in each district, against the state\'s own norm.',
    kind: 'district',
    total: calls.length,
    clearedNote: 'No district is materially outside the state norm this week.',
    items: calls.map((d, i) => ({
      id: `call-${d.districtId}`,
      title: d.districtName,
      where: `${d.open.toLocaleString()} cases under investigation`,
      owner: `SP, ${d.districtName}`,
      when: { label: i === 0 ? 'first call' : 'today', days: i, tone: i === 0 ? 'now' : 'soon' },
      metric: `${d.critical} due in 7d`,
      why: `${d.critical} charge-sheets fall due within a week and ${d.soon} within three — `
        + `${d.critical + d.soon + d.ok} of ${d.open.toLocaleString()} open cases are still inside their window.`
        + (d.pulsing ? ` ${d.pulsing} station${d.pulsing === 1 ? '' : 's'} pulsing.` : '')
        + (d.driverHead && d.zone !== 'normal' ? ` The district is moving on ${d.driverHead}.` : ''),
      action: d.pulsing
        ? `Ask which stations are pulsing and what the SP has moved in response.`
        : 'Ask for the pendency statement by station and the disposal plan for the coming month.',
      link: { page: 'district', id: d.districtId },
    })),
  });

  // The state clock. One number a DGP can carry into a meeting, and the five districts that
  // hold most of it — because "15,645 past their window" is a fact nobody can act on and
  // "five districts hold a third of them" is an instruction.
  const topCritical = [...ranked].sort((a, b) => b.critical - a.critical).slice(0, 5);
  const heldByTop = topCritical.reduce((a, d) => a + d.critical, 0);
  blocks.push({
    key: 'clock',
    title: 'The state\'s charge-sheet clock',
    subtitle: `${clock.tally.critical} cases fall due within 7 days across Karnataka and `
      + `${clock.tally.soon} within 21. ${topCritical.length} districts hold `
      + `${pct(heldByTop, clock.tally.critical)}% of the week's load.`,
    kind: 'board',
    total: topCritical.length,
    clearedNote: 'Nothing falls due in the state inside three weeks.',
    columns: ['District', 'Due 7d', 'Due 21d', 'Past window', 'Open'],
    items: topCritical.map((d) => ({
      id: `sclk-${d.districtId}`,
      title: d.districtName,
      owner: `SP, ${d.districtName}`,
      cells: [d.critical, d.soon, d.breached, d.open],
      breachRate: d.breachRate,
      districtRate: stateRate,
      link: { page: 'district', id: d.districtId },
    })),
  });

  // The genuinely state-only job. An offender working three districts is invisible to each of
  // the three SPs individually and belongs to none of them; deciding who leads is a state
  // function, and it is the only item on this page that cannot be delegated downward.
  const cross = (offenders || [])
    .filter((o) => (o.distinctDistricts || 0) > 1)
    .sort((a, b) => (b.distinctDistricts - a.distinctDistricts) || (b.riskScore - a.riskScore))
    .slice(0, 6);
  blocks.push({
    key: 'coordinate',
    title: 'No single district can own these',
    subtitle: 'Offenders operating across district lines. Each SP sees a fragment; assigning '
      + 'the lead is a state decision and nobody below this tier can make it.',
    kind: 'offender',
    total: cross.length,
    clearedNote: 'No active offender currently spans more than one district.',
    items: cross.map((o) => ({
      id: `co-${o.offenderIdentityId}`,
      title: o.canonicalName,
      where: `${o.distinctDistricts} districts · ${o.distinctCases} cases`,
      owner: 'Unassigned — state to nominate a lead district',
      when: { label: 'standing', days: null, tone: 'now' },
      metric: `risk ${o.riskScore}`,
      why: `Cases in ${o.distinctDistricts} districts resolved to one identity. `
        + `Behaviour-based risk ${o.riskScore}`
        + ((o.arrestCount || 0) === 0 ? ', and no arrest on record.' : `, ${o.arrestCount} prior arrests.`),
      action: 'Nominate the lead district and tell the others to route through it.',
      link: { page: 'offender', id: String(o.offenderIdentityId) },
    })),
  });

  // A head moving in one district is that SP's problem. The same head moving in several at
  // once is not, and telling the two apart is the reason a state tier exists.
  const headCount = new Map();
  for (const d of (zones.districts || [])) {
    for (const cat of (d.categories || [])) {
      if (cat.zone !== 'red_pulsing') continue;
      const k = cat.crimeHead;
      if (!headCount.has(k)) headCount.set(k, []);
      headCount.get(k).push({ districtName: d.districtName, changePct: cat.changePct, z: cat.z });
    }
  }
  const systemic = [...headCount.entries()]
    .filter(([, ds]) => ds.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  blocks.push({
    key: 'systemic',
    title: 'Moving in more than one district at once',
    subtitle: 'A crime head above its own baseline in several districts in the same month. '
      + 'One district is a local problem; several at once is a state one.',
    kind: 'head',
    total: systemic.length,
    clearedNote: 'No crime head is pulsing in more than one district this month.',
    items: systemic.map(([head, ds]) => ({
      id: `sys-${head}`,
      title: head,
      where: ds.map((d) => d.districtName).join(', '),
      owner: 'State — no district owns this pattern',
      when: { label: 'this month', days: null, tone: 'soon' },
      metric: `${ds.length} districts`,
      why: `Above its own 12-month baseline in ${ds.length} districts simultaneously, `
        + `steepest in ${ds[0].districtName} at +${Math.round(ds[0].changePct)}%.`,
      action: 'Decide whether this is a state advisory or a set of separate district reviews.',
      link: { page: 'cases', query: { head } },
    })),
  });

  return blocks;
}

/**
 * Build the agenda.
 *
 * `ctx` carries inputs the query layer has already scoped, so this stays a pure shaping
 * function that cannot widen anyone's read boundary by accident — the same discipline the
 * worklist it replaces was written under, and the reason both live outside queries.js.
 */
function agenda(ctx) {
  const { tier, framing, scopeName, asOf, cases, deadlineOf } = ctx;
  const clock = buildClock(cases.filter((c) => String(c.statusId) === '1'), deadlineOf);

  const blocks = tier === 'station' ? stationBlocks(ctx, clock)
    : tier === 'district' ? districtBlocks(ctx, clock)
      : stateBlocks(ctx, clock);

  // The only counts on the page are counts of things that can be finished. "Open now" is
  // everything in a block that is not already past its window; the standing debt is reported
  // once, separately, so it never inflates the day's work.
  const openNow = blocks.reduce((a, b) => a + (b.items || []).length, 0);
  const dueWeek = clock.tally.critical;

  // A written summary, computed rather than generated. The model gets the same numbers and
  // usually phrases them better, but when it is unavailable the panel used to fall back to a
  // generic key-value dump -- "the day's agenda for this state commander: records in view
  // 16870" -- which is not a sentence anybody can act on. This is the floor.
  const running = clock.tally.critical + clock.tally.soon + clock.tally.ok;
  const lead = blocks.find((b) => (b.items || []).length);
  const nounForTier = tier === 'station' ? 'on this register'
    : tier === 'district' ? `across ${scopeName}` : `across ${scopeName}`;
  const summary = clock.total === 0
    ? `No case ${tier === 'station' ? 'on this register' : `in ${scopeName}`} is currently under investigation, so no charge-sheet window is running.`
    : `${clock.tally.critical} charge-sheet${clock.tally.critical === 1 ? '' : 's'} fall${clock.tally.critical === 1 ? 's' : ''} due `
      + `${nounForTier} within seven days and ${clock.tally.soon} more within three weeks. `
      + `${running.toLocaleString()} of ${clock.total.toLocaleString()} open cases are still inside their window; `
      + `${clock.tally.breached.toLocaleString()} are past it. `
      + (lead ? `Start with ${lead.items[0].title} — ${lead.items[0].owner}.` : 'Nothing else is outstanding.');

  return {
    tier,
    framing,
    scopeName,
    asOf,
    clock: { ...clock.tally, total: clock.total, breachRate: pct(clock.tally.breached, clock.total) },
    openNow,
    dueWeek,
    summary,
    blocks,
    basis: 'Every item here carries a date and a named post. The charge-sheet window is '
      + 'inferred from recorded gravity — Heinous 90 days, otherwise 60 — counted from the '
      + 'earliest arrest where one is recorded and from registration where none is. It is an '
      + 'indicator of the BNSS custody test, not legal advice.',
  };
}

module.exports = { agenda, dueLabel, buildClock };
