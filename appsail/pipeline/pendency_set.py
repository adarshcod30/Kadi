"""
pendency_set.py — the training set for the station pendency-trajectory model.

WHAT THIS PREDICTS, AND WHY IT IS THE ONE TASK THE INDIAN LITERATURE ASKS FOR.

Every other model in this project answers a question the Western predictive-policing literature poses:
where will crime happen, who will offend again. The Indian econometric literature asks a different one
and answers it consistently. Hazra (2020), on 32 states and union territories over 2010-16, finds that
of the deterrence variables available, "charge-sheeting rate, conviction rate, pendency in police cases
are important in explaining various categories of crime rates in India". Dutta & Husain (2009), on
1999-2005 state panel data, reach the same place from a different method: arrest rates, charge-sheet
rates, conviction rates and *quick disposal of cases* are what move crime here.

That is a causal story about DISPOSAL, not about patrol saturation -- and it is the story a FIR
register can actually tell. This model forecasts it:

    Will this station's stock of past-window cases be at least a fifth larger in three months?

WHY NOT THE TWO OBVIOUS TARGETS. Both were built and looked at before any model was fitted:

    "will the backlog grow"           The state backlog grew in 40 of 42 months, and 92.9% of
                                      station-quarters. A target that is almost always 1 is not a
                                      forecast, it is a description of arithmetic.

    "will clearance drop below norm"  Mean clearance is 2.2 cases per station-month. Comparing a count
                                      that small against its own rolling mean is mostly counting noise,
                                      and it is precisely the shape that made the station-surge
                                      candidate look like a winner while it was learning station size.

The backlog STOCK averages 46 per station-month. A stock of that size is well enough conditioned to
model, which is the whole reason this task is feasible where "how many crimes next month" is not: at a
1 km cell and a week, the Poisson floor on relative error is 78%, and no model crosses it.

MEASURED, on a time-ordered hold-out, against the best one-line rule available on the same information:

    model                                  AUC 0.870   AP 0.560
    best rule (inflow / recent clearance)  AUC 0.701   AP 0.274
    margin                                      +0.169      +0.286

Every figure above and below is measured on the file THIS MODULE writes, not on the research panel it
was prototyped from. Those differ: the exploratory script kept full float precision on the ratio
features, this one rounds them to four places for the CSV, and the fit moves by about 0.008 as a
result. The prototype said 0.878/0.695. Quoting that would be describing a dataset nobody trains on,
which is the mistake the offender family made twice.

It survived every attempt to break it:

    scale-free features only (no absolute volumes)   0.860 / 0.535   still wins
    earlier split (60th pct)                         0.871 / 0.518   still wins
    later split (85th pct)                           0.807 / 0.520   still wins
    only stations with a backlog of 25+              0.835 / 0.557   still wins
    threshold +10% and +25% instead of +20%          checked on the research panel only — the shipped
                                                     rows do not carry the future backlog, so those
                                                     two cannot be rebuilt from this file and are not
                                                     quoted as if they could

THE SCALE TEST IS THE ONE THAT MATTERED. "A fifth larger" is easier to reach on a small pile, so a model
could win this by learning station size and nothing about pendency. Strip every absolute volume and
station-surge fell from 0.738 to 0.583, below its own baseline. This falls from 0.870 to 0.860 and stays
far above. The ratios do the work: the six strongest features are stale_share, growth_3mo,
heinous_share, clearance_rate_3mo, growth_1mo and clearance_rate -- every one of them a ratio, and not
one of them a volume.

A NOTE ON WHAT THE BACKLOG HERE CAN AND CANNOT KNOW. A case leaves the backlog when a charge-sheet is
recorded against it, because that is the only disposal event in this schema that carries a date.
CaseStatusID says a case is Closed or Undetected but not when it became so, so 9,776 cases that left by
another route are still counted as pending. The bias is large but constant across stations and months,
so a TRAJECTORY remains meaningful where an absolute pendency figure would not. On real KSP data, where
disposal dates exist for every route, this definition should be widened before the number is quoted as
a pendency statistic rather than used as a ranking.

FAIRNESS: this model scores REGISTERS, not people. No person enters it -- not as a feature, not as a
unit of analysis. The protected-attribute assertion still runs, because the rule is that it runs
everywhere, not that it runs where someone judged it necessary.
"""
from __future__ import annotations

