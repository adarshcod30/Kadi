#!/usr/bin/env python3
"""
generate.py — KADI synthetic FIR dataset generator.

Produces schema-faithful CSVs (one per table in docs/03_DATABASE_SCHEMA.md Part A),
a `_ground_truth.json` of planted patterns, and a `_manifest.json`.

Deterministic (SEED). Run:
    python data/generator/generate.py --cases 40000 --out data/output
    python data/generator/generate.py --cases 6000            # fast dev scale

Design: a single `Builder` mints every row and keeps FK integrity + CrimeNo serials
consistent. Base random cases are generated first, then `patterns.py` injects the
planted ground-truth (gangs, serial chains, cyber ring, risky offender, slipping /
false cases, emerging hotspot) using the same Builder so everything stays valid.

Fairness: caste / religion / occupation are sampled INDEPENDENTLY of crime, offender,
disposition and geography (see _independent_protected). They carry no predictive signal
by construction.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
from collections import defaultdict
from datetime import date, datetime, timedelta

import karnataka as K
from patterns import PLANTED_SURNAMES

SEED = 2026
DATE_START = date(2023, 1, 1)
DATE_END = date(2026, 6, 30)
TODAY = date(2026, 7, 13)  # "now" for the demo (matches currentDate)


# ---------------------------------------------------------------------------
# Deterministic RNG helpers
# ---------------------------------------------------------------------------
class Rng:
    def __init__(self, seed: int):
        self.r = random.Random(seed)

    def choice(self, seq):
        return self.r.choice(seq)

    def choices(self, seq, weights=None, k=1):
        return self.r.choices(seq, weights=weights, k=k)

    def randint(self, a, b):
        return self.r.randint(a, b)

    def random(self):
        return self.r.random()

    def uniform(self, a, b):
        return self.r.uniform(a, b)

    def sample(self, seq, k):
        return self.r.sample(list(seq), k)

    def weighted_key(self, weight_map: dict):
        keys = list(weight_map.keys())
        w = list(weight_map.values())
        return self.r.choices(keys, weights=w, k=1)[0]

    def date_between(self, d0: date, d1: date) -> date:
        delta = (d1 - d0).days
        return d0 + timedelta(days=self.r.randint(0, max(delta, 0)))


def fmt_dt(dt) -> str:
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return dt.strftime("%Y-%m-%d")


def fmt_d(d) -> str:
    return "" if d is None else d.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Builder — mints rows for every table with FK integrity
# ---------------------------------------------------------------------------
class Builder:
    def __init__(self, rng: Rng):
        self.rng = rng
        self._recurring = []
        self._recurring_w = []
        self.rows = defaultdict(list)  # table_name -> list[dict]
        self._ids = defaultdict(int)
        self._serials = defaultdict(int)  # (unitId, category_code, year) -> serial
        # runtime reference (populated by build_reference)
        self.units = []                    # list of unit dicts
        self.units_by_district = defaultdict(list)
        self.employees_by_unit = defaultdict(list)
        self.courts_by_district = {}
        self.subhead_index = {sh[0]: sh for sh in K.CRIME_SUBHEADS}
        self.head_of_subhead = {sh[0]: sh[1] for sh in K.CRIME_SUBHEADS}
        # real district geometry for coordinate sampling (optional dependency)
        try:
            from geo_sampler import GeoSampler
            self.geo = GeoSampler(seed=SEED)
            print(f"[KADI] geo sampler: {len(self.geo._polys)} district polygons loaded")
        except Exception as e:  # shapely/geojson missing -> bbox fallback
            self.geo = None
            print(f"[KADI] geo sampler unavailable ({e}); falling back to bounding boxes")

    def _next(self, key: str) -> int:
        self._ids[key] += 1
        return self._ids[key]

    def add(self, table: str, row: dict):
        self.rows[table].append(row)
        return row

    # --- CrimeNo / CaseNo ---
    def crime_no(self, category_code: int, district_id: int, unit_id: int, year: int):
        skey = (unit_id, category_code, year)
        self._serials[skey] += 1
        serial = self._serials[skey]
        crime_no = f"{category_code:1d}{district_id:04d}{unit_id:04d}{year:04d}{serial:05d}"
        case_no = f"{year:04d}{serial:05d}"
        return crime_no, case_no

    # --- names ---
    def name_variant(self, canonical: str) -> str:
        """One plausible way a constable might write this name on a given day.

        Real registers are messy: initials get added or dropped, compound first names get
        merged, surnames get transliterated differently. Our corpus was generating a fresh
        random name for every accused, so entity resolution had almost nothing to merge --
        36,890 records collapsed to 36,289 identities, only 601 merges. That made a genuine
        capability look weak. This produces the noise ER is supposed to survive."""
        toks = canonical.split()
        if len(toks) < 2:
            return canonical
        r = self.rng.random()
        first, last = toks[0], toks[-1]
        mid = toks[1] if len(toks) > 2 else ""
        if r < 0.34:
            return canonical                                   # written in full
        if r < 0.46 and mid:
            return f"{first}{mid.lower()} {last}"              # "Ravi Kumar" -> "Ravikumar"
        if r < 0.58:
            return f"{first} {last[0]}"                        # surname to an initial
        if r < 0.68:
            return f"{first[0]} {last}"                         # first name to an initial
        if r < 0.78:
            return f"{first} {last} {self.rng.choice(K.INITIALS)}"   # trailing initial
        if r < 0.88:
            # transliteration drift: doubled consonants collapse, 'th'/'t' swap
            v = last.replace("dd", "d").replace("tt", "t").replace("th", "t")
            return f"{first} {v}" if v != last else f"{first} {last}"
        if mid:
            return f"{first} {mid[0]} {last}"                   # middle to an initial
        return f"{first} {last}"

    def recurring_person(self):
        """Draw someone from the recurring population, or None for a one-time offender.

        Real offending is heavily skewed: a small minority commit a large share of crime.
        Weighting the draw reproduces that, and it is what makes repeat-offender tracking
        and association detection have anything to find."""
        if not self._recurring:
            return None
        if self.rng.random() > 0.08:      # keeps distinctive surnames under the rarity gate
            return None
        return self.rng.choices(self._recurring, weights=self._recurring_w)[0]

    def build_recurring_pool(self, n: int = 900):
        """Canonical identities that reappear across the corpus, with a Zipf-ish weight."""
        self._recurring = []
        self._recurring_w = []
        seen = set()
        while len(self._recurring) < n:
            g = 1 if self.rng.random() < 0.9 else 2
            first = self.rng.choice(K.FIRST_NAMES_F if g == 2 else K.FIRST_NAMES_M)
            # Distinctive (place-derived) surnames, NOT the 30-name common pool. A surname
            # seen 1,200 times carries no identity signal, so ER correctly refuses to merge
            # on it; these stay rare enough to be evidence.
            last = self.rng.choice(PLANTED_SURNAMES)
            key = (first, last)
            if key in seen:
                continue
            seen.add(key)
            self._recurring.append({"canonical": f"{first} {last}", "gender": g})
            # heavy tail: rank 1 appears far more often than rank n
            self._recurring_w.append(1.0 / ((len(self._recurring)) ** 0.65))

    def person_name(self, gender_id: int) -> str:
        if gender_id == 2:
            first = self.rng.choice(K.FIRST_NAMES_F)
        else:
            first = self.rng.choice(K.FIRST_NAMES_M)
        last = self.rng.choice(K.LAST_NAMES)
        style = self.rng.random()
        if style < 0.15:  # "Ravi Kumar R" initial style
            return f"{first} {self.rng.choice(K.INITIALS)}"
        if style < 0.25:
            return f"{first} {last} {self.rng.choice(K.INITIALS)}"
        return f"{first} {last}"

    # --- geo ---
    def sample_latlng(self, district_id: int):
        """Coordinates INSIDE the real district polygon, clustered around urban centres.
        Sampling a bounding box (the naive way) puts incidents in visible rectangles and
        even in the sea. Falls back to the bbox only if geometry is unavailable."""
        centres = K.BENGALURU_HOTSPOTS if district_id == 1 else None
        if self.geo is not None:
            pt = self.geo.sample(district_id, centres)
            if pt:
                return round(pt[0], 6), round(pt[1], 6)
        d = next(x for x in K.DISTRICTS if x["DistrictID"] == district_id)
        lat0, lat1, lng0, lng1 = d["box"]
        return round(self.rng.uniform(lat0, lat1), 6), round(self.rng.uniform(lng0, lng1), 6)

    # --- protected attributes, sampled independently of everything else ---
    def independent_protected(self):
        return {
            "ReligionID": self.rng.weighted_key({1: 84, 2: 11, 3: 2, 4: 1, 5: 1, 6: 0.5, 7: 0.5}),
            "CasteID": self.rng.choice([1, 2, 3, 4, 5]),
            "OccupationID": self.rng.choice(list(range(1, 11))),
        }

    # --- high-level case creation used by both base gen and patterns ---
    def make_case(self, *, district_id, unit_id, subhead_id, incident_dt, category_code=1,
                  status_id=None, brief=None, lat=None, lng=None, io_emp_id=None):
        head_id = self.head_of_subhead[subhead_id]
        sh = self.subhead_index[subhead_id]
        heinous = sh[3]

        # reporting delay (hours) — mostly small; occasionally large
        rd_roll = self.rng.random()
        if rd_roll < 0.78:
            delay_h = self.rng.randint(0, 72)
        elif rd_roll < 0.93:
            delay_h = self.rng.randint(72, 360)
        else:
            delay_h = self.rng.randint(360, 1440)
        info_dt = incident_dt + timedelta(hours=delay_h)
        reg_date = (info_dt + timedelta(hours=self.rng.randint(0, 24))).date()
        if reg_date > TODAY:
            reg_date = TODAY

        # CrimeNo's serial counter is a station register: it only ticks once a case is
        # actually entered, so its year must be the year of REGISTRATION, not the year the
        # underlying incident happened. Using incident_dt.year here previously gave 576 of
        # 40,829 cases (1.4%) a CrimeNo whose embedded year didn't match CrimeRegisteredDate
        # -- every one a late-December incident whose reporting delay carried registration
        # into January or February of the following year.
        crime_no, case_no = self.crime_no(category_code, district_id, unit_id, reg_date.year)
        cid = self._next("CaseMaster")

        if lat is None:
            lat, lng = self.sample_latlng(district_id)

        if io_emp_id is None:
            emps = self.employees_by_unit.get(unit_id) or [None]
            io_emp_id = self.rng.choice(emps)

        court = self.courts_by_district.get(district_id)
        gravity_id = 1 if heinous else 2
        if status_id is None:
            status_id = self._roll_status(head_id, heinous)

        if brief is None:
            brief = self._brief(subhead_id)

        self.add("CaseMaster", {
            "CaseMasterID": cid,
            "CrimeNo": crime_no,
            "CaseNo": case_no,
            "CrimeRegisteredDate": fmt_d(reg_date),
            "PolicePersonID": io_emp_id if io_emp_id else "",
            "PoliceStationID": unit_id,
            "CaseCategoryID": category_code,
            "GravityOffenceID": gravity_id,
            "CrimeMajorHeadID": head_id,
            "CrimeMinorHeadID": subhead_id,
            "CaseStatusID": status_id,
            "CourtID": court if court else "",
            "IncidentFromDate": fmt_dt(incident_dt),
            "IncidentToDate": fmt_dt(incident_dt + timedelta(hours=self.rng.randint(0, 6))),
            "InfoReceivedPSDate": fmt_dt(info_dt),
            "latitude": lat,
            "longitude": lng,
            "BriefFacts": brief,
        })
        self._add_act_sections(cid, subhead_id)
        return {"CaseMasterID": cid, "unit_id": unit_id, "district_id": district_id,
                "subhead_id": subhead_id, "head_id": head_id, "status_id": status_id,
                "reg_date": reg_date, "incident_dt": incident_dt, "io": io_emp_id,
                "lat": lat, "lng": lng, "heinous": heinous}

    def _roll_status(self, head_id, heinous):
        # Missing/UDR mostly closed/undetected; property often undetected; else mixed.
        roll = self.rng.random()
        if head_id == 7:  # Missing / UDR
            return self.rng.choices([1, 3, 4], weights=[0.25, 0.5, 0.25])[0]
        if roll < 0.42:
            return 2  # charge sheeted
        if roll < 0.70:
            return 1  # under investigation
        if roll < 0.88:
            return 4  # undetected
        return 3      # closed

    def _brief(self, subhead_id):
        templates = K.MO_TEMPLATES.get(subhead_id)
        tpl = self.rng.choice(templates) if templates else K.GENERIC_MO
        sh = self.subhead_index.get(subhead_id)
        return tpl.format(
            item=self.rng.choice(K.STOLEN_ITEMS),
            loc=self._locality_phrase(),
            time=self.rng.choice(K.TIME_PHRASES),
            method=self.rng.choice(K.METHODS),
            place=self.rng.choice(K.PLACES),
            barrier=self.rng.choice(K.BARRIERS),
            weapon=self.rng.choice(K.WEAPONS),
            vehicle=self.rng.choice(K.VEHICLES),
            count=self.rng.choice(K.COUNTS),
            authority=self.rng.choice(K.AUTHORITIES),
            app=self.rng.choice(K.APPS),
            pretext=self.rng.choice(K.PRETEXTS),
            amount=self.rng.choice(K.AMOUNTS),
            subhead=(sh[2] if sh else "offence").lower(),
        )

    def _locality_phrase(self):
        return self.rng.choice(K.STATION_LOCALITIES) + " area"

    def _add_act_sections(self, case_id, subhead_id):
        pairs = K.SUBHEAD_SECTIONS.get(subhead_id, [("IPC", "379")])
        n = 1 if len(pairs) == 1 else self.rng.randint(1, len(pairs))
        chosen = pairs[:n]
        for i, (act, sec) in enumerate(chosen, start=1):
            self.add("ActSectionAssociation", {
                "CaseMasterID": case_id, "ActID": act, "SectionID": sec,
                "ActOrderID": i, "SectionOrderID": i,
            })

    # --- parties ---
    def add_complainant(self, case_id, gender_id=None):
        gender_id = gender_id or self.rng.choices([1, 2, 3], weights=[0.62, 0.37, 0.01])[0]
        prot = self.independent_protected()
        cid = self._next("Complainant")
        self.add("ComplainantDetails", {
            "ComplainantID": cid, "CaseMasterID": case_id,
            "ComplainantName": self.person_name(gender_id),
            "AgeYear": self.rng.randint(18, 70),
            "OccupationID": prot["OccupationID"], "ReligionID": prot["ReligionID"],
            "CasteID": prot["CasteID"], "GenderID": gender_id,
        })
        return cid

    def add_victim(self, case_id, gender_id=None, age=None):
        gender_id = gender_id or self.rng.choices([1, 2, 3], weights=[0.55, 0.44, 0.01])[0]
        vid = self._next("Victim")
        self.add("Victim", {
            "VictimMasterID": vid, "CaseMasterID": case_id,
            "VictimName": self.person_name(gender_id),
            "AgeYear": age if age is not None else self.rng.randint(16, 80),
            "GenderID": gender_id,
            "VictimPolice": 1 if self.rng.random() < 0.01 else 0,
        })
        return vid

    def add_accused(self, case_id, name=None, gender_id=None, person_index=1):
        if name is None:
            person = self.recurring_person()
            if person is not None:
                gender_id = person["gender"]
                name = self.name_variant(person["canonical"])
        gender_id = gender_id or self.rng.choices([1, 2], weights=[0.9, 0.1])[0]
        aid = self._next("Accused")
        self.add("Accused", {
            "AccusedMasterID": aid, "CaseMasterID": case_id,
            "AccusedName": name if name else self.person_name(gender_id),
            "AgeYear": self.rng.randint(19, 55),
            "GenderID": gender_id, "PersonID": f"A{person_index}",
        })
        return aid

    def add_arrest(self, case_id, accused_id, district_id, unit_id, io_emp_id,
                   arrest_date, atype=1, state_id=K.KARNATAKA_STATE_ID, is_accused=1,
                   is_complainant_accused=0):
        asid = self._next("ArrestSurrender")
        self.add("ArrestSurrender", {
            "ArrestSurrenderID": asid, "CaseMasterID": case_id,
            "ArrestSurrenderTypeID": atype, "ArrestSurrenderDate": fmt_d(arrest_date),
            "ArrestSurrenderStateId": state_id, "ArrestSurrenderDistrictId": district_id,
            "PoliceStationID": unit_id, "IOID": io_emp_id if io_emp_id else "",
            "CourtID": self.courts_by_district.get(district_id, ""),
            "AccusedMasterID": accused_id, "IsAccused": is_accused,
            "IsComplainantAccused": is_complainant_accused,
        })
        self.add("inv_arrestsurrenderaccused", {
            "ArrestSurrenderID": asid, "AccusedMasterID": accused_id,
        })
        return asid

    def add_chargesheet(self, case_id, cs_date, cstype, officer_id):
        csid = self._next("CS")
        self.add("ChargesheetDetails", {
            "CSID": csid, "CaseMasterID": case_id, "csdate": fmt_dt(cs_date),
            "cstype": cstype, "PolicePersonID": officer_id if officer_id else "",
        })
        return csid


# ---------------------------------------------------------------------------
# Reference / master data
# ---------------------------------------------------------------------------
def build_reference(b: Builder, rng: Rng):
    for s in K.STATES:
        b.add("State", s)
    for d in K.DISTRICTS:
        b.add("District", {"DistrictID": d["DistrictID"], "DistrictName": d["DistrictName"],
                           "StateID": K.KARNATAKA_STATE_ID, "Active": True})
    for ut in K.UNIT_TYPES:
        b.add("UnitType", ut)
    for r in K.RANKS:
        b.add("Rank", r)
    for de in K.DESIGNATIONS:
        b.add("Designation", de)
    for c in K.CASE_CATEGORIES:
        b.add("CaseCategory", {"CaseCategoryID": c["CaseCategoryID"], "LookupValue": c["LookupValue"]})
    for g in K.GRAVITY:
        b.add("GravityOffence", g)
    for st in K.CASE_STATUSES:
        b.add("CaseStatusMaster", st)
    for g in K.GENDERS:
        b.add("GenderMaster", g)
    for at in K.ARREST_TYPES:
        b.add("ArrestSurrenderType", at)
    for ch in K.CRIME_HEADS:
        b.add("CrimeHead", {"CrimeHeadID": ch["CrimeHeadID"], "CrimeGroupName": ch["CrimeGroupName"], "Active": True})
    for (shid, hid, name, heinous, w) in K.CRIME_SUBHEADS:
        b.add("CrimeSubHead", {"CrimeSubHeadID": shid, "CrimeHeadID": hid, "CrimeHeadName": name, "SeqID": shid})
    for a in K.ACTS:
        b.add("Act", a)
    for (act, sec, desc) in K.SECTIONS:
        b.add("Section", {"ActCode": act, "SectionCode": sec, "SectionDescription": desc, "Active": True})
    # CrimeHeadActSection mapping
    seen = set()
    for shid, pairs in K.SUBHEAD_SECTIONS.items():
        hid = b.head_of_subhead[shid]
        for (act, sec) in pairs:
            key = (hid, act, sec)
            if key not in seen:
                seen.add(key)
                b.add("CrimeHeadActSection", {"CrimeHeadID": hid, "ActCode": act, "SectionCode": sec})
    for rel in K.RELIGIONS:
        b.add("ReligionMaster", rel)
    for c in K.CASTES:
        b.add("CasteMaster", c)
    for o in K.OCCUPATIONS:
        b.add("OccupationMaster", o)

    _build_units(b, rng)
    _build_courts(b, rng)
    _build_employees(b, rng)


def _build_units(b: Builder, rng: Rng, total=300):
    # distribute stations across districts roughly by weight, min 3 each
    weights = K.DISTRICT_WEIGHTS
    alloc = {}
    for did, w in weights.items():
        alloc[did] = max(3, round(w * total))
    # trim/pad to ~total
    unit_id = 0
    for d in K.DISTRICTS:
        did = d["DistrictID"]
        n = alloc[did]
        base = d["DistrictName"].split()[0]
        for i in range(n):
            unit_id += 1
            loc = rng.choice(K.STATION_LOCALITIES)
            name = f"{base} {loc} PS" if i else f"{base} City PS"
            row = {"UnitID": unit_id, "UnitName": name, "TypeID": 1, "ParentUnit": "",
                   "NationalityID": 1, "StateID": K.KARNATAKA_STATE_ID, "DistrictID": did, "Active": True}
            b.add("Unit", row)
            b.units.append(row)
            b.units_by_district[did].append(row)


def _build_courts(b: Builder, rng: Rng):
    cid = 0
    for d in K.DISTRICTS:
        cid += 1
        did = d["DistrictID"]
        b.add("Court", {"CourtID": cid, "CourtName": f"{d['DistrictName']} District & Sessions Court",
                        "DistrictID": did, "StateID": K.KARNATAKA_STATE_ID, "Active": True})
        b.courts_by_district[did] = cid


def _build_employees(b: Builder, rng: Rng, total=1500):
    eid = 0
    # ensure every unit has at least ~3 officers (IO pool)
    for row in b.units:
        for _ in range(rng.randint(3, 6)):
            eid += 1
            gender_id = rng.choices([1, 2], weights=[0.85, 0.15])[0]
            rank = rng.choices([5, 6, 7, 8, 9], weights=[0.1, 0.25, 0.2, 0.2, 0.25])[0]
            emp = {
                "EmployeeID": eid, "DistrictID": row["DistrictID"], "UnitID": row["UnitID"],
                "RankID": rank, "DesignationID": rng.choice([1, 2, 2, 2, 4]),
                "KGID": f"KG{100000 + eid}", "FirstName": b.person_name(gender_id),
                "EmployeeDOB": fmt_d(date(rng.randint(1968, 1998), rng.randint(1, 12), rng.randint(1, 28))),
                "GenderID": gender_id, "BloodGroupID": rng.randint(1, 8),
                "PhysicallyChallenged": 0,
                "AppointmentDate": fmt_d(date(rng.randint(1995, 2022), rng.randint(1, 12), rng.randint(1, 28))),
            }
            b.add("Employee", emp)
            b.employees_by_unit[row["UnitID"]].append(eid)


# ---------------------------------------------------------------------------
# Base random cases
# ---------------------------------------------------------------------------
def generate_base_cases(b: Builder, rng: Rng, n_cases: int):
    subheads = [sh[0] for sh in K.CRIME_SUBHEADS]
    sub_weights = [sh[4] for sh in K.CRIME_SUBHEADS]
    district_ids = list(K.DISTRICT_WEIGHTS.keys())
    district_w = list(K.DISTRICT_WEIGHTS.values())
    officers_pool = [e["EmployeeID"] for e in b.rows["Employee"]]

    for _ in range(n_cases):
        did = rng.choices(district_ids, weights=district_w)[0]
        units = b.units_by_district[did]
        unit = rng.choice(units)
        shid = rng.choices(subheads, weights=sub_weights)[0]
        head_id = b.head_of_subhead[shid]
        # category: mostly FIR; UDR for missing/udr; small Zero-FIR/PAR
        if head_id == 7:
            cat = rng.choices([1, 3], weights=[0.4, 0.6])[0]
        elif head_id == 8:
            cat = rng.choices([1, 4], weights=[0.3, 0.7])[0]
        else:
            cat = rng.choices([1, 8], weights=[0.97, 0.03])[0]

        incident_dt = _sample_incident_dt(rng, shid)
        case = b.make_case(district_id=did, unit_id=unit["UnitID"], subhead_id=shid,
                           incident_dt=incident_dt, category_code=cat)

        _attach_parties(b, rng, case)
        _attach_disposition(b, rng, case, officers_pool)


def _sample_incident_dt(rng: Rng, shid: int) -> datetime:
    d = rng.date_between(DATE_START, DATE_END)
    # festival-season bump (Oct-Nov) for property crime — nudge some dates there
    head = next(sh[1] for sh in K.CRIME_SUBHEADS if sh[0] == shid)
    if head == 2 and rng.random() < 0.15:
        d = date(rng.choice([2023, 2024, 2025]), rng.choice([10, 11]), rng.randint(1, 28))
    # time-of-day skew: property/snatching at night; cyber daytime
    if shid in (206, 203, 202, 101):
        hour = rng.choices(range(24), weights=[3]*6 + [1]*10 + [3]*8)[0]
    elif head == 4:
        hour = rng.randint(9, 20)
    else:
        hour = rng.randint(0, 23)
    return datetime(d.year, d.month, d.day, hour, rng.randint(0, 59), 0)


def _attach_parties(b: Builder, rng: Rng, case):
    head_id = case["head_id"]
    b.add_complainant(case["CaseMasterID"])
    # victims
    nv = rng.choices([1, 2, 3], weights=[0.8, 0.15, 0.05])[0]
    for _ in range(nv):
        if head_id == 3:  # crimes against women
            b.add_victim(case["CaseMasterID"], gender_id=2)
        elif head_id == 4:  # cyber — victims across age bands (vulnerability analytics)
            b.add_victim(case["CaseMasterID"], age=rng.choices(range(18, 75),
                         weights=[2 if 22 <= a <= 40 else 1 for a in range(18, 75)])[0])
        else:
            b.add_victim(case["CaseMasterID"])
    # accused: ~40% unknown (0), else 1-3
    if rng.random() < 0.40:
        n_acc = 0
    else:
        n_acc = rng.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0]
    case["accused"] = []
    for i in range(n_acc):
        aid = b.add_accused(case["CaseMasterID"], person_index=i + 1)
        case["accused"].append(aid)


def _attach_disposition(b: Builder, rng: Rng, case, officers_pool):
    status = case["status_id"]
    reg = case["reg_date"]
    io = case["io"] or (rng.choice(officers_pool) if officers_pool else "")
    # chargesheet / disposal
    if status == 2:  # charge sheeted
        cs_gap = rng.randint(20, 220)
        cs_date = datetime.combine(min(reg + timedelta(days=cs_gap), TODAY), datetime.min.time())
        b.add_chargesheet(case["CaseMasterID"], cs_date, "A", io)
        # arrests for chargesheeted with accused
        for aid in case.get("accused", []):
            if rng.random() < 0.8:
                adate = min(reg + timedelta(days=rng.randint(1, cs_gap)), TODAY)
                # IsComplainantAccused was hardcoded 0 for all 11,717 arrests -- a flag
                # generated with full referential integrity that could never be true. Real
                # investigations occasionally find the complainant is also an accused
                # (mutual-combat cases, a complaint filed to pre-empt one's own arrest).
                # Same 1% treatment already used for VictimPolice above.
                complainant_accused = 1 if rng.random() < 0.01 else 0
                b.add_arrest(case["CaseMasterID"], aid, case["district_id"], case["unit_id"], io, adate,
                             is_complainant_accused=complainant_accused)
    elif status == 4:  # undetected
        if rng.random() < 0.6:
            cs_date = datetime.combine(min(reg + timedelta(days=rng.randint(90, 300)), TODAY), datetime.min.time())
            b.add_chargesheet(case["CaseMasterID"], cs_date, "C", io)
    elif status == 3:  # closed — some false
        if rng.random() < 0.35:
            cs_date = datetime.combine(min(reg + timedelta(days=rng.randint(30, 200)), TODAY), datetime.min.time())
            b.add_chargesheet(case["CaseMasterID"], cs_date, "B", io)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
TABLE_ORDER = [
    # lookups / masters (import first)
    "State", "District", "UnitType", "Unit", "Rank", "Designation", "Employee",
    "CaseCategory", "GravityOffence", "CaseStatusMaster", "GenderMaster",
    "ArrestSurrenderType", "CrimeHead", "CrimeSubHead", "Act", "Section",
    "CrimeHeadActSection", "ReligionMaster", "CasteMaster", "OccupationMaster", "Court",
    # core
    "CaseMaster",
    # children
    "ComplainantDetails", "Victim", "Accused", "ActSectionAssociation",
    "ArrestSurrender", "inv_arrestsurrenderaccused", "ChargesheetDetails",
]


def write_outputs(b: Builder, out_dir: str, ground_truth: dict):
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"generated": datetime.now().isoformat(timespec="seconds"),
                "seed": SEED, "import_order": [], "counts": {}}
    for table in TABLE_ORDER:
        rows = b.rows.get(table, [])
        path = os.path.join(out_dir, f"{table}.csv")
        if rows:
            headers = list(rows[0].keys())
        else:
            headers = []
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers)
            w.writeheader()
            w.writerows(rows)
        manifest["counts"][table] = len(rows)
        manifest["import_order"].append(table)

    with open(os.path.join(out_dir, "_ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2)
    with open(os.path.join(out_dir, "_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="KADI synthetic FIR generator")
    ap.add_argument("--cases", type=int, default=40000, help="number of base FIRs")
    ap.add_argument("--out", type=str, default=os.path.join(os.path.dirname(__file__), "..", "output"))
    args = ap.parse_args()

    rng = Rng(SEED)
    b = Builder(rng)

    print(f"[KADI] building reference data ...")
    build_reference(b, rng)
    print(f"       units={len(b.rows['Unit'])} employees={len(b.rows['Employee'])} courts={len(b.rows['Court'])}")

    # Must precede case generation: add_accused draws from this pool.
    b.build_recurring_pool()
    print(f"       recurring offender pool={len(b._recurring)}")

    print(f"[KADI] generating {args.cases} base FIRs ...")
    generate_base_cases(b, rng, args.cases)
    print(f"       CaseMaster={len(b.rows['CaseMaster'])} Accused={len(b.rows['Accused'])} Victim={len(b.rows['Victim'])}")

    print(f"[KADI] injecting planted ground-truth patterns ...")
    import patterns
    ground_truth = patterns.inject_all(b, rng, TODAY)
    print(f"       gangs={len(ground_truth['gangs'])} serialChains={len(ground_truth['serialChains'])} "
          f"slipping={len(ground_truth['slippingCaseIds'])} risky={len(ground_truth['riskyOffenderIds'])}")

    out_dir = os.path.abspath(args.out)
    print(f"[KADI] writing CSVs -> {out_dir}")
    manifest = write_outputs(b, out_dir, ground_truth)
    total = sum(manifest["counts"].values())
    print(f"[KADI] done. {total} total rows across {len(manifest['counts'])} tables.")
    print(f"       CaseMaster={manifest['counts']['CaseMaster']}, "
          f"Accused={manifest['counts']['Accused']}, "
          f"ArrestSurrender={manifest['counts']['ArrestSurrender']}")


if __name__ == "__main__":
    main()
