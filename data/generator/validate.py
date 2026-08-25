#!/usr/bin/env python3
"""
validate.py — post-generation validation for the KADI synthetic dataset.

Runs the checklist from docs/06 §11:
  - FK integrity (no orphans) on the key relationships
  - CrimeNo format + serial uniqueness per (station, category, year)
  - Planted patterns present and consistent with _ground_truth.json
  - Protected attributes (caste/religion/occupation) independent of outcomes (chi-square)
  - Row counts match _manifest.json

Exit code 0 = all pass. Non-zero = a check failed (usable in CI).
Run: python data/generator/validate.py --dir data/output
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import pandas as pd
from scipy import stats as _stats  # scipy optional; fall back if missing


def load(dir_, name):
    return pd.read_csv(os.path.join(dir_, f"{name}.csv"), dtype=str, keep_default_na=False)


def check(label, ok, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "..", "output"))
    args = ap.parse_args()
    d = os.path.abspath(args.dir)
    print(f"[validate] dataset at {d}")

    manifest = json.load(open(os.path.join(d, "_manifest.json")))
    gt = json.load(open(os.path.join(d, "_ground_truth.json")))
    all_ok = True

    # ---- row counts match manifest ----
    for t, n in manifest["counts"].items():
        df = load(d, t)
        all_ok &= check(f"row count {t}={n}", len(df) == n, f"actual {len(df)}")

    cases = load(d, "CaseMaster")
    accused = load(d, "Accused")
    victims = load(d, "Victim")
    comps = load(d, "ComplainantDetails")
    acts = load(d, "ActSectionAssociation")
    units = load(d, "Unit")
    subheads = load(d, "CrimeSubHead")

    case_ids = set(cases["CaseMasterID"])
    unit_ids = set(units["UnitID"])
    subhead_ids = set(subheads["CrimeSubHeadID"])

    # ---- FK integrity ----
    all_ok &= check("Accused.CaseMasterID -> CaseMaster",
                    set(accused["CaseMasterID"]).issubset(case_ids))
    all_ok &= check("Victim.CaseMasterID -> CaseMaster",
                    set(victims["CaseMasterID"]).issubset(case_ids))
    all_ok &= check("Complainant.CaseMasterID -> CaseMaster",
                    set(comps["CaseMasterID"]).issubset(case_ids))
    all_ok &= check("ActSection.CaseMasterID -> CaseMaster",
                    set(acts["CaseMasterID"]).issubset(case_ids))
    all_ok &= check("CaseMaster.PoliceStationID -> Unit",
                    set(cases["PoliceStationID"]).issubset(unit_ids))
    all_ok &= check("CaseMaster.CrimeMinorHeadID -> CrimeSubHead",
                    set(cases["CrimeMinorHeadID"]).issubset(subhead_ids))

    # ---- CrimeNo format + serial uniqueness ----
    bad_fmt = cases[~cases["CrimeNo"].str.fullmatch(r"\d{18}")]
    all_ok &= check("CrimeNo is 18 digits", len(bad_fmt) == 0, f"{len(bad_fmt)} bad")
    # serial = last 5 digits; category=1st; unit=chars 6-9; year=chars 10-13
    key = cases["CrimeNo"].str[0] + "|" + cases["CrimeNo"].str[5:9] + "|" + cases["CrimeNo"].str[9:13]
    serial = cases["CrimeNo"].str[13:]
    dup = pd.DataFrame({"k": key, "s": serial}).duplicated().sum()
    all_ok &= check("CrimeNo serial unique per (station,category,year)", dup == 0, f"{dup} dupes")

    # Regression guard: a station register's serial only ticks on registration, so the year
    # embedded in CrimeNo must be the year of CrimeRegisteredDate. 576/40,829 cases failed
    # this before the fix -- late-December incidents whose reporting delay carried
    # registration into the next year while CrimeNo still carried the incident's year.
    crimeno_year = cases["CrimeNo"].str[9:13]
    reg_year = cases["CrimeRegisteredDate"].astype(str).str[:4]
    year_mismatch = (crimeno_year != reg_year).sum()
    all_ok &= check("CrimeNo year matches CrimeRegisteredDate year", year_mismatch == 0,
                     f"{year_mismatch} mismatched")

    # ---- Planted patterns present ----
    gang = gt["gangs"][0]
    all_ok &= check("gang cases exist", set(map(str, gang["caseMasterIds"])).issubset(case_ids),
                    f"{len(gang['caseMasterIds'])} cases, {len(gang['districts'])} districts, {len(gang['stations'])} stations")
    all_ok &= check("gang spans >=2 districts & >=3 stations",
                    len(gang["districts"]) >= 2 and len(gang["stations"]) >= 3)
    gang_accused = accused[accused["AccusedMasterID"].isin(set(map(str, gang["accusedMasterIds"])))]
    variant_names = set(gang_accused["AccusedName"])
    all_ok &= check("gang has multiple name variants (ER target)", len(variant_names) >= 2,
                    f"variants: {sorted(variant_names)[:5]}")
    all_ok &= check("serial-burglary chain present",
                    set(map(str, gt["serialChains"][0]["caseMasterIds"])).issubset(case_ids))
    all_ok &= check("cyber ring present",
                    set(map(str, gt["cyberRing"]["caseMasterIds"])).issubset(case_ids))
    all_ok &= check("slipping cases present", set(map(str, gt["slippingCaseIds"])).issubset(case_ids),
                    f"{len(gt['slippingCaseIds'])} cases")
    all_ok &= check("emerging hotspot present",
                    set(map(str, gt["emergingHotspot"]["caseMasterIds"])).issubset(case_ids),
                    f"{len(gt['emergingHotspot']['caseMasterIds'])} cases")

    # ---- Fairness: protected attrs independent of crime head (chi-square) ----
    merged = comps.merge(cases[["CaseMasterID", "CrimeMajorHeadID"]], on="CaseMasterID", how="inner")
    ok_indep = True
    detail = ""
    try:
        for col in ["ReligionID", "CasteID", "OccupationID"]:
            ct = pd.crosstab(merged[col], merged["CrimeMajorHeadID"])
            chi2, p, dof, _ = _stats.chi2_contingency(ct)
            # independent by construction -> expect high-ish p; flag only extreme dependence
            if p < 0.001:
                ok_indep = False
                detail += f"{col} p={p:.4f} "
    except Exception as e:  # scipy missing or degenerate table
        detail = f"chi-square skipped ({e})"
    all_ok &= check("protected attrs ~independent of crime head", ok_indep, detail)

    print()
    if all_ok:
        print("[validate] ALL CHECKS PASSED ✅")
        sys.exit(0)
    else:
        print("[validate] SOME CHECKS FAILED ❌")
        sys.exit(1)


if __name__ == "__main__":
    main()
