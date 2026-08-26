#!/usr/bin/env python3
"""
run_pipeline.py — orchestrate the full KADI analytics pipeline (the nightly recompute).

Reads the source FIR tables, runs entity resolution -> MO similarity -> graph build ->
community detection -> risk -> health -> anomaly -> spatial, then writes the derived
read-model that the API serves (mirrors Catalyst NoSQL/Cache). Finally runs the
ground-truth evaluation (recovery of planted gangs/chains) into eval_report.json.

This is the heavy compute that runs in a Catalyst Job — NEVER in a Function or AppSail,
both of which cap a request at 30s. Jobs allow 15 minutes but only 512 MB, so each stage
logs the peak RSS high-water mark: if that crosses ~512 MB the Job is OOM-killed in
production while still passing locally. Keep an eye on the MB column.

Usage:  python appsail/pipeline/run_pipeline.py --data data/output
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

import common
import entity_resolution
import mo_similarity
import graph_build
import risk_score
import health_metrics
import anomaly
import spatial
import zones
import occasions
import evaluate
import national
import socio
import forecast
import training_set

TODAY = date(2026, 7, 13)


def run(data_dir: str):
    t0 = time.time()
    log = []

    def _peak_mb():
        # ru_maxrss is the high-water mark: bytes on macOS, kilobytes on Linux.
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return r / 1e6 if sys.platform == "darwin" else r / 1e3

    def step(msg):
        log.append(f"[{time.time()-t0:6.1f}s {_peak_mb():5.0f}MB] {msg}")
        print(log[-1], flush=True)

    step("loading source tables")
    tables = common.load_tables(data_dir)
    cases = tables["CaseMaster"]
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()

    step("entity resolution")
    identities, mapping = entity_resolution.resolve(tables)
    id_by_oid = {i["offenderIdentityId"]: i for i in identities}

    step("MO similarity")
    mo_pairs = mo_similarity.compute(tables)

    step("graph build + community detection")
    edges, cluster_of, ctx, cases_of_oid, oid_of_case_accused = graph_build.build(
        tables, identities, mapping, mo_pairs)

    step("offender risk scoring")
    risks = risk_score.compute(tables, identities, mapping, edges, ctx, TODAY)
    risk_by_oid = {r["offenderIdentityId"]: r for r in risks}

    step("investigation-health metrics")
    health, station_false_rate = health_metrics.compute(tables, edges, ctx, cluster_of, TODAY)

    step("anomaly detection")
    anomalies = anomaly.compute(tables, TODAY, station_false_rate)

    step("spatial hotspots")
    geo = spatial.compute(tables, TODAY)

    step("zone status")
    _unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].astype(str).to_dict()
    _dnames = tables["District"].set_index("DistrictID")["DistrictName"].to_dict()
    _hnames = tables["CrimeHead"].set_index("CrimeHeadID")["CrimeGroupName"].to_dict()
    _zone_cases = [{
        "crimeRegisteredDate": row.CrimeRegisteredDate,
        "districtId": _unit_district.get(row.PoliceStationID, ""),
        "unitId": str(row.PoliceStationID),
        "crimeHead": _hnames.get(str(row.CrimeMajorHeadID), "Other"),
    } for row in cases.itertuples(index=False)]
    zone_report = zones.compute(
        _zone_cases,
        [{"districtId": str(k), "districtName": v} for k, v in _dnames.items()],
        unit_district=_unit_district,
    )

    # --- police-station roster -------------------------------------------------------
    # A station's map position is now its OWN generated Latitude/Longitude (generate.py),
    # not the centroid of its cases. The centroid approach meant a station's location was
    # never really modelled -- it was an average of wherever its cases happened to be
    # geocoded, and since cases are geocoded from the same handful of per-district urban
    # centres, dozens of stations in one district converged toward nearly the same point.
    # A district's ~120 stations rendered as one blob on the map regardless of zoom, because
    # they never had distinct positions to render. generate.py now draws each station its
    # own point with a minimum separation from its district's other stations.
    step("police-station roster")
    _st_case_count = defaultdict(int)
    for row in cases.itertuples(index=False):
        _st_case_count[str(row.PoliceStationID)] += 1
    # stationBaselines covers every station; zone_report["stations"] only the flagged ones.
    _zone_by_unit = dict(zone_report.get("stationBaselines", {}))
    for z in zone_report.get("stations", []):
        _zone_by_unit[str(z["unitId"])] = z
    _cat_names = {}
    if "StationCategory" in tables:
        _cat_names = dict(zip(tables["StationCategory"]["StationCategoryID"],
                              tables["StationCategory"]["StationCategoryName"]))
    # NOT `stations` -- a later block in this same function rebinds that name to a set(),
    # which silently replaced this list before it reached write_json 90 lines below.
    station_roster = []
    for _, urow in tables["Unit"].iterrows():
        u = str(urow["UnitID"])
        did = str(urow.get("DistrictID", ""))
        z = _zone_by_unit.get(u)
        cat_id = str(urow.get("StationCategoryID", "") or "")
        lat_raw, lng_raw = urow.get("Latitude"), urow.get("Longitude")
        station_roster.append({
            "unitId": u,
            "unitName": urow.get("UnitName", u),
            "districtId": did,
            # _dnames may be keyed by str or int depending on how the CSV parsed; try both
            # rather than silently emitting an empty name.
            "districtName": _dnames.get(did) or _dnames.get(int(did) if str(did).isdigit() else did, ""),
            "cases": _st_case_count.get(u, 0),
            "lat": round(float(lat_raw), 5) if lat_raw not in (None, "") else None,
            "lng": round(float(lng_raw), 5) if lng_raw not in (None, "") else None,
            "categoryId": cat_id,
            "category": _cat_names.get(cat_id, _cat_names.get(int(cat_id) if cat_id.isdigit() else cat_id, "")),
            "zone": (z or {}).get("zone", "normal"),
            "zoneZ": (z or {}).get("z", 0.0),
            "current": (z or {}).get("current"),
            "baseline": (z or {}).get("baseline"),
            "changePct": (z or {}).get("changePct"),
            "thresholds": (z or {}).get("thresholds", {}),
        })
    station_roster.sort(key=lambda r: (-r["cases"], r["unitName"]))

    step("special-occasion patterns")
    _occ_cases = [{
        "crimeRegisteredDate": row.CrimeRegisteredDate,
        "crimeHead": _hnames.get(str(row.CrimeMajorHeadID), "Other"),
        "hour": (int(str(row.IncidentFromDate)[11:13])
                 if len(str(row.IncidentFromDate)) >= 13 and str(row.IncidentFromDate)[11:13].isdigit()
                 else None),
    } for row in cases.itertuples(index=False)]
    occasion_report = occasions.compute(_occ_cases)

    # ---------------- build derived read-model ----------------
    step("assembling read-model")

    # adjacency index (per case -> its linked cases with evidence) — the fast graph read
    crimeno = {row.CaseMasterID: row.CrimeNo for row in cases.itertuples(index=False)}
    adjacency = defaultdict(list)
    # Cheap per-case summary (link count, offender-link count, evidence-kind set) for
    # /graph/featured to pick from -- built once here, alongside the adjacency it is
    # already deriving from the same edge list, rather than recomputed from the FULL
    # adjacency graph on every request. That endpoint used to do exactly that: iterate
    # every case's full evidence-linked neighbour list just to read edges.length and an
    # edge-type set. At 40K cases it stayed under a second by accident; at 60K it forced
    # the API's lazy adjacency-rehydration Proxy to fully decode ~34K cases per request,
    # and under the function's 512MB ceiling that measured 0.6-24s per call in production
    # -- wide, unpredictable, and the empty responses came back as a plain 200 with no
    # body rather than a clean error.
    link_summary = defaultdict(lambda: {"links": 0, "offenderLinks": 0, "signalTypes": set()})
    for e in edges:
        a, b = e["srcId"], e["dstId"]
        kinds = set(e["allTypes"] or [e["edgeType"]])
        is_offender = "shared_offender" in kinds
        for cid in (a, b):
            rec = link_summary[cid]
            rec["links"] += 1
            if is_offender:
                rec["offenderLinks"] += 1
            rec["signalTypes"] |= kinds
        adjacency[a].append({"neighborId": b, "neighborCrimeNo": crimeno.get(b),
                             "edgeType": e["edgeType"], "allTypes": e["allTypes"],
                             "strength": e["strength"], "evidence": e["evidence"],
                             "clusterId": e.get("clusterId")})
        adjacency[b].append({"neighborId": a, "neighborCrimeNo": crimeno.get(a),
                             "edgeType": e["edgeType"], "allTypes": e["allTypes"],
                             "strength": e["strength"], "evidence": e["evidence"],
                             "clusterId": e.get("clusterId")})
    link_summary = {cid: {"links": v["links"], "offenderLinks": v["offenderLinks"],
                          "signalTypes": sorted(v["signalTypes"])}
                    for cid, v in link_summary.items()}

    # offenders present per case (resolved multi-case identities)
    offender_of_case = defaultdict(list)
    for m in mapping:
        oid = m["offenderIdentityId"]
        if id_by_oid[oid]["distinctCases"] > 1:
            if oid not in offender_of_case[m["caseMasterId"]]:
                offender_of_case[m["caseMasterId"]].append(oid)

    # linked-case count per case (for list/detail)
    linked_count = {cid: len(adj) for cid, adj in adjacency.items()}

    # clusters summary
    cluster_cases = defaultdict(list)
    for cid, cl in cluster_of.items():
        if cl:
            cluster_cases[cl].append(cid)
    case_row = cases.set_index("CaseMasterID")
    clusters = []
    for cl, cids in cluster_cases.items():
        districts, stations, heads, offs = set(), set(), Counter(), Counter()
        for cid in cids:
            if cid in case_row.index:
                r = case_row.loc[cid]
                stations.add(r["PoliceStationID"])
                districts.add(unit_district.get(r["PoliceStationID"], ""))
                heads[r["CrimeMajorHeadID"]] += 1
            for oid in offender_of_case.get(cid, []):
                offs[oid] += 1
        top_offenders = [{"offenderIdentityId": o, "canonicalName": id_by_oid[o]["canonicalName"],
                          "caseCount": c} for o, c in offs.most_common(5)]
        clusters.append({
            "clusterId": cl, "size": len(cids), "caseIds": cids,
            "districts": sorted(d for d in districts if d),
            "stations": sorted(s for s in stations if s),
            "crossDistrict": len([d for d in districts if d]) > 1,
            "headMix": dict(heads), "topOffenders": top_offenders,
        })
    clusters.sort(key=lambda c: (c["crossDistrict"], c["size"]), reverse=True)

    # offender profiles (merge identity + risk + co-offenders + arrests)
    arrests_by_case = defaultdict(list)
    for row in tables["ArrestSurrender"].itertuples(index=False):
        arrests_by_case[row.CaseMasterID].append({
            "date": row.ArrestSurrenderDate, "districtId": row.ArrestSurrenderDistrictId,
            "unitId": row.PoliceStationID, "typeId": row.ArrestSurrenderTypeID})
    offenders = []
    for ident in identities:
        if ident["distinctCases"] < 2:
            continue
        cids = ident["caseIds"]
        co = Counter()
        for cid in cids:
            for oid in offender_of_case.get(cid, []):
                if oid != ident["offenderIdentityId"]:
                    co[oid] += 1
        arrests = []
        for cid in cids:
            arrests.extend(arrests_by_case.get(cid, []))
        r = risk_by_oid.get(ident["offenderIdentityId"], {})
        first_dt = min((ctx[c]["dt"] for c in cids if ctx.get(c) and ctx[c]["dt"]), default=None)
        last_dt = max((ctx[c]["dt"] for c in cids if ctx.get(c) and ctx[c]["dt"]), default=None)
        offenders.append({
            **ident,
            "distinctDistricts": len(ident.get("districts", [])),
            "riskScore": r.get("riskScore"), "band": r.get("band"),
            "factors": r.get("factors"), "protectedAttributesUsed": 0,
            "coOffenders": [{"offenderIdentityId": o, "canonicalName": id_by_oid[o]["canonicalName"],
                             "sharedCases": c} for o, c in co.most_common(8)],
            "arrests": arrests, "arrestCount": len(arrests),
            "firstSeen": first_dt.date().isoformat() if first_dt else None,
            "lastSeen": last_dt.date().isoformat() if last_dt else None,
            "clusterIds": sorted({cluster_of.get(c) for c in cids if cluster_of.get(c)}),
            "linkedCaseCount": sum(linked_count.get(c, 0) for c in cids),
        })
    offenders.sort(key=lambda o: (o["riskScore"] or 0), reverse=True)

    # alerts
    alerts = _build_alerts(clusters, health, anomalies, geo, offenders, unit_district, TODAY)

    # dashboard stats
    stats = _build_stats(tables, health, clusters, offenders, geo, anomalies, TODAY)

    # per-district aggregates (choropleth + drill-down) and national context
    district_stats = _build_district_stats(tables, health, offenders, geo, unit_district)
    national_ctx = national.national_context()

    step("socio-economic correlation")
    socio_ctx = socio.compute(tables, unit_district)

    step("crime forecasting")
    forecast_ctx = forecast.compute(tables, unit_district, TODAY)

    # The CSV a QuickML model trains on. Written every run so it tracks the corpus, including
    # any case approved through the write path -- but retraining stays a deliberate console
    # action. Silent automatic retraining on a police system is a liability; someone should
    # read the backtest before a new model serves.
    step("ML training set")
    training_meta = training_set.compute(tables, unit_district, TODAY, data_dir)

    # ---------------- write artifacts ----------------
    step("writing derived artifacts")
    common.write_json(data_dir, "offenders", offenders)
    common.write_json(data_dir, "offender_map", mapping)
    common.write_json(data_dir, "link_edges", edges)
    common.write_json(data_dir, "graph_adjacency", adjacency)
    common.write_json(data_dir, "link_summary", link_summary)
    common.write_json(data_dir, "offender_of_case", offender_of_case)
    common.write_json(data_dir, "clusters", clusters)
    common.write_json(data_dir, "case_health", health)
    common.write_json(data_dir, "case_linked_count", linked_count)
    common.write_json(data_dir, "anomalies", anomalies)
    common.write_json(data_dir, "hotspots", geo)
    common.write_json(data_dir, "alerts", alerts)
    common.write_json(data_dir, "zones", zone_report)
    common.write_json(data_dir, "stations", station_roster)
    common.write_json(data_dir, "occasions", occasion_report)
    common.write_json(data_dir, "stats", stats)
    common.write_json(data_dir, "district_stats", district_stats)
    common.write_json(data_dir, "national", national_ctx)
    common.write_json(data_dir, "socio", socio_ctx)
    common.write_json(data_dir, "forecast", forecast_ctx)
    common.write_json(data_dir, "training_set_meta", training_meta)

    step("ground-truth evaluation")
    gt_path = os.path.join(data_dir, "_ground_truth.json")
    eval_report = evaluate.evaluate(gt_path, identities, mapping, cluster_of, offenders, geo)
    common.write_json(data_dir, "eval_report", eval_report)

    summary = {
        "generatedTs": datetime.now().isoformat(timespec="seconds"),
        "runtimeSec": round(time.time() - t0, 1),
        "counts": {
            "cases": len(cases), "identities": len(identities),
            "resolvedOffenders": len(offenders), "edges": len(edges),
            "clusters": len(clusters), "healthFlagged": len(health),
            "anomalies": len(anomalies["caseAnomalies"]), "hotspots": len(geo["hotspots"]),
            "alerts": len(alerts),
        },
        "eval": {k: eval_report[k] for k in ("gangRecoveryPct", "chainRecoveryPct",
                                             "overallRecoveryPct", "passed")},
        "log": log,
    }
    common.write_json(data_dir, "pipeline_summary", summary)
    step(f"DONE in {summary['runtimeSec']}s — recovery {eval_report['overallRecoveryPct']}% "
         f"(pass={eval_report['passed']})")
    return summary


def _build_alerts(clusters, health, anomalies, geo, offenders, unit_district, today):
    alerts = []
    aid = 0

    def add(kind, severity, title, reason, **kw):
        nonlocal aid
        aid += 1
        alerts.append({"alertId": f"AL{aid:05d}", "kind": kind, "severity": severity,
                       "title": title, "reason": reason, "ts": today.isoformat(),
                       "acknowledged": False, **kw})

    # A "cross-silo network" alert is about an OFFENDER whose own cases span districts.
    # Do NOT report cluster size here: communities glued by similar-MO text can span half
    # the state, which would produce nonsense like "184 FIRs across 28 districts".
    cross_silo = [o for o in offenders
                  if o.get("distinctDistricts", 0) >= 2 and o.get("distinctCases", 0) >= 3]
    cross_silo.sort(key=lambda o: (o["distinctDistricts"], o["distinctCases"]), reverse=True)
    for o in cross_silo[:8]:
        add("new-link", "high",
            f"Cross-district offender: {o['canonicalName']}",
            f"Linked to {o['distinctCases']} FIRs across {o['distinctDistricts']} districts "
            f"(risk {o.get('riskScore')}/100)",
            offenderIdentityId=o["offenderIdentityId"])
    for o in offenders[:6]:
        if o.get("band") == "High":
            add("offender", "high", f"High-risk offender: {o['canonicalName']}",
                f"Risk {o['riskScore']} across {o['distinctCases']} cases",
                offenderIdentityId=o["offenderIdentityId"])
    slipping = [h for h in health if "investigation_ageing" in h["flagKeys"] or "pendency" in h["flagKeys"]]
    for h in slipping[:8]:
        add("health", "medium", f"Case slipping: {h['crimeNo']}",
            h["flags"][0]["reason"], caseMasterId=h["caseMasterId"],
            unitId=h["unitId"], districtId=h["districtId"])
    for hs in [h for h in geo["hotspots"] if h["emergingFlag"]][:5]:
        add("hotspot", "medium", "Emerging crime hotspot",
            f"{hs['recentCount']} cases in last 60d vs ~{hs['baselineExpected']} expected",
            cellId=hs["cellId"])
    for sa in anomalies["stationAnomalies"][:3]:
        add("anomaly", "medium", "False-case pattern at station",
            sa["reason"], unitId=sa["unitId"])
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda a: sev_rank.get(a["severity"], 3))
    return alerts


def _build_district_stats(tables, health, offenders, geo, unit_district):
    cases = tables["CaseMaster"]
    district_names = tables["District"].set_index("DistrictID")["DistrictName"].to_dict()
    head_names = tables["CrimeHead"].set_index("CrimeHeadID")["CrimeGroupName"].to_dict()
    unit_names = tables["Unit"].set_index("UnitID")["UnitName"].to_dict()

    health_by_district = Counter(str(h["districtId"]) for h in health if h.get("severity") == "high")
    d = {}
    for row in cases.itertuples(index=False):
        did = unit_district.get(row.PoliceStationID, "")
        if not did:
            continue
        e = d.setdefault(did, {"districtId": str(did), "district": district_names.get(str(did), did),
                               "total": 0, "open": 0, "heads": Counter(), "stations": Counter(),
                               "latSum": 0.0, "lngSum": 0.0, "geoN": 0})
        e["total"] += 1
        if str(row.CaseStatusID) == "1":
            e["open"] += 1
        e["heads"][head_names.get(row.CrimeMajorHeadID, row.CrimeMajorHeadID)] += 1
        e["stations"][row.PoliceStationID] += 1
        try:
            e["latSum"] += float(row.latitude); e["lngSum"] += float(row.longitude); e["geoN"] += 1
        except (TypeError, ValueError):
            pass

    emerging_by_district = Counter()
    unit_to_district = {u: unit_district.get(u, "") for u in unit_names}
    out = []
    for did, e in d.items():
        n = max(e["geoN"], 1)
        out.append({
            "districtId": e["districtId"], "district": e["district"],
            "total": e["total"], "open": e["open"],
            "flaggedHigh": health_by_district.get(str(did), 0),
            "topHeads": [{"name": k, "count": v} for k, v in e["heads"].most_common(5)],
            "topStations": [{"unitId": u, "name": unit_names.get(u, u), "count": c}
                            for u, c in e["stations"].most_common(5)],
            "centroidLat": round(e["latSum"] / n, 4), "centroidLng": round(e["lngSum"] / n, 4),
        })
    out.sort(key=lambda x: x["total"], reverse=True)
    counts = [x["total"] for x in out]
    return {"districts": out, "maxCount": max(counts) if counts else 0,
            "minCount": min(counts) if counts else 0, "totalDistricts": len(out)}


def _build_stats(tables, health, clusters, offenders, geo, anomalies, today):
    cases = tables["CaseMaster"]
    status = Counter(str(r.CaseStatusID) for r in cases.itertuples(index=False))
    head_names = tables["CrimeHead"].set_index("CrimeHeadID")["CrimeGroupName"].to_dict()
    head_counts = Counter(r.CrimeMajorHeadID for r in cases.itertuples(index=False))
    # A "network" = a resolved offender who operates WITH co-offenders (a group), not a
    # Louvain community — those can be glued by similar-MO text alone and span the state.
    offender_networks = [o for o in offenders if o.get("coOffenders")]
    cross_silo_networks = [o for o in offenders
                           if o.get("distinctDistricts", 0) >= 2 and o.get("distinctCases", 0) >= 2]
    serious_flagged = sum(1 for h in health if h.get("severity") == "high")
    # cases per month (last 18) for trend; hour x weekday heatmap; gravity split
    by_month = Counter()
    hour_dow = [[0] * 24 for _ in range(7)]  # [weekday][hour]
    gravity = Counter()
    for r in cases.itertuples(index=False):
        d = common.parse_dt(r.CrimeRegisteredDate)
        if d:
            by_month[d.strftime("%Y-%m")] += 1
        inc = common.parse_dt(r.IncidentFromDate)
        if inc:
            hour_dow[inc.weekday()][inc.hour] += 1
        gravity[str(r.GravityOffenceID)] += 1
    trend = [{"month": m, "count": by_month[m]} for m in sorted(by_month)][-18:]
    heat = [{"dow": wd, "hour": h, "count": hour_dow[wd][h]} for wd in range(7) for h in range(24)]
    return {
        "totalCases": len(cases),
        "openCases": status.get("1", 0),
        "chargeSheeted": status.get("2", 0),
        "undetected": status.get("4", 0),
        "flaggedCases": len(health),
        "seriousFlaggedCases": serious_flagged,
        "activeNetworks": len(offender_networks),
        "crossDistrictNetworks": len(cross_silo_networks),
        "resolvedOffenders": len(offenders),
        "highRiskOffenders": sum(1 for o in offenders if o.get("band") == "High"),
        "emergingHotspots": sum(1 for h in geo["hotspots"] if h["emergingFlag"]),
        "caseAnomalies": len(anomalies["caseAnomalies"]),
        "topCrimeHeads": [{"headId": h, "name": head_names.get(h, str(h)), "count": c}
                          for h, c in head_counts.most_common(8)],
        "trend": trend,
        "heat": heat,
        "statusBreakdown": {"open": status.get("1", 0), "chargeSheeted": status.get("2", 0),
                            "closed": status.get("3", 0), "undetected": status.get("4", 0)},
        "gravitySplit": {"heinous": gravity.get("1", 0), "nonHeinous": gravity.get("2", 0)},
        "computedTs": today.isoformat(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "..", "data", "output"))
    args = ap.parse_args()
    run(os.path.abspath(args.data))


if __name__ == "__main__":
    main()
