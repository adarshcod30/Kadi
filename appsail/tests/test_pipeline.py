"""
Pipeline tests — fairness invariant, entity-resolution matching, health math, and the
ground-truth evaluation. Run: pytest appsail/tests  (from repo root, in the venv).

The heavier assertions read the committed derived artifacts + ground truth, so they
validate the actual pipeline output that ships. Pure-function tests need no data.
"""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PIPELINE = os.path.join(ROOT, "appsail", "pipeline")
DATA = os.path.join(ROOT, "data", "output")
DERIVED = os.path.join(DATA, "derived")
sys.path.insert(0, PIPELINE)

import common  # noqa: E402
import entity_resolution as er  # noqa: E402
import risk_score  # noqa: E402
import anomaly  # noqa: E402


def _load(name):
    return json.load(open(os.path.join(DERIVED, f"{name}.json")))


# --------------------------- Fairness invariant ---------------------------
def test_assert_no_protected_raises():
    with pytest.raises(ValueError):
        common.assert_no_protected(["AccusedName", "CasteID"])
    with pytest.raises(ValueError):
        common.assert_no_protected(["ReligionID"])
    # clean feature sets pass
    common.assert_no_protected(["AccusedName", "geocell", "co_accused_tokens"])


def test_model_feature_sets_exclude_protected():
    protected = common.PROTECTED_COLUMNS
    for feats in (er.ER_FEATURES, risk_score.RISK_FEATURES, anomaly.ANOMALY_FEATURES):
        assert not (set(feats) & protected), f"protected attr in {feats}"


@pytest.mark.skipif(not os.path.exists(os.path.join(DERIVED, "offenders.json")), reason="pipeline not run")
def test_offender_risk_reports_no_protected_attrs():
    offenders = _load("offenders")
    assert offenders, "expected resolved offenders"
    for o in offenders:
        assert o["protectedAttributesUsed"] == 0


# --------------------------- Name normalization / ER helpers ---------------------------
def test_normalize_name_handles_initials_and_merged_tokens():
    c1, t1, _ = common.normalize_name("Ravi Kumar Doddamani")
    c2, t2, _ = common.normalize_name("Ravikumar Doddamani")
    assert c1 == c2 == "ravikumardoddamani"
    c3, t3, _ = common.normalize_name("Ravi K Doddamani")   # initial dropped
    assert t3 == ["ravi", "doddamani"]


def test_soundex():
    assert common.soundex("Doddamani")[0] == "D"
    assert common.soundex("gowda") == common.soundex("gauda")  # phonetic match


def test_er_structural_gate():
    # same first + same surname link; different surname does not
    assert er._first_ok(["ravi", "doddamani"], ["ravikumar", "doddamani"])
    assert er._last_match(["ravi", "doddamani"], ["ravikumar", "doddamani"], set(), set()) == "exact"
    assert er._last_match(["ravi", "gowda"], ["ravi", "reddy"], set(), set()) is None
    # initial bridging
    assert er._last_match(["ravikumar"], ["ravikumar", "doddamani"], {"d"}, set()) == "initial"


# --------------------------- Ground-truth recovery ---------------------------
@pytest.mark.skipif(not os.path.exists(os.path.join(DERIVED, "eval_report.json")), reason="pipeline not run")
def test_ground_truth_recovery_over_90pct():
    ev = _load("eval_report")
    assert ev["passed"] is True
    assert ev["overallRecoveryPct"] >= 90.0
    assert ev["gangRecoveryPct"] >= 90.0
    assert ev["chainRecoveryPct"] >= 90.0


@pytest.mark.skipif(not os.path.exists(os.path.join(DERIVED, "eval_report.json")), reason="pipeline not run")
def test_repeat_offender_flagged_high_or_medium():
    ev = _load("eval_report")
    assert ev["repeatOffenderRiskOk"] is True


@pytest.mark.skipif(not os.path.exists(os.path.join(DERIVED, "eval_report.json")), reason="pipeline not run")
def test_emerging_hotspot_detected():
    ev = _load("eval_report")
    assert ev["hotspotDetected"] is True


