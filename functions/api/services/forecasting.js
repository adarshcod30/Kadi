// forecasting.js — the forward-looking half: what is coming, and what changed.
//
// The Intelligence page explains what IS. This answers what is ABOUT TO BE, and it is the
// brief's items 4 and 6 — pattern and trend discovery, and ML-driven detection of hidden
// correlations, anomalies and emerging risk.
//
// Everything here is unsupervised or time-series. That is not a limitation, it is the honest
// consequence of measuring the data first: detection outcome in this corpus is essentially
// independent of case features (68.7% base rate, moving less than two points across crime
// head, linkage and gravity), so a supervised outcome model would predict the base rate for
// everything and call it intelligence. Trend, deviation and co-occurrence genuinely have
// structure, so those are what get modelled.
//
// See docs/10_REACT_FORECAST_PLAN.md §0.2 for the measurement.

const RECENT_DAYS = 90;

const iso = (d) => d.toISOString().slice(0, 10);
function shiftDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
const monthOf = (d) => String(d || '').slice(0, 7);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);


// Which trailing months are COMPLETE.
//
// Both the trend read and the emerging-risk baseline need "the last month we actually have all
// of", and both originally took that to be `months[length - 2]` -- the last month minus one,
// on the assumption that exactly one trailing month is partial because the extract was pulled
// mid-month.
//
// The write path broke that assumption the day it shipped. A single case registered today adds
// a new month holding one row, so the "partial" month slid one position and the analyses
// silently read a fortnight of July as a complete month: momentum reported -24% falling and
// emerging risk returned nothing at all, on a corpus that had not changed.
//
// So detect a partial month instead of assuming where it is. A trailing month counting less
// than PARTIAL_GUARD of the trailing median is cut, repeatedly -- which handles one stray live
// case, several, and the ordinary mid-month extract identically.
const PARTIAL_GUARD = 0.55;

function completeMonths(byMonth) {
  const months = [...byMonth.keys()].sort();
  while (months.length > 6) {
    const tail = byMonth.get(months[months.length - 1]) || 0;
    const prior = months.slice(-7, -1).map((m) => byMonth.get(m) || 0).sort((a, b) => a - b);
    const median = prior[Math.floor(prior.length / 2)] || 0;
    if (median && tail < PARTIAL_GUARD * median) months.pop();
    else break;
  }
  return months;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Emerging risk: which district × crime-type combinations are rising fastest against their OWN
 * history.
 *
 * Ranked by z-score rather than by size, deliberately. A district that always runs 400 cases a
 * month going to 430 is noise; one that runs 12 going to 40 is a signal, and only the second is
 * worth a commander's attention. Ranking by absolute rise would surface the first and bury the
 * second every time — which is the failure mode of every volume dashboard.
 */
function emergingRisk(rows, { limit = 12 } = {}) {
  // Bucket by district × sub-head × month.
  const series = new Map();
  const monthTotals = new Map();
  let maxMonth = '';
  for (const c of rows) {
    const m = monthOf(c.crimeRegisteredDate);
    if (!m) continue;
    monthTotals.set(m, (monthTotals.get(m) || 0) + 1);
    if (m > maxMonth) maxMonth = m;
    const key = `${c.districtId}|${c.crimeSubHeadId}`;
    let e = series.get(key);
    if (!e) {
      e = { districtId: c.districtId, districtName: c.districtName, subHeadId: c.crimeSubHeadId, subHead: c.crimeSubHead, months: new Map() };
      series.set(key, e);
    }
    e.months.set(m, (e.months.get(m) || 0) + 1);
  }
  if (!maxMonth) return { asOfMonth: null, items: [] };
  // Compare against the last COMPLETE month, not the last month with any row in it -- a
  // fortnight of data makes every series read as collapsing.
  const ordered = completeMonths(monthTotals);
  if (!ordered.length) return { asOfMonth: null, items: [], total: 0 };
  const current = ordered[ordered.length - 1];

  const out = [];
  for (const e of series.values()) {
    const now = e.months.get(current) || 0;
    // The baseline is every month before the current one. Fewer than six and the standard
    // deviation is not trustworthy enough to call anything unusual.
    const history = [...e.months.entries()].filter(([m]) => m < current).map(([, v]) => v);
    if (history.length < 6) continue;
    const base = mean(history);
    const sd = stdev(history);
    if (base < 3) continue;                 // too small for a rise to mean anything
    if (sd === 0) continue;
    const z = (now - base) / sd;
    if (z < 1.5 || now <= base) continue;
    out.push({
      key: `${e.districtId}-${e.subHeadId}`,
      districtId: String(e.districtId),
      districtName: e.districtName,
      subHeadId: String(e.subHeadId),
      subHead: e.subHead,
      current: now,
      baseline: Math.round(base * 10) / 10,
      changePct: Math.round(((now - base) / base) * 100),
      z: Math.round(z * 10) / 10,
      monthsOfHistory: history.length,
      severity: z >= 3 ? 'high' : z >= 2 ? 'medium' : 'info',
    });
  }
  out.sort((a, b) => b.z - a.z);
  return { asOfMonth: current, items: out.slice(0, limit), total: out.length };
}

/**
 * Pattern discovery: which crime types actually occur together.
 *
 * Association mining over district × month buckets, scored by LIFT — how much more often two
 * sub-heads co-occur than they would if they were independent. Raw co-occurrence counts would
 * just rank the two commonest crimes together in every district, which tells nobody anything.
 * Lift asks the useful question instead: given this crime is up here, what else is?
 */
function patterns(rows, { limit = 10, minSupport = 12 } = {}) {
  const buckets = new Map();      // district|month -> Set(subHeadId)
  const counts = new Map();       // subHeadId -> buckets containing it
  const labels = new Map();
  for (const c of rows) {
    const m = monthOf(c.crimeRegisteredDate);
    if (!m) continue;
    const bk = `${c.districtId}|${m}`;
    let set = buckets.get(bk);
    if (!set) { set = new Set(); buckets.set(bk, set); }
    set.add(String(c.crimeSubHeadId));
    labels.set(String(c.crimeSubHeadId), c.crimeSubHead);
  }
  const N = buckets.size;
  if (N < 12) return { buckets: N, items: [], total: 0, districts: 0 };

  for (const set of buckets.values()) for (const s of set) counts.set(s, (counts.get(s) || 0) + 1);

  const pairCounts = new Map();
  for (const set of buckets.values()) {
    const arr = [...set].sort();
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const k = `${arr[i]}|${arr[j]}`;
        pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
      }
    }
  }

  const items = [];
  for (const [k, together] of pairCounts.entries()) {
    if (together < minSupport) continue;
    const [a, b] = k.split('|');
    const pa = (counts.get(a) || 0) / N;
    const pb = (counts.get(b) || 0) / N;
    if (!pa || !pb) continue;
    const lift = (together / N) / (pa * pb);
    if (lift < 1.15) continue;
    items.push({
      key: k,
      a: labels.get(a) || a,
      b: labels.get(b) || b,
      aId: a,
      bId: b,
      together,
      lift: Math.round(lift * 100) / 100,
      // Stated in words, because "lift 1.4" means nothing to an officer.
      reading: `These appear together in ${pct(together, N)}% of district-months — ${Math.round((lift - 1) * 100)}% more often than if they were unrelated.`,
    });
  }
  items.sort((a, b) => b.lift - a.lift);
  // How many districts the buckets span, because it changes what an empty result MEANS. Lift
  // is measured against how often two types co-occur by chance; inside a single district both
  // common types appear in nearly every month, so chance is already near one and almost
  // nothing can rise above it. That is a property of the scope, not an absence of pattern, and
  // an empty panel that does not say so reads as "we found nothing" rather than "this reads at
  // state level".
  const districts = new Set([...buckets.keys()].map((k) => k.split('|')[0])).size;
  return { buckets: N, districts, total: items.length, items: items.slice(0, limit) };
}

