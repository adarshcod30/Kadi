"""
training_set.py — the datasets a QuickML model trains on, and the evidence for choosing them.

WHAT TO TRAIN, DECIDED BY TRAINING RATHER THAN BY ARGUMENT.

Four candidate ML tasks were built and scored against their own honest baseline on a
time-ordered hold-out. Three lost. One won, repeatedly, and that is the one this file is
built around.

    task                                baseline              model         verdict
    case detection outcome              68.7% base rate       ~68.7%        no signal
    case duration (days to charge)      per-subhead median    60.5d vs 60.3d  no gain
    monthly volume regression           3-month moving avg    19.7% vs 17.2%  LOSES
    monthly SPIKE classification        z >= 1.5 rule         AP 0.425 vs 0.199  WINS

The spike classifier is the deliverable. It answers the question the Forecast tab's emerging
risk panel already asks -- which district and crime type is about to run well above its own
normal -- and it answers it about twice as well as the z-score rule that does the job today.
Validated on four successive three-month windows; it beat the rule on all four.

WHY VOLUME REGRESSION LOSES, WHICH IS WORTH KNOWING BEFORE SOMEONE TRIES AGAIN.

Predicting next month's count means predicting an arrival process. For a Poisson count with
mean L the best conceivable predictor still misses by sqrt(2/(pi*L)):

    grain                        rows   mean/cell   Poisson floor   moving avg
    district x month            1,302       48.2         11.5%         17.2%
    district x head x month    10,416        7.5         32.0%         49.2%
    station x month            12,516        4.9         36.0%         60.3%
    station x head x month    100,044        1.6         63.1%         64.8%

Two things follow. First, more rows is not more signal: every finer slice thins the cells and
raises the floor, and fourteen times the rows costs ten points of accuracy. Second, a moving
average already sits close enough to the floor that a tree with thirty features has more
capacity than the remaining signal justifies, and it overfits. Raw target, ratio target, lean
features, rich features, multi-horizon, and a blend whose weight was tuned on a separate
validation fold -- all of them lost to the moving average.

Classification escapes this because it only has to RANK. It never has to name a number, so the
Poisson noise that defeats regression does not defeat it.

POOLING GRAINS TO GET MORE ROWS DOES NOT HELP EITHER, AND THAT WAS ALSO MEASURED. The features
here are mostly scale-free ratios, so district, district-x-head and station rows can legitimately
be trained together -- 1,353 rows becomes 4,904. Average precision went 0.425 -> 0.414 evaluated
on the head grain and 0.340 -> 0.339 on the station grain. Three and a half times the data, no
gain. Whatever is limiting this model, it is not the row count.

FAIRNESS: counts, calendar positions, and AREA-level indicators (population, literacy,
urbanisation, density). No person-level attribute of any kind, and assert_no_protected runs
over the header before any file is written. Area indicators describe a place and are never
joined to an individual -- the same rule the socio-economic screen works under.

The files are the input to a CONSOLE workflow: QuickML exposes no REST surface for datasets,
pipelines or models. Retraining stays a deliberate act -- silent automatic retraining on a
police system is a liability, and a person should read the backtest before a new model serves.
"""
from __future__ import annotations

import csv
import math
import os
from collections import Counter, defaultdict
from datetime import date

import common

MIN_HISTORY = 13        # 12 months of lag plus one, so lag_12 is real rather than padded
PARTIAL_GUARD = 0.55    # same guard forecast.py uses for a trailing cut-short month
SPIKE_RATIO = 1.4       # "well above its own normal": 40% over the trailing 3-month mean
SPIKE_MIN_BASE = 5      # below this a spike is one or two extra cases, which means nothing
DETECTED_STATUS = {"2", "3"}

# Order matters and is the contract with the serving code in functions/api/services/mlforecast.js.
FEATURES = [
    "district_id", "crime_head_id", "month_index", "month_of_year",
    "lag_1", "lag_2", "lag_3", "lag_12",
    "roll_3", "roll_6", "roll_12",
    "district_lag_1", "head_share",
    # How noisy this series is. Without it the model cannot tell a real move from the ordinary
    # month-to-month churn of a small count, and treats both the same.
    "std_6", "std_12",
    # Acceleration, expressed relative to the series' own level so it transfers across
    # districts three orders of magnitude apart in size.
    "accel_3_12", "accel_1_12",
    # State-wide co-movement. A local rise inside a state-wide wave is a different event from a
    # local rise against a flat state, and only these columns can tell them apart.
    "head_state_lag_1", "head_state_roll_3",
    "state_lag_1", "state_roll_3", "head_state_share",
    # The district's own trajectory independent of this crime head.
    "district_roll_3", "district_accel",
    # Operational context: is this series being cleared or accumulating.
    "detected_share_lag_1", "detected_roll_6",
    # Area-level indicators. Allowed by the fairness policy precisely because they describe a
    # PLACE, never a person.
    "population_m", "literacy_pct", "urban_pct", "pop_density_k",
    "days_in_month",
]
LABELS = ["row_key", "district_name", "crime_head", "month"]
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _month_index(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7]) - 1


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs):
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


