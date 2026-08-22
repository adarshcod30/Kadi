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

# Each area is judged against its OWN observed variability -- not one shared constant, and
# not an assumed distribution either.
#
# Two earlier attempts both failed the same way. A flat MIN_ABS_DELTA = 6 was noise for
# Bengaluru (~390/month) and demanded a 67% surge from Kodagu (~9). Replacing it with a
# Poisson bar, sigma = sqrt(baseline), fixed the scaling but kept an assumption that the data
# does not support: Poisson requires variance == mean, and 177 of 298 stations are
# UNDER-dispersed (median observed_sd / sqrt(baseline) = 0.96, 10th percentile 0.72). For
# those, sqrt(baseline) overstates the natural swing and sets the bar too high -- Belagavi
# Industrial Area scored 2.65 sigma under Poisson but 3.87 against its own actual history.
# The board stayed almost entirely normal outside Bengaluru as a result.
#
# So the spread now comes from each area's own twelve months. A station that has held steady
# at 4 for a year is doing something genuinely unusual at 7; a station that swings 2-9
# routinely is not. Only its own record can tell those apart.
#
#     Belagavi Industrial   base 2.7  own sd 1.11  ->  7 cases is 3.9 sigma
#     Davanagere North      base 3.8  own sd 1.53  ->  7 cases is 2.1 sigma
#     Bengaluru Gate PS     base 4.0  own sd 2.45  -> 47 cases is 17.6 sigma
#
Z_RED = 2.5        # acted on
Z_YELLOW = 1.5     # watched
# A perfectly flat history gives sd 0, which would make any rise infinitely significant.
# This floor is a guard against that degenerate case, not a scale.
SD_FLOOR = 0.8
# Significance alone is not enough at small baselines, so a rise must also be materially
# large FOR THIS AREA. A relative test keeps that per-area: 25% of Bengaluru's 390 is ~98
# cases, 25% of a rural station's 4 is 1. That is the point -- the old flat floor of 3 was
# still a common scale wearing a different name.
MIN_RELATIVE_RISE = 0.25
MIN_ABS_RISE = 1.0   # it must actually go up; blocks rounding noise on tiny baselines        # required to go yellow -- worth an eye, not a van


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

    def classify(current, baseline, previous, spread=None):
        """Zone from how far above its OWN normal an area sits, measured in its own sigma.

        Ratio alone cannot decide this. A station going 2.7 -> 7 is +162% and four extra
        cases; Bengaluru going 390 -> 430 is +10% and forty. The percentage says the small
        one is the emergency. Its own history says both are -- and says why.

        Escalation to pulsing needs the rise to still be climbing. A spike that has already
        turned over needs review; one still accelerating needs someone today."""
        if baseline <= 0:
            return "normal", 0.0, 0.0
        ratio = current / baseline
        delta = current - baseline
        sigma = max(spread if spread is not None else math.sqrt(baseline), SD_FLOOR)
        z = delta / sigma
        if delta < MIN_ABS_RISE or (ratio - 1) < MIN_RELATIVE_RISE:
            return "normal", ratio, z
        # Acceleration separates red from pulsing red, and nothing else. Letting it also
        # promote yellow to red emptied the yellow tier entirely -- 5 pulsing, 3 red, 0
        # yellow -- because almost everything above baseline is, by definition, rising.
        rising = current > previous
        if z >= Z_RED:
            return ("red_pulsing" if rising else "red"), ratio, z
        if z >= Z_YELLOW:
            return "yellow", ratio, z
        return "normal", ratio, z

    def thresholds(baseline, spread=None):
        """The rise this area needs for each colour, so the UI can show its own bar.

        Publishing this is most of the point. An officer should be able to read that their
        station's red line sits at +3 while Bengaluru City's sits at +98, instead of
        wondering why their district never lights up."""
        if baseline <= 0:
            return {}
        sigma = max(spread if spread is not None else math.sqrt(baseline), SD_FLOOR)
        rel = baseline * MIN_RELATIVE_RISE
        return {
            "baseline": round(baseline, 1),
            "sigma": round(sigma, 2),
            "yellowAt": max(MIN_ABS_RISE, round(max(Z_YELLOW * sigma, rel), 1)),
            "redAt": max(MIN_ABS_RISE, round(max(Z_RED * sigma, rel), 1)),
        }

    name_of = {str(d.get("districtId")): d.get("districtName") for d in districts}

    out_d = []
    for d, per_month in by_district.items():
        base_vals = [per_month.get(m, 0) for m in hist]
        if not base_vals:
            continue
        baseline = statistics.mean(base_vals)
        spread = statistics.pstdev(base_vals) if len(base_vals) > 1 else None
        current = per_month.get(last, 0)
        zone, ratio, z = classify(current, baseline, per_month.get(prev, 0), spread)
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
            h_spread = statistics.pstdev(hist_vals) if len(hist_vals) > 1 else None
            h_cur = cur_heads.get(h, 0)
            h_prev = by_district_head[d].get(prev, {}).get(h, 0)
            h_zone, h_ratio, h_z = classify(h_cur, h_base, h_prev, h_spread)
            if h_zone == "normal":
                continue
            cat_rows.append({
                "crimeHead": h, "zone": h_zone, "current": h_cur,
                "baseline": round(h_base, 1), "z": round(h_z, 2),
                "changePct": round((h_ratio - 1) * 100, 1),
                "thresholds": thresholds(h_base, h_spread),
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
            "thresholds": thresholds(baseline, spread),
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
    all_s = {}
    for u, per_month in by_unit.items():
        base_vals = [per_month.get(m, 0) for m in hist]
        if not base_vals or statistics.mean(base_vals) < 2:   # too small to be meaningful
            continue
        baseline = statistics.mean(base_vals)
        spread = statistics.pstdev(base_vals) if len(base_vals) > 1 else None
        current = per_month.get(last, 0)
        zone, ratio, z = classify(current, baseline, per_month.get(prev, 0), spread)
        # Every station's own bar, whether or not it is lit. An officer whose station is
        # quiet still needs to see what would count as a rise here -- "why is my station
        # never red" deserves a number, not a shrug.
        all_s[u] = {
            "unitId": u, "zone": zone, "current": current, "z": round(z, 2),
            "baseline": round(baseline, 1), "changePct": round((ratio - 1) * 100, 1),
            "thresholds": thresholds(baseline, spread),
        }
        if zone == "normal":
            continue
        out_s.append({
            "unitId": u,
            "districtId": (unit_district or {}).get(u, ""),
            "zone": zone, "current": current, "z": round(z, 2),
            "thresholds": thresholds(baseline, spread),
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
        "stationBaselines": all_s,
        "summary": {
            "month": last,
            "baselineMonths": len(hist),
            "red_pulsing": counts["red_pulsing"], "red": counts["red"],
            "yellow": counts["yellow"], "normal": counts["normal"],
        },
    }
