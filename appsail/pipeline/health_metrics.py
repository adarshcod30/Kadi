"""
health_metrics.py — deterministic Investigation-Health metrics per case.

Everything here is transparent arithmetic (no black box), so an ACP can trust and audit
the numbers. Flags: reporting delay, investigation ageing vs peer median, pendency,
undetected risk, false-case pattern. Each flagged case carries a plain-language reason
and a recommended next action (e.g. consolidate N linked cases sharing an offender).
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from common import parse_dt

REPORTING_DELAY_FLAG_HRS = 168     # 7 days — only genuinely late reporting
AGEING_MULTIPLIER = 2.0
PENDENCY_DAYS = 270


def compute(tables, edges, ctx, cluster_of, today):
    cases = tables["CaseMaster"]
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()

    # chargesheet lookup
    cs_by_case = defaultdict(list)
    for row in tables["ChargesheetDetails"].itertuples(index=False):
        cs_by_case[row.CaseMasterID].append(row.cstype)

    # accused count per case
    acc_count = defaultdict(int)
    for row in tables["Accused"].itertuples(index=False):
        acc_count[row.CaseMasterID] += 1

    # false-case rate per station (for anomaly context)
    station_total = defaultdict(int)
    station_false = defaultdict(int)

    # linked cases per case (degree + shared-offender partners) for recommendations
    linked = defaultdict(list)
    for e in edges:
        linked[e["srcId"]].append((e["dstId"], e["edgeType"]))
        linked[e["dstId"]].append((e["srcId"], e["edgeType"]))

    # first pass: gather per-subhead ages of disposed cases for peer medians
    rows = []
    ages_by_subhead = defaultdict(list)
    for row in cases.itertuples(index=False):
        reg = parse_dt(row.CrimeRegisteredDate)
        inc = parse_dt(row.IncidentFromDate)
        info = parse_dt(row.InfoReceivedPSDate)
        status = str(row.CaseStatusID)
        cstypes = cs_by_case.get(row.CaseMasterID, [])
        station_total[row.PoliceStationID] += 1
        if "B" in cstypes:
            station_false[row.PoliceStationID] += 1
        age_days = (today - reg.date()).days if reg else 0
        # disposed = charge sheeted/closed: use as peer sample of "resolved" duration
        if status in ("2", "3") and reg:
            ages_by_subhead[row.CrimeMinorHeadID].append(age_days)
        rows.append((row, reg, inc, info, status, cstypes, age_days))

    peer_median = {sh: statistics.median(v) for sh, v in ages_by_subhead.items() if v}

    results = []
    for (row, reg, inc, info, status, cstypes, age_days) in rows:
        flags = []
        # reporting delay
        delay_hrs = None
        if inc and info:
            delay_hrs = round((info - inc).total_seconds() / 3600.0, 1)
            if delay_hrs >= REPORTING_DELAY_FLAG_HRS:
                flags.append({"flag": "reporting_delay",
                              "reason": f"Reported {round(delay_hrs/24,1)} days after the incident"})
        # ageing vs peer median (only for cases still under active investigation)
        pm = peer_median.get(row.CrimeMinorHeadID, 120)
        ageing = status == "1" and age_days > pm * AGEING_MULTIPLIER
        if ageing:
            flags.append({"flag": "investigation_ageing",
                          "reason": f"Open {age_days} days — {round(age_days/max(pm,1),1)}x the peer median ({int(pm)}d) for this crime type"})
        # pendency
        if status == "1" and age_days > PENDENCY_DAYS:
            flags.append({"flag": "pendency",
                          "reason": f"Under investigation beyond {PENDENCY_DAYS} days ({age_days}d)"})
        # undetected risk
        undetected_score = 0.0
        if status in ("1", "4") and acc_count.get(row.CaseMasterID, 0) == 0:
            undetected_score = min(1.0, 0.4 + age_days / 720.0)
            if undetected_score >= 0.6:
                flags.append({"flag": "undetected_risk",
                              "reason": "No accused identified and case ageing — risk of remaining undetected"})
        # false-case pattern
        false_flag = "B" in cstypes
        if false_flag:
            flags.append({"flag": "false_case", "reason": "Closed as a false case (cstype B)"})

        if not flags:
            continue

        # recommendation: prefer consolidation when linked by a shared offender
        rec = None
        shared_partners = [p for (p, t) in linked.get(row.CaseMasterID, []) if t in ("shared_offender", "co_accused")]
        cl = cluster_of.get(row.CaseMasterID)
        if shared_partners:
            rec = (f"Consolidate investigation: {len(set(shared_partners))} linked case(s) share an "
                   f"offender with this FIR — coordinate with the linked IOs.")
        elif cl:
            rec = f"Part of network cluster {cl}; review the linkage graph for joint leads."
        elif any(f["flag"] == "investigation_ageing" for f in flags):
            rec = "Escalate to supervisory officer; case is ageing well beyond peer norm."
        elif any(f["flag"] == "undetected_risk" for f in flags):
            rec = "Re-canvass witnesses / CCTV; consider technical follow-up before it lapses."
        else:
            rec = "Review case status and update investigation diary."

        flag_keys = [f["flag"] for f in flags]
        serious_keys = {"investigation_ageing", "pendency", "undetected_risk"}
        severity = "high" if serious_keys & set(flag_keys) else "medium"
        results.append({
            "caseMasterId": row.CaseMasterID,
            "crimeNo": row.CrimeNo,
            "unitId": row.PoliceStationID,
            "districtId": unit_district.get(row.PoliceStationID, ""),
            "subheadId": row.CrimeMinorHeadID,
            "statusId": status,
            "reportingDelayHrs": delay_hrs,
            "investigationAgeDays": age_days,
            "peerMedianAgeDays": int(pm),
            "undetectedRiskScore": round(undetected_score, 2),
            "falseCasePatternFlag": bool(false_flag),
            "flags": flags,
            "flagKeys": flag_keys,
            "severity": severity,
            "clusterId": cl,
            "recommendationText": rec,
            "computedTs": today.isoformat(),
        })

    results.sort(key=lambda r: (r["severity"] == "high", r["investigationAgeDays"]), reverse=True)

    # station false-case rates for anomaly section
    station_false_rate = {
        u: {"total": station_total[u], "false": station_false[u],
            "rate": round(station_false[u] / station_total[u], 3) if station_total[u] else 0}
        for u in station_total
    }
    return results, station_false_rate