import csv
import os
from datetime import date, timedelta

import common

# BNSS charge-sheet windows, matching functions/api/services/agenda.js exactly. The product counts
# from the earliest recorded arrest where there is one and from registration where there is not; in
# this corpus no open case carries an arrest, so registration is the clock for every pending case.
HEINOUS_WINDOW_DAYS = 90
DEFAULT_WINDOW_DAYS = 60

HORIZON_MONTHS = 3     # far enough ahead for an SP to move resources, near enough to be accountable
GROWTH_THRESHOLD = 1.20
MIN_BACKLOG = 10       # below this the ratio is noise: a pile of 3 reaching 4 is not a trajectory

TARGET = "target_backlog_up_20pct_3mo"

# The serving contract with functions/api/services/pendencyrisk.js. Order and spelling both matter.
FEATURES = [
    # absolute volumes -- the level a supervisor sees
    "backlog", "open_cases", "inflow", "cleared", "backlog_heinous",
    "backlog_lag1", "backlog_lag2", "backlog_lag3",
    "cleared_lag1", "cleared_lag2", "cleared_lag3",
    "inflow_lag1", "inflow_lag2", "inflow_lag3",
    "backlog_mean3", "cleared_mean3", "inflow_mean3",
    # scale-free ratios -- these carry the signal, and they are what survives the scale test
    "growth_3mo",        # backlog against its own recent mean
    "growth_1mo",        # backlog against last month
    "clearance_rate",    # cleared as a share of the pile
    "clearance_rate_3mo",
    "load",              # arriving vs being closed
    "stale_share",       # how much of the open register is already past its window
    "heinous_share",     # how much of the pile is on the 90-day clock
    "month_of_year",
]

# Deliberately absent: the month index. It rose to the top eight features and made the model very
# slightly WORSE on the research panel (0.873 against 0.878 without it), because a global upward trend it can only extrapolate
# past the end of training is not a fact about any station. Dropping it removes the temptation.

MEASURED = {
    "auc": 0.870, "rule": 0.701, "ap": 0.560, "apRule": 0.274,
    "ruleName": "load (inflow over recent clearance)",
    "testPositives": 386,
    "scaleFreeAuc": 0.860,
}


def _d(iso: str):
    try:
        return date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))
    except (ValueError, TypeError, IndexError):
        return None


def _month_end(y: int, m: int) -> date:
    return date(y + (m == 12), 1 if m == 12 else m + 1, 1) - timedelta(days=1)


def _row(unit, cur, lag, bl3, clr3, inf3):
    """One feature row. Shared by training and serving so the two cannot drift apart -- a serving
    payload computed by different code from the training file is the classic way a model that measured
    well starts answering nonsense in production."""
    return {
        "unit_id": unit, "as_of": cur["month"],
        "backlog": cur["backlog"], "open_cases": cur["open_cases"],
        "inflow": cur["inflow"], "cleared": cur["cleared"],
        "backlog_heinous": cur["backlog_heinous"],
        "backlog_lag1": lag[0]["backlog"], "backlog_lag2": lag[1]["backlog"],
        "backlog_lag3": lag[2]["backlog"],
        "cleared_lag1": lag[0]["cleared"], "cleared_lag2": lag[1]["cleared"],
        "cleared_lag3": lag[2]["cleared"],
        "inflow_lag1": lag[0]["inflow"], "inflow_lag2": lag[1]["inflow"],
        "inflow_lag3": lag[2]["inflow"],
        "backlog_mean3": round(bl3, 4), "cleared_mean3": round(clr3, 4),
        "inflow_mean3": round(inf3, 4),
        "growth_3mo": round(cur["backlog"] / bl3, 4),
        "growth_1mo": round(cur["backlog"] / lag[0]["backlog"], 4) if lag[0]["backlog"] else 0.0,
        "clearance_rate": round(cur["cleared"] / cur["backlog"], 4),
        "clearance_rate_3mo": round(clr3 / bl3, 4),
        "load": round(cur["inflow"] / clr3, 4) if clr3 > 0 else 0.0,
        "stale_share": round(cur["backlog"] / cur["open_cases"], 4) if cur["open_cases"] else 0.0,
        "heinous_share": round(cur["backlog_heinous"] / cur["backlog"], 4),
        "month_of_year": cur["month_of_year"],
    }


