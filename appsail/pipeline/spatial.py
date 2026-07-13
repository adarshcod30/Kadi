"""
spatial.py — spatiotemporal hotspots + emerging-trend detection.

DBSCAN clusters incident coordinates per crime head into hotspot cells; for each cell we
compare the recent window against the historical baseline rate to flag emerging trends.
Also produces district-level counts for the choropleth. FAIRNESS: geography + time only.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

import numpy as np
from sklearn.cluster import DBSCAN

from common import parse_dt

EPS_DEG = 0.004          # ~450 m
MIN_SAMPLES = 8
RECENT_WINDOW_DAYS = 60


def compute(tables, today):
    cases = tables["CaseMaster"]
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()

    # Detect per crime SUB-head so a specific spike (e.g. MV-theft) stands out from the
    # general crime density of an area.
    by_group = defaultdict(list)   # (head, subhead) -> list of (cid, lat, lng, dt)
    district_counts = defaultdict(int)
    for row in cases.itertuples(index=False):
        try:
            lat, lng = float(row.latitude), float(row.longitude)
        except (TypeError, ValueError):
            continue
        dt = parse_dt(row.IncidentFromDate) or parse_dt(row.CrimeRegisteredDate)
        by_group[(row.CrimeMajorHeadID, row.CrimeMinorHeadID)].append((row.CaseMasterID, lat, lng, dt))
        district_counts[unit_district.get(row.PoliceStationID, "")] += 1

    recent_cutoff = today - timedelta(days=RECENT_WINDOW_DAYS)
    hotspots = []
    cell_id = 0
    for (head, subhead), items in by_group.items():
        if len(items) < MIN_SAMPLES:
            continue
        coords = np.array([[la, lo] for _, la, lo, _ in items])
        labels = DBSCAN(eps=EPS_DEG, min_samples=MIN_SAMPLES).fit_predict(coords)
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
            hotspots.append({
                "cellId": f"HS{cell_id:05d}",
                "crimeHeadId": head,
                "crimeSubHeadId": subhead,
                "centroidLat": round(float(np.mean(lats)), 5),
                "centroidLng": round(float(np.mean(lngs)), 5),
                "count": total,
                "recentCount": recent,
                "baselineExpected": round(baseline_rate, 1),
                "emergingFlag": bool(emerging),
                "caseIds": [m[0] for m in members][:200],
                "computedTs": today.isoformat(),
            })

    hotspots.sort(key=lambda h: (h["emergingFlag"], h["recentCount"]), reverse=True)
    return {"hotspots": hotspots, "districtCounts": dict(district_counts)}
