"""
national.py — realistic national context (state-wise crime magnitudes) so KADI can
frame Karnataka within an all-India picture (country-wide → state-wise → district).

Figures are realistic-magnitude annual cognizable-crime approximations (IPC+SLL, NCRB
scale) used ONLY for a comparative national overview — the detailed FIR analytics run on
the synthetic Karnataka dataset. Not used in any offender/risk model.
"""
from __future__ import annotations

# state, approx annual cognizable crimes (thousands), population (millions), lat, lng
NATIONAL_STATES = [
    ("Uttar Pradesh", 655, 231, 27.0, 80.9),
    ("Maharashtra", 388, 124, 19.7, 75.7),
    ("Madhya Pradesh", 305, 86, 23.5, 78.5),
    ("Kerala", 362, 35, 10.5, 76.3),
    ("Tamil Nadu", 292, 77, 11.1, 78.7),
    ("Rajasthan", 239, 81, 27.0, 74.2),
    ("Karnataka", 186, 67, 15.3, 75.7),
    ("Bihar", 179, 128, 25.8, 85.1),
    ("West Bengal", 172, 99, 22.9, 87.9),
    ("Gujarat", 162, 71, 22.6, 71.6),
    ("Delhi", 341, 20, 28.7, 77.1),
    ("Telangana", 141, 38, 17.9, 79.0),
    ("Andhra Pradesh", 112, 53, 15.9, 79.7),
    ("Assam", 134, 35, 26.2, 92.9),
    ("Haryana", 109, 30, 29.1, 76.1),
    ("Odisha", 118, 46, 20.9, 85.1),
    ("Punjab", 68, 30, 31.1, 75.3),
    ("Jharkhand", 62, 39, 23.6, 85.3),
    ("Chhattisgarh", 76, 30, 21.3, 81.9),
    ("Uttarakhand", 27, 11, 30.1, 79.2),
    ("Himachal Pradesh", 18, 7, 31.9, 77.2),
    ("Jammu & Kashmir", 25, 14, 33.8, 76.6),
    ("Goa", 4, 1.5, 15.5, 74.0),
    ("Tripura", 6, 4, 23.9, 91.5),
    ("Manipur", 4, 3, 24.7, 93.9),
    ("Meghalaya", 4, 3.3, 25.6, 91.4),
]


def national_context():
    total = sum(s[1] for s in NATIONAL_STATES)
    rows = []
    for name, crimes, pop, lat, lng in NATIONAL_STATES:
        rows.append({
            "state": name, "crimesThousands": crimes, "populationMillions": pop,
            "ratePerLakh": round(crimes * 1000 / (pop * 10), 1),  # per 100k
            "lat": lat, "lng": lng,
            "isFocus": name == "Karnataka",
        })
    rows.sort(key=lambda r: r["crimesThousands"], reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    ka = next(r for r in rows if r["isFocus"])
    return {
        "states": rows,
        "totalCrimesThousands": total,
        "focusState": "Karnataka",
        "focusRank": ka["rank"],
        "focusRatePerLakh": ka["ratePerLakh"],
        "note": "National figures are realistic-magnitude approximations for comparative context "
                "only; detailed analytics run on the Karnataka synthetic FIR dataset.",
    }
