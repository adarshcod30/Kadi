"""
patterns.py — inject the planted ground-truth patterns into the synthetic dataset.

Each pattern is created with the shared Builder so all FKs stay valid, and its exact
IDs are recorded into `_ground_truth.json` so the pipeline eval can prove recovery
(≥90% of planted gangs/chains) and the demo can jump straight to a guaranteed case.

Patterns (see docs/06 §6):
  1. Cross-district chain-snatching gang (1 identity, 3 name variants, 2 co-accused)
  2. Serial burglary chain (2 accused, one district, escalating dates)
  3. Cyber-fraud ring (shared accused, UPI/OTP modus, victims skew an age band)
  4. Repeat offender out on bail (priors + arrests, re-offends -> high risk)
  5. Slipping cases (aged past peer median, some drifting to undetected)
  6. False-case cluster (cstype=B concentrated in one station)
  7. Emerging hotspot (spike of one crime head in one Bengaluru area, last 2 months)

Fairness: none of these patterns correlate with caste/religion/occupation.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import karnataka as K


# Distinctive surnames reserved for planted offenders (NOT in the random name pool),
# so entity resolution resolves them confidently by name.
PLANTED_SURNAMES = [
    "Doddamani", "Chikkanna", "Yaraguntla", "Talwar", "Marihal", "Hosakote", "Belavadi",
    "Kadaganchi", "Mahalingpur", "Savadatti", "Nidagundi", "Ranebennur", "Halagatti",
    "Bommanahalli", "Yelburga", "Mundargi", "Aland", "Chincholi", "Sedam", "Afzalpur",
    "Basavakalyan", "Humnabad", "Shorapur", "Lingsugur", "Manvi", "Sindhanur", "Gangavathi",
    "Kustagi", "Shiggaon", "Byadgi", "Hangal", "Kalghatgi", "Kundgol", "Navalgund",
    "Ron", "Nargund", "Mudhol", "Jamkhandi", "Hunagund", "Badami",
]


def _pick_unit(b, district_id, rng):
    return rng.choice(b.units_by_district[district_id])


def _io_for(b, unit_id, rng):
    pool = b.employees_by_unit.get(unit_id) or [None]
    return rng.choice(pool)


# distinctive MO templates so MO-similarity links the planted rings
SNATCH_MO = ("Two accused on a black motorcycle approached the complainant near {loc}, "
             "snatched the gold chain from the neck and sped away towards the ring road "
             "in the {time}. CCTV of a two-wheeler without number plate available.")
BURGLARY_MO = ("Accused gained entry by breaking the rear window grill of the locked house at {loc} "
               "during {time}, and decamped with gold ornaments and cash from the bedroom almirah.")
CYBER_MO = ("Complainant received a call from a person posing as bank official regarding KYC update, "
            "was induced to share the OTP, and an amount was debited through multiple UPI transactions.")


def inject_all(b, rng, today) -> dict:
    gt = {
        "note": "Synthetic planted ground truth for KADI evaluation. Not imported to Data Store.",
        "gangs": [],
        "serialChains": [],
        "cyberRing": {},
        "riskyOffenderIds": [],
        "slippingCaseIds": [],
        "falseCaseCluster": {},
        "emergingHotspot": {},
    }
    gt["gangs"].append(_gang_chain_snatching(b, rng, today))
    gt["serialChains"].append(_serial_burglary(b, rng, today))
    gt["cyberRing"] = _cyber_ring(b, rng, today)
    gt["riskyOffenderIds"].append(_repeat_offender_on_bail(b, rng, today))
    gt["slippingCaseIds"] = _slipping_cases(b, rng, today)
    gt["falseCaseCluster"] = _false_case_cluster(b, rng, today)
    gt["emergingHotspot"] = _emerging_hotspot(b, rng, today)
    gt["ordinaryRepeatOffenders"] = _ordinary_repeat_offenders(b, rng, today)
    return gt


def _ordinary_repeat_offenders(b, rng, today):
    """~40 everyday repeat offenders (distinctive surnames, 2-4 cases each) so the
    offender watchlist and network views are realistically populated."""
    used = {"Doddamani", "Chikkanna", "Yaraguntla", "Talwar", "Marihal", "Hosakote", "Belavadi"}
    pool = [s for s in PLANTED_SURNAMES if s not in used]
    records = []
    for surname in pool:
        first = rng.choice(K.FIRST_NAMES_M)
        n = rng.randint(2, 4)
        district = rng.choice(list(K.DISTRICT_WEIGHTS.keys()))
        case_ids, accused_ids = [], []
        dt = datetime(2024, rng.randint(1, 12), rng.randint(1, 28), rng.randint(6, 23), 0)
        for i in range(n):
            u = _pick_unit(b, district, rng)
            dt = dt + timedelta(days=rng.randint(40, 220))
            if dt.date() > today:
                dt = datetime.combine(today - timedelta(days=rng.randint(5, 60)), datetime.min.time())
            shid = rng.choice([201, 202, 203, 205, 206, 401, 501])
            arrested = rng.random() < 0.5
            case = b.make_case(district_id=district, unit_id=u["UnitID"], subhead_id=shid,
                               incident_dt=dt, status_id=2 if arrested else 1,
                               io_emp_id=_io_for(b, u["UnitID"], rng))
            cid = case["CaseMasterID"]
            b.add_complainant(cid); b.add_victim(cid)
            # name variant: occasional initial or spelling change
            nm = f"{first} {surname}"
            if i and rng.random() < 0.5:
                nm = f"{first} {surname} {rng.choice(K.INITIALS)}"
            aid = b.add_accused(cid, name=nm, gender_id=1, person_index=1)
            accused_ids.append(aid)
            if arrested:
                b.add_arrest(cid, aid, district, u["UnitID"], _io_for(b, u["UnitID"], rng),
                             (dt + timedelta(days=12)).date())
            case_ids.append(cid)
        records.append({"canonicalOffender": f"{first} {surname}", "surname": surname,
                        "caseMasterIds": case_ids, "accusedMasterIds": accused_ids,
                        "district": district})
    return records


# ---------------------------------------------------------------------------
# 1. Cross-district chain-snatching gang
# ---------------------------------------------------------------------------
def _gang_chain_snatching(b, rng, today):
    # Distinctive surnames (not in the random name pool) so entity resolution can
    # resolve them confidently by name across stations — mirrors a real, traceable
    # offender identity. Random accused with common names require corroboration.
    canonical = "Ravikumar Doddamani"
    variants = ["Ravikumar Doddamani", "Ravi Kumar Doddamani", "Ravikumar D", "Ravi K Doddamani"]
    co1_variants = ["Imran Chikkanna", "Imran Chikkanna S", "Imran C"]
    co2_variants = ["Suresh Yaraguntla", "Suresha Yaraguntla", "Suresh Y"]

    districts = [1, 2, 29]  # Bengaluru City, Bengaluru Rural, Ramanagara
    units = []
    for d in districts:
        us = rng.sample(b.units_by_district[d], min(2, len(b.units_by_district[d])))
        units.extend([(d, u) for u in us])

    n_fir = rng.randint(8, 10)
    case_ids, accused_ids, used_stations, used_districts = [], [], set(), set()
    base_dt = datetime(2025, 9, 1, 22, 0, 0)
    for i in range(n_fir):
        d, u = rng.choice(units)
        incident = base_dt + timedelta(days=i * rng.randint(4, 12), hours=rng.randint(-2, 2))
        lat, lng = b.sample_latlng(d)
        io = _io_for(b, u["UnitID"], rng)
        brief = SNATCH_MO.format(loc=rng.choice(K.STATION_LOCALITIES) + " junction",
                                 time=rng.choice(["late night", "night", "early morning hours"]))
        case = b.make_case(district_id=d, unit_id=u["UnitID"], subhead_id=206,  # chain snatching
                           incident_dt=incident, category_code=1,
                           status_id=rng.choice([1, 1, 4]), brief=brief, lat=lat, lng=lng, io_emp_id=io)
        cid = case["CaseMasterID"]
        b.add_complainant(cid)
        b.add_victim(cid, gender_id=2, age=rng.randint(45, 70))
        # main offender (name variant) always; co-accused sometimes
        a_main = b.add_accused(cid, name=rng.choice(variants), gender_id=1, person_index=1)
        accused_ids.append(a_main)
        idx = 2
        if rng.random() < 0.7:
            accused_ids.append(b.add_accused(cid, name=rng.choice(co1_variants), gender_id=1, person_index=idx)); idx += 1
        if rng.random() < 0.5:
            accused_ids.append(b.add_accused(cid, name=rng.choice(co2_variants), gender_id=1, person_index=idx)); idx += 1
        # one arrest late in the chain (they were caught)
        if i == n_fir - 1:
            b.add_arrest(cid, a_main, d, u["UnitID"], io, (incident + timedelta(days=20)).date())
        case_ids.append(cid)
        used_stations.add(u["UnitID"]); used_districts.add(d)

    return {
        "name": "Cross-district chain-snatching gang",
        "canonicalOffender": canonical,
        "variants": variants,
        "coAccused": [co1_variants[0], co2_variants[0]],
        "caseMasterIds": case_ids,
        "accusedMasterIds": accused_ids,
        "districts": sorted(used_districts),
        "stations": sorted(used_stations),
        "expectedCluster": True,
    }


# ---------------------------------------------------------------------------
# 2. Serial burglary chain (one district, escalating dates, 2 accused)
# ---------------------------------------------------------------------------
def _serial_burglary(b, rng, today):
    a1_variants = ["Manjunath Talwar", "Manjunatha Talwar", "Manju Talwar"]
    a2_variants = ["Prakash Marihal", "Prakash Marihala"]
    district = 3  # Mysuru
    units = rng.sample(b.units_by_district[district], min(3, len(b.units_by_district[district])))
    n = rng.randint(6, 8)
    case_ids, accused_ids, stations = [], [], set()
    dt = datetime(2025, 11, 5, 2, 30, 0)
    for i in range(n):
        u = rng.choice(units)
        dt = dt + timedelta(days=rng.randint(6, 14))
        lat, lng = b.sample_latlng(district)
        io = _io_for(b, u["UnitID"], rng)
        brief = BURGLARY_MO.format(loc=rng.choice(K.STATION_LOCALITIES) + " layout",
                                   time=rng.choice(["late night", "early morning hours"]))
        case = b.make_case(district_id=district, unit_id=u["UnitID"], subhead_id=202,
                           incident_dt=dt, status_id=rng.choice([1, 1, 4]),
                           brief=brief, lat=lat, lng=lng, io_emp_id=io)
        cid = case["CaseMasterID"]
        b.add_complainant(cid)
        b.add_victim(cid)
        accused_ids.append(b.add_accused(cid, name=rng.choice(a1_variants), gender_id=1, person_index=1))
        if rng.random() < 0.8:
            accused_ids.append(b.add_accused(cid, name=rng.choice(a2_variants), gender_id=1, person_index=2))
        case_ids.append(cid); stations.add(u["UnitID"])
    return {
        "name": "Serial burglary chain",
        "canonicalOffenders": [a1_variants[0], a2_variants[0]],
        "variants": {"a1": a1_variants, "a2": a2_variants},
        "caseMasterIds": case_ids,
        "accusedMasterIds": accused_ids,
        "districts": [district],
        "stations": sorted(stations),
        "expectedCluster": True,
    }


# ---------------------------------------------------------------------------
# 3. Cyber-fraud ring (shared accused, UPI/OTP modus, victims skew age band)
# ---------------------------------------------------------------------------
def _cyber_ring(b, rng, today):
    ring_variants = ["Naveen Hosakote", "Naveen Hosakote R", "Naveena Hosakote"]
    districts = [1, 4, 5, 6]  # spread across state
    n = rng.randint(7, 9)
    case_ids, accused_ids, used_d = [], [], set()
    dt = datetime(2026, 1, 10, 12, 0, 0)
    for i in range(n):
        d = rng.choice(districts)
        u = _pick_unit(b, d, rng)
        dt = dt + timedelta(days=rng.randint(3, 9))
        io = _io_for(b, u["UnitID"], rng)
        case = b.make_case(district_id=d, unit_id=u["UnitID"], subhead_id=401,  # UPI/OTP fraud
                           incident_dt=dt, status_id=rng.choice([1, 1, 4]),
                           brief=CYBER_MO, io_emp_id=io)
        cid = case["CaseMasterID"]
        b.add_complainant(cid)
        # victims skew 55-72 age band (vulnerability analytics — victim side only)
        for _ in range(rng.choice([1, 1, 2])):
            b.add_victim(cid, age=rng.randint(55, 72))
        accused_ids.append(b.add_accused(cid, name=rng.choice(ring_variants), gender_id=1, person_index=1))
        case_ids.append(cid); used_d.add(d)
    return {
        "name": "Cyber-fraud ring (UPI/OTP)",
        "canonicalOffender": ring_variants[0],
        "variants": ring_variants,
        "caseMasterIds": case_ids,
        "accusedMasterIds": accused_ids,
        "districts": sorted(used_d),
        "victimAgeBand": [55, 72],
        "expectedCluster": True,
    }


# ---------------------------------------------------------------------------
# 4. Repeat offender out on bail (priors + arrests, re-offends -> high risk)
# ---------------------------------------------------------------------------
def _repeat_offender_on_bail(b, rng, today):
    variants = ["Basavaraj Belavadi", "Basavaraja Belavadi", "Basava Belavadi"]
    district = 5  # Belagavi
    units = rng.sample(b.units_by_district[district], min(3, len(b.units_by_district[district])))
    case_ids, accused_ids, arrests = [], [], 0
    # priors 2023-2024 (arrested), then new FIRs 2025-2026 (re-offending while on bail)
    timeline = [
        (datetime(2023, 4, 10, 21, 0), 203, True),
        (datetime(2023, 9, 22, 23, 0), 202, True),
        (datetime(2024, 3, 15, 20, 0), 203, True),
        (datetime(2025, 6, 5, 22, 0), 206, False),
        (datetime(2025, 12, 18, 1, 0), 202, False),
        (datetime(2026, 4, 2, 23, 30), 203, False),
    ]
    for dt, shid, arrested in timeline:
        u = rng.choice(units)
        io = _io_for(b, u["UnitID"], rng)
        case = b.make_case(district_id=district, unit_id=u["UnitID"], subhead_id=shid,
                           incident_dt=dt, status_id=2 if arrested else 1, io_emp_id=io)
        cid = case["CaseMasterID"]
        b.add_complainant(cid); b.add_victim(cid)
        aid = b.add_accused(cid, name=rng.choice(variants), gender_id=1, person_index=1)
        accused_ids.append(aid)
        if arrested:
            b.add_arrest(cid, aid, district, u["UnitID"], io, (dt + timedelta(days=15)).date())
            arrests += 1
        case_ids.append(cid)
    return {
        "name": "Repeat offender out on bail",
        "canonicalOffender": variants[0],
        "variants": variants,
        "caseMasterIds": case_ids,
        "accusedMasterIds": accused_ids,
        "districts": [district],
        "priorArrests": arrests,
        "expectedHighRisk": True,
    }


# ---------------------------------------------------------------------------
# 5. Slipping cases (aged well past peer median; some drifting to undetected)
# ---------------------------------------------------------------------------
def _slipping_cases(b, rng, today):
    district = 6  # Kalaburagi
    unit = _pick_unit(b, district, rng)
    io = _io_for(b, unit["UnitID"], rng)
    ids = []
    for i in range(12):
        # registered 8-16 months ago, still Under Investigation (aged), no chargesheet
        months_ago = rng.randint(8, 16)
        incident = datetime.combine(today - timedelta(days=months_ago * 30 + rng.randint(0, 20)),
                                    datetime.min.time()) + timedelta(hours=rng.randint(0, 23))
        shid = rng.choice([201, 202, 103, 205])
        status = 1 if i < 8 else 4  # last few drift to undetected
        case = b.make_case(district_id=district, unit_id=unit["UnitID"], subhead_id=shid,
                           incident_dt=incident, status_id=status, io_emp_id=io)
        cid = case["CaseMasterID"]
        b.add_complainant(cid); b.add_victim(cid)
        if rng.random() < 0.5:
            b.add_accused(cid, person_index=1)
        ids.append(cid)
    return ids


# ---------------------------------------------------------------------------
# 6. False-case cluster (cstype=B concentrated in one station)
# ---------------------------------------------------------------------------
def _false_case_cluster(b, rng, today):
    district = 8  # Ballari
    unit = _pick_unit(b, district, rng)
    io = _io_for(b, unit["UnitID"], rng)
    ids = []
    for i in range(9):
        incident = datetime.combine(today - timedelta(days=rng.randint(120, 400)),
                                    datetime.min.time())
        case = b.make_case(district_id=district, unit_id=unit["UnitID"],
                           subhead_id=rng.choice([501, 301, 103]),
                           incident_dt=incident, status_id=3, io_emp_id=io)
        cid = case["CaseMasterID"]
        b.add_complainant(cid)
        cs_date = datetime.combine(case["reg_date"] + timedelta(days=rng.randint(30, 120)), datetime.min.time())
        b.add_chargesheet(cid, cs_date, "B", io)  # false case
        ids.append(cid)
    return {"name": "False-case cluster", "stationUnitId": unit["UnitID"],
            "district": district, "caseMasterIds": ids, "cstype": "B"}


# ---------------------------------------------------------------------------
# 7. Emerging hotspot (spike of one crime head in one Bengaluru area, last 2 months)
# ---------------------------------------------------------------------------
def _emerging_hotspot(b, rng, today):
    district = 1
    # a distinct spot NOT on the base Bengaluru hotspot centroids, so the historical
    # baseline is low and the recent spike reads as genuinely emerging.
    clat, clng = 12.9560, 77.7480   # Whitefield-ish, east Bengaluru
    unit = _pick_unit(b, district, rng)
    io = _io_for(b, unit["UnitID"], rng)
    ids = []
    for i in range(70):
        incident = datetime.combine(today - timedelta(days=rng.randint(1, 55)),
                                    datetime.min.time()) + timedelta(hours=rng.randint(18, 23))
        lat = round(clat + rng.uniform(-0.004, 0.004), 6)
        lng = round(clng + rng.uniform(-0.004, 0.004), 6)
        case = b.make_case(district_id=district, unit_id=unit["UnitID"], subhead_id=205,  # MV theft
                           incident_dt=incident, status_id=rng.choice([1, 4]),
                           lat=lat, lng=lng, io_emp_id=io)
        b.add_complainant(case["CaseMasterID"]); b.add_victim(case["CaseMasterID"])
        ids.append(case["CaseMasterID"])
    return {"name": "Emerging MV-theft hotspot", "district": district, "crimeHeadId": 2,
            "crimeSubHeadId": 205, "centroidLat": clat, "centroidLng": clng,
            "windowDays": 55, "caseMasterIds": ids, "cellIds": []}
