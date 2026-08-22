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
import math
import statistics

RECENT_DAYS = 60
BASELINE_MONTHS = 12

# Each area is judged against its OWN natural variation, not one shared constant.
#
# The previous MIN_ABS_DELTA = 6 was a flat floor applied to every area alike, and it failed
# in both directions at once. Bengaluru City runs a baseline near 200 FIRs a month, so +6 is
# a 3% wobble it clears without trying -- the gate never blocked anything there. Kodagu runs
# near 9, so +6 demanded a 67% surge before the district was even eligible for a colour. A
# real 40% rise in a small district was silently discarded. The board read 0 red, 0 yellow,
# 0 pulsing across all 31 districts, which is not calm policing -- it is a dead alert system.
#
# Monthly FIR counts are counts of many largely independent events, so they are approximately
# Poisson: the natural month-to-month variation around a baseline mean is sqrt(baseline).
# Scoring in units of that spread makes the bar self-adjusting --
#
#     Bengaluru  baseline 200 -> sigma 14.1 -> red needs roughly +42
#     Shivamogga baseline  21 -> sigma  4.6 -> red needs roughly +14
#     Kodagu     baseline   9 -> sigma  3.0 -> red needs roughly +9
#
# Small districts get a far lower bar in absolute cases while being held to the SAME
# statistical standard. That is the point: a surge is newsworthy relative to what that area
# normally looks like, which is the same argument per-capita analysis makes about volume.
Z_RED = 3.0        # ~3 sigma -- would occur by chance in well under 1% of quiet months
Z_YELLOW = 2.0     # ~2 sigma -- elevated, worth a look
Z_WATCH = 1.5      # early warning
# sqrt() alone is too permissive at the very bottom: a baseline of 1 gives sigma 1, so +2
# would score 2 sigma on what is almost certainly noise. Two extra FIRs is not an operation.
#
# But a single hard floor makes yellow unreachable, because yellow's whole job is small
# genuine movement. Hassan sat at z=2.01 (5 body-crime cases against a 2.1 baseline) and was
# discarded for being 0.1 cases under the floor -- a real 2-sigma signal lost to a rounding
# margin. So the floor is tiered: acting on an area needs a materially larger rise than
# merely watching it.
MIN_ABS_FLOOR = 3        # required to go red / pulsing -- something worth deploying against
MIN_ABS_WATCH = 2        # required to go yellow -- worth an eye, not a van


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

    def classify(current, baseline, previous):
        """Zone from how far above its OWN baseline an area sits, measured in Poisson sigma.

        Ratio alone cannot decide this. A station going 2.7 -> 7 is +162% and four extra
        cases; Bengaluru going 200 -> 240 is +20% and forty. The percentage says the small
        one is the emergency. Sigma says the opposite, and sigma is right: four extra cases
        is an ordinary month for a station that averages three, while forty extra is well
        outside anything Bengaluru normally does.

        Escalation to pulsing needs the rise to still be climbing. A spike that has already
        turned over needs review; one still accelerating needs someone today."""
        if baseline <= 0:
            return "normal", 0.0, 0.0
        ratio = current / baseline
        delta = current - baseline
        sigma = math.sqrt(baseline)
        z = delta / sigma if sigma > 0 else 0.0
        rising = current > previous
        if delta >= MIN_ABS_FLOOR:
            if z >= Z_RED:
                return ("red_pulsing" if rising else "red"), ratio, z
            if z >= Z_YELLOW:
                return ("red" if rising else "yellow"), ratio, z
            if z >= Z_WATCH:
                return "yellow", ratio, z
            return "normal", ratio, z
        # Below the action floor a strong signal can still be watched, never actioned.
        if delta >= MIN_ABS_WATCH and z >= Z_YELLOW:
            return "yellow", ratio, z
        return "normal", ratio, z

    def thresholds(baseline):
        """The absolute rise this area needs for each colour, so the UI can show its bar.

        Publishing this is most of the point. An officer in Shivamogga should be able to see
        that their red line sits at +14 and Bengaluru's at +42, rather than wondering why
        their district never lights up."""
        if baseline <= 0:
            return {}
        sigma = math.sqrt(baseline)
        return {
            "baseline": round(baseline, 1),
            "sigma": round(sigma, 2),
            "yellowAt": max(MIN_ABS_WATCH, round(Z_WATCH * sigma)),
            "redAt": max(MIN_ABS_FLOOR, round(Z_YELLOW * sigma)),
            "pulsingAt": max(MIN_ABS_FLOOR, round(Z_RED * sigma)),
        }

    name_of = {str(d.get("districtId")): d.get("districtName") for d in districts}

    out_d = []
    for d, per_month in by_district.items():
        base_vals = [per_month.get(m, 0) for m in hist]
        if not base_vals:
            continue
        baseline = statistics.mean(base_vals)
        current = per_month.get(last, 0)
        zone, ratio, z = classify(current, baseline, per_month.get(prev, 0))
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

        # Classify each crime head separately, not just the district total.
        #
        # The brief asks for an alert when "a specific crime category spikes in a region".
        # Summing every head first averages that away: a district can sit flat overall while
        # cyber crime doubles underneath, and the total-volume view calls it normal. Testing
        # per head is what makes the alert nameable -- "cyber crime in Dharwad, 3 sigma above
        # its own baseline" is something an officer can act on this week; "Dharwad: normal"
        # is not.
        cat_rows = []
        for h, hist_vals in base_heads.items():
            if len(hist_vals) < 3:
                continue                      # too little history to have a baseline
            h_base = statistics.mean(hist_vals)
            h_cur = cur_heads.get(h, 0)
            h_prev = by_district_head[d].get(prev, {}).get(h, 0)
            h_zone, h_ratio, h_z = classify(h_cur, h_base, h_prev)
            if h_zone == "normal":
                continue
            cat_rows.append({
                "crimeHead": h, "zone": h_zone, "current": h_cur,
                "baseline": round(h_base, 1), "z": round(h_z, 2),
                "changePct": round((h_ratio - 1) * 100, 1),
                "thresholds": thresholds(h_base),
            })
        cat_rows.sort(key=lambda r: -r["z"])

        # A district is as alarming as its worst category. Escalating here is the difference
        # between a board that reads "31 normal" and one that names what is actually moving.
        sev = {"red_pulsing": 3, "red": 2, "yellow": 1, "normal": 0}
        if cat_rows and sev[cat_rows[0]["zone"]] > sev[zone]:
            zone = cat_rows[0]["zone"]
            driver = cat_rows[0]["crimeHead"]
        out_d.append({
            "districtId": d,
            "districtName": name_of.get(d, d),
            "zone": zone,
            "current": current,
            "baseline": round(baseline, 1),
            "ratio": round(ratio, 2),
            "z": round(z, 2),
            "thresholds": thresholds(baseline),
            "changePct": round((ratio - 1) * 100, 1) if baseline else 0.0,
            "driverHead": driver,
            "driverDelta": round(driver_delta, 1),
            "categories": cat_rows,
            "categoryZ": cat_rows[0]["z"] if cat_rows else 0.0,
            "month": last,
        })

    # Rank by z, not ratio. Sorting on ratio puts the smallest areas on top by construction,
    # since a couple of extra cases is a huge percentage of a tiny baseline.
    out_d.sort(key=lambda r: -max(r["z"], r.get("categoryZ", 0.0)))

    out_s = []
    for u, per_month in by_unit.items():
        base_vals = [per_month.get(m, 0) for m in hist]
        if not base_vals or statistics.mean(base_vals) < 2:   # too small to be meaningful
            continue
        baseline = statistics.mean(base_vals)
        current = per_month.get(last, 0)
        zone, ratio, z = classify(current, baseline, per_month.get(prev, 0))
        if zone == "normal":
            continue
        out_s.append({
            "unitId": u,
            "districtId": (unit_district or {}).get(u, ""),
            "zone": zone, "current": current, "z": round(z, 2),
            "thresholds": thresholds(baseline),
            "baseline": round(baseline, 1), "ratio": round(ratio, 2),
            "changePct": round((ratio - 1) * 100, 1), "month": last,
        })
    out_s.sort(key=lambda r: -r["z"])

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
