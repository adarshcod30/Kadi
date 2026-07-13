"""
anomaly.py — case anomaly detection (IsolationForest) + false-case station anomalies.

Per crime head, an IsolationForest over transparent operational features flags cases that
deviate from their peers (unusual reporting delay / ageing / party counts). Separately we
flag stations whose false-case (cstype B) rate is a statistical outlier.

FAIRNESS: features are operational only — no caste / religion / occupation.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

import numpy as np
from sklearn.ensemble import IsolationForest

from common import assert_no_protected, parse_dt

ANOMALY_FEATURES = ["reporting_delay_hrs", "investigation_age_days", "num_accused", "num_victims"]
MIN_SAMPLES = 30


def compute(tables, today, station_false_rate):
    assert_no_protected(ANOMALY_FEATURES)
    cases = tables["CaseMaster"]

    acc = defaultdict(int)
    for row in tables["Accused"].itertuples(index=False):
        acc[row.CaseMasterID] += 1
    vic = defaultdict(int)
    for row in tables["Victim"].itertuples(index=False):
        vic[row.CaseMasterID] += 1

    by_head = defaultdict(list)
    for row in cases.itertuples(index=False):
        inc = parse_dt(row.IncidentFromDate)
        info = parse_dt(row.InfoReceivedPSDate)
        reg = parse_dt(row.CrimeRegisteredDate)
        delay = (info - inc).total_seconds() / 3600.0 if (inc and info) else 0.0
        age = (today - reg.date()).days if reg else 0
        feats = [delay, age, acc.get(row.CaseMasterID, 0), vic.get(row.CaseMasterID, 0)]
        by_head[row.CrimeMajorHeadID].append((row.CaseMasterID, row.CrimeNo, feats))

    case_anomalies = []
    for head, items in by_head.items():
        if len(items) < MIN_SAMPLES:
            continue
        X = np.array([f for _, _, f in items], dtype=float)
        model = IsolationForest(n_estimators=120, contamination=0.03, random_state=2026)
        model.fit(X)
        scores = model.score_samples(X)     # lower = more anomalous
        pred = model.predict(X)
        for (cid, crimeno, feats), s, p in zip(items, scores, pred):
            if p == -1:
                case_anomalies.append({
                    "caseMasterId": cid, "crimeNo": crimeno, "crimeHeadId": head,
                    "anomalyScore": round(float(-s), 3),
                    "features": dict(zip(ANOMALY_FEATURES, [round(float(x), 1) for x in feats])),
                    "reason": _explain(feats),
                })
    case_anomalies.sort(key=lambda a: a["anomalyScore"], reverse=True)

    # station false-case outliers (rate > mean + 2*std, min 4 false cases)
    rates = [v["rate"] for v in station_false_rate.values() if v["total"] >= 20]
    station_anoms = []
    if rates:
        mu = statistics.mean(rates)
        sd = statistics.pstdev(rates) or 0.0001
        for unit, v in station_false_rate.items():
            if v["total"] >= 20 and v["false"] >= 4 and v["rate"] > mu + 2 * sd:
                station_anoms.append({
                    "unitId": unit, "falseRate": v["rate"], "falseCases": v["false"],
                    "totalCases": v["total"], "peerMeanRate": round(mu, 3),
                    "reason": f"False-case rate {v['rate']:.0%} vs peer mean {mu:.0%}",
                })
    station_anoms.sort(key=lambda a: a["falseRate"], reverse=True)
    return {"caseAnomalies": case_anomalies, "stationAnomalies": station_anoms}


def _explain(feats):
    delay, age, na, nv = feats
    bits = []
    if delay >= 240:
        bits.append(f"very late reporting ({round(delay/24,1)}d)")
    if age >= 365:
        bits.append(f"ageing {age}d")
    if na >= 5:
        bits.append(f"{int(na)} accused")
    if nv >= 4:
        bits.append(f"{int(nv)} victims")
    return "Deviates from peers: " + (", ".join(bits) if bits else "unusual feature combination")
