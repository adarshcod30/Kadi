"""
offender_set.py — the training set for the repeat-offending model.

WHAT THIS ANSWERS, AND WHY IT IS THE ONE THAT SURVIVED.

Six candidate forecasting tasks were built and scored against the BEST simple rule available
on the same information, on time-ordered hold-outs. Five lost:

    task                                   model    best rule                 verdict
    disposal within 90 days                0.520    0.527 sub-head history    loses
    station surge next month               0.738    0.717 inverse volume      artefact
    location re-victimisation (14d)        0.621    0.632 26-week rate        loses
    cross-district escalation              0.586    0.691 district share      loses
    early linkage at registration          0.930    0.929 sub-head history    +0.002
    REPEAT OFFENDING within 180 days       0.827    0.562 recency             WINS

Two of those deserve a note, because both look like wins until the baseline is chosen fairly.
Station surge scores 0.738 against the z-score rule's 0.504 -- but "inverse recent level" alone
scores 0.717, because a target of "40% above the trailing mean" is simply easier to hit on a
small register. Strip absolute volumes from the features and the model falls to 0.583, BELOW
the rule: it was learning station size. Early linkage scores 0.930, and the sub-head's own
history scores 0.929, because the linkage pipeline keys on modus operandi and MO is derived
from the sub-head -- the target is very nearly a function of one input column.

Repeat offending is the one with a real margin: +0.265 AUC and +0.274 average precision over
recency, which is the honest baseline here ("who was active lately" explains most of who is
active next).

THE MEASUREMENT ALSO CAUGHT A LEAK IN ITS OWN FIRST DRAFT, which is why the feature list is
shorter than it looks like it should be. coOffenders and arrestCount live on the offender
record and are LIFETIME totals -- computed over every case including ones registered after the
observation date. Including them scored 0.851; they were telling the model how active this
person turned out to be. Removed, it holds at 0.827.

CAVEAT WORTH KEEPING: some of this margin may be the corpus generator giving each offender a
stable offending rate, which (prior_cases, span_days) then recovers almost exactly. The same
circularity the socio-economic panel already declares about urbanisation. On real KSP data the
margin should be re-measured before anyone relies on the number.

FAIRNESS: behaviour and evidence only. Counts, dates, districts spanned, crime heads spanned,
gravity. No age, no gender -- which the risk score also excludes, and widening that quietly in
a training set would be a policy change made in the wrong place -- and none of the protected
columns, asserted before the file is written.
"""
from __future__ import annotations

import csv
import os
from datetime import date, timedelta

import common

HORIZON_DAYS = 180      # "will they be back within six months"
WARMUP_DAYS = 365       # no observations until the corpus has a year of history behind it
STEP_DAYS = 30          # observation cadence
MIN_PRIOR = 1           # a person is only observable once police know of them

# The contract with the serving code. Order matters: functions/api/services/offenderrisk.js
# sends these names, and the endpoint validates against what it was trained from.
FEATURES = [
    "prior_cases",       # how many FIRs this identity carries as at the observation date
    "days_since_last",   # recency, which is the single strongest simple predictor
    "span_days",         # how long they have been known
    "rate_per_yr",       # prior_cases over years known -- their own tempo
    "n_districts",       # how far they range
    "n_heads",           # how varied their offending is
    "heinous",           # how serious, by recorded gravity
]
LABELS = ["row_key", "offender_id", "as_of"]
TARGET = "target_reoffend_180"


def _d(iso: str):
    try:
        return date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))
    except (ValueError, TypeError, IndexError):
        return None


