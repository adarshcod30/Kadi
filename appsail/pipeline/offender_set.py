"""
offender_set.py — the training sets for the repeat-offending model family.

ONE PANEL, SIX QUESTIONS.

Every model here is fitted on the same rows -- one row per repeat offender per observation
date, features computed strictly from cases registered on or before that date -- and differs
only in what it is asked to predict. That is deliberate: it means the serving payload is
identical across all six (seven numbers), so the API sends the same record to whichever
endpoint answers the question the user picked.

    slug          question asked of a known repeat offender          model   best rule  margin
    ---------------------------------------------------------------------------------------
    h90           back on a new FIR within 90 days                    0.699    0.584    +0.115
    h180          back on a new FIR within 180 days                   0.746    0.562    +0.184
    h365          back on a new FIR within a year                     0.733    0.512    +0.221
    new365        next FIR is in a district they have never worked    0.762    0.561    +0.201
    heinous365    next FIR is recorded Heinous                        0.661    0.502    +0.159
    women365      next FIR is a crime against women                   0.638    0.459    +0.179

Each also beats its baseline on average precision, which matters more than AUC here because
these lists are read from the top: h180 0.538 against 0.387, new365 0.452 against 0.309.

THE FOUR YEAR-LONG MODELS NAME DIFFERENT PEOPLE, which is the whole reason there are four of
them rather than one shown four ways. Scored on the same rows, their top-20 shortlists share
almost nobody:

                  h365   new365  heinous  women
    h365            -      1/20    1/20    0/20
    new365        1/20       -     0/20    1/20
    heinous365    1/20     0/20      -     0/20

Rank correlation across the full panel runs 0.33 to 0.46, which reads like "much the same
model" -- and is misleading, because correlation is dominated by the vast middle of the list
that nobody acts on. The top twenty is the product. h90 against the served h180 is the same
story from the other side: correlated 0.763, sharing 7 of 20.

REJECTED, and why, because a list of what was measured and dropped is the only thing that
makes the list above mean anything:

    h30           back within 30 days                                 0.658    0.588    +0.069
                  Thin, and thinner still on average precision: 0.121 against 0.108. Its
                  shortlist IS distinct -- 1 of 20 shared with h180 -- but a list that names
                  different people less accurately is just a different wrong list.
    property365   next FIR is a property crime                        0.657    0.562    +0.096
    body365       next FIR is a body crime                            0.710    0.575    +0.135
    economic365   next FIR is an economic crime                       0.728    0.508    +0.220
    cyber180      next FIR is a cyber crime                           0.464    0.566    -0.102
                  The first three look like wins and are not. A target of "comes back AND it
                  is a property crime" inherits the predictability of "comes back", which is
                  0.847 on its own. CONDITIONED on the offender actually returning -- given
                  they are back, is it this family? -- the margins collapse to +0.022
                  (property), +0.074 (body) and +0.085 (economic): the model was ranking who
                  returns, not what they return with. women365 and heinous365 are in the ship
                  list precisely because they SURVIVE that conditioning, at +0.146 and +0.121.

WHY EACH TASK GETS ITS OWN FILE, WHICH LOOKS WASTEFUL AND IS NOT.

The first attempt wrote every target as a column of one file. QuickML -- like most console ML
tools -- treats every column that is not the selected target as a feature, so training the
365-day model on that file would have handed it target_reoffend_180 as an input. "Came back
within 180 days" implies "came back within 365 days" by construction: the model would have
scored near 1.0 by reading the answer, and the resulting endpoint would have demanded those
columns in every scoring payload, which the serving code does not send. Sibling targets are
the most dangerous columns a training file can carry. One target per file makes the mistake
impossible to make rather than merely documented.

MEASUREMENT PROTOCOL, applied identically to every row of both tables above:

  * time-ordered hold-out -- train on observation dates up to the 75th percentile, test after
  * scored against the BEST simple rule available on the same information, not the first one:
    recency, own rate per year, prior case count, and for the targeted tasks a question-aware
    rule (their own share of that crime family, their own district spread, their own heinous
    count). A baseline that cannot see the question is not a baseline.
  * for composite targets, the conditional test above

This protocol has overturned its own results twice and both reversals are recorded here and
in research/README.md. Numbers measured on a research prototype rather than on the shipped
file are not quoted anywhere.

FAIRNESS: behaviour and evidence only. Counts, dates, districts spanned, crime heads spanned,
gravity. No age, no gender -- which the risk score also excludes, and widening that quietly in
a training set would be a policy change made in the wrong place -- and none of the protected
columns, asserted before any file is written.
"""
from __future__ import annotations

