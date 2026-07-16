"""
geo_sampler.py — sample realistic incident coordinates INSIDE real district polygons.

Sampling inside a district's bounding box (the naive approach) puts crimes in rectangles
— visibly synthetic on a map, and sometimes in the sea. This samples inside the actual
Karnataka district geometry, with most incidents clustered around a few urban centres per
district (towns/cities carry the volume) and the rest spread over the rural remainder.

Pools are precomputed once per district for speed, then drawn from during generation.
"""
from __future__ import annotations

import json
import os
import random

from shapely.geometry import shape, Point
from shapely.prepared import prep

GEOJSON = os.path.join(os.path.dirname(__file__), "..", "..", "client", "src", "geo",
                       "karnataka_districts.json")

# Districts created after the GADM vintage have no polygon of their own; sample them from
# the parent district they were carved out of (geographically correct enough).
FALLBACK = {
    7: 31,   # Hubballi-Dharwad -> Dharwad
    27: 6,   # Yadgir -> Kalaburagi
    28: 17,  # Chikkaballapura -> Kolar
    29: 2,   # Ramanagara -> Bengaluru Rural
}

POOL_SIZE = 4000          # candidate points cached per district
URBAN_SHARE = 0.62        # share of incidents near an urban centre
CENTRES_PER_DISTRICT = 4


class GeoSampler:
    def __init__(self, seed: int = 2026):
        self.rng = random.Random(seed)
        self._polys = {}
        self._pools = {}
        self._load()

    def _load(self):
        with open(os.path.abspath(GEOJSON), encoding="utf-8") as f:
            fc = json.load(f)
        for feat in fc["features"]:
            did = int(feat["properties"]["districtId"])
            geom = shape(feat["geometry"]).buffer(0)
            self._polys[did] = geom

    def has(self, district_id: int) -> bool:
        return self._resolve(district_id) is not None

    def _resolve(self, district_id: int):
        if district_id in self._polys:
            return self._polys[district_id]
        alt = FALLBACK.get(district_id)
        return self._polys.get(alt) if alt else None

    def _random_in(self, poly, prepared, n):
        """Rejection-sample n points strictly inside the polygon."""
        minx, miny, maxx, maxy = poly.bounds
        out = []
        guard = 0
        while len(out) < n and guard < n * 200:
            guard += 1
            p = Point(self.rng.uniform(minx, maxx), self.rng.uniform(miny, maxy))
            if prepared.contains(p):
                out.append((p.x, p.y))
        return out

    def _build_pool(self, district_id: int, centres=None):
        poly = self._resolve(district_id)
        if poly is None:
            return []
        prepared = prep(poly)
        # urban centres: either supplied (e.g. real Bengaluru wards) or picked inside
        if centres:
            cs = [(lng, lat) for (lat, lng) in centres if prepared.contains(Point(lng, lat))]
        else:
            cs = []
        if not cs:
            cs = self._random_in(poly, prepared, CENTRES_PER_DISTRICT)
        if not cs:
            return []

        pool = []
        n_urban = int(POOL_SIZE * URBAN_SHARE)
        guard = 0
        while len(pool) < n_urban and guard < n_urban * 60:
            guard += 1
            cx, cy = self.rng.choice(cs)
            # tight gaussian around a town centre
            p = Point(self.rng.gauss(cx, 0.035), self.rng.gauss(cy, 0.035))
            if prepared.contains(p):
                pool.append((p.y, p.x))  # (lat, lng)
        rural = self._random_in(poly, prepared, POOL_SIZE - len(pool))
        pool.extend([(y, x) for (x, y) in rural])
        self.rng.shuffle(pool)
        return pool

    def prepare(self, district_id: int, centres=None):
        if district_id not in self._pools:
            self._pools[district_id] = self._build_pool(district_id, centres)
        return bool(self._pools[district_id])

    def sample(self, district_id: int, centres=None):
        """Return (lat, lng) inside the district, or None if no geometry available."""
        self.prepare(district_id, centres)
        pool = self._pools.get(district_id) or []
        if not pool:
            return None
        return pool[self.rng.randrange(len(pool))]
