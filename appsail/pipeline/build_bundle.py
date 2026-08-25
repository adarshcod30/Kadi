#!/usr/bin/env python3
"""
build_bundle.py — produce the deployable data bundle for the Catalyst function.

The full read-model is ~121MB: fine on a laptop, impossible to ship to a serverless
function that must cold-start fast. This trims it to what the API actually serves,
without changing any answer the UI gives.

What gets trimmed and why:
  graph_adjacency  52MB -> the evidence blob repeats every source FIR on both ends of
                   every edge. Keep the fields the graph and the "why linked" panel
                   render; drop the duplicated arrays.
  case_health      10MB -> keep flagged cases (what the worklist shows) with their
                   reasons; drop the per-case metric history nothing reads.
  CaseMaster       10MB -> drop BriefFacts from the list payload. The detail view
                   fetches it separately; the list never shows it.
  link_edges       28MB -> not loaded by the API at all (adjacency covers it). Skipped.
  offender_map    5.6MB -> only the case->offender direction is read. Kept compact.

Run:  python appsail/pipeline/build_bundle.py
Out:  functions/api/data/
"""
from __future__ import annotations

import csv
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "data", "output")
DERIVED = os.path.join(SRC, "derived")
OUT = os.path.join(ROOT, "functions", "api", "data")
OUT_DERIVED = os.path.join(OUT, "derived")

# Copied through untouched — all small.
SMALL = ["socio", "forecast", "stats", "zones", "occasions", "district_stats", "national", "alerts",
         "hotspots", "eval_report", "offenders", "anomalies", "clusters",
         "case_linked_count", "offender_of_case", "stations", "link_summary"]
LOOKUPS = ["District", "Unit", "CrimeHead", "CrimeSubHead", "CaseStatusMaster",
           "CaseCategory", "GravityOffence", "GenderMaster", "Court", "Section", "Act",
           "Rank", "Designation", "ArrestSurrenderType"]

# Sized to hold a whole ego network rather than truncate it. The cap used to be 14 while
# case_linked_count was written from the UNCAPPED graph, so the switcher advertised "125
# links" and the canvas drew 14. With MO boilerplate no longer generating mega-hubs the
# busiest case has 21 neighbours, so this now shows the real network for every case but one.
MAX_NEIGHBOURS = 24


def size_mb(p):
    return os.path.getsize(p) / 1e6 if os.path.exists(p) else 0.0


