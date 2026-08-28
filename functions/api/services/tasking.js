// tasking.js — What Next, as a tasking board rather than another forecast.
//
// THE DISTINCTION THAT JUSTIFIES THIS TAB. Forecast answers "what will the numbers do?" — a
// projection with a measured backtest error. What Next answers "what should we do about it?" —
// areas, hours, units, offenders, a review date, and the measure that would show it worked.
// React answers "what is on fire now?". Three different claims: about the future, about action,
// about the present. In intelligence-led policing this action layer is the Tasking &
// Coordination product, and the platform had nothing doing that job.
//
// THE ONE RULE. Every task traces to a computed trigger — a zone, a forecast direction, an
// emerging hotspot, a running deadline. A recommendation that cannot name what produced it is
// the model editorialising, and it does not ship. So each task carries its trigger verbatim.
//
// Tier-shaped, because the doctrine products are:
//   state     a quarterly control strategy across districts (strategic)
//   district  a two-week deployment plan across stations (tactical)
//   station   tomorrow's beat and deadline list (operational)
const { load } = require('./store.mock');

// The busiest patrol window from the state heat grid: the (weekday, hour) band with the most
// incidents, expressed as a human window. Used to make deployment tasks specific about time.
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function peakWindow(heat) {
  if (!heat || !heat.length) return null;
  // Aggregate to hour-of-day, then find the 4-hour block with the most mass.
  const byHour = new Array(24).fill(0);
  for (const c of heat) byHour[c.hour] = (byHour[c.hour] || 0) + c.count;
  let best = 0, bestSum = -1;
  for (let h = 0; h < 24; h += 1) {
    let s = 0;
    for (let k = 0; k < 4; k += 1) s += byHour[(h + k) % 24];
    if (s > bestSum) { bestSum = s; best = h; }
  }
  const fmt = (h) => `${String(h).padStart(2, '0')}:00`;
  // Also the single busiest weekday.
  const byDow = new Array(7).fill(0);
  for (const c of heat) byDow[c.dow] = (byDow[c.dow] || 0) + c.count;
  const topDow = byDow.indexOf(Math.max(...byDow));
  return { from: fmt(best), to: fmt((best + 4) % 24), day: DOW[topDow] };
}

// The peak window for ONE area, from its own incidents. The state grid gives a single answer
// for all of Karnataka, and a deployment plan that hands every station the same window is not a
// plan — it is the state average wearing a station's name. Each task now carries the window its
// own ground actually peaks in.
function windowForCases(rows) {
  if (!rows || rows.length < 12) return null;   // too thin to claim a pattern
  const byHour = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  let n = 0;
  for (const c of rows) {
    const ts = c.incidentFromDate || '';
    if (ts.length < 13) continue;
    const hour = parseInt(ts.slice(11, 13), 10);
    const d = new Date(`${ts.slice(0, 10)}T00:00:00Z`);
    const day = d.getUTCDay();
    if (!Number.isFinite(hour) || Number.isNaN(day)) continue;
    byHour[hour] += 1;
    byDow[(day + 6) % 7] += 1;   // Mon-first, matching the pipeline
    n += 1;
  }
  if (n < 12) return null;
  let best = 0; let bestSum = -1;
  for (let h = 0; h < 24; h += 1) {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) sum += byHour[(h + k) % 24];
    if (sum > bestSum) { bestSum = sum; best = h; }
  }
  const fmt = (h) => `${String(h).padStart(2, '0')}:00`;
  const topDow = byDow.indexOf(Math.max(...byDow));
  return { from: fmt(best), to: fmt((best + 4) % 24), day: DOW[topDow],
    sharePct: Math.round((bestSum / n) * 100), n };
}

