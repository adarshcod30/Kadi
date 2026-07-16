"""
mo_similarity.py — modus-operandi similarity over BriefFacts.

Per crime sub-head we TF-IDF the BriefFacts text and find each case's nearest
neighbours (sparse cosine). Pairs above a threshold become candidate MO-similarity
links — the planted gang / serial / cyber rings share near-identical MO templates, so
they surface with high cosine, while unrelated cases stay below threshold.

Lightweight by design (sklearn TF-IDF, not sentence-transformers) so it runs inside a
Catalyst Job's time and memory budget. FAIRNESS: only free-text MO is used, no
protected fields.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors

MO_THRESHOLD = 0.85   # cosine similarity to record an MO pair (distinctive text only)
TOP_K = 4
MIN_GROUP = 2
MAX_GROUP = 8000

# Brute-force kneighbors materialises the distance block in chunks sized by sklearn's
# `working_memory`, which defaults to 1 GiB — on its own that is twice a Catalyst Job's
# 512 MB ceiling, and a MAX_GROUP-sized block (8000x8000 float64) is 512 MB by itself.
# Chunking smaller costs nothing measurable here (the work is the same, just in more
# passes) and yields byte-identical pairs; it only bounds the scratch buffer.
WORKING_MEMORY_MB = 32


def compute(tables: dict):
    """Return list of {a, b, sim} case pairs (a<b) with MO cosine >= MO_THRESHOLD."""
    cases = tables["CaseMaster"]
    by_subhead = defaultdict(list)
    for row in cases.itertuples(index=False):
        by_subhead[row.CrimeMinorHeadID].append((row.CaseMasterID, row.BriefFacts or ""))

    pairs = {}
    for subhead, items in by_subhead.items():
        if len(items) < MIN_GROUP or len(items) > MAX_GROUP:
            continue
        ids = [cid for cid, _ in items]
        texts = [txt for _, txt in items]
        try:
            vec = TfidfVectorizer(stop_words="english", min_df=1, ngram_range=(1, 2))
            X = vec.fit_transform(texts)
        except ValueError:
            continue
        if X.shape[1] == 0:
            continue
        k = min(TOP_K + 1, len(ids))
        nn = NearestNeighbors(n_neighbors=k, metric="cosine", algorithm="brute")
        nn.fit(X)
        with sklearn.config_context(working_memory=WORKING_MEMORY_MB):
            dist, idx = nn.kneighbors(X)
        for i in range(len(ids)):
            for d, j in zip(dist[i], idx[i]):
                if i == j:
                    continue
                sim = 1.0 - float(d)
                if sim < MO_THRESHOLD:
                    continue
                a, b = ids[i], ids[j]
                key = (a, b) if a < b else (b, a)
                prev = pairs.get(key, 0.0)
                if sim > prev:
                    pairs[key] = round(sim, 3)

    return [{"a": a, "b": b, "sim": s} for (a, b), s in pairs.items()]
