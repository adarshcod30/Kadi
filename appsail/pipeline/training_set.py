"""
training_set.py — the CSV a QuickML model actually trains on.

WHAT IS BEING PREDICTED, and why this and not something else.

The obvious ML pitch on a crime corpus is a case-outcome classifier: given an FIR, will it be
detected? We measured that before proposing anything and it does not work here. Detection runs
at a 68.7% base rate and moves less than two points across crime head (69.9 / 70.7 / 70.3 /
70.1), linkage (67.8 vs 69.8 -- backwards), and gravity (70.1 vs 68.5). The only feature that
separates is the health flag, and that is circular: a case is flagged BECAUSE it is stalling.
A model on that corpus would predict the base rate for everything and call it intelligence.

So the model here forecasts VOLUME: one row per district x crime head x month, predicting next
month's count from the history of that same series. Time series genuinely carries trend,
seasonality and level shifts, it needs no outcome labels so it improves as cases arrive rather
than waiting on closures, and it has a number to beat -- the statistical forecast in
forecast.py already backtests, so a model that loses to it can be seen to lose.

FAIRNESS: the feature set is counts and calendar positions. No person-level attribute of any
kind enters it, and assert_no_protected runs over the header before the file is written.

The file is the input to a CONSOLE workflow -- QuickML has no REST surface for datasets,
pipelines or models -- so this writes the CSV and records what is in it. Someone uploads it,
builds the model, and puts the endpoint id in the API's environment. Retraining stays a
deliberate act: silent automatic retraining on a police system is a liability, and a person
should read the backtest before a new model serves.
"""
from __future__ import annotations

import csv
import os
from collections import Counter, defaultdict
from datetime import date

import common

# A series needs enough history for the lags to mean anything. Twelve months of history plus
# the twelve-month lag means the first usable row sits a year into the series.
MIN_HISTORY = 13
PARTIAL_GUARD = 0.55   # same guard forecast.py uses: drop a trailing month that is clearly cut short

FEATURES = [
    "district_id", "crime_head_id", "month_index", "month_of_year",
    "lag_1", "lag_2", "lag_3", "lag_12",
    "roll_3", "roll_6", "roll_12",
    "district_lag_1", "head_share",
]
HEADER = ["row_key", "district_name", "crime_head", "month"] + FEATURES + ["target"]


def _add_months(ym: str, k: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    t = (y * 12 + (m - 1)) + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def _month_index(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7]) - 1


def _mean(xs):
    return round(sum(xs) / len(xs), 3) if xs else 0.0


def build(tables, unit_district, today: date):
    """Return (rows, meta). Rows are dicts keyed by HEADER."""
    cases = tables["CaseMaster"]
    districts = {str(r.DistrictID): r.DistrictName for r in tables["District"].itertuples(index=False)}
    heads = {str(r.CrimeHeadID): r.CrimeGroupName for r in tables["CrimeHead"].itertuples(index=False)}

    series = defaultdict(Counter)       # (districtId, headId) -> month -> count
    district_totals = defaultdict(Counter)
    all_months = Counter()
    for row in cases.itertuples(index=False):
        d = unit_district.get(row.PoliceStationID)
        if d in (None, ""):
            continue
        ym = str(row.CrimeRegisteredDate)[:7]
        if len(ym) != 7:
            continue
        h = str(row.CrimeMajorHeadID)
        series[(str(int(d)), h)][ym] += 1
        district_totals[str(int(d))][ym] += 1
        all_months[ym] += 1

    if not all_months:
        return [], {"rows": 0, "reason": "no dated cases"}

    months = sorted(all_months)
    # Drop the trailing partial month. The corpus is extracted mid-month, so the last bucket
    # holds a fortnight; training on it teaches the model that every year ends in a collapse.
    dropped = None
    if len(months) > 6:
        trailing = sorted(all_months[m] for m in months[-7:-1])
        median = trailing[len(trailing) // 2]
        if all_months[months[-1]] < PARTIAL_GUARD * median:
            dropped = months[-1]
            months = months[:-1]

    rows = []
    for (did, hid), counts in sorted(series.items()):
        # A month with no case is a real zero, not a gap. Filling it matters: without it the
        # lags silently reach further back than they claim to.
        span = [m for m in months if m >= min(counts)]
        if len(span) < MIN_HISTORY + 1:
            continue
        dense = [counts.get(m, 0) for m in span]
        for i in range(MIN_HISTORY, len(span)):
            ym = span[i]
            hist = dense[:i]
            prev_month = _add_months(ym, -1)
            dl1 = district_totals[did].get(prev_month, 0)
            lag1 = hist[-1]
            rows.append({
                "row_key": f"{did}-{hid}-{ym}",
                "district_name": districts.get(did, ""),
                "crime_head": heads.get(hid, ""),
                "month": ym,
                "district_id": int(did),
                "crime_head_id": int(hid),
                # Absolute position, so the model can learn a long-run trend, and the calendar
                # month separately, so it can learn seasonality without conflating the two.
                "month_index": _month_index(ym),
                "month_of_year": int(ym[5:7]),
                "lag_1": lag1,
                "lag_2": hist[-2],
                "lag_3": hist[-3],
                "lag_12": hist[-12],
                "roll_3": _mean(hist[-3:]),
                "roll_6": _mean(hist[-6:]),
                "roll_12": _mean(hist[-12:]),
                # The district's whole caseload last month. A head rising while its district
                # rises is a different thing from a head rising while its district is flat.
                "district_lag_1": dl1,
                "head_share": round(lag1 / dl1, 4) if dl1 else 0.0,
                "target": dense[i],
            })

    common.assert_no_protected(HEADER)
    meta = {
        "rows": len(rows),
        "series": len({(r["district_id"], r["crime_head_id"]) for r in rows}),
        "monthFrom": min((r["month"] for r in rows), default=None),
        "monthTo": max((r["month"] for r in rows), default=None),
        "features": FEATURES,
        "target": "target",
        "droppedPartialMonth": dropped,
        "builtOn": today.isoformat(),
        # Stated in the file's own metadata so nobody has to take the docstring's word for it.
        "fairness": "Counts and calendar positions only. No person-level attribute is used.",
    }
    return rows, meta


def write_csv(data_dir: str, rows) -> str:
    path = os.path.join(common.derived_dir(data_dir), "training_set.csv")
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        w.writerows(rows)
    return path


def compute(tables, unit_district, today: date, data_dir: str):
    rows, meta = build(tables, unit_district, today)
    if rows:
        meta["path"] = write_csv(data_dir, rows)
    return meta