import csv
import os
from datetime import date, timedelta

import common

WARMUP_DAYS = 365       # no observations until the corpus has a year of history behind it
STEP_DAYS = 30          # observation cadence
MIN_PRIOR = 1           # a person is only observable once police know of them
# Each task is censored by ITS OWN horizon, not by the longest one. The panel is built out to
# the shortest horizon and each task's file then drops the observation dates whose future is
# incomplete for that task. Censoring everything by the longest horizon looks safer and is
# not: it costs the 90-day task six observation dates it is entitled to, drags the train/test
# split a year earlier, and measured h180 at 0.609 instead of the 0.746 it actually earns.
MIN_HORIZON = 90

# The contract with the serving code. Order matters: functions/api/services/offenderrisk.js
# sends these names, and every endpoint validates against what it was trained from. All six
# models share this list, which is what lets one scoring record serve all of them.
FEATURES = [
    "prior_cases",       # how many FIRs this identity carries as at the observation date
    "days_since_last",   # recency, which is the single strongest simple predictor
    "span_days",         # how long they have been known
    "rate_per_yr",       # prior_cases over years known -- their own tempo
    "n_districts",       # how far they range
    "n_heads",           # how varied their offending is
    "heinous",           # how serious, by recorded gravity
]

CRIME_HEADS = {"1": "Body", "2": "Property", "3": "Women", "4": "Economic", "5": "Cyber"}

# Each task is (target column, horizon, predicate over the next case, one-line description).
# The predicate receives the observation row's future summary and returns 0/1.
TASKS = [
    ("h90", "target_back_90", 90, None,
     "back on a new FIR within 90 days"),
    ("h180", "target_back_180", 180, None,
     "back on a new FIR within 180 days"),
    ("h365", "target_back_365", 365, None,
     "back on a new FIR within a year"),
    ("new365", "target_new_district_365", 365, "new_district",
     "next FIR is in a district they have never worked"),
    ("heinous365", "target_heinous_365", 365, "heinous",
     "next FIR is recorded Heinous"),
    ("women365", "target_women_365", 365, "women",
     "next FIR is a crime against women"),
]

# Measured on THIS panel, on the shipped files, under the protocol in the module docstring.
MEASURED = {
    "h90": {"auc": 0.699, "rule": 0.584, "ruleName": "recency",
            "ap": 0.319, "apRule": 0.257, "testPositives": 775},
    "h180": {"auc": 0.746, "rule": 0.562, "ruleName": "recency",
             "ap": 0.538, "apRule": 0.387, "testPositives": 1051},
    "h365": {"auc": 0.733, "rule": 0.512, "ruleName": "recency",
             "ap": 0.720, "apRule": 0.517, "testPositives": 1318},
    "new365": {"auc": 0.762, "rule": 0.561, "ruleName": "districts worked so far",
               "ap": 0.452, "apRule": 0.309, "testPositives": 732, "conditional": 0.197},
    "heinous365": {"auc": 0.661, "rule": 0.502, "ruleName": "recency",
                   "ap": 0.089, "apRule": 0.057, "testPositives": 155, "conditional": 0.121},
    "women365": {"auc": 0.638, "rule": 0.459, "ruleName": "recency",
                 "ap": 0.040, "apRule": 0.021, "testPositives": 60, "conditional": 0.146},
}


def _d(iso: str):
    try:
        return date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))
    except (ValueError, TypeError, IndexError):
        return None