# --------------------------- Health metric math (pure) ---------------------------
@pytest.mark.skipif(not os.path.exists(os.path.join(DERIVED, "case_health.json")), reason="pipeline not run")
def test_health_flags_are_deterministic_and_explained():
    health = _load("case_health")
    assert health, "expected flagged cases"
    for h in health[:200]:
        assert h["flags"], "every flagged case has a reason"
        assert h["recommendationText"], "every flagged case has a recommended action"
        assert h["severity"] in ("high", "medium")
        # ageing flag implies age exceeds peer median
        if "investigation_ageing" in h["flagKeys"]:
            assert h["investigationAgeDays"] > h["peerMedianAgeDays"]


@pytest.mark.skipif(not os.path.exists(os.path.join(DERIVED, "case_health.json")), reason="pipeline not run")
def test_planted_slipping_cases_are_flagged():
    gt = json.load(open(os.path.join(DATA, "_ground_truth.json")))
    flagged = {str(h["caseMasterId"]) for h in _load("case_health")}
    planted = [str(c) for c in gt["slippingCaseIds"]]
    hit = sum(1 for c in planted if c in flagged)
    assert hit / len(planted) >= 0.8, f"only {hit}/{len(planted)} planted slipping cases flagged"


# --- zone thresholds scale per area -------------------------------------------------
# The guarantee under test: a small district must be able to raise an alert on a surge
# that is large FOR IT, without needing Bengaluru's absolute numbers. A flat threshold
# broke this in both directions -- it was noise-level for large areas and unreachable
# for small ones.

def _months(n, value):
    return {f"2025-{m:02d}": value for m in range(1, n + 1)}


def test_small_district_can_reach_red_on_a_proportionate_surge():
    """A 2.5x surge is red whether the baseline is 8 or 200."""
    import zones as z
    # classify is a closure, so exercise it through compute() on synthetic cases.
    def surge(baseline, factor):
        cases = []
        for m in range(1, 13):
            for _ in range(baseline):
                cases.append({"crimeRegisteredDate": f"2025-{m:02d}-05",
                              "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
        for _ in range(int(baseline * factor)):
            cases.append({"crimeRegisteredDate": "2026-01-05",
                          "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
        cases.append({"crimeRegisteredDate": "2026-02-01",
                      "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
        rep = z.compute(cases, [{"districtId": "1", "districtName": "D"}],
                        unit_district={"1": "1"})
        return rep["districts"][0]["zone"]

    assert surge(200, 2.5) in ("red", "red_pulsing")
    assert surge(8, 2.5) in ("red", "red_pulsing"), \
        "a small district must be able to go red on a surge that is large for its own baseline"


def test_large_district_is_not_red_for_a_trivial_absolute_rise():
    """+6 on a 200 baseline is noise, and must stay normal."""
    import zones as z
    cases = []
    for m in range(1, 13):
        for _ in range(200):
            cases.append({"crimeRegisteredDate": f"2025-{m:02d}-05",
                          "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
    for _ in range(206):
        cases.append({"crimeRegisteredDate": "2026-01-05",
                      "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
    cases.append({"crimeRegisteredDate": "2026-02-01",
                  "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
    rep = z.compute(cases, [{"districtId": "1", "districtName": "D"}], unit_district={"1": "1"})
    assert rep["districts"][0]["zone"] == "normal"


def test_thresholds_are_lower_in_absolute_terms_for_smaller_areas():
    """The published bar must be smaller for a small area -- the whole point of the change."""
    import zones as z

    def bar(baseline):
        cases = []
        for m in range(1, 13):
            for _ in range(baseline):
                cases.append({"crimeRegisteredDate": f"2025-{m:02d}-05",
                              "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
        for _ in range(baseline):
            cases.append({"crimeRegisteredDate": "2026-01-05",
                          "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
        cases.append({"crimeRegisteredDate": "2026-02-01",
                      "districtId": "1", "unitId": "1", "crimeHead": "Theft"})
        return z.compute(cases, [{"districtId": "1", "districtName": "D"}],
                         unit_district={"1": "1"})["districts"][0]["thresholds"]["redAt"]

    assert bar(9) < bar(200), "a small district's red line must sit lower in absolute cases"