/**
 * Momentum: the whole scope's own trajectory, as a monthly series with a plain reading.
 * The chart shows shape; this says which way it is going and by how much.
 */
function momentum(rows) {
  const byMonth = new Map();
  for (const c of rows) {
    const m = monthOf(c.crimeRegisteredDate);
    if (m) byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }
  if (byMonth.size < 6) return null;
  // Drop trailing PARTIAL months -- however many there are. Taking "the last one" on faith read
  // a fortnight of the extract month as a complete month the moment a live case opened a new
  // one, and reported the state as falling 24% on a corpus that had not changed.
  const complete = new Set(completeMonths(byMonth));
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const usable = months.filter(([m]) => complete.has(m));
  if (usable.length < 6) return null;
  const last3 = usable.slice(-3).map(([, v]) => v);
  const prev3 = usable.slice(-6, -3).map(([, v]) => v);
  const a = mean(last3);
  const b = mean(prev3);
  const changePct = b ? Math.round(((a - b) / b) * 100) : 0;
  return {
    series: usable.map(([month, count]) => ({ month, count })),
    recentAvg: Math.round(a),
    priorAvg: Math.round(b),
    changePct,
    direction: changePct > 5 ? 'rising' : changePct < -5 ? 'falling' : 'flat',
    note: 'Trailing partial months are excluded — a month with only a fortnight in it always reads as a fall.',
  };
}

/**
 * Time-of-day risk profile, as a deployable shift recommendation rather than a chart.
 */
function shiftProfile(rows) {
  const blocks = new Array(8).fill(0);
  let timed = 0;
  for (const c of rows) {
    if (!c.incidentFromDate || c.incidentFromDate.length < 13) continue;
    const hh = parseInt(c.incidentFromDate.slice(11, 13), 10);
    if (!Number.isFinite(hh)) continue;
    blocks[Math.floor(hh / 3)] += 1;
    timed += 1;
  }
  if (timed < 200) return null;
  const evenly = timed / 8;
  const ranked = blocks
    .map((count, i) => ({
      from: `${String(i * 3).padStart(2, '0')}:00`,
      to: `${String((i * 3 + 3) % 24).padStart(2, '0')}:00`,
      count,
      sharePct: pct(count, timed),
      lift: Math.round((count / evenly) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);
  return { timed, evenShare: Math.round((100 / 8) * 10) / 10, blocks: ranked };
}

module.exports = { emergingRisk, patterns, momentum, shiftProfile, RECENT_DAYS, shiftDays };
