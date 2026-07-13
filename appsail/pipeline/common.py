"""
common.py — shared utilities for the KADI analytics pipeline.

Loads the source FIR tables, enforces the fairness invariant (no protected attribute
ever enters a feature set), normalizes names for entity resolution, and writes derived
artifacts that the API reads (mirrors the Catalyst NoSQL/Cache read model).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime

import pandas as pd

# ---------------------------------------------------------------------------
# Fairness invariant — enforced in code + tests (docs/03 Part B)
# ---------------------------------------------------------------------------
PROTECTED_COLUMNS = {"ReligionID", "CasteID", "OccupationID", "caste_master_id", "caste_master_name",
                     "ReligionName", "OccupationName"}


def assert_no_protected(feature_columns) -> None:
    """Raise if any protected attribute appears in a model's feature set."""
    used = PROTECTED_COLUMNS.intersection(set(feature_columns))
    if used:
        raise ValueError(f"FAIRNESS VIOLATION: protected attributes in feature set: {sorted(used)}")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
SOURCE_TABLES = [
    "CaseMaster", "Accused", "Victim", "ComplainantDetails", "ArrestSurrender",
    "ActSectionAssociation", "ChargesheetDetails", "Unit", "District", "Employee",
    "CrimeHead", "CrimeSubHead", "CaseStatusMaster", "CaseCategory", "GravityOffence",
    "Court", "Section", "Act",
]


def load_tables(data_dir: str) -> dict:
    tables = {}
    for name in SOURCE_TABLES:
        path = os.path.join(data_dir, f"{name}.csv")
        if os.path.exists(path):
            tables[name] = pd.read_csv(path, dtype=str, keep_default_na=False)
    return tables


def to_int(series, default=0):
    return pd.to_numeric(series, errors="coerce").fillna(default).astype("int64")


def to_float(series, default=0.0):
    return pd.to_numeric(series, errors="coerce").fillna(default)


def parse_dt(s: str):
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Name normalization for entity resolution (NO protected attributes involved)
# ---------------------------------------------------------------------------
_NON_ALPHA = re.compile(r"[^a-z ]+")
_INITIAL = re.compile(r"\b[a-z]\b")


def normalize_name(name: str):
    """Return (compact, tokens, block_key). Handles merged tokens & initials."""
    if not name:
        return "", [], "zzz"
    n = name.strip().lower()
    n = _NON_ALPHA.sub(" ", n)
    n = re.sub(r"\s+", " ", n).strip()
    tokens = [t for t in n.split(" ") if len(t) > 1]  # drop single-letter initials
    compact = "".join(tokens)                          # spaces removed, initials dropped
    block_key = (tokens[0][:3] if tokens else "zzz")   # first 3 letters of first real token
    return compact, tokens, block_key


def soundex(token: str) -> str:
    token = re.sub(r"[^a-z]", "", token.lower())
    if not token:
        return "0000"
    codes = {**dict.fromkeys("bfpv", "1"), **dict.fromkeys("cgjkqsxz", "2"),
             **dict.fromkeys("dt", "3"), "l": "4", **dict.fromkeys("mn", "5"), "r": "6"}
    first = token[0].upper()
    tail = []
    prev = codes.get(token[0], "")
    for ch in token[1:]:
        c = codes.get(ch, "")
        if c and c != prev:
            tail.append(c)
        if ch not in "hw":
            prev = c
    return (first + "".join(tail) + "000")[:4]


# ---------------------------------------------------------------------------
# Derived output
# ---------------------------------------------------------------------------
def derived_dir(data_dir: str) -> str:
    d = os.path.join(data_dir, "derived")
    os.makedirs(d, exist_ok=True)
    return d


def write_json(data_dir: str, name: str, obj) -> str:
    d = derived_dir(data_dir)
    path = os.path.join(d, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return path


def read_json(data_dir: str, name: str):
    path = os.path.join(derived_dir(data_dir), f"{name}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)