function reviewDate(asOf, days) {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function task(t) { return { id: t.id, ...t }; }

function build(user, ctx) {
  const db = load();
  const asOf = ctx.asOf;
  const tier = (user.roleMeta && user.roleMeta.tier) || 'state';
  const heat = (db.stats && db.stats.heat) || [];
  const win = peakWindow(heat);
  const zones = db.zones || { districts: [], stations: [] };
  const fc = db.forecast || { districts: [] };
  const tasks = [];

  if (tier === 'state') {
    // Strategic control strategy: the districts the pipeline marks Pulsing become quarterly
    // priorities, each tied to its own driver and its forecast direction.
    const pulsing = (zones.districts || []).filter((d) => d.zone === 'red_pulsing').slice(0, 6);
    const fcById = new Map((fc.districts || []).map((d) => [String(d.districtId), d]));
    pulsing.forEach((d, i) => {
      const f = fcById.get(String(d.districtId));
      tasks.push(task({
        id: `S${i + 1}`, horizon: 'This quarter', priority: i < 2 ? 'high' : 'medium',
        title: `Make ${d.districtName} a control-strategy priority`,
        area: d.districtName,
        trigger: `Pulsing: ${d.z != null ? `${d.z.toFixed(1)}σ` : ''} above its own baseline`
          + (d.driverHead ? `, driven by ${d.driverHead}` : '')
          + (f && f.direction === 'rising' ? `, forecast rising ${f.changePct}% next month` : ''),
        action: `Task the SP with a two-week deployment plan against ${d.driverHead || 'the leading crime head'}; `
          + 'review resourcing and inter-district links.',
        measure: `${d.driverHead || 'Head'} volume returns within one σ of baseline over the quarter`,
        reviewBy: reviewDate(asOf, 30),
        link: { to: `/map?district=${d.districtId}`, label: 'Open district' },
      }));
    });
    // A standing intelligence task off the state's busiest window.
    if (win) tasks.push(task({
      id: 'S0', horizon: 'Standing', priority: 'medium',
      title: `Weight night cover to the state peak window`,
      area: 'Karnataka', trigger: `Incidents peak ${win.day} ${win.from}–${win.to} across the state`,
      action: `Set the tasking meeting to protect ${win.from}–${win.to} cover in Pulsing districts before reallocating elsewhere.`,
      measure: 'Peak-window clearance holds while cover is rebalanced',
      reviewBy: reviewDate(asOf, 14), link: { to: '/map', label: 'Map' },
    }));
  } else if (tier === 'district') {
    const did = String(ctx.districtId || user.districtId || '');
    const stations = (zones.stations || []).filter((s) => String(s.districtId) === did && s.zone !== 'normal')
      .sort((a, b) => (b.z || 0) - (a.z || 0)).slice(0, 6);
    // A TWO-WEEK PLANNER, NOT A PILE OF CARDS. A tactical assessment turns into deployment only
    // once it says which station, in which week, on which day and in which window — that is what
    // a tasking meeting actually produces. The worst stations take week 1; the rest take week 2,
    // because a fortnight's cover cannot start everywhere at once and pretending otherwise is how
    // a plan becomes a wish list.
    stations.forEach((s, i) => {
      const u = db.lookups.units.get(String(s.unitId));
      const name = u ? u.UnitName : `Unit ${s.unitId}`;
      const week = i < 3 ? 1 : 2;
      const pulsing = s.zone === 'red_pulsing';
      // This station's own peak, falling back to the district-wide window only when the
      // station's own history is too thin to support a claim.
      const sw = windowForCases(db.caseList.filter((c) => String(c.unitId) === String(s.unitId))) || win;
      tasks.push(task({
        id: `D${i + 1}`, horizon: `Week ${week}`, week,
        priority: pulsing ? 'high' : 'medium',
        title: `Deploy to ${name}`,
        area: name,
        window: sw ? `${sw.day} ${sw.from}–${sw.to}` : null,
        windowShare: sw && sw.sharePct != null ? sw.sharePct : null,
        owner: `SHO ${name}`,
        trigger: `${pulsing ? 'Pulsing' : 'Elevated'}: ${s.z != null ? `${s.z.toFixed(1)}σ` : ''} above baseline`
          + (s.changePct != null ? `, ${s.changePct > 0 ? '+' : ''}${s.changePct}% vs baseline` : ''),
        action: sw
          ? `Add patrol cover ${sw.day} ${sw.from}–${sw.to} — this station's own busiest block, `
            + `carrying ${sw.sharePct}% of its incidents. Brief the SHO on the driver and set daily follow-up.`
          : 'Add patrol cover on the station’s peak window; brief the SHO and set daily follow-up.',
        measure: 'Station returns to Normal band within the fortnight',
        reviewBy: reviewDate(asOf, week === 1 ? 7 : 14),
        link: { to: `/cases?unit=${s.unitId}`, label: 'Station register' },
      }));
    });
    // The supervision rung the district actually owns: KSP practice is a DCP visiting one
    // station a day and an ACP two, reviewing cases under investigation. The plan names it
    // rather than leaving it implicit.
    if (stations.length) {
      tasks.push(task({
        id: 'D0', horizon: 'Week 1', week: 1, priority: 'medium',
        title: 'Station visits on the pulsing stations',
        area: stations.slice(0, 3).map((s) => (db.lookups.units.get(String(s.unitId)) || {}).UnitName).filter(Boolean).join(', ') || 'Top stations',
        window: 'Daily',
        owner: 'DySP / ACP',
        trigger: `${stations.filter((s) => s.zone === 'red_pulsing').length} station(s) pulsing against their own baseline`,
        action: 'Visit each, review cases under investigation on the spot, and report upward daily.',
        measure: 'Every pulsing station visited and its open pendency reviewed within the week',
        reviewBy: reviewDate(asOf, 7),
        link: { to: '/health', label: 'Health worklist' },
      }));
    }
    if (!stations.length && win) tasks.push(task({
      id: 'D0', horizon: 'Next two weeks', priority: 'low',
      title: 'Hold the line — no station is pulsing',
      area: 'District', trigger: 'No station above its baseline this cycle',
      action: `Maintain routine cover, weighted to ${win.day} ${win.from}–${win.to}; use the slack for pending-case clearance.`,
      measure: 'Pendency falls while no station enters the Watch band',
      reviewBy: reviewDate(asOf, 14), link: { to: '/health', label: 'Health worklist' },
    }));
  } else {
    // Station: tomorrow's list. Deadlines first, then the beat's own hotspots.
    const q = require('./queries');
    const dl = q.deadlines(user, { pageSize: 5 });
    (dl.items || []).slice(0, 5).forEach((c, i) => {
      tasks.push(task({
        id: `T${i + 1}`, horizon: c.band === 'breached' ? 'Overdue' : 'This week',
        priority: c.band === 'breached' || c.band === 'critical' ? 'high' : 'medium',
        title: `File / progress ${c.crimeNo}`,
        area: c.unit,
        trigger: c.band === 'breached'
          ? `Chargesheet deadline passed ${Math.abs(c.daysRemaining)}d ago (${c.gravity})`
          : `${c.daysRemaining}d to chargesheet deadline (${c.gravity})`,
        action: 'Confirm investigation status; escalate to the SHO if the file cannot be completed in time.',
        measure: 'Chargesheet filed or court extension sought before the date',
        reviewBy: c.dueDate, link: { to: `/cases/${c.caseMasterId}`, label: 'Open case' },
      }));
    });
    const myHot = ((db.hotspots && db.hotspots.hotspots) || [])
      .filter((h) => h.emergingFlag && String(h.districtId) === String(user.districtId)).slice(0, 2);
    myHot.forEach((h, i) => tasks.push(task({
      id: `TH${i + 1}`, horizon: 'This week', priority: 'medium',
      title: 'Patrol an emerging hotspot on the beat',
      area: `${h.centroidLat.toFixed(3)}, ${h.centroidLng.toFixed(3)}`,
      trigger: `${h.count} recent incidents clustered, far above the local baseline`,
      action: win ? `Walk the cluster ${win.from}–${win.to}; note repeat locations for near-repeat follow-up.`
        : 'Walk the cluster on the beat’s peak hours; note repeat locations.',
      measure: 'Cluster stops growing week on week',
      reviewBy: reviewDate(asOf, 7), link: { to: '/map', label: 'Map' },
    })));
  }

  return {
    tier,
    horizonLabel: tier === 'state' ? 'Quarterly control strategy'
      : tier === 'district' ? 'Two-week deployment plan' : 'This week',
    tasks,
    note: 'Every task traces to a computed trigger — a zone, a forecast, an emerging hotspot or '
      + 'a statutory deadline — shown on the card. What Next is about action; the projection it '
      + 'responds to lives in Forecast.',
  };
}

module.exports = { build };
