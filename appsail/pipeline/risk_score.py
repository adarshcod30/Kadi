"""
risk_score.py — transparent, behaviour-based offender risk (0-100).

A deliberately GLASS-BOX model: each factor is a normalized behavioural feature with a
fixed weight, so the score is fully explainable (factor -> contribution) and auditable.
This is a feature, not a limitation — operational risk must never be a black box.

FAIRNESS (hard invariant): the feature set is asserted against PROTECTED_COLUMNS. Caste,
religion and occupation are never inputs. `protectedAttributesUsed` is emitted as 0.
"""
from __future__ import annotations

from collections import defaultdict

from common import assert_no_protected, parse_dt

RISK_FEATURES = ["prior_count", "heinous_ratio", "recency", "arrests",
                 "reoffended_after_arrest", "distinct_districts", "network_centrality"]
WEIGHTS = {
    "prior_count": 0.26,
    "heinous_ratio": 0.18,
    "recency": 0.14,
    "arrests": 0.10,
    "reoffended_after_arrest": 0.16,
    "distinct_districts": 0.10,
    "network_centrality": 0.06,
}
FACTOR_LABEL = {
    "prior_count": "Number of prior cases",
    "heinous_ratio": "Share of heinous offences",
    "recency": "Recent activity",
    "arrests": "Arrest history",
    "reoffended_after_arrest": "Re-offended after arrest",
    "distinct_districts": "Operates across districts",
    "network_centrality": "Position in offender network",
}


def _norm(x, lo, hi):
    if hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def compute(tables, identities, mapping, edges, ctx, today):
    assert_no_protected(RISK_FEATURES)

    cases = tables["CaseMaster"].set_index("CaseMasterID")
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()

    # arrests per case
    arrests_by_case = defaultdict(list)
    for row in tables["ArrestSurrender"].itertuples(index=False):
        d = parse_dt(row.ArrestSurrenderDate)
        arrests_by_case[row.CaseMasterID].append(d)

    # network centrality: degree of each case in the linkage graph
    degree = defaultdict(int)
    for e in edges:
        degree[e["srcId"]] += 1
        degree[e["dstId"]] += 1

    results = []
    for ident in identities:
        cids = ident["caseIds"]
        if len(cids) < 2:
            continue  # risk profiles only for resolved repeat identities
        prior = len(cids)
        heinous = 0
        last_dt = None
        districts = set()
        arrests = 0
        arrest_dates = []
        incident_dates = []
        centrality = 0
        for cid in cids:
            if cid not in cases.index:
                continue
            c = cases.loc[cid]
            if str(c["GravityOffenceID"]) == "1":
                heinous += 1
            dt = parse_dt(c["IncidentFromDate"]) or parse_dt(c["CrimeRegisteredDate"])
            if dt:
                incident_dates.append(dt)
                last_dt = dt if last_dt is None else max(last_dt, dt)
            districts.add(unit_district.get(c["PoliceStationID"], ""))
            for ad in arrests_by_case.get(cid, []):
                arrests += 1
                if ad:
                    arrest_dates.append(ad)
            centrality += degree.get(cid, 0)

        reoffended = 0
        if arrest_dates and incident_dates:
            earliest_arrest = min(arrest_dates)
            if any(idt > earliest_arrest for idt in incident_dates):
                reoffended = 1

        recency_days = (today - last_dt.date()).days if last_dt else 999
        feats = {
            "prior_count": _norm(prior, 2, 10),
            "heinous_ratio": heinous / prior if prior else 0.0,
            "recency": 1.0 - _norm(recency_days, 0, 540),
            "arrests": _norm(arrests, 0, 4),
            "reoffended_after_arrest": float(reoffended),
            "distinct_districts": _norm(len(districts), 1, 4),
            "network_centrality": _norm(centrality, 0, 20),
        }
        contributions = {k: round(WEIGHTS[k] * feats[k] * 100, 1) for k in RISK_FEATURES}
        score = round(sum(contributions.values()), 1)
        factors = sorted(
            [{"factor": k, "label": FACTOR_LABEL[k], "value": round(feats[k], 2),
              "contribution": contributions[k]} for k in RISK_FEATURES],
            key=lambda f: f["contribution"], reverse=True)
        results.append({
            "offenderIdentityId": ident["offenderIdentityId"],
            "canonicalName": ident["canonicalName"],
            "riskScore": score,
            "band": "High" if score >= 60 else "Medium" if score >= 35 else "Low",
            "factors": factors,
            "priorCases": prior,
            "distinctDistricts": len(districts),
            "arrests": arrests,
            "reoffendedAfterArrest": bool(reoffended),
            "protectedAttributesUsed": 0,
            "computedTs": today.isoformat(),
        })

    results.sort(key=lambda r: r["riskScore"], reverse=True)
    return results