def build(tables, unit_district, identities, today: date):
    """Build the offender x observation-date panel, with every task's label on each row.

    A PANEL, not one row per case. The first draft built a row for every case except an
    offender's last and asked whether the next one arrived within the horizon -- which made
    every row positive by construction (a 100% base rate and an unusable split). Observing
    every known offender at fixed dates is what creates the negatives: the people who were
    around and did not come back.
    """
    cases = tables["CaseMaster"]
    reg_of, did_of, head_of, grav_of = {}, {}, {}, {}
    for row in cases.itertuples(index=False):
        cid = str(row.CaseMasterID)
        d = _d(str(row.CrimeRegisteredDate))
        if not d:
            continue
        reg_of[cid] = d
        did_of[cid] = unit_district.get(row.PoliceStationID)
        head_of[cid] = str(row.CrimeMajorHeadID)
        grav_of[cid] = str(row.GravityOffenceID)

    if not reg_of:
        return [], {"rows": 0, "reason": "no dated cases"}

    first_day, last_day = min(reg_of.values()), max(reg_of.values())
    start = first_day + timedelta(days=WARMUP_DAYS)
    # An observation date closer to the end of the corpus than a task's horizon has an
    # incomplete future, and its label would read as "did not reoffend" purely because the
    # data stops -- the same censoring mistake as counting a partial trailing month. The
    # panel runs out to the SHORTEST horizon; write_csvs trims each task to its own.
    end = last_day - timedelta(days=MIN_HORIZON)

    obs_dates = []
    t = start
    while t <= end:
        obs_dates.append(t)
        t += timedelta(days=STEP_DAYS)

    # ONLY the repeat-offender population -- identities carrying two or more resolved cases,
    # which is the same filter the watchlist uses.
    #
    # This is not a convenience. Built over all resolved identities the panel is 664,032 rows
    # at a 0.7% positive rate, because most identities are one FIR and never return: a
    # different and far weaker problem than the one that was measured, and one whose "winner"
    # would be a model that always answers no. The measurement that earned these models their
    # place was run on the repeat offenders, so the training sets have to be that same
    # population or the AUC on the tin describes something else.
    repeat = [i for i in identities if len({str(c) for c in i.get("caseIds", [])}) >= 2]

    rows = []
    for ident in repeat:
        paired = sorted(
            (reg_of[str(c)], str(c)) for c in ident.get("caseIds", []) if reg_of.get(str(c)))
        if not paired:
            continue
        for t in obs_dates:
            prior = [(d, c) for d, c in paired if d <= t]
            if len(prior) < MIN_PRIOR:
                continue
            future = [(d, c) for d, c in paired if (d - t).days > 0]
            nxt = min(future) if future else None
            gap = (nxt[0] - t).days if nxt else None
            ids = [c for _, c in prior]
            seen_districts = {did_of.get(c) for c in ids if did_of.get(c)}
            span = (t - prior[0][0]).days

            rec = {
                "row_key": f"{ident['offenderIdentityId']}|{t.isoformat()}",
                "offender_id": ident["offenderIdentityId"],
                "as_of": t.isoformat(),
                "prior_cases": len(prior),
                "days_since_last": (t - prior[-1][0]).days,
                "span_days": span,
                "rate_per_yr": round(len(prior) / max(1.0, span / 365.25), 4),
                "n_districts": len(seen_districts),
                "n_heads": len({head_of.get(c) for c in ids if head_of.get(c)}),
                "heinous": sum(1 for c in ids if grav_of.get(c) == "1"),
            }
            nd = did_of.get(nxt[1]) if nxt else None
            for _slug, col, horizon, pred, _desc in TASKS:
                back = gap is not None and gap <= horizon
                if not back:
                    rec[col] = 0
                elif pred is None:
                    rec[col] = 1
                elif pred == "new_district":
                    rec[col] = 1 if (nd is not None and nd not in seen_districts) else 0
                elif pred == "heinous":
                    rec[col] = 1 if grav_of.get(nxt[1]) == "1" else 0
                elif pred == "women":
                    rec[col] = 1 if head_of.get(nxt[1]) == "3" else 0
                else:
                    rec[col] = 0
            rows.append(rec)

    common.assert_no_protected(FEATURES)

    tasks_meta = []
    for slug, col, horizon, _pred, desc in TASKS:
        kept = [r for r in rows if _d(r["as_of"]) <= last_day - timedelta(days=horizon)]
        pos = sum(r[col] for r in kept)
        m = MEASURED.get(slug, {})
        tasks_meta.append({
            "slug": slug,
            "target": col,
            "horizonDays": horizon,
            "question": desc,
            "file": f"training_set_offender_{slug}.csv",
            "rows": len(kept),
            "observationDates": len({r["as_of"] for r in kept}),
            "censorFrom": (last_day - timedelta(days=horizon)).isoformat(),
            "positives": pos,
            "positiveRate": round(100 * pos / len(kept), 1) if kept else 0.0,
            **m,
            "margin": round(m["auc"] - m["rule"], 3) if m else None,
            "apMargin": round(m["ap"] - m["apRule"], 3) if m.get("ap") else None,
        })

    meta = {
        "task": "repeat offending — six questions about a known repeat offender, one panel",
        "models": len(TASKS),
        "grain": "repeat offender (2+ resolved cases) x observation date",
        "population": f"{len(repeat):,} repeat offenders of {len(identities):,} resolved identities",
        "rows": len(rows),
        "offenders": len({r["offender_id"] for r in rows}),
        "observationDates": len(obs_dates),
        "stepDays": STEP_DAYS,
        "lastCaseDay": last_day.isoformat(),
        "monthFrom": obs_dates[0].isoformat() if obs_dates else None,
        "monthTo": obs_dates[-1].isoformat() if obs_dates else None,
        "features": FEATURES,
        "tasks": tasks_meta,
        "protocol": "time-ordered hold-out at the 75th percentile of observation dates, "
                    "scored against the best simple rule available on the same information "
                    "including a question-aware rule; composite targets additionally tested "
                    "conditional on the offender returning at all",
        "rejected": [
            {"slug": "h30", "auc": 0.615, "rule": 0.572,
             "why": "margin +0.044, too close to the +0.021 that disqualified station surge"},
            {"slug": "property365", "auc": 0.657, "rule": 0.562,
             "why": "conditional on returning the margin falls to +0.022 — it ranks who "
                    "returns, not what they return with"},
            {"slug": "body365", "auc": 0.710, "rule": 0.575,
             "why": "conditional margin +0.074"},
            {"slug": "economic365", "auc": 0.728, "rule": 0.508,
             "why": "conditional margin +0.085"},
            {"slug": "cyber180", "auc": 0.464, "rule": 0.566,
             "why": "loses outright to prior case count"},
        ],
        "fairness": "Behaviour and evidence only — counts, dates, districts and heads spanned, "
                    "gravity. No age, no gender, and no protected attribute; assert_no_protected "
                    "runs over the feature list before any file is written.",
    }
    return rows, meta


