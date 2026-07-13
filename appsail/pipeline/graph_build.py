"""
graph_build.py — the KADI hero: build the case-linkage graph.

Generates candidate case pairs from blocking keys (shared resolved offender, same
location cell + crime type, same time window, MO neighbours), scores every signal on a
pair, and emits ONE typed LinkEdge per case pair carrying an evidence payload of every
matched attribute + the source FIR numbers (powers the "Why linked" panel). Community
detection then tags each case with a clusterId (gang).

Edge signals & weights (docs/02 §7.2):
  shared_offender  0.95   co_accused 0.80   mo_similarity =cosine
  same_location    0.55   same_timewindow 0.40   shared_section 0.30

FAIRNESS: no protected attribute participates in any edge or weight.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

import networkx as nx

from common import parse_dt
import community as community_mod

SIGNAL_WEIGHT = {
    "shared_offender": 0.95,
    "co_accused": 0.80,
    "same_location": 0.55,
    "same_timewindow": 0.40,
    "shared_section": 0.30,
}
EDGE_MIN_STRENGTH = 0.30
LOCATION_PRECISION = 2      # ~1 km cell
TIME_WINDOW_DAYS = 21
MAX_GROUP = 90              # skip blocking groups larger than this (avoids hairballs)


def _cell(lat, lng, p=LOCATION_PRECISION):
    try:
        return f"{round(float(lat), p)},{round(float(lng), p)}"
    except (TypeError, ValueError):
        return ""


def build(tables, identities, mapping, mo_pairs):
    cases = tables["CaseMaster"]
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()

    # --- per-case context ---
    ctx = {}
    for row in cases.itertuples(index=False):
        dt = parse_dt(row.IncidentFromDate) or parse_dt(row.CrimeRegisteredDate)
        ctx[row.CaseMasterID] = {
            "crimeNo": row.CrimeNo,
            "subhead": row.CrimeMinorHeadID,
            "head": row.CrimeMajorHeadID,
            "unit": row.PoliceStationID,
            "district": unit_district.get(row.PoliceStationID, ""),
            "dt": dt,
            "cell": _cell(row.latitude, row.longitude),
            "lat": row.latitude, "lng": row.longitude,
        }

    # --- offender identities: case membership (multi-case identities only) ---
    id_by_oid = {i["offenderIdentityId"]: i for i in identities}
    oid_of_case_accused = defaultdict(set)   # caseId -> set(oid)
    cases_of_oid = defaultdict(set)
    for m in mapping:
        oid_of_case_accused[m["caseMasterId"]].add(m["offenderIdentityId"])
        cases_of_oid[m["offenderIdentityId"]].add(m["caseMasterId"])

    # --- section sets per case ---
    sections = defaultdict(set)
    for row in tables["ActSectionAssociation"].itertuples(index=False):
        sections[row.CaseMasterID].add(f"{row.ActID}:{row.SectionID}")

    # --- candidate pair generation: STRONG signals only (a sparse, meaningful backbone).
    # Shared resolved offender (incl. shared co-accused) and distinctive MO similarity
    # generate pairs; location / time / section are enrichment signals scored on those
    # pairs, never edge generators (which would glue dense areas into hairballs).
    candidates = set()

    def _add_group_pairs(members):
        members = list(members)
        if len(members) < 2 or len(members) > MAX_GROUP:
            return
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b = members[i], members[j]
                candidates.add((a, b) if a < b else (b, a))

    for oid, cids in cases_of_oid.items():
        if len(cids) > 1:
            _add_group_pairs(cids)
    mo_lookup = {}
    for p in mo_pairs:
        a, b = p["a"], p["b"]
        key = (a, b) if a < b else (b, a)
        mo_lookup[key] = p["sim"]
        candidates.add(key)

    # --- score each candidate pair ---
    edges = []
    for (a, b) in candidates:
        ca, cb = ctx.get(a), ctx.get(b)
        if not ca or not cb:
            continue
        signals = []
        evidence = {"sourceFIRs": [ca["crimeNo"], cb["crimeNo"]], "matched": []}

        shared_oids = [o for o in (oid_of_case_accused[a] & oid_of_case_accused[b])
                       if len(cases_of_oid[o]) > 1]
        if shared_oids:
            names = [id_by_oid[o]["canonicalName"] for o in shared_oids]
            signals.append(("shared_offender", SIGNAL_WEIGHT["shared_offender"]))
            evidence["matched"].append({"type": "shared_offender",
                                        "detail": f"Same resolved offender: {', '.join(sorted(set(names)))}",
                                        "offenderIds": sorted(shared_oids)})

        if ca["cell"] and ca["cell"] == cb["cell"]:
            signals.append(("same_location", SIGNAL_WEIGHT["same_location"]))
            evidence["matched"].append({"type": "same_location",
                                        "detail": f"Same ~1km location cell ({ca['cell']})"})

        if ca["dt"] and cb["dt"] and abs((ca["dt"] - cb["dt"]).days) <= TIME_WINDOW_DAYS \
                and ca["subhead"] == cb["subhead"]:
            gap = abs((ca["dt"] - cb["dt"]).days)
            signals.append(("same_timewindow", SIGNAL_WEIGHT["same_timewindow"]))
            evidence["matched"].append({"type": "same_timewindow",
                                        "detail": f"Same crime type within {gap} days"})

        mo = mo_lookup.get((a, b))
        if mo:
            signals.append(("mo_similarity", float(mo)))
            evidence["matched"].append({"type": "mo_similarity",
                                        "detail": f"Similar modus operandi (cosine {mo:.2f})"})

        shared_secs = sections[a] & sections[b]
        if shared_secs:
            signals.append(("shared_section", SIGNAL_WEIGHT["shared_section"]))
            evidence["matched"].append({"type": "shared_section",
                                        "detail": f"Shared act/section: {', '.join(sorted(shared_secs))}"})

        if not signals:
            continue
        # aggregate strength: strongest signal + diminishing bonus for corroboration
        signals.sort(key=lambda s: s[1], reverse=True)
        strength = signals[0][1]
        for _, w in signals[1:]:
            strength += w * (1.0 - strength) * 0.5
        strength = round(min(strength, 1.0), 3)
        if strength < EDGE_MIN_STRENGTH:
            continue
        edges.append({
            "edgeId": f"E{len(edges)+1:07d}",
            "srcType": "case", "srcId": a,
            "dstType": "case", "dstId": b,
            "edgeType": signals[0][0],
            "allTypes": [s[0] for s in signals],
            "strength": strength,
            "evidence": evidence,
        })

    # --- community detection on the weighted case-case projection ---
    G = nx.Graph()
    G.add_nodes_from(ctx.keys())
    for e in edges:
        G.add_edge(e["srcId"], e["dstId"], weight=e["strength"])
    cluster_of = community_mod.detect(G)
    for e in edges:
        e["clusterId"] = cluster_of.get(e["srcId"]) or cluster_of.get(e["dstId"])

    return edges, cluster_of, ctx, cases_of_oid, oid_of_case_accused