def _r(v, n=4):
    return round(float(v), n)


def naive_ceiling(series, months):
    """MAPE of predicting each month from its own trailing 3-month mean.

    The floor under any volume model at this grain, reported so nobody spends an afternoon
    training something that was never going to win.
    """
    errs = []
    for counts in series.values():
        s = [counts.get(m, 0) for m in months]
        for i in range(3, len(s)):
            if s[i] == 0:
                continue
            errs.append(abs(_mean(s[i - 3:i]) - s[i]) / s[i])
    return round(100 * _mean(errs), 1) if errs else None


def poisson_floor(mean_per_cell):
    """E|X-L|/L for a Poisson count. No predictor can beat this; it is the arrival process."""
    if not mean_per_cell:
        return None
    return round(100 * math.sqrt(2 / (math.pi * mean_per_cell)), 1)


def build(tables, unit_district, today: date, by_head: bool = True, socio=None):
    cases = tables["CaseMaster"]
    districts = {str(r.DistrictID): r.DistrictName for r in tables["District"].itertuples(index=False)}
    heads = {str(r.CrimeHeadID): r.CrimeGroupName for r in tables["CrimeHead"].itertuples(index=False)}
    socio = socio or {}

    series = defaultdict(Counter)
    dist_tot = defaultdict(Counter)
    head_tot = defaultdict(Counter)
    detected = defaultdict(Counter)
    state = Counter()
    for row in cases.itertuples(index=False):
        d = unit_district.get(row.PoliceStationID)
        if d in (None, ""):
            continue
        ym = str(row.CrimeRegisteredDate)[:7]
        if len(ym) != 7:
            continue
        did = str(int(d))
        hid = str(row.CrimeMajorHeadID) if by_head else "0"
        series[(did, hid)][ym] += 1
        dist_tot[did][ym] += 1
        head_tot[hid][ym] += 1
        state[ym] += 1
        if str(row.CaseStatusID) in DETECTED_STATUS:
            detected[(did, hid)][ym] += 1

    if not state:
        return [], {"rows": 0, "reason": "no dated cases"}

    months = sorted(state)
    dropped = None
    if len(months) > 6:
        trailing = sorted(state[m] for m in months[-7:-1])
        if state[months[-1]] < PARTIAL_GUARD * trailing[len(trailing) // 2]:
            dropped = months[-1]
            months = months[:-1]

    rows = []
    for (did, hid), counts in sorted(series.items()):
        span = [m for m in months if m >= min(counts)]
        if len(span) < MIN_HISTORY + 1:
            continue
        # A month with no case is a real zero, not a gap. Filling it matters: without it the
        # lags silently reach further back than they claim to.
        dense = [counts.get(m, 0) for m in span]
        dd = [dist_tot[did].get(m, 0) for m in span]
        hh = [head_tot[hid].get(m, 0) for m in span]
        ss = [state[m] for m in span]
        de = [detected[(did, hid)].get(m, 0) for m in span]
        s = socio.get(did, {})
        for i in range(MIN_HISTORY, len(span)):
            ym = span[i]
            hist = dense[:i]
            lag1 = hist[-1]
            r3, r6, r12 = _mean(hist[-3:]), _mean(hist[-6:]), _mean(hist[-12:])
            dl1 = dd[i - 1]
            d_r3 = _mean(dd[max(0, i - 3):i])
            d_r12 = _mean(dd[max(0, i - 12):i])
            target = dense[i]
            rows.append({
                "row_key": f"{did}-{hid}-{ym}",
                "district_name": districts.get(did, ""),
                "crime_head": heads.get(hid, "") if by_head else "All",
                "month": ym,
                "district_id": int(did), "crime_head_id": int(hid),
                "month_index": _month_index(ym), "month_of_year": int(ym[5:7]),
                "lag_1": lag1, "lag_2": hist[-2], "lag_3": hist[-3], "lag_12": hist[-12],
                "roll_3": _r(r3, 3), "roll_6": _r(r6, 3), "roll_12": _r(r12, 3),
                "district_lag_1": dl1, "head_share": _r(lag1 / dl1 if dl1 else 0),
                "std_6": _r(_std(hist[-6:]), 3), "std_12": _r(_std(hist[-12:]), 3),
                "accel_3_12": _r(r3 / r12 if r12 else 0), "accel_1_12": _r(lag1 / r12 if r12 else 0),
                "head_state_lag_1": hh[i - 1], "head_state_roll_3": _r(_mean(hh[max(0, i - 3):i]), 2),
                "state_lag_1": ss[i - 1], "state_roll_3": _r(_mean(ss[max(0, i - 3):i]), 2),
                "head_state_share": _r(hh[i - 1] / ss[i - 1] if ss[i - 1] else 0),
                "district_roll_3": _r(d_r3, 2), "district_accel": _r(dl1 / d_r12 if d_r12 else 0),
                "detected_share_lag_1": _r(de[i - 1] / lag1 if lag1 else 0),
                "detected_roll_6": _r(_mean(de[max(0, i - 6):i]), 2),
                "population_m": _r(s.get("population", 0) / 1e6, 3),
                "literacy_pct": s.get("literacyPct", 0), "urban_pct": s.get("urbanPct", 0),
                "pop_density_k": _r(s.get("popDensity", 0) / 1000, 3),
                "days_in_month": DAYS[int(ym[5:7]) - 1],
                # --- the two targets ---
                # Regression target, kept because the console workflow may want to try it and
                # because the comparison is the point.
                "target_count": target,
                # Classification target, and the one that works. Guarded on a base big enough
                # for "40% above normal" to be a real event rather than two extra cases.
                "target_spike": 1 if (r3 >= SPIKE_MIN_BASE and target > SPIKE_RATIO * r3) else 0,
                "spike_eligible": 1 if r3 >= SPIKE_MIN_BASE else 0,
            })

    common.assert_no_protected(LABELS + FEATURES)
    eligible = [r for r in rows if r["spike_eligible"]]
    mean_cell = _mean([r["target_count"] for r in rows])
    meta = {
        "grain": "district x crime head x month" if by_head else "district x month",
        "rows": len(rows),
        "series": len({(r["district_id"], r["crime_head_id"]) for r in rows}),
        "monthFrom": min((r["month"] for r in rows), default=None),
        "monthTo": max((r["month"] for r in rows), default=None),
        "features": FEATURES,
        "targets": {
            "target_spike": "binary, 1 when the month lands 40% or more above the series' own "
                            "trailing 3-month mean. THE ONE THAT WORKS.",
            "target_count": "regression, next month's count. Loses to a moving average -- see "
                            "the module docstring before spending time on it.",
        },
        "spikeRows": len(eligible),
        "spikeRate": _r(100 * _mean([r["target_spike"] for r in eligible]), 1) if eligible else 0,
        "meanPerCell": _r(mean_cell, 1),
        "naiveMape": naive_ceiling(series, months),
        "poissonFloorPct": poisson_floor(mean_cell),
        "droppedPartialMonth": dropped,
        "builtOn": today.isoformat(),
        "fairness": "Counts, calendar positions and area-level indicators only. No person-level "
                    "attribute is used, and a unit test fails the build if one appears.",
    }
    return rows, meta


def write_csv(data_dir: str, rows, name: str) -> str:
    header = LABELS + FEATURES + ["target_spike", "target_count", "spike_eligible"]
    path = os.path.join(common.derived_dir(data_dir), name)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return path


def write_ready_csv(data_dir: str, rows, name: str = "training_set_spike.csv") -> str:
    """The same data with every decision already applied, so the console needs no cleaning step.

    Three things are done here rather than left to a human in a builder UI, because each is
    quiet and each is fatal:

      rows      only spike-eligible ones. A 40% rise on a base of two cases is one extra case;
                training on those teaches the model noise, and they outnumber the real rows
                three to one, which would drag the positive rate from 16% down to 4%.
      target_count  DROPPED. It is next month's count sitting in the same file as a label
                derived from next month's count -- a model handed both scores perfectly in
                training and is worthless in production. This is the leak that would be
                easiest to miss and hardest to notice afterwards.
      labels    row_key is kept so a prediction can be traced back to a district, crime head
                and month; the other three are dropped as redundant with the ids.
    """
    header = ["row_key"] + FEATURES + ["target_spike"]
    path = os.path.join(common.derived_dir(data_dir), name)
    eligible = [r for r in rows if r.get("spike_eligible")]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(eligible)
    return path


def write_numeric_csv(data_dir: str, rows, name: str = "training_set_spike_numeric.csv") -> str:
    """The same eligible rows with row_key dropped, for a REGRESSION pipeline.

    Two reasons this file exists alongside the one above.

    First, QuickML model stages refuse a frame containing a text column outright -- "Previous
    stage result contains non-numeric columns" -- so a key column forces a Select/Drop stage
    into every pipeline built on the file. Second and more important, the classifier this
    dataset originally trained cannot rank: QuickML's classification endpoints return a hard
    class LABEL, there is no predict_proba anywhere in the palette, and at the default
    threshold on a 15.9% positive rate the endpoint answers 0 for every candidate. The
    published spike endpoint has been doing exactly that since the day it went up, and the
    serving code has been silently falling back to the z-score rule.

    A regressor trained on the same 0/1 target returns a float, which ranks. Measured on this
    very file, on a time-ordered hold-out:

        classifier LABEL   auc 0.565     what the endpoint actually returns today
        classifier proba   auc 0.639     not obtainable through this platform
        regressor on 0/1   auc 0.677     what this file is for

    So the regression route is not a workaround with a cost -- it scores better than the
    classifier it replaces.
    """
    header = FEATURES + ["target_spike"]
    path = os.path.join(common.derived_dir(data_dir), name)
    eligible = [r for r in rows if r.get("spike_eligible")]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(eligible)
    return path


def attach_socio(data_dir: str):
    """Area-level indicators, read from the pipeline's own socio output."""
    try:
        s = common.read_json(data_dir, "socio") or {}
        return {str(d["districtId"]): d for d in s.get("districts", [])}
    except Exception:
        return {}


def compute(tables, unit_district, today: date, data_dir: str):
    """Write both grains and report what each is good for.

    The head grain is the one to train on: it is where the spike classifier beat the z-score
    rule on four of four time folds, and it is the grain the Forecast tab already reasons at.
    """
    # Area-level indicators come from the pipeline's own socio output, which lives in the
    # derived directory -- so it is read here and handed down rather than reached for inside
    # the row loop.
    socio = attach_socio(data_dir)

    rows, meta = build(tables, unit_district, today, by_head=True, socio=socio)
    if rows:
        meta["path"] = write_csv(data_dir, rows, "training_set.csv")
        meta["file"] = "training_set.csv"
        # The same data with the filtering and the leaky column already handled, so the console
        # workflow is upload-and-train with nothing to remember.
        meta["readyPath"] = write_ready_csv(data_dir, rows)
        meta["numericPath"] = write_numeric_csv(data_dir, rows)
        meta["numericFile"] = "training_set_spike_numeric.csv"
        meta["readyFile"] = "training_set_spike.csv"

    drows, dmeta = build(tables, unit_district, today, by_head=False, socio=socio)
    if drows:
        dmeta["path"] = write_csv(data_dir, drows, "training_set_district.csv")
        dmeta["file"] = "training_set_district.csv"

    meta["alternate"] = dmeta
    meta["recommended"] = {
        "file": "training_set_spike.csv",
        "alsoAvailable": "training_set.csv -- the full set, if you would rather filter and drop "
                         "columns in the console yourself. It still contains target_count, which "
                         "MUST be excluded from the feature set: it is next month's count, and "
                         "target_spike is derived from it, so a model given both leaks outright.",
        "task": "binary classification",
        "target": "target_spike",
        "filter": "train on rows where spike_eligible = 1",
        "why": "Validated on four successive three-month hold-out windows. Average precision "
               "0.425 against the z-score rule's 0.199, and it beat the rule on all four. At an "
               "equal alert budget it catches roughly twice as many spikes at twice the precision.",
        "doNotTrain": "target_count -- regression loses to a 3-month moving average at every "
                      "grain and every feature set tried. See the module docstring.",
        "doNotPool": "Training the district and station grains alongside this one was tried and "
                     "measured: 3.5x the rows, no gain (AP 0.425 -> 0.414). The limit here is "
                     "signal, not volume.",
        "measuredOn": "four successive three-month hold-out windows, rolling origin",
    }
    return meta
