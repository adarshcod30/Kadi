"""
community.py — detect offender/case communities (gangs) on the case-linkage graph.

Louvain modularity on the weighted case-case projection groups cases that are densely
inter-linked (shared offenders, MO, location, time) into clusters — the operational
notion of a "gang" / serial-crime network.
"""
from __future__ import annotations

import networkx as nx


def detect(graph: "nx.Graph"):
    """Return {caseId: clusterId} for components with >=2 nodes; singletons get None."""
    cluster_of = {}
    cid = 0
    try:
        communities = nx.community.louvain_communities(graph, weight="weight", seed=2026)
    except Exception:
        communities = list(nx.connected_components(graph))
    for comm in communities:
        if len(comm) < 2:
            continue
        cid += 1
        label = f"CL{cid:05d}"
        for node in comm:
            cluster_of[node] = label
    return cluster_of