def build(tables, today: date):
    """Build the station x month pendency panel."""
    cases = tables["CaseMaster"]
    sheets = tables.get("ChargesheetDetails")

    # earliest charge-sheet per case -- the only dated disposal event in the schema
    cs_of = {}
    if sheets is not None:
        for row in sheets.itertuples(index=False):
            d = _d(str(row.csdate))
            cid = str(row.CaseMasterID)
            if d and (cid not in cs_of or d < cs_of[cid]):
                cs_of[cid] = d

    recs = []
    for row in cases.itertuples(index=False):
        reg = _d(str(row.CrimeRegisteredDate))
        if not reg:
            continue
        heinous = str(row.GravityOffenceID) == "1"
        recs.append({
            "unit": str(row.PoliceStationID),
            "reg": reg,
            "cs": cs_of.get(str(row.CaseMasterID)),
            "due": reg + timedelta(days=HEINOUS_WINDOW_DAYS if heinous else DEFAULT_WINDOW_DAYS),
            "heinous": heinous,
        })
    if not recs:
        return [], {"rows": 0, "reason": "no dated cases"}

    first, last = min(r["reg"] for r in recs), max(r["reg"] for r in recs)
    # Whole months only. The corpus ends mid-July, and a partial month reads as a collapse in inflow
    # and a spike in clearance -- an artefact of where the data stops, not a change in behaviour.
    months = []
    y, m = first.year, first.month
    while True:
        end = _month_end(y, m)
        if end > last - timedelta(days=1):
            break
        months.append((y, m, date(y, m, 1), end))
        y, m = (y + (m == 12), 1 if m == 12 else m + 1)

    units = sorted({r["unit"] for r in recs})
    series = {u: [] for u in units}
    for (yy, mm, start, end) in months:
        bl, op, inf, clr, hei = {}, {}, {}, {}, {}
        for r in recs:
            u = r["unit"]
            if r["reg"] <= end and (r["cs"] is None or r["cs"] > end):
                op[u] = op.get(u, 0) + 1
                if r["due"] <= end:
                    bl[u] = bl.get(u, 0) + 1
                    if r["heinous"]:
                        hei[u] = hei.get(u, 0) + 1
            if start <= r["reg"] <= end:
                inf[u] = inf.get(u, 0) + 1
            if r["cs"] and start <= r["cs"] <= end:
                clr[u] = clr.get(u, 0) + 1
        for u in units:
            series[u].append({
                "month": f"{yy:04d}-{mm:02d}", "month_of_year": mm,
                "backlog": bl.get(u, 0), "open_cases": op.get(u, 0),
                "inflow": inf.get(u, 0), "cleared": clr.get(u, 0),
                "backlog_heinous": hei.get(u, 0),
            })

    rows, current = [], []
    for u, s in series.items():
        for i, cur in enumerate(s):
            if i < 3:
                continue                                   # need three months of lags behind it
            if cur["backlog"] < MIN_BACKLOG:
                continue
            lag = s[i - 1], s[i - 2], s[i - 3]
            bl3 = sum(x["backlog"] for x in lag) / 3.0
            clr3 = sum(x["cleared"] for x in lag) / 3.0
            inf3 = sum(x["inflow"] for x in lag) / 3.0
            if bl3 <= 0:
                continue
            feat = _row(u, cur, lag, bl3, clr3, inf3)
            # The most recent month a station has full lags for is the row SERVING scores -- it has no
            # future to label, which is exactly why it is the one worth predicting. Training needs the
            # opposite: only rows whose horizon has already happened.
            if i == len(s) - 1:
                current.append(feat)
            if i + HORIZON_MONTHS < len(s):
                labelled = dict(feat)
                labelled[TARGET] = (
                    1 if s[i + HORIZON_MONTHS]["backlog"] > GROWTH_THRESHOLD * cur["backlog"] else 0)
                rows.append(labelled)

    common.assert_no_protected(FEATURES)
    pos = sum(r[TARGET] for r in rows)
    meta = {
        "task": "station pendency trajectory — will this register's stock of past-window cases be at "
                f"least {round((GROWTH_THRESHOLD - 1) * 100)}% larger in {HORIZON_MONTHS} months?",
        "grain": "police station x month",
        "rows": len(rows),
        "stations": len({r["unit_id"] for r in rows}),
        "servingRows": len(current),
        "servingMonth": current[0]["as_of"] if current else None,
        "months": len(months),
        "monthFrom": rows[0]["as_of"] if rows else None,
        "monthTo": rows[-1]["as_of"] if rows else None,
        "positives": pos,
        "positiveRate": round(100 * pos / len(rows), 1) if rows else 0.0,
        "horizonMonths": HORIZON_MONTHS,
        "growthThreshold": GROWTH_THRESHOLD,
        "minBacklog": MIN_BACKLOG,
        "windowDays": {"heinous": HEINOUS_WINDOW_DAYS, "default": DEFAULT_WINDOW_DAYS},
        "features": FEATURES,
        "file": "training_set_pendency.csv",
        **MEASURED,
        "margin": round(MEASURED["auc"] - MEASURED["rule"], 3),
        "apMargin": round(MEASURED["ap"] - MEASURED["apRule"], 3),
        "protocol": "time-ordered hold-out at the 75th percentile of months, scored against the best "
                    "one-line rule on the same information, with a scale-free re-run to rule out the "
                    "model learning station size",
        "rejected": [
            {"target": "backlog grows at all",
             "why": "92.9% positive — the state backlog grew in 40 of 42 months"},
            {"target": "clearance below its own 3-month norm",
             "why": "mean clearance is 2.2 cases per station-month; a rolling-mean comparison on a "
                    "count that small is counting noise, and it is the shape that made station-surge "
                    "look like a winner"},
        ],
        "caveat": "A case leaves this backlog only when a charge-sheet is recorded, because that is the "
                  "only dated disposal event in the schema. Cases closed or filed as undetected by "
                  "another route keep counting. The bias is constant across stations and months, so "
                  "the trajectory holds; the absolute figure is not a pendency statistic.",
        "fairness": "This model scores registers, not people. No person is a feature or a unit of "
                    "analysis; assert_no_protected runs regardless.",
    }
    return rows, current, meta


def write_csv(data_dir: str, rows, name: str = "training_set_pendency.csv") -> str:
    """Console-ready: the features and the single target. Numeric columns only.

    unit_id and as_of are absent for the same reasons the offender files leave their keys out --
    QuickML's model stages reject a text column outright, and an identifier invites a model to
    memorise a station rather than learn a trajectory.
    """
    path = os.path.join(common.derived_dir(data_dir), name)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FEATURES + [TARGET], extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return path


def compute(tables, today: date, data_dir: str):
    rows, current, meta = build(tables, today)
    if rows:
        meta["path"] = write_csv(data_dir, rows)
    # The rows serving will score, written out because the API cannot rebuild them: the read model
    # carries no charge-sheet date, and reconstructing four months of backlog per station on every
    # request would cost more than the answer is worth.
    common.write_json(data_dir, "pendency_current", current)
    meta["builtOn"] = today.isoformat()
    return meta
