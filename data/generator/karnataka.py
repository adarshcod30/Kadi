"""
karnataka.py — Reference / lookup data for the KADI synthetic FIR generator.

Everything here is realistic Karnataka police-domain reference data: real districts
with bounding boxes, a plausible crime taxonomy, IPC/BNS/IT-Act/NDPS sections, and a
Kannada/Indian name pool. All IDs are stable so CSVs are reproducible.

No protected attribute (caste/religion/occupation) is ever correlated with crime here.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# States (Karnataka + neighbours, for cross-border arrests)
# ---------------------------------------------------------------------------
STATES = [
    {"StateID": 1, "StateName": "Karnataka", "NationalityID": 1, "Active": True},
    {"StateID": 2, "StateName": "Maharashtra", "NationalityID": 1, "Active": True},
    {"StateID": 3, "StateName": "Tamil Nadu", "NationalityID": 1, "Active": True},
    {"StateID": 4, "StateName": "Andhra Pradesh", "NationalityID": 1, "Active": True},
    {"StateID": 5, "StateName": "Telangana", "NationalityID": 1, "Active": True},
    {"StateID": 6, "StateName": "Kerala", "NationalityID": 1, "Active": True},
    {"StateID": 7, "StateName": "Goa", "NationalityID": 1, "Active": True},
]
KARNATAKA_STATE_ID = 1

# ---------------------------------------------------------------------------
# Districts (real Karnataka districts) with approximate bounding boxes
# box = (lat_min, lat_max, lon_min, lon_max)
# ---------------------------------------------------------------------------
DISTRICTS = [
    {"DistrictID": 1,  "DistrictName": "Bengaluru City",       "box": (12.90, 13.10, 77.50, 77.70)},
    {"DistrictID": 2,  "DistrictName": "Bengaluru Rural",      "box": (12.80, 13.45, 77.30, 77.90)},
    {"DistrictID": 3,  "DistrictName": "Mysuru",               "box": (11.95, 12.55, 76.20, 76.90)},
    {"DistrictID": 4,  "DistrictName": "Dakshina Kannada",     "box": (12.70, 13.10, 74.80, 75.40)},
    {"DistrictID": 5,  "DistrictName": "Belagavi",             "box": (15.60, 16.40, 74.40, 75.20)},
    {"DistrictID": 6,  "DistrictName": "Kalaburagi",           "box": (17.00, 17.60, 76.60, 77.40)},
    {"DistrictID": 7,  "DistrictName": "Hubballi-Dharwad",     "box": (15.20, 15.60, 74.90, 75.30)},
    {"DistrictID": 8,  "DistrictName": "Ballari",              "box": (14.90, 15.30, 76.70, 77.10)},
    {"DistrictID": 9,  "DistrictName": "Vijayapura",           "box": (16.60, 17.10, 75.50, 76.10)},
    {"DistrictID": 10, "DistrictName": "Shivamogga",           "box": (13.70, 14.20, 75.40, 75.80)},
    {"DistrictID": 11, "DistrictName": "Tumakuru",             "box": (13.20, 13.60, 76.90, 77.30)},
    {"DistrictID": 12, "DistrictName": "Davanagere",           "box": (14.30, 14.70, 75.70, 76.10)},
    {"DistrictID": 13, "DistrictName": "Udupi",                "box": (13.20, 13.60, 74.60, 75.00)},
    {"DistrictID": 14, "DistrictName": "Hassan",               "box": (12.90, 13.30, 75.90, 76.30)},
    {"DistrictID": 15, "DistrictName": "Mandya",               "box": (12.40, 12.80, 76.70, 77.10)},
    {"DistrictID": 16, "DistrictName": "Chitradurga",          "box": (14.10, 14.40, 76.20, 76.60)},
    {"DistrictID": 17, "DistrictName": "Kolar",                "box": (12.90, 13.30, 78.00, 78.40)},
    {"DistrictID": 18, "DistrictName": "Raichur",              "box": (16.10, 16.50, 77.20, 77.60)},
    {"DistrictID": 19, "DistrictName": "Bidar",                "box": (17.80, 18.20, 77.30, 77.70)},
    {"DistrictID": 20, "DistrictName": "Koppal",               "box": (15.20, 15.60, 76.00, 76.40)},
    {"DistrictID": 21, "DistrictName": "Haveri",               "box": (14.60, 14.90, 75.20, 75.60)},
    {"DistrictID": 22, "DistrictName": "Gadag",                "box": (15.30, 15.60, 75.50, 75.90)},
    {"DistrictID": 23, "DistrictName": "Chikkamagaluru",       "box": (13.10, 13.60, 75.60, 76.10)},
    {"DistrictID": 24, "DistrictName": "Chamarajanagar",       "box": (11.60, 12.10, 76.70, 77.20)},
    {"DistrictID": 25, "DistrictName": "Kodagu",               "box": (12.20, 12.70, 75.60, 76.10)},
    {"DistrictID": 26, "DistrictName": "Bagalkote",            "box": (16.00, 16.40, 75.50, 76.00)},
    {"DistrictID": 27, "DistrictName": "Yadgir",               "box": (16.50, 16.90, 76.80, 77.30)},
    {"DistrictID": 28, "DistrictName": "Chikkaballapura",      "box": (13.30, 13.70, 77.60, 78.00)},
    {"DistrictID": 29, "DistrictName": "Ramanagara",           "box": (12.60, 13.00, 77.10, 77.50)},
    {"DistrictID": 30, "DistrictName": "Uttara Kannada",       "box": (14.30, 15.30, 74.10, 74.90)},
    {"DistrictID": 31, "DistrictName": "Dharwad",              "box": (15.30, 15.70, 74.90, 75.30)},
]

# Share of total FIRs per district (Bengaluru City ~40%). Remaining spread by rough size.
DISTRICT_WEIGHTS = {
    1: 0.40, 2: 0.05, 3: 0.06, 4: 0.045, 5: 0.045, 6: 0.03, 7: 0.035, 8: 0.025,
    9: 0.02, 10: 0.02, 11: 0.02, 12: 0.018, 13: 0.016, 14: 0.016, 15: 0.016,
    16: 0.013, 17: 0.014, 18: 0.013, 19: 0.011, 20: 0.010, 21: 0.010, 22: 0.009,
    23: 0.010, 24: 0.008, 25: 0.008, 26: 0.009, 27: 0.008, 28: 0.010, 29: 0.011,
    30: 0.010, 31: 0.010,
}

# Bengaluru ward-ish hotspot centroids (for visible spatial clustering)
BENGALURU_HOTSPOTS = [
    (12.9716, 77.5946), (12.9352, 77.6245), (13.0358, 77.5970),  # Majestic, Koramangala, Yeshwanthpur
    (12.9081, 77.6476), (12.9784, 77.6408), (13.0072, 77.5385),  # HSR, Indiranagar, Rajajinagar
    (12.9165, 77.6101), (12.9539, 77.5820), (13.0298, 77.6410),  # BTM, Jayanagar, Hebbal
]

# ---------------------------------------------------------------------------
# Unit (police station) types & hierarchy
# ---------------------------------------------------------------------------
UNIT_TYPES = [
    {"UnitTypeID": 1, "UnitTypeName": "Police Station", "CityDistState": "City", "Hierarchy": 5, "Active": True},
    {"UnitTypeID": 2, "UnitTypeName": "Circle",          "CityDistState": "City", "Hierarchy": 4, "Active": True},
    {"UnitTypeID": 3, "UnitTypeName": "Sub-Division",    "CityDistState": "Dist", "Hierarchy": 3, "Active": True},
    {"UnitTypeID": 4, "UnitTypeName": "District",        "CityDistState": "Dist", "Hierarchy": 2, "Active": True},
    {"UnitTypeID": 5, "UnitTypeName": "Commissionerate", "CityDistState": "City", "Hierarchy": 1, "Active": True},
]

# Station-name themes to build realistic PS names per district
STATION_LOCALITIES = [
    "City", "Town", "Market", "Rural", "North", "South", "East", "West", "Nagar",
    "Extension", "Layout", "Gate", "Cross", "Circle", "Colony", "Peth", "Halli",
    "Cross Road", "Camp", "New Town", "Old Town", "Industrial Area", "Bazaar",
]

# ---------------------------------------------------------------------------
# Ranks & Designations
# ---------------------------------------------------------------------------
RANKS = [
    {"RankID": 1, "RankName": "Director General of Police", "Hierarchy": 1, "Active": True},
    {"RankID": 2, "RankName": "Inspector General of Police", "Hierarchy": 2, "Active": True},
    {"RankID": 3, "RankName": "Superintendent of Police", "Hierarchy": 3, "Active": True},
    {"RankID": 4, "RankName": "Deputy Superintendent of Police", "Hierarchy": 4, "Active": True},
    {"RankID": 5, "RankName": "Police Inspector", "Hierarchy": 5, "Active": True},
    {"RankID": 6, "RankName": "Police Sub-Inspector", "Hierarchy": 6, "Active": True},
    {"RankID": 7, "RankName": "Assistant Sub-Inspector", "Hierarchy": 7, "Active": True},
    {"RankID": 8, "RankName": "Head Constable", "Hierarchy": 8, "Active": True},
    {"RankID": 9, "RankName": "Police Constable", "Hierarchy": 9, "Active": True},
]
DESIGNATIONS = [
    {"DesignationID": 1, "DesignationName": "SHO", "Active": True, "SortOrder": 1},
    {"DesignationID": 2, "DesignationName": "Investigating Officer", "Active": True, "SortOrder": 2},
    {"DesignationID": 3, "DesignationName": "Station Writer", "Active": True, "SortOrder": 3},
    {"DesignationID": 4, "DesignationName": "Beat Officer", "Active": True, "SortOrder": 4},
    {"DesignationID": 5, "DesignationName": "Circle Inspector", "Active": True, "SortOrder": 5},
]

# ---------------------------------------------------------------------------
# Case categories, gravity, statuses
# ---------------------------------------------------------------------------
CASE_CATEGORIES = [
    {"CaseCategoryID": 1, "LookupValue": "FIR", "code": 1},
    {"CaseCategoryID": 3, "LookupValue": "UDR", "code": 3},
    {"CaseCategoryID": 4, "LookupValue": "PAR", "code": 4},
    {"CaseCategoryID": 8, "LookupValue": "Zero FIR", "code": 8},
]
GRAVITY = [
    {"GravityOffenceID": 1, "LookupValue": "Heinous"},
    {"GravityOffenceID": 2, "LookupValue": "Non-Heinous"},
]
CASE_STATUSES = [
    {"CaseStatusID": 1, "CaseStatusName": "Under Investigation"},
    {"CaseStatusID": 2, "CaseStatusName": "Charge Sheeted"},
    {"CaseStatusID": 3, "CaseStatusName": "Closed"},
    {"CaseStatusID": 4, "CaseStatusName": "Undetected"},
]
GENDERS = [
    {"GenderID": 1, "GenderName": "Male"},
    {"GenderID": 2, "GenderName": "Female"},
    {"GenderID": 3, "GenderName": "Transgender"},
]
ARREST_TYPES = [
    {"ArrestSurrenderTypeID": 1, "LookupValue": "Arrest"},
    {"ArrestSurrenderTypeID": 2, "LookupValue": "Surrender"},
]

# ---------------------------------------------------------------------------
# Police station specialisation. Not in the source ER diagram (that models FIR data, not
# the station roster) -- added because a real KSP station is not a generic dot on a map. It
# is one of a handful of distinct kinds of station, each with a different mandate. Karnataka
# runs Law & Order (Town/City and Rural), Traffic, Women's, CEN (Cyber, Economic & Narcotics
# -- rolled out in every district), and a Cyber Crime carve-out unique to Bengaluru (8
# dedicated stations, per the state government's 2024 announcement), plus Railway Police at
# major junction towns. Sourced from bangaloreurbanpolice.karnataka.gov.in, the Karnataka
# Police Wikipedia entry, and Deccan Herald's reporting on the Bengaluru cyber rollout --
# not from the ER diagram, which does not cover this.
STATION_CATEGORIES = [
    {"StationCategoryID": 1, "StationCategoryName": "Law and Order (Town/City)"},
    {"StationCategoryID": 2, "StationCategoryName": "Law and Order (Rural)"},
    {"StationCategoryID": 3, "StationCategoryName": "Traffic Police Station"},
    {"StationCategoryID": 4, "StationCategoryName": "Women Police Station"},
    {"StationCategoryID": 5, "StationCategoryName": "CEN (Cyber, Economic & Narcotics) Police Station"},
    {"StationCategoryID": 6, "StationCategoryName": "Cyber Crime Police Station"},
    {"StationCategoryID": 7, "StationCategoryName": "Railway Police Station"},
]

# Districts with a major railway junction, per KSP's Railway DPO coverage -- Railway Police
# is not a per-district service like CEN, only present where there is real rail traffic to
# police.
RAILWAY_JUNCTION_DISTRICTS = {1, 3, 7, 5, 6, 12, 8}  # Bengaluru City, Mysuru, Hubballi-Dharwad,
# Belagavi, Kalaburagi, Davanagere, Ballari -- Karnataka's principal rail junctions

# ---------------------------------------------------------------------------
# Crime taxonomy: CrimeHead (major) -> CrimeSubHead (minor)
# gravity: whether sub-head is typically heinous. weight: relative volume.
# ---------------------------------------------------------------------------
CRIME_HEADS = [
    {"CrimeHeadID": 1, "CrimeGroupName": "Crimes Against Body"},
    {"CrimeHeadID": 2, "CrimeGroupName": "Crimes Against Property"},
    {"CrimeHeadID": 3, "CrimeGroupName": "Crimes Against Women"},
    {"CrimeHeadID": 4, "CrimeGroupName": "Cyber Crime"},
    {"CrimeHeadID": 5, "CrimeGroupName": "Economic Offences"},
    {"CrimeHeadID": 6, "CrimeGroupName": "NDPS"},
    {"CrimeHeadID": 7, "CrimeGroupName": "Missing / UDR"},
    {"CrimeHeadID": 8, "CrimeGroupName": "Traffic / PAR"},
]

# (CrimeSubHeadID, CrimeHeadID, name, heinous, volume_weight)
CRIME_SUBHEADS = [
    (101, 1, "Murder", True, 0.010),
    (102, 1, "Attempt to Murder", True, 0.015),
    (103, 1, "Hurt / Grievous Hurt", False, 0.060),
    (104, 1, "Assault", False, 0.040),
    (201, 2, "Theft", False, 0.150),
    (202, 2, "House Breaking / Burglary", False, 0.090),
    (203, 2, "Robbery", True, 0.035),
    (204, 2, "Dacoity", True, 0.008),
    (205, 2, "Motor Vehicle Theft", False, 0.070),
    (206, 2, "Chain Snatching", False, 0.045),
    (301, 3, "Dowry Harassment", False, 0.030),
    (302, 3, "Assault on Woman", True, 0.025),
    (303, 3, "Sexual Harassment", True, 0.020),
    (401, 4, "Online Financial Fraud (UPI/OTP)", False, 0.090),
    (402, 4, "Sextortion", True, 0.020),
    (403, 4, "Identity Theft / Phishing", False, 0.030),
    (404, 4, "Job / Investment Fraud", False, 0.030),
    (501, 5, "Cheating", False, 0.040),
    (502, 5, "Forgery", False, 0.020),
    (503, 5, "Criminal Breach of Trust", False, 0.015),
    (601, 6, "NDPS - Possession", False, 0.020),
    (602, 6, "NDPS - Trafficking", True, 0.010),
    (701, 7, "Man Missing", False, 0.018),
    (702, 7, "Woman Missing", False, 0.015),
    (703, 7, "Unnatural Death (UDR)", False, 0.020),
    (801, 8, "Rash Driving / Accident", False, 0.030),
    (802, 8, "Drunk Driving", False, 0.020),
]

# ---------------------------------------------------------------------------
# Acts & Sections (IPC / BNS / IT Act / NDPS / MV Act / local)
# ---------------------------------------------------------------------------
ACTS = [
    {"ActCode": "IPC",  "ActDescription": "Indian Penal Code, 1860", "ShortName": "IPC", "Active": True},
    {"ActCode": "BNS",  "ActDescription": "Bharatiya Nyaya Sanhita, 2023", "ShortName": "BNS", "Active": True},
    {"ActCode": "ITA",  "ActDescription": "Information Technology Act, 2000", "ShortName": "IT Act", "Active": True},
    {"ActCode": "NDPS", "ActDescription": "Narcotic Drugs and Psychotropic Substances Act, 1985", "ShortName": "NDPS", "Active": True},
    {"ActCode": "MVA",  "ActDescription": "Motor Vehicles Act, 1988", "ShortName": "MV Act", "Active": True},
    {"ActCode": "KPA",  "ActDescription": "Karnataka Police Act, 1963", "ShortName": "KP Act", "Active": True},
]

# (ActCode, SectionCode, SectionDescription)
SECTIONS = [
    ("IPC", "302", "Punishment for murder"),
    ("IPC", "307", "Attempt to murder"),
    ("IPC", "323", "Voluntarily causing hurt"),
    ("IPC", "325", "Voluntarily causing grievous hurt"),
    ("IPC", "354", "Assault on woman with intent to outrage modesty"),
    ("IPC", "379", "Punishment for theft"),
    ("IPC", "380", "Theft in dwelling house"),
    ("IPC", "392", "Punishment for robbery"),
    ("IPC", "395", "Punishment for dacoity"),
    ("IPC", "457", "House-breaking by night"),
    ("IPC", "420", "Cheating and dishonestly inducing delivery of property"),
    ("IPC", "465", "Punishment for forgery"),
    ("IPC", "406", "Criminal breach of trust"),
    ("IPC", "498A", "Husband or relative subjecting woman to cruelty"),
    ("IPC", "363", "Punishment for kidnapping"),
    ("BNS", "103", "Punishment for murder"),
    ("BNS", "109", "Attempt to murder"),
    ("BNS", "115", "Voluntarily causing hurt"),
    ("BNS", "303", "Theft"),
    ("BNS", "309", "Robbery"),
    ("BNS", "310", "Dacoity"),
    ("BNS", "318", "Cheating"),
    ("ITA", "66C", "Identity theft"),
    ("ITA", "66D", "Cheating by personation using computer resource"),
    ("ITA", "67", "Publishing obscene material in electronic form"),
    ("NDPS", "20", "Punishment for contravention in relation to cannabis"),
    ("NDPS", "22", "Punishment for contravention in relation to psychotropic substances"),
    ("MVA", "279", "Rash driving on a public way"),
    ("MVA", "185", "Driving by a drunken person"),
    ("KPA", "110", "Penalty for causing public nuisance"),
]

# CrimeSubHead -> preferred (ActCode, SectionCode) list for act-section association
SUBHEAD_SECTIONS = {
    101: [("IPC", "302"), ("BNS", "103")],
    102: [("IPC", "307"), ("BNS", "109")],
    103: [("IPC", "323"), ("IPC", "325"), ("BNS", "115")],
    104: [("IPC", "323"), ("BNS", "115")],
    201: [("IPC", "379"), ("BNS", "303")],
    202: [("IPC", "457"), ("IPC", "380")],
    203: [("IPC", "392"), ("BNS", "309")],
    204: [("IPC", "395"), ("BNS", "310")],
    205: [("IPC", "379"), ("BNS", "303")],
    206: [("IPC", "379"), ("IPC", "392")],
    301: [("IPC", "498A")],
    302: [("IPC", "354")],
    303: [("IPC", "354"), ("ITA", "67")],
    401: [("IPC", "420"), ("ITA", "66D"), ("BNS", "318")],
    402: [("ITA", "67"), ("ITA", "66D")],
    403: [("ITA", "66C"), ("ITA", "66D")],
    404: [("IPC", "420"), ("ITA", "66D")],
    501: [("IPC", "420"), ("BNS", "318")],
    502: [("IPC", "465")],
    503: [("IPC", "406")],
    601: [("NDPS", "20")],
    602: [("NDPS", "22")],
    701: [("IPC", "363")],
    702: [("IPC", "363")],
    703: [("KPA", "110")],
    801: [("MVA", "279")],
    802: [("MVA", "185")],
}

# ---------------------------------------------------------------------------
# Protected & demographic lookups (schema fidelity ONLY — never predictive)
# ---------------------------------------------------------------------------
RELIGIONS = [
    {"ReligionID": 1, "ReligionName": "Hindu"},
    {"ReligionID": 2, "ReligionName": "Muslim"},
    {"ReligionID": 3, "ReligionName": "Christian"},
    {"ReligionID": 4, "ReligionName": "Jain"},
    {"ReligionID": 5, "ReligionName": "Sikh"},
    {"ReligionID": 6, "ReligionName": "Buddhist"},
    {"ReligionID": 7, "ReligionName": "Other"},
]
CASTES = [
    {"caste_master_id": 1, "caste_master_name": "General"},
    {"caste_master_id": 2, "caste_master_name": "OBC"},
    {"caste_master_id": 3, "caste_master_name": "SC"},
    {"caste_master_id": 4, "caste_master_name": "ST"},
    {"caste_master_id": 5, "caste_master_name": "Not Recorded"},
]
OCCUPATIONS = [
    {"OccupationID": 1, "OccupationName": "Agriculture / Farmer"},
    {"OccupationID": 2, "OccupationName": "Daily Wage Labour"},
    {"OccupationID": 3, "OccupationName": "Business / Self-employed"},
    {"OccupationID": 4, "OccupationName": "Private Employee"},
    {"OccupationID": 5, "OccupationName": "Government Employee"},
    {"OccupationID": 6, "OccupationName": "Student"},
    {"OccupationID": 7, "OccupationName": "Homemaker"},
    {"OccupationID": 8, "OccupationName": "Unemployed"},
    {"OccupationID": 9, "OccupationName": "IT / Software"},
    {"OccupationID": 10, "OccupationName": "Retired"},
]

# ---------------------------------------------------------------------------
# Name pool — Kannada / South-Indian first & last names (for authentic UI)
# ---------------------------------------------------------------------------
FIRST_NAMES_M = [
    "Ravi", "Suresh", "Manjunath", "Prakash", "Kiran", "Naveen", "Ramesh", "Girish",
    "Santosh", "Mahesh", "Anil", "Basavaraj", "Shivakumar", "Vinay", "Praveen",
    "Chandru", "Nagaraj", "Gopal", "Harish", "Umesh", "Vijay", "Lokesh", "Yogesh",
    "Sandeep", "Ganesh", "Raghavendra", "Arun", "Deepak", "Srinivas", "Madhu",
    "Ashok", "Karthik", "Vishnu", "Rohit", "Sunil", "Darshan", "Abdul", "Imran",
    "Syed", "Thomas", "David", "Prasad", "Venkatesh", "Shankar", "Mohan", "Rajesh",
]
FIRST_NAMES_F = [
    "Lakshmi", "Geetha", "Sunitha", "Kavya", "Deepa", "Ramya", "Anitha", "Divya",
    "Roopa", "Sowmya", "Bhavya", "Nandini", "Pooja", "Shwetha", "Vidya", "Meena",
    "Rekha", "Sushma", "Chaitra", "Ashwini", "Manasa", "Netra", "Sahana", "Padma",
    "Fathima", "Ayesha", "Mary", "Grace", "Sujatha", "Yamuna", "Bharathi", "Uma",
]
LAST_NAMES = [
    "Gowda", "Hegde", "Shetty", "Rao", "Reddy", "Naik", "Patil", "Kulkarni",
    "Desai", "Murthy", "Bhat", "Acharya", "Kamath", "Pai", "Nayak", "Iyer",
    "Kumar", "Prasad", "Swamy", "Setty", "Angadi", "Kori", "Poojary", "Ballal",
    "Hiremath", "Jadhav", "Biradar", "Banakar", "Hanumanthappa", "Devaraj",
]
# Single-token / initial style surnames common in Karnataka (e.g., "Ravi Kumar M")
INITIALS = list("RSKMGHNPVBLTDA")

# ---------------------------------------------------------------------------
# MO (modus operandi) templates per sub-head — used for BriefFacts & MO similarity.
# Many varied templates + rich fill vocabulary so UNRELATED cases have low mutual
# text similarity (TF-IDF cosine), while the planted rings reuse a single distinctive
# template (see patterns.py) and therefore surface as high-similarity MO clusters.
# ---------------------------------------------------------------------------
MO_TEMPLATES = {
    201: [
        "Unknown persons committed theft of {item} from {loc} during {time} by {method}.",
        "Complainant reports {item} stolen from {place} at {loc} in the {time}.",
        "Theft of {item} noticed at {loc}; suspect {method} while the {place} was unattended.",
        "The complainant left {item} at {place} near {loc}; on return during {time} it was missing.",
        "Pickpocketing of {item} reported in a crowded {place} at {loc} during {time}.",
        "{item} kept in the {place} at {loc} was stolen; entry gained by {method}.",
    ],
    202: [
        "Accused broke open the {barrier} of the house at {loc} at {time} and decamped with {item}.",
        "House-breaking at {loc}; {barrier} tampered, {item} missing, occurred {time}.",
        "Culprits entered a locked residence at {loc} by {method} and took {item} from the {place}.",
        "Burglary reported at {loc}: {barrier} damaged, {item} and valuables removed during {time}.",
    ],
    203: [
        "{count} persons threatened the complainant with {weapon} at {loc} and robbed {item}.",
        "Accused waylaid the complainant near {loc} in the {time} and robbed {item} at {weapon}-point.",
        "Highway robbery near {loc}: {count} men stopped the vehicle and took {item} using {weapon}.",
    ],
    206: [
        "A pillion rider snatched {item} from the complainant near {loc} and escaped on a {vehicle}.",
        "Chain-snatching at {loc} during {time}; {count} youths on a {vehicle} fled with {item}.",
        "Snatching of {item} from a pedestrian near {loc}; accused escaped through {method}.",
    ],
    205: [
        "The complainant's {vehicle} parked at {loc} was found missing on returning {time}.",
        "Motor-vehicle theft near {loc}: {vehicle} stolen during {time} by {method}.",
        "{vehicle} parked outside a {place} at {loc} was stolen in the {time}.",
    ],
    401: [
        "Complainant received a call from a fake {authority} and shared an OTP; {amount} debited via UPI.",
        "Accused sent a phishing link posing as {authority}; complainant lost {amount} in {time}.",
        "Online fraud: victim induced to install a {app} app on pretext of {pretext}, losing {amount}.",
        "Fraudster promised {pretext} and collected {amount} through multiple UPI transfers {time}.",
    ],
    402: [
        "Accused befriended the complainant on {app}, obtained private media and extorted {amount}.",
        "Sextortion: video call recorded and used to demand {amount} over {app} {time}.",
    ],
    403: [
        "Accused created a fake profile impersonating the complainant on {app} to defraud contacts.",
        "Identity theft: complainant's documents misused to obtain a {pretext} {time}.",
    ],
    404: [
        "Victim responded to a {pretext} advertisement and paid {amount} as processing fee via UPI.",
        "Investment fraud: accused promised high returns and collected {amount} {time}.",
    ],
    101: [
        "Complainant found the deceased with injuries at {loc}; suspected homicide reported {time}.",
        "A body bearing {weapon} injuries was recovered at {loc} in the {time}.",
    ],
    102: [
        "Accused assaulted the complainant with {weapon} at {loc} with intent to kill {time}.",
    ],
    103: [
        "A quarrel over {pretext} at {loc} led the accused to assault the complainant {time}.",
        "The complainant sustained injuries when {count} persons attacked with {weapon} at {loc}.",
    ],
    104: [
        "Verbal altercation at {loc} escalated; accused pushed and injured the complainant {time}.",
    ],
    301: [
        "Complainant alleges harassment for dowry by in-laws at {loc} over the past months.",
    ],
    501: [
        "Accused cheated the complainant of {amount} on a false promise of {pretext}.",
    ],
}
GENERIC_MO = "Offence of {subhead} reported at {loc} during {time}; investigation taken up under law."

STOLEN_ITEMS = [
    "gold ornaments", "a mobile phone", "cash and jewellery", "a laptop", "a gold chain",
    "silver articles", "two gold bangles", "cash of Rs. 40,000", "electronic items",
    "documents and cash", "a wristwatch and cash", "a mangalsutra", "gold earrings",
    "a handbag with valuables", "power tools", "copper wire", "a bicycle",
]
TIME_PHRASES = ["late night", "early morning hours", "afternoon", "evening", "small hours",
                "post-midnight", "day-time absence", "office hours"]
METHODS = ["cutting the grill", "using a duplicate key", "distracting the victim",
           "climbing the compound wall", "breaking the window latch", "picking the lock",
           "posing as a delivery agent", "tailgating into the parking"]
PLACES = ["a jewellery shop", "a residential flat", "a parked scooter", "a shop counter",
          "a temple premises", "a bus stand", "a hostel room", "an ATM kiosk",
          "a market stall", "a school compound", "a rented house", "a godown"]
BARRIERS = ["door lock", "rear window grill", "back door", "shutter lock", "almirah"]
WEAPONS = ["a knife", "a machete", "an iron rod", "a wooden club", "a country pistol"]
VEHICLES = ["black motorcycle", "scooter", "sedan car", "auto-rickshaw", "bike without number plate"]
COUNTS = ["two", "three", "four", "a group of"]
AUTHORITIES = ["bank official", "KYC department", "electricity board", "police officer",
               "courier company", "mobile operator"]
APPS = ["a messaging", "a screen-sharing", "a social media", "a trading", "a dating"]
PRETEXTS = ["a work-from-home job", "a lottery prize", "electricity bill update",
            "a loan approval", "a customs clearance", "a matrimonial alliance",
            "a part-time task", "a KYC re-verification"]
AMOUNTS = ["Rs. 15,000", "Rs. 50,000", "Rs. 1,20,000", "Rs. 8,500", "Rs. 2,40,000",
           "Rs. 75,000", "Rs. 3,10,000"]
