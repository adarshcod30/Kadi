"""zones.py — district and station zone status, computed against each area's OWN baseline.

The brief asks for "emerging trend alerts" with "visual indicators (e.g. red-zone pulsing)
when a specific crime category spikes in a region compared to historical averages". The
operative words are *compared to historical averages* -- not "where crime is high".

A district with consistently high volume is not news; everyone knows about it. A district
running well above its own trailing baseline is news, even if its absolute numbers are
modest. Ranking by volume would just re-rank by population, which is the exact failure the
per-capita analysis exists to correct.

Zones:
    normal        within expected range
    yellow        elevated, worth watching
    red           significantly above its own baseline
    red_pulsing   above baseline AND still accelerating

Acceleration is what separates red from pulsing red: a spike that has already peaked needs
review, one that is still climbing needs someone today.
"""
from collections import defaultdict
import statistics

RECENT_DAYS = 60
MIN_ABS_DELTA = 6      # a rise must be worth acting on, not just a large percentage
BASELINE_MONTHS = 12


def _month(d):
    return str(d)[:7]


def compute(cases, districts, unit_district=None, last_month=None):
    """Return {districts: [...], stations: [...], summary: {...}}."""
    by_district = defaultdict(lambda: defaultdict(int))   # district -> month -> count
    by_district_head = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    by_unit = defaultdict(lambda: defaultdict(int))

    for c in cases:
        m = _month(c.get("crimeRegisteredDate") or "")
        if not m:
            continue
        d = str(c.get("districtId") or "")
        by_district[d][m] += 1
        by_district_head[d][m][c.get("crimeHead") or "Other"] += 1
        u = str(c.get("unitId") or "")
        if u:
            by_unit[u][m] += 1

    months = sorted({m for dd in by_district.values() for m in dd})
    if not months:
        return {"districts": [], "stations": [], "summary": {}}
    # The final month in the data is the one still in progress, so it holds a fraction of a
    # normal month's FIRs. Measuring against it makes every district look like it is
    # collapsing -- the first run of this reported all 31 districts down 60-78%. Use the last
    # COMPLETE month, exactly as the forecast does.
    last = last_month or (months[-2] if len(months) > 1 else months[-1])
    hist = [m for m in months if m < last][-BASELINE_MONTHS:]
    prev = hist[-1] if hist else last

    def classify(current, baseline, previous, min_delta=MIN_ABS_DELTA):
        """Zone from the ratio to baseline, escalated if still accelerating.

        Ratio alone is not enough. A station going from 2.7 to 7 is +162%, and it is four
        extra cases -- noise wearing a big percentage. Requiring a material absolute rise as
        well is what stops the board filling with alerts nobody can act on. If everything
        pulses red, nothing does."""
        if baseline <= 0:
            return "normal", 0.0
        ratio = current / baseline
        if (current - baseline) < min_delta:
            return ("yellow" if ratio >= 1.30 else "normal"), ratio
        rising = current > previous
        if ratio >= 1.60:
            return ("red_pulsing" if rising else "red"), ratio
        if ratio >= 1.30:
            return ("red" if rising else "yellow"), ratio
        if ratio >= 1.15:
            return "yellow", ratio
        return "normal", ratio

    name_of = {str(d.get("districtId")): d.get("districtName") for d in districts}

    out_d = []
    for d, per_month in by_district.items():
        base_vals = [per_month.get(m, 0) for m in hist]
        if not base_vals:
            continue
        baseline = statistics.mean(base_vals)
        current = per_month.get(last, 0)
        zone, ratio = classify(current, baseline, per_month.get(prev, 0))
        # which crime head moved most, so the alert can name a cause rather than a number
        cur_heads = by_district_head[d].get(last, {})
        base_heads = defaultdict(list)
        for m in hist:
            for h, n in by_district_head[d].get(m, {}).items():
                base_heads[h].append(n)
        driver, driver_delta = None, 0.0
        for h, n in cur_heads.items():
            b = statistics.mean(base_heads[h]) if base_heads.get(h) else 0
            if b > 0 and (n - b) > driver_delta:
                driver, driver_delta = h, n - b
        out_d.append({
            "districtId": d,
            "districtName": name_of.get(d, d),
            "zone": zone,
            "current": current,
            "baseline": round(baseline, 1),
            "ratio": round(ratio, 2),
            "changePct": round((ratio - 1) * 100, 1) if baseline else 0.0,
            "driverHead": driver,
            "driverDelta": round(driver_delta, 1),
            "month": last,
        })

    out_d.sort(key=lambda r: (-r["ratio"]))

    out_s = []
    for u, per_month in by_unit.items():
        base_vals = [per_month.get(m, 0) for m in hist]
        if not base_vals or statistics.mean(base_vals) < 2:   # too small to be meaningful
            continue
        baseline = statistics.mean(base_vals)
        current = per_month.get(last, 0)
        zone, ratio = classify(current, baseline, per_month.get(prev, 0))
        if zone == "normal":
            continue
        out_s.append({
            "unitId": u,
            "districtId": (unit_district or {}).get(u, ""),
            "zone": zone, "current": current,
            "baseline": round(baseline, 1), "ratio": round(ratio, 2),
            "changePct": round((ratio - 1) * 100, 1), "month": last,
        })
    out_s.sort(key=lambda r: -r["ratio"])

    counts = defaultdict(int)
    for r in out_d:
        counts[r["zone"]] += 1
    return {
        "districts": out_d,
        "stations": out_s[:60],
        "summary": {
            "month": last,
            "baselineMonths": len(hist),
            "red_pulsing": counts["red_pulsing"], "red": counts["red"],
            "yellow": counts["yellow"], "normal": counts["normal"],
        },
    }