def build(tables, unit_district, identities, today: date):
    """Build the offender x observation-date panel.

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

    first_day = min(reg_of.values())
    last_day = max(reg_of.values())
    start = first_day + timedelta(days=WARMUP_DAYS)
    # Stop a full horizon before the end of the corpus. An observation date closer than that
    # has an incomplete future and its label would read as "did not reoffend" purely because
    # the data stops -- the same censoring mistake as counting a partial trailing month.
    end = last_day - timedelta(days=HORIZON_DAYS)

    obs_dates = []
    t = start
    while t <= end:
        obs_dates.append(t)
        t += timedelta(days=STEP_DAYS)

    # ONLY the repeat-offender population -- identities carrying two or more resolved cases,
    # which is the same filter the watchlist uses.
    #
    # This is not a convenience. Built over all 39,981 resolved identities the panel is 664,032
    # rows at a 0.7% positive rate, because most identities are one FIR and never return: a
    # different and far weaker problem than the one that was measured, and one whose "winner"
    # would be a model that always answers no. The measurement that earned this model its place
    # was run on the 578 repeat offenders, so the training set has to be that same population
    # or the AUC on the tin describes something else.
    repeat = [i for i in identities if len({str(c) for c in i.get("caseIds", [])}) >= 2]

    rows = []
    for ident in repeat:
        dated = sorted(d for d in (reg_of.get(str(c)) for c in ident.get("caseIds", [])) if d)
        if not dated:
            continue
        case_ids = [str(c) for c in ident.get("caseIds", []) if reg_of.get(str(c))]
        paired = sorted(zip(dated, case_ids))
        for t in obs_dates:
            prior = [(d, c) for d, c in paired if d <= t]
            if len(prior) < MIN_PRIOR:
                continue
            future = [d for d, _ in paired if 0 < (d - t).days <= HORIZON_DAYS]
            first = prior[0][0]
            span = (t - first).days
            ids = [c for _, c in prior]
            rows.append({
                "row_key": f"{ident['offenderIdentityId']}|{t.isoformat()}",
                "offender_id": ident["offenderIdentityId"],
                "as_of": t.isoformat(),
                "prior_cases": len(prior),
                "days_since_last": (t - prior[-1][0]).days,
                "span_days": span,
                "rate_per_yr": round(len(prior) / max(1.0, span / 365.25), 4),
                "n_districts": len({did_of.get(c) for c in ids if did_of.get(c)}),
                "n_heads": len({head_of.get(c) for c in ids if head_of.get(c)}),
                "heinous": sum(1 for c in ids if grav_of.get(c) == "1"),
                TARGET: 1 if future else 0,
            })

    common.assert_no_protected(FEATURES)
    pos = sum(r[TARGET] for r in rows)
    meta = {
        "task": "repeat offending — will this resolved offender appear on a new FIR within "
                f"{HORIZON_DAYS} days?",
        "grain": "repeat offender (2+ resolved cases) x observation date",
        "population": f"{len(repeat):,} repeat offenders of {len(identities):,} resolved identities",
        "rows": len(rows),
        "offenders": len({r["offender_id"] for r in rows}),
        "observationDates": len(obs_dates),
        "stepDays": STEP_DAYS,
        "horizonDays": HORIZON_DAYS,
        "positives": pos,
        "positiveRate": round(100 * pos / len(rows), 1) if rows else 0.0,
        "monthFrom": obs_dates[0].isoformat() if obs_dates else None,
        "monthTo": obs_dates[-1].isoformat() if obs_dates else None,
        "features": FEATURES,
        # Measured on THIS FILE, not on the research prototype. The prototype sampled
        # quarterly and scored 0.827; sampling every 30 days as here gives more rows but more
        # overlapping horizons, and scores 0.769. The number that ships has to be the one the
        # shipped file produces, or it is describing a dataset nobody trained on.
        "measured": {
            "modelAuc": 0.769, "modelAp": 0.589,
            "baselineName": "recency (days since last case)",
            "baselineAuc": 0.565, "baselineAp": 0.401,
            "protocol": "time-ordered hold-out, last quartile of observation dates, LightGBM "
                        "at small-data settings",
            "note": "The research prototype scored 0.827 at quarterly sampling; this file "
                    "samples every 30 days. Both beat recency by a wide margin.",
        },
        "fairness": "Behaviour and evidence only — counts, dates, districts and heads spanned, "
                    "gravity. No age, no gender, and no protected attribute; assert_no_protected "
                    "runs over the feature list before the file is written.",
    }
    return rows, meta


def write_csv(data_dir: str, rows, name: str = "training_set_offender.csv") -> str:
    """Console-ready: the seven features and the target. NUMERIC COLUMNS ONLY.

    row_key is deliberately absent, and that is not a style choice. QuickML's model stages
    refuse a frame containing a text column -- "Previous stage result contains non-numeric
    columns. Columns row_key." -- so a key column forces an extra Select/Drop stage into every
    pipeline built on this file. Leaving it out makes the pipeline Source -> model and the
    scoring payload seven numbers, with nothing to keep in step.

    Traceability is not lost: predictions come back in the order they were sent, and the
    serving code holds the offender each row belongs to. offender_id and as_of are likewise
    absent -- an identity column in a training file is an invitation for a model to memorise a
    person rather than learn a behaviour.
    """
    header = FEATURES + [TARGET]
    path = os.path.join(common.derived_dir(data_dir), name)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return path


def compute(tables, unit_district, identities, today: date, data_dir: str):
    rows, meta = build(tables, unit_district, identities, today)
    if rows:
        meta["path"] = write_csv(data_dir, rows)
        meta["file"] = "training_set_offender.csv"
    meta["builtOn"] = today.isoformat()
    return meta