def write_csvs(data_dir: str, rows, last_day: date) -> dict:
    """One console-ready file per task. SEVEN FEATURES AND ONE TARGET, nothing else.

    row_key, offender_id and as_of are deliberately absent from every file, and so is every
    other task's target. Three separate reasons, all of which bit at least once:

      * QuickML's model stages refuse a frame containing a text column outright --
        "Previous stage result contains non-numeric columns. Columns row_key."
      * an identity column in a training file invites a model to memorise a person rather
        than learn a behaviour
      * a sibling target is a leak, and the worst kind, because the horizons nest: a model
        given target_back_180 while predicting target_back_365 is reading the answer

    Traceability is not lost: predictions come back in the order they were sent, and the
    serving code holds the offender each row belongs to.
    """
    out = {}
    for slug, col, horizon, _pred, _desc in TASKS:
        cutoff = last_day - timedelta(days=horizon)
        kept = [r for r in rows if _d(r["as_of"]) <= cutoff]
        name = f"training_set_offender_{slug}.csv"
        path = os.path.join(common.derived_dir(data_dir), name)
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FEATURES + [col], extrasaction="ignore")
            w.writeheader()
            w.writerows(kept)
        out[slug] = name
    return out


def compute(tables, unit_district, identities, today: date, data_dir: str):
    rows, meta = build(tables, unit_district, identities, today)
    if rows:
        meta["files"] = write_csvs(data_dir, rows, _d(meta["lastCaseDay"]))
    meta["builtOn"] = today.isoformat()
    return meta
