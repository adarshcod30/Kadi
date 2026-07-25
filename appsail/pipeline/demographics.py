"""
demographics.py — district socio-economic reference data for Karnataka.

Source: Census of India 2011 district tables (population, literacy rate, urban share,
area), projected to 2026 with Karnataka's ~1.05%/yr decadal growth. These are real
published figures, not synthetic — the crime data is synthetic but the denominators it
is normalised against must be real, or per-capita rates are meaningless.

Two of our police districts are city commissionerates carved out of a parent revenue
district, which is how KSP is actually organised:
  - Bengaluru City (1) vs Bengaluru Rural (2)   -> Bengaluru Urban district, split
  - Hubballi-Dharwad (7) vs Dharwad (31)        -> Dharwad district, split
For those we apportion the parent district's population between the urban
commissionerate and the rural remainder, and set the urban share accordingly.

FAIRNESS: these are area-level aggregates (population, literacy, urbanisation). They are
never joined to an individual and never used as a model feature for any person-level
prediction — only to normalise counts into rates and to explain area-level variation.
See PROTECTED_COLUMNS in common.py for the person-level exclusions.
"""
from __future__ import annotations

# 2011 -> 2026 projection: Karnataka grew 15.6% over 2001-2011; recent estimates put
# annual growth near 1.05%, so 15 years compounds to ~1.17.
PROJECTION_2026 = 1.17

# DistrictID: (name, census2011_population, literacy_pct, urban_pct, area_sq_km)
DISTRICT_DEMOGRAPHICS = {
    1:  ("Bengaluru City",     8_500_000, 88.7, 98.0,   741),
    2:  ("Bengaluru Rural",    2_112_474, 77.9, 30.6,  2298),
    3:  ("Mysuru",             3_001_127, 72.8, 41.5,  6854),
    4:  ("Dakshina Kannada",   2_089_649, 88.6, 47.7,  4560),
    5:  ("Belagavi",           4_779_661, 73.5, 25.1, 13415),
    6:  ("Kalaburagi",         2_566_326, 64.9, 32.5, 10951),
    7:  ("Hubballi-Dharwad",   1_050_000, 84.0, 96.0,   202),
    8:  ("Ballari",            2_452_595, 67.4, 37.6,  8447),
    9:  ("Vijayapura",         2_177_331, 67.2, 23.3, 10494),
    10: ("Shivamogga",         1_752_753, 80.5, 35.4,  8477),
    11: ("Tumakuru",           2_678_980, 75.1, 22.3, 10598),
    12: ("Davanagere",         1_945_497, 75.7, 32.3,  5926),
    13: ("Udupi",              1_177_361, 86.2, 28.5,  3880),
    14: ("Hassan",             1_776_421, 75.9, 21.4,  6814),
    15: ("Mandya",             1_805_769, 70.1, 17.1,  4961),
    16: ("Chitradurga",        1_659_456, 73.7, 19.5,  8440),
    17: ("Kolar",              1_536_401, 74.4, 32.5,  4012),
    18: ("Raichur",            1_928_812, 59.6, 22.4,  8386),
    19: ("Bidar",              1_703_300, 70.5, 24.4,  5448),
    20: ("Koppal",             1_389_920, 68.1, 16.9,  7189),
    21: ("Haveri",             1_597_668, 77.6, 21.9,  4823),
    22: ("Gadag",              1_064_570, 75.1, 35.6,  4656),
    23: ("Chikkamagaluru",     1_137_961, 79.3, 21.6,  7201),
    24: ("Chamarajanagar",     1_020_791, 61.4, 17.1,  5101),
    25: ("Kodagu",               554_519, 82.6, 14.6,  4102),
    26: ("Bagalkote",          1_889_752, 68.8, 31.5,  6575),
    27: ("Yadgir",             1_174_271, 51.8, 17.2,  5225),
    28: ("Chikkaballapura",    1_255_104, 69.8, 22.9,  4208),
    29: ("Ramanagara",         1_082_636, 69.2, 25.1,  3573),
    30: ("Uttara Kannada",     1_437_169, 84.1, 30.0, 10291),
    31: ("Dharwad",              797_023, 76.5, 30.0,  4061),
}


def population(district_id: int) -> int:
    """Projected 2026 population for a district, or 0 if unknown."""
    row = DISTRICT_DEMOGRAPHICS.get(district_id)
    return int(row[1] * PROJECTION_2026) if row else 0


def profile(district_id: int) -> dict | None:
    """Full socio-economic profile for a district."""
    row = DISTRICT_DEMOGRAPHICS.get(district_id)
    if not row:
        return None
    name, pop2011, literacy, urban, area = row
    pop = int(pop2011 * PROJECTION_2026)
    return {
        "districtId": district_id,
        "districtName": name,
        "population": pop,
        "literacyPct": literacy,
        "urbanPct": urban,
        "areaSqKm": area,
        "popDensity": round(pop / area, 1) if area else 0.0,
    }


def all_profiles() -> list[dict]:
    return [profile(d) for d in sorted(DISTRICT_DEMOGRAPHICS)]


def per_100k(count: int, district_id: int) -> float:
    """Crime count normalised to incidents per 100,000 residents."""
    pop = population(district_id)
    return round(count * 100_000 / pop, 1) if pop else 0.0
