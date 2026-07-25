"""
socio.py — socio-economic correlation and per-capita normalisation.

Answers the problem statement's "understand the *why* behind the *where*": raw FIR counts
mostly measure population, so Bengaluru always "looks worst". Normalising to incidents per
100k residents and correlating against urbanisation / literacy / density turns a count
map into an actual analytical claim.

Outputs
  - per-district crime rate per 100k, with rank shift vs the raw-count rank
  - Pearson + Spearman correlation of the rate against each socio-economic indicator,
    with a two-sided p-value so weak signals can be labelled as such in the UI
  - crime-type composition split by urbanisation band (urban/mixed/rural)

FAIRNESS: every input here is an *area-level* aggregate. Nothing is joined to a person and
nothing here feeds a person-level score. Caste/religion/occupation are never touched.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict

import demographics

URBAN_BANDS = [("Urban", 60.0), ("Mixed", 30.0), ("Rural", 0.0)]


def _band(urban_pct: float) -> str:
    for name, floor in URBAN_BANDS:
        if urban_pct >= floor:
            return name
    return "Rural"


def _rank_map(pairs):
    """Average-rank (1 = highest value), ties share the mean rank — needed for Spearman."""
    ordered = sorted(pairs, key=lambda kv: -kv[1])
    ranks, i = {}, 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[ordered[k][0]] = avg
        i = j + 1
    return ranks


def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    dx = math.sqrt(sum((a - mx) ** 2 for a in xs))
    dy = math.sqrt(sum((b - my) ** 2 for b in ys))
    return num / (dx * dy) if dx and dy else 0.0


def _p_value(r, n):
    """Two-sided p for a correlation, via the t approximation. Good enough at n=31 to
    separate 'real signal' from 'noise' in the UI, which is all we claim."""
    if n < 3 or abs(r) >= 1.0:
        return 0.0
    t = abs(r) * math.sqrt((n - 2) / (1 - r * r))
    df = n - 2
    # Student-t survival via incomplete beta, using the regularised form.
    x = df / (df + t * t)
    return max(0.0, min(1.0, _betainc_half(df / 2, 0.5, x)))


def _betainc_half(a, b, x):
    """Regularised incomplete beta I_x(a,b) by continued fraction (Lentz). Only used for
    the p-value above; df is small so convergence is quick."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    front = math.exp(math.log(x) * a + math.log(1 - x) * b - lbeta) / a
    f, c, d = 1.0, 1.0, 0.0
    for i in range(0, 200):
        m = i // 2
        if i == 0:
            num = 1.0
        elif i % 2 == 0:
            num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
        else:
            num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
        d = 1.0 + num * d
        d = 1e-30 if abs(d) < 1e-30 else d
        d = 1.0 / d
        c = 1.0 + num / c
        c = 1e-30 if abs(c) < 1e-30 else c
        f *= c * d
        if abs(1.0 - c * d) < 1e-8:
            break
    return front * (f - 1.0)


def _strength(r, p):
    if p > 0.05:
        return "not significant"
    a = abs(r)
    return "strong" if a >= 0.6 else "moderate" if a >= 0.4 else "weak"


def compute(tables, unit_district):
    """Return the socio-economic analysis block for the read-model."""
    cases = tables["CaseMaster"]
    heads = {}
    if "CrimeHead" in tables:
        heads = tables["CrimeHead"].set_index("CrimeHeadID")["CrimeGroupName"].to_dict()

    counts = Counter()
    by_head = defaultdict(Counter)
    for row in cases.itertuples(index=False):
        d = unit_district.get(row.PoliceStationID)
        if d in (None, ""):
            continue
        d = int(d)
        counts[d] += 1
        by_head[d][heads.get(row.CrimeMajorHeadID, "Other")] += 1

    # ---- per-district rates, and how far the rank moves once you divide by people ----
    rows = []
    for prof in demographics.all_profiles():
        did = prof["districtId"]
        total = counts.get(did, 0)
        rows.append({
            **prof,
            "total": total,
            "ratePer100k": demographics.per_100k(total, did),
            "band": _band(prof["urbanPct"]),
        })

    raw_rank = _rank_map([(r["districtId"], r["total"]) for r in rows])
    rate_rank = _rank_map([(r["districtId"], r["ratePer100k"]) for r in rows])
    for r in rows:
        r["rankByCount"] = int(raw_rank[r["districtId"]])
        r["rankByRate"] = int(rate_rank[r["districtId"]])
        # positive = looks worse per-capita than raw counts suggest
        r["rankShift"] = r["rankByCount"] - r["rankByRate"]

    # ---- correlations of rate against each indicator ----
    valid = [r for r in rows if r["population"] > 0]
    ys = [r["ratePer100k"] for r in valid]
    n = len(valid)
    correlations = []
    for key, label, why in [
        ("urbanPct", "Urbanisation",
         "Share of the district's population living in urban areas"),
        ("literacyPct", "Literacy",
         "Literacy rate — a standard proxy for socio-economic development"),
        ("popDensity", "Population density",
         "Residents per square kilometre"),
    ]:
        xs = [r[key] for r in valid]
        r_p = _pearson(xs, ys)
        xr = _rank_map([(r["districtId"], r[key]) for r in valid])
        yr = _rank_map([(r["districtId"], r["ratePer100k"]) for r in valid])
        ids = [r["districtId"] for r in valid]
        r_s = _pearson([xr[i] for i in ids], [yr[i] for i in ids])
        p = _p_value(r_p, n)
        correlations.append({
            "indicator": label, "field": key, "why": why,
            "pearson": round(r_p, 3), "spearman": round(r_s, 3),
            "pValue": round(p, 4), "n": n,
            "strength": _strength(r_p, p),
            "direction": "positive" if r_p >= 0 else "negative",
            "points": [{"district": r["districtName"], "x": r[key],
                        "y": r["ratePer100k"], "band": r["band"]} for r in valid],
        })

    # ---- crime-type mix by urbanisation band ----
    band_mix = defaultdict(Counter)
    band_pop = Counter()
    for r in rows:
        band_mix[r["band"]].update(by_head.get(r["districtId"], {}))
        band_pop[r["band"]] += r["population"]
    composition = []
    for band, _ in URBAN_BANDS:
        c = band_mix.get(band)
        if not c:
            continue
        tot = sum(c.values()) or 1
        composition.append({
            "band": band,
            "districts": sum(1 for r in rows if r["band"] == band),
            "population": band_pop[band],
            "total": tot,
            "ratePer100k": round(tot * 100_000 / band_pop[band], 1) if band_pop[band] else 0.0,
            "mix": [{"head": h, "count": v, "pct": round(100 * v / tot, 1)}
                    for h, v in c.most_common(6)],
        })

    return {
        "districts": sorted(rows, key=lambda r: -r["ratePer100k"]),
        "correlations": correlations,
        "composition": composition,
        "method": {
            "denominator": "Census 2011 district population projected to 2026 (x1.17)",
            "note": "Area-level indicators only; never joined to an individual or used "
                    "as a feature in any person-level score.",
        },
    }
