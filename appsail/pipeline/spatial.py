"""
spatial.py — spatiotemporal hotspots + emerging-trend detection.

DBSCAN clusters incident coordinates per crime head into hotspot cells; for each cell we
compare the recent window against the historical baseline rate to flag emerging trends.
Also produces district-level counts for the choropleth. FAIRNESS: geography + time only.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta

import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors

from common import parse_dt

# A single global (eps, min_samples) is a Bengaluru-shaped assumption. At ~450 m and 8
# incidents, only a metro's density can ever form a cluster: every one of the 52 hotspots
# this produced sat in district 1, while Mysuru's 2,538 geocoded FIRs and Bengaluru Rural's
# 2,150 produced none at all. That is not an absence of hotspots, it is a threshold that
# only one district can reach -- the same failure as a flat zone floor, in the spatial
# dimension.
#
# So the neighbourhood is sized from each district's OWN point spread, and the support
# requirement scales with how much data the district actually has.
EPS_DEG = 0.004          # ~450 m -- the metro default, and the floor for dense districts
EPS_MAX_DEG = 0.02       # ~2.2 km -- ceiling, past which a "hotspot" is just a town
MIN_SAMPLES = 8          # metro support
MIN_SAMPLES_FLOOR = 4    # below this a cluster is an anecdote, whatever the district size
RECENT_WINDOW_DAYS = 60


def district_density_params(points):
    """Neighbourhood size and support for one district, from its own geometry.

    eps is set from the median nearest-neighbour distance among the district's incidents:
    it asks "how far apart do crimes in this district normally sit?" and calls anything
    meaningfully tighter than that a cluster. A rural district gets a wider net because its
    incidents are genuinely further apart, not because the bar was lowered for it."""
    n = len(points)
    if n < MIN_SAMPLES_FLOOR:
        return None
    arr = np.asarray(points)
    # Sampling keeps this linear-ish on the metro districts; the median is stable well
    # before the full set.
    if n > 4000:
        idx = np.linspace(0, n - 1, 4000).astype(int)
        arr_s = arr[idx]
    else:
        arr_s = arr
    nn = NearestNeighbors(n_neighbors=2).fit(arr_s)
    dist, _ = nn.kneighbors(arr_s)
    median_nn = float(np.median(dist[:, 1]))
    eps = min(EPS_MAX_DEG, max(EPS_DEG, median_nn * 3.0))
    # Support scales with the district's volume, floored so a handful of points can never
    # constitute a hotspot.
    min_samples = int(max(MIN_SAMPLES_FLOOR, min(MIN_SAMPLES, round(n / 500))))
    return {"eps": eps, "minSamples": min_samples, "medianNN": round(median_nn, 5), "points": n}


# A 6-hour window is the operational unit here: it is roughly a patrol shift, so a finding
# expressed in these terms converts directly into a deployment decision.
SHIFT_WINDOWS = [
    ("00:00-06:00", range(0, 6)),
    ("06:00-12:00", range(6, 12)),
    ("12:00-18:00", range(12, 18)),
    ("18:00-24:00", range(18, 24)),
]


def temporal_profile(dts):
    """When, within the week, this spatial cluster actually offends.

    Concentration is reported against what a flat distribution would give, not as a bare
    percentage. 30% of cases in a 6-hour window sounds unremarkable until you note that an
    even spread would put 25% there; 60% is a genuine pattern worth staffing against. The
    ratio is the part a commander can act on."""
    if not dts:
        return None
    hours = [d.hour for d in dts]
    dows = [d.weekday() for d in dts]          # 0 = Monday
    n = len(dts)

    counts = []
    for label, rng in SHIFT_WINDOWS:
        c = sum(1 for h in hours if h in rng)
        counts.append({"window": label, "count": c, "share": round(100.0 * c / n, 1)})
    peak = max(counts, key=lambda x: x["count"])

    weekend = sum(1 for d in dows if d >= 5)
    # Two of seven days are weekend, so an even spread gives ~28.6%.
    weekend_share = round(100.0 * weekend / n, 1)

    # Is the peak concentration more than chance? With four windows, a small cluster lands
    # entirely in one of them fairly often -- a 4-case cluster does it about 1.6% of the
    # time, and across ~190 clusters that is roughly three false "100% concentrated"
    # findings. Ranking on raw share would put those at the top, which is the same mistake
    # as ranking zones by percentage.
    #
    # Exact binomial tail: P(at least k of n in a given window | uniform), times 4 windows
    # because the peak is chosen after looking (a Bonferroni correction for the search).
    k, n_ = peak["count"], n
    tail = sum(math.comb(n_, i) * (0.25 ** i) * (0.75 ** (n_ - i)) for i in range(k, n_ + 1))
    p_value = min(1.0, tail * len(SHIFT_WINDOWS))

    return {
        "windows": counts,
        "peakWindow": peak["window"],
        "peakCount": k,
        "pValue": round(p_value, 5),
        # Only clusters whose timing beats chance are worth staffing against.
        "timeConcentrated": bool(p_value < 0.01),
        "peakShare": peak["share"],
        # >1 means this cluster is concentrated in its peak shift rather than spread evenly.
        "concentration": round(peak["share"] / 25.0, 2),
        "weekendShare": weekend_share,
        "weekendSkew": round(weekend_share / 28.6, 2),
        "nightShare": round(100.0 * sum(1 for h in hours if h >= 22 or h < 6) / n, 1),
    }


def compute(tables, today):
    cases = tables["CaseMaster"]
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()

    # Detect per crime SUB-head so a specific spike (e.g. MV-theft) stands out from the
    # general crime density of an area.
    # Grouped by DISTRICT as well as crime sub-head, because the clustering parameters are
    # now per district. Detecting per sub-head keeps a specific spike (e.g. MV-theft) from
    # being buried under an area's general crime density.
    by_group = defaultdict(list)   # (district, head, subhead) -> [(cid, lat, lng, dt)]
    by_district_pts = defaultdict(list)
    district_counts = defaultdict(int)
    for row in cases.itertuples(index=False):
        try:
            lat, lng = float(row.latitude), float(row.longitude)
        except (TypeError, ValueError):
            continue
        dt = parse_dt(row.IncidentFromDate) or parse_dt(row.CrimeRegisteredDate)
        did = str(unit_district.get(row.PoliceStationID, ""))
        by_group[(did, row.CrimeMajorHeadID, row.CrimeMinorHeadID)].append(
            (row.CaseMasterID, lat, lng, dt))
        by_district_pts[did].append([lat, lng])
        district_counts[did] += 1

    # One set of density parameters per district, derived from that district's own spread.
    params = {d: district_density_params(pts) for d, pts in by_district_pts.items()}

    recent_cutoff = today - timedelta(days=RECENT_WINDOW_DAYS)
    hotspots = []
    cell_id = 0
    for (did, head, subhead), items in by_group.items():
        pr = params.get(did)
        if not pr or len(items) < pr["minSamples"]:
            continue
        coords = np.array([[la, lo] for _, la, lo, _ in items])
        labels = DBSCAN(eps=pr["eps"], min_samples=pr["minSamples"]).fit_predict(coords)
        clusters = defaultdict(list)
        for idx, lab in enumerate(labels):
            if lab >= 0:
                clusters[lab].append(items[idx])
        for lab, members in clusters.items():
            lats = [m[1] for m in members]
            lngs = [m[2] for m in members]
            dts = [m[3] for m in members if m[3]]
            if not dts:
                continue
            total = len(members)
            recent = sum(1 for d in dts if d.date() >= recent_cutoff)
            first = min(dts).date()
            base_days = max((recent_cutoff - first).days, 1)
            baseline_rate = (total - recent) / base_days * RECENT_WINDOW_DAYS
            emerging = recent >= MIN_SAMPLES and recent > max(baseline_rate * 1.8, 6)
            cell_id += 1
            tp = temporal_profile(dts)
            hotspots.append({
                "cellId": f"HS{cell_id:05d}",
                "districtId": did,
                # Published so the map can explain why a rural cluster is drawn wider: it is
                # a different neighbourhood size, not a lower standard.
                "clusterParams": {"epsDeg": round(pr["eps"], 5), "minSamples": pr["minSamples"]},
                "crimeHeadId": head,
                "crimeSubHeadId": subhead,
                "centroidLat": round(float(np.mean(lats)), 5),
                "centroidLng": round(float(np.mean(lngs)), 5),
                "count": total,
                "recentCount": recent,
                "baselineExpected": round(baseline_rate, 1),
                "emergingFlag": bool(emerging),
                "caseIds": [m[0] for m in members][:200],
                # The brief asks for hotspots found by "layering time of day with location".
                # A cluster that is purely spatial tells a commander WHERE but not WHEN, and
                # "when" is what turns a map into a shift roster.
                "temporal": tp,
                "computedTs": today.isoformat(),
            })

    hotspots.sort(key=lambda h: (h["emergingFlag"], h["recentCount"]), reverse=True)
    return {"hotspots": hotspots, "districtCounts": dict(district_counts)}