def write(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    return size_mb(path)



def _add_strength_percentiles(adj):
    """Raw cosine strengths cluster hard: MO links sit around 0.99, shared-offender around
    0.95. A slider over that range does nothing until the last sliver, which is why the UI
    had to apologise for it in its own help text. Rank every edge against the whole
    population and store the percentile, so the control spreads evenly across the data."""
    vals = []
    for edges in adj.values():
        for e in edges:
            v = e.get("s")
            if isinstance(v, (int, float)):
                vals.append(v)
    if not vals:
        return adj
    ordered = sorted(vals)
    n = len(ordered)
    import bisect
    for edges in adj.values():
        for e in edges:
            v = e.get("s")
            if isinstance(v, (int, float)):
                e["p"] = round(bisect.bisect_left(ordered, v) / n, 3)
    return adj


def main():
    os.makedirs(OUT_DERIVED, exist_ok=True)

    # A build fingerprint the API can fold into cache keys. /stats round-trips through
    # Catalyst Cache with a 6-hour TTL; without something that changes on every rebuild, a
    # redeploy after a corpus regeneration would keep serving the PREVIOUS corpus's cached
    # KPIs for up to 6 hours -- discovered when a 60K-case regeneration deployed cleanly but
    # /stats still reported 40,829 (the old total) because the cache didn't know anything
    # had changed underneath it. Content-derived (case count + hash of a few files' mtimes),
    # not wall-clock time, so re-running the pipeline on unchanged inputs doesn't bust the
    # cache for no reason.
    import hashlib
    with open(os.path.join(SRC, "CaseMaster.csv")) as f:
        case_count = sum(1 for _ in f) - 1
    # Fingerprints the actual cached artifact (stats.json), not just the source corpus --
    # a pipeline rerun changes derived analytics (offender bands, risk scores) even when
    # CaseMaster.csv itself is untouched, and that must invalidate the cache too.
    stats_path = os.path.join(DERIVED, "stats.json")
    fp_src = str(os.path.getmtime(stats_path)) if os.path.exists(stats_path) else "0"
    build_id = hashlib.sha1(f"{case_count}:{fp_src}".encode()).hexdigest()[:12]
    with open(os.path.join(OUT, "build_info.json"), "w") as f:
        json.dump({"buildId": build_id, "caseCount": case_count}, f)
    print(f"  build_info.json  buildId={build_id}  caseCount={case_count:,}")
    total_before = total_after = 0.0

    # ---- small artifacts, copied verbatim ----
    for name in SMALL:
        src = os.path.join(DERIVED, f"{name}.json")
        if not os.path.exists(src):
            continue
        with open(src) as f:
            obj = json.load(f)
        b = size_mb(src)
        a = write(os.path.join(OUT_DERIVED, f"{name}.json"), obj)
        total_before += b
        total_after += a

    # ---- adjacency ----
    # 70% of this file is the evidence blob, and most of that is redundant:
    #   sourceFIRs  is always [thisCase, neighbour] - both already known at read time
    #   matched[].detail  is drawn from a small set of sentences repeated ~137k times
    # So: drop sourceFIRs, and intern the detail strings into a table the client resolves
    # by index. Exact same text renders in the "why linked" panel, a fraction of the bytes.
    src = os.path.join(DERIVED, "graph_adjacency.json")
    if os.path.exists(src):
        with open(src) as f:
            adj = json.load(f)
        details: dict[str, int] = {}
        types: dict[str, int] = {}

        def intern(table, s):
            if s not in table:
                table[s] = len(table)
            return table[s]

        slim = {}
        for case_id, edges in adj.items():
            if not edges:
                continue
            # Top-N by strength alone was a mistake: mo_similarity averages 0.993 while
            # shared_offender averages 0.954, so a strongest-N filter quietly deleted every
            # shared-offender link - the rarest and most investigatively useful edge in the
            # graph (1,926 of 137k). Keep those first, then fill with the strongest MO.
            def _rank(e):
                primary = 0 if e.get("edgeType") == "shared_offender" else 1
                return (primary, -float(e.get("strength", 0)))
            keep = sorted(edges, key=_rank)[:MAX_NEIGHBOURS]
            out = []
            for e in keep:
                ev = e.get("evidence") or {}
                matched = [[intern(types, m.get("type", "")), intern(details, m.get("detail", ""))]
                           for m in (ev.get("matched") or [])]
                out.append({
                    "n": e.get("neighborId"),
                    "c": e.get("neighborCrimeNo"),
                    "t": intern(types, e.get("edgeType", "")),
                    "a": [intern(types, t) for t in (e.get("allTypes") or [])],
                    "s": round(float(e.get("strength", 0)), 3),
                    "m": matched,
                    "k": e.get("clusterId"),
                })
            slim[case_id] = out

        payload = {
            "typeTable": [k for k, _ in sorted(types.items(), key=lambda kv: kv[1])],
            "detailTable": [k for k, _ in sorted(details.items(), key=lambda kv: kv[1])],
            "adj": slim,
        }
        b = size_mb(src)
        a = write(os.path.join(OUT_DERIVED, "graph_adjacency.json"), payload)
        total_before += b
        total_after += a
        print(f"  graph_adjacency  {b:6.1f} MB -> {a:5.1f} MB   "
              f"({len(slim):,} linked cases, {len(details):,} unique reasons interned)")

    # ---- case health: the worklist reads flagged cases ----
    src = os.path.join(DERIVED, "case_health.json")
    if os.path.exists(src):
        with open(src) as f:
            health = json.load(f)
        rows = health if isinstance(health, list) else health.get("cases", [])
        slim = [{k: v for k, v in r.items() if k not in ("history", "metricHistory", "timeline")}
                for r in rows]
        b = size_mb(src)
        a = write(os.path.join(OUT_DERIVED, "case_health.json"), slim)
        total_before += b
        total_after += a
        print(f"  case_health      {b:6.1f} MB -> {a:5.1f} MB   ({len(slim):,} entries)")

    # ---- offender_map: NOT shipped ----
    # 6.0 MB of accused-record to identity mapping that the API never opens. The comment at
    # the top of this file said "only the case->offender direction is read", and that is
    # exactly right -- offender_of_case (28 KB) carries that direction. The full map is
    # pipeline working state and evaluation input, not something the read path needs.
    #
    # Dropping it takes ~12% off every deploy and off the JSON a cold container parses before
    # serving its first request.
    src = os.path.join(DERIVED, "offender_map.json")
    if os.path.exists(src):
        total_before += size_mb(src)
        print(f"  offender_map     {size_mb(src):6.1f} MB ->   skipped (never read by the API)")

    # ---- CaseMaster without BriefFacts (list view never renders it) ----
    src = os.path.join(SRC, "CaseMaster.csv")
    if os.path.exists(src):
        with open(src) as f:
            rows = list(csv.DictReader(f))
        # BriefFacts stays: the detail view renders it as "Brief facts (MO)" and dropping
        # it left that panel blank in production.
        fields = list(rows[0].keys())
        dst = os.path.join(OUT, "CaseMaster.csv")
        with open(dst, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r[k] for k in fields})
        b, a = size_mb(src), size_mb(dst)
        total_before += b
        total_after += a
        print(f"  CaseMaster.csv   {b:6.1f} MB -> {a:5.1f} MB   ({len(rows):,} FIRs)")

    # ---- Employee, trimmed (never shipped at all before this) ----
    # Employee.csv was absent from every bundle build. store.mock.js reads it
    # unconditionally to resolve the investigating officer's name for every case, so on the
    # deployed function that lookup always missed and every case detail showed "IO: --".
    # Trimmed rather than copied whole: KGID, EmployeeDOB, BloodGroupID,
    # PhysicallyChallenged and AppointmentDate are personnel/HR fields no feature reads --
    # unlike CaseMaster.BriefFacts above, dropping them costs nothing today, and not
    # shipping unused personal data about individually named officers is the right default
    # even in a synthetic dataset.
    src = os.path.join(SRC, "Employee.csv")
    if os.path.exists(src):
        with open(src) as f:
            rows = list(csv.DictReader(f))
        fields = ["EmployeeID", "DistrictID", "UnitID", "RankID", "DesignationID", "FirstName", "GenderID"]
        dst = os.path.join(OUT, "Employee.csv")
        with open(dst, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r[k] for k in fields})
        b, a = size_mb(src), size_mb(dst)
        total_before += b
        total_after += a
        print(f"  Employee.csv     {b:6.1f} MB -> {a:5.1f} MB   ({len(rows):,} employees, HR fields dropped)")

    # ---- lookups + party tables the detail view needs ----
    for name in LOOKUPS + ["Accused", "Victim", "ComplainantDetails", "ActSectionAssociation", "ArrestSurrender", "ChargesheetDetails"]:
        s = os.path.join(SRC, f"{name}.csv")
        if os.path.exists(s):
            with open(s) as fi, open(os.path.join(OUT, f"{name}.csv"), "w") as fo:
                fo.write(fi.read())
            total_before += size_mb(s)
            total_after += size_mb(os.path.join(OUT, f"{name}.csv"))

    bundle = sum(size_mb(os.path.join(dp, f))
                 for dp, _, fs in os.walk(OUT) for f in fs)
    print(f"\n  BUNDLE TOTAL     {bundle:6.1f} MB   (full read-model is ~121 MB)")
    return 0


def _slim_evidence(ev):
    """Keep the shape the 'why linked' panel renders; cap the long arrays."""
    out = {}
    for k, v in ev.items():
        if isinstance(v, list):
            out[k] = v[:6]
            if len(v) > 6:
                out[f"{k}More"] = len(v) - 6
        else:
            out[k] = v
    return out


if __name__ == "__main__":
    sys.exit(main())
