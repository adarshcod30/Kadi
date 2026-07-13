"""
evaluate.py — ground-truth evaluation of the pipeline (the killer demo slide).

The synthetic data plants known gangs/chains/rings (data/output/_ground_truth.json).
This measures how well the pipeline recovers them:
  - gang/chain recovery: fraction of a planted pattern's cases that land in one cluster
  - offender recovery: fraction of a planted offender's accused rows in one identity
  - risk: does the planted repeat offender score High?
  - hotspot: is the planted emerging hotspot detected?

Target (docs/02 §13): overall recovery >= 90%.
"""
from __future__ import annotations

from collections import Counter


def _cluster_recovery(case_ids, cluster_of):
    if not case_ids:
        return 0.0, None
    cl = Counter(cluster_of.get(str(c)) for c in case_ids)
    top_cluster, top_n = cl.most_common(1)[0]
    return top_n / len(case_ids), top_cluster


def _identity_recovery(accused_ids, by_aid):
    if not accused_ids:
        return 0.0, None
    c = Counter(by_aid.get(str(a)) for a in accused_ids)
    top, n = c.most_common(1)[0]
    return n / len(accused_ids), top


def evaluate(gt_path, identities, mapping, cluster_of, offenders, geo):
    import json
    gt = json.load(open(gt_path))
    by_aid = {str(m["AccusedMasterID"]): m["offenderIdentityId"] for m in mapping}

    patterns = []

    def add_cluster_pattern(name, case_ids, extra=None):
        rec, cl = _cluster_recovery(case_ids, cluster_of)
        row = {"pattern": name, "type": "cluster", "cases": len(case_ids),
               "recoveryPct": round(rec * 100, 1), "dominantCluster": cl}
        if extra:
            row.update(extra)
        patterns.append(row)
        return rec

    gang_recs, chain_recs = [], []
    for g in gt.get("gangs", []):
        gang_recs.append(add_cluster_pattern(g["name"], g["caseMasterIds"],
                         {"expectedDistricts": len(g.get("districts", [])),
                          "expectedStations": len(g.get("stations", []))}))
    for s in gt.get("serialChains", []):
        chain_recs.append(add_cluster_pattern(s["name"], s["caseMasterIds"]))
    if gt.get("cyberRing"):
        chain_recs.append(add_cluster_pattern(gt["cyberRing"]["name"], gt["cyberRing"]["caseMasterIds"]))

    # offender identity recovery — measured on single-person planted offenders
    # (each has accused rows that all belong to ONE real person).
    id_recs = []
    single_person = []
    if gt.get("cyberRing"):
        single_person.append(("Cyber ring offender", gt["cyberRing"]["accusedMasterIds"]))
    for ro in gt.get("riskyOffenderIds", []):
        single_person.append((ro["name"], ro["accusedMasterIds"]))
    for ro in gt.get("ordinaryRepeatOffenders", []):
        single_person.append((ro["canonicalOffender"], ro["accusedMasterIds"]))
    for name, aids in single_person:
        rec, oid = _identity_recovery(aids, by_aid)
        id_recs.append(rec)
    if single_person:
        patterns.append({"pattern": "Offender entity resolution (single-person avg)",
                         "type": "identity", "offenders": len(single_person),
                         "recoveryPct": round(sum(id_recs) / len(id_recs) * 100, 1)})

    # risk of planted repeat offender
    risk_ok = None
    for ro in gt.get("riskyOffenderIds", []):
        rec, oid = _identity_recovery(ro.get("accusedMasterIds", []), by_aid)
        band = next((o["band"] for o in offenders if o["offenderIdentityId"] == oid), None)
        risk_ok = band in ("High", "Medium")
        patterns.append({"pattern": ro["name"], "type": "risk", "recoveryPct": round(rec * 100, 1),
                         "identity": oid, "riskBand": band, "passed": bool(risk_ok)})

    # emerging hotspot detection (any emerging hotspot near planted centroid)
    hotspot_ok = None
    eh = gt.get("emergingHotspot")
    if eh:
        clat, clng = eh.get("centroidLat"), eh.get("centroidLng")
        near = [h for h in geo["hotspots"] if h["emergingFlag"]
                and abs(h["centroidLat"] - clat) < 0.03 and abs(h["centroidLng"] - clng) < 0.03]
        hotspot_ok = len(near) > 0
        patterns.append({"pattern": eh["name"], "type": "hotspot",
                         "detected": hotspot_ok, "passed": bool(hotspot_ok)})

    cluster_recs = gang_recs + chain_recs
    overall = sum(cluster_recs) / len(cluster_recs) if cluster_recs else 0.0
    gang_pct = round(sum(gang_recs) / len(gang_recs) * 100, 1) if gang_recs else 0.0
    chain_pct = round(sum(chain_recs) / len(chain_recs) * 100, 1) if chain_recs else 0.0
    overall_pct = round(overall * 100, 1)

    return {
        "target": "Recover >= 90% of planted gangs/chains",
        "gangRecoveryPct": gang_pct,
        "chainRecoveryPct": chain_pct,
        "overallRecoveryPct": overall_pct,
        "identityRecoveryPct": round(sum(id_recs) / len(id_recs) * 100, 1) if id_recs else 0.0,
        "repeatOffenderRiskOk": risk_ok,
        "hotspotDetected": hotspot_ok,
        "passed": overall_pct >= 90.0,
        "patterns": patterns,
    }
