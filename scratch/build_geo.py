"""Build simplified GeoJSON assets for the client:
   - karnataka_districts.json : KA districts, simplified, tagged with our DistrictID
   - india_outline.json       : India official composite boundary (simplified) for context
"""
import json, os
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

SCRATCH = os.path.dirname(__file__)
OUT = os.path.join(SCRATCH, "..", "client", "src", "geo")
os.makedirs(OUT, exist_ok=True)

# GADM (geohacker) district name -> our DistrictID (docs/03 + karnataka.py)
NAME_TO_ID = {
    "Bangalore Urban": 1, "Bangalore Rural": 2, "Mysore": 3, "Dakshin Kannad": 4,
    "Belgaum": 5, "Gulbarga": 6, "Dharwad": 31, "Bellary": 8, "Bijapur": 9,
    "Shimoga": 10, "Tumkur": 11, "Davanagere": 12, "Udupi": 13, "Hassan": 14,
    "Mandya": 15, "Chitradurga": 16, "Kolar": 17, "Raichur": 18, "Bidar": 19,
    "Koppal": 20, "Haveri": 21, "Gadag": 22, "Chikmagalur": 23, "Chamrajnagar": 24,
    "Kodagu": 25, "Bagalkot": 26, "Uttar Kannand": 30,
}
# our canonical district names for display
ID_TO_NAME = {
    1: "Bengaluru City", 2: "Bengaluru Rural", 3: "Mysuru", 4: "Dakshina Kannada",
    5: "Belagavi", 6: "Kalaburagi", 7: "Hubballi-Dharwad", 8: "Ballari", 9: "Vijayapura",
    10: "Shivamogga", 11: "Tumakuru", 12: "Davanagere", 13: "Udupi", 14: "Hassan",
    15: "Mandya", 16: "Chitradurga", 17: "Kolar", 18: "Raichur", 19: "Bidar", 20: "Koppal",
    21: "Haveri", 22: "Gadag", 23: "Chikkamagaluru", 24: "Chamarajanagar", 25: "Kodagu",
    26: "Bagalkote", 27: "Yadgir", 28: "Chikkaballapura", 29: "Ramanagara",
    30: "Uttara Kannada", 31: "Dharwad",
}

def simplify(geom, tol):
    g = shape(geom).buffer(0).simplify(tol, preserve_topology=True)
    return mapping(g)

# ---- Karnataka districts ----
d = json.load(open(os.path.join(SCRATCH, "india_district.geojson")))
feats = []
for f in d["features"]:
    if f["properties"].get("NAME_1") != "Karnataka":
        continue
    nm = f["properties"]["NAME_2"]
    did = NAME_TO_ID.get(nm)
    if not did:
        continue
    feats.append({
        "type": "Feature",
        "properties": {"districtId": str(did), "district": ID_TO_NAME[did], "gadm": nm},
        "geometry": simplify(f["geometry"], 0.006),
    })
ka = {"type": "FeatureCollection", "features": feats}
p = os.path.join(OUT, "karnataka_districts.json")
json.dump(ka, open(p, "w"), separators=(",", ":"))
print("karnataka_districts.json", len(feats), "districts", os.path.getsize(p) // 1024, "KB")

# ---- India official outline (composite) ----
ic = json.load(open(os.path.join(SCRATCH, "india_composite.geojson")))
geoms = [shape(f["geometry"]).buffer(0) for f in ic["features"] if f.get("geometry")]
union = unary_union(geoms).simplify(0.02, preserve_topology=True)
india = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"name": "India"}, "geometry": mapping(union)}]}
p2 = os.path.join(OUT, "india_outline.json")
json.dump(india, open(p2, "w"), separators=(",", ":"))
print("india_outline.json", os.path.getsize(p2) // 1024, "KB")
