"""
measure_bd.py — second pass on the two tasks the first pass could not settle.

Two problems surfaced in measure_candidates.py and both change the answer:

  B  The target `n > 1.4 * roll_3` is EASIER TO HIT WHEN A STATION IS SMALL: a register
     averaging 5 needs 7 to "spike", one averaging 50 needs 70. So "inverse recent level"
     scored 0.717 AUC on its own -- most of the apparent signal was the model learning that
     quiet stations spike more often, which is an artefact of the label, not intelligence.
     A scale-free target is tested here alongside it.

  D  PersonID in Accused.csv is a within-case index -- three distinct values across 54,337
     rows, not a person. The offender panel built on it collapsed to 27 rows. Real identities
     come from the entity-resolution pipeline (derived/offenders.json, 578 of them).

Same rules as before: time-ordered splits, best-available simple rule as the baseline, no
protected attribute anywhere near a feature.
"""
import json
import os

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score
import lightgbm as lgb

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "output")
DERIVED = os.path.join(HERE, "..", "functions", "api", "data", "derived")
BANNED = {"ReligionID", "CasteID", "OccupationID"}


def fit_clf(X, y, Xte, yte):
    if len(set(y)) < 2 or len(set(yte)) < 2:
        return None
    m = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=15,
                           min_child_samples=25, subsample=0.9, colsample_bytree=0.8,
                           verbose=-1, random_state=7)
    m.fit(X, y)
    p = m.predict_proba(Xte)[:, 1]
    return {"auc": roc_auc_score(yte, p), "ap": average_precision_score(yte, p)}


def best_rule(y, cands):
    scored = {k: roc_auc_score(y, v) for k, v in cands.items()}
    b = max(scored, key=scored.get)
    return b, {"auc": scored[b], "ap": average_precision_score(y, cands[b])}, scored


def verdict(name, question, n, rate, model, base, base_name, all_rules):
    print(f"\n{'=' * 78}\n{name}\n  question : {question}\n  rows     : {n:,}   positive rate: {rate:.1%}")
    print("  rules    : " + ", ".join(f"{k} {v:.3f}" for k, v in all_rules.items()))
    if model is None:
        print("  RESULT   : degenerate")
        return False
    wins = True
    for k in ("auc", "ap"):
        better = model[k] > base[k]
        wins = wins and better
        print(f"  {k:4}     : model {model[k]:.3f}  vs best rule ({base_name}) {base[k]:.3f}"
              f"  -> {'WINS ' if better else 'loses'}   margin {model[k] - base[k]:+.3f}")
    return wins


cases = pd.read_csv(os.path.join(DATA, "CaseMaster.csv"), low_memory=False)
units = pd.read_csv(os.path.join(DATA, "Unit.csv"), low_memory=False)
cases["reg"] = pd.to_datetime(cases["CrimeRegisteredDate"], errors="coerce")
ASOF = cases["reg"].max()
cases["did"] = cases["PoliceStationID"].astype(str).map(
    dict(zip(units["UnitID"].astype(str), units["DistrictID"].astype(str))))
cases["ym"] = cases["reg"].dt.to_period("M").astype(str)
print(f"corpus asOf {ASOF.date()}  cases {len(cases):,}")

# =======================================================================================
# B — STATION SURGE, with the label artefact removed.
# =======================================================================================
sm = cases.groupby(["PoliceStationID", "ym"]).size().rename("n").reset_index()
months = sorted(sm["ym"].unique())[:-1]
sm = sm[sm["ym"].isin(months)]
grid = (pd.MultiIndex.from_product([sm["PoliceStationID"].unique(), months],
                                   names=["PoliceStationID", "ym"]).to_frame(index=False)
        .merge(sm, how="left").fillna({"n": 0}).sort_values(["PoliceStationID", "ym"])
        .reset_index(drop=True))
g = grid.groupby("PoliceStationID")["n"]
for k in (1, 2, 3, 6, 12):
    grid[f"lag_{k}"] = g.shift(k)
for w in (3, 6, 12):
    grid[f"roll_{w}"] = g.shift(1).rolling(w).mean().reset_index(0, drop=True)
grid["std_6"] = g.shift(1).rolling(6).std().reset_index(0, drop=True)
grid["std_12"] = g.shift(1).rolling(12).std().reset_index(0, drop=True)
grid["p90_12"] = g.shift(1).rolling(12).quantile(0.9).reset_index(0, drop=True)
grid["mi"] = grid["ym"].map({m: i for i, m in enumerate(months)})
grid["moy"] = grid["ym"].str[5:7].astype(int)
grid["accel"] = grid["roll_3"] / grid["roll_12"].replace(0, np.nan)
grid["cv"] = grid["std_12"] / grid["roll_12"].replace(0, np.nan)      # how noisy this register is
grid["z_prev"] = (grid["lag_1"] - grid["roll_6"]) / grid["std_6"].replace(0, np.nan)
grid = grid.dropna(subset=["roll_12", "std_12", "lag_12", "p90_12"]).copy()

FEAT_B = ["lag_1", "lag_2", "lag_3", "lag_6", "lag_12", "roll_3", "roll_6", "roll_12",
          "std_6", "std_12", "cv", "moy", "accel", "z_prev"]

TARGETS = {
    # what ships today, at station grain
    "ratio  n > 1.4 x roll_3": ((grid["roll_3"] >= 5) & (grid["n"] > 1.4 * grid["roll_3"])).astype(int),
    # scale-free: unusually busy FOR THIS REGISTER, whatever its size
    "z      n > roll_12 + 2sd": (grid["n"] > grid["roll_12"] + 2 * grid["std_12"]).astype(int),
    # the same idea stated the way a supervisor would: above its own worst normal month
    "p90    n > own 12mo p90": (grid["n"] > grid["p90_12"]).astype(int),
}
# Ratios only -- no absolute level anywhere. "inverse recent level" scoring 0.717 on its own
# means the label rewards small registers, so a model handed lag_1..roll_12 can win by learning
# station size. Stripping levels asks whether anything else is there.
FEAT_B_SCALEFREE = ["cv", "moy", "accel", "z_prev", "r31", "r16", "r_last_3"]
grid["r31"] = grid["roll_3"] / grid["roll_12"].replace(0, np.nan)
grid["r16"] = grid["lag_1"] / grid["roll_6"].replace(0, np.nan)
grid["r_last_3"] = grid["lag_1"] / grid["roll_3"].replace(0, np.nan)

cutb = sorted(grid["ym"].unique())[-4]
for tname, tgt in TARGETS.items():
    grid["y"] = tgt
    trb, teb = grid[grid["ym"] < cutb], grid[grid["ym"] >= cutb]
    m = fit_clf(trb[FEAT_B], trb["y"], teb[FEAT_B], teb["y"])
    msf = fit_clf(trb[FEAT_B_SCALEFREE].fillna(0), trb["y"],
                  teb[FEAT_B_SCALEFREE].fillna(0), teb["y"])
    cands = {
        "z of last month": teb["z_prev"].fillna(0),
        "acceleration 3/12": teb["accel"].fillna(1),
        "inverse recent level": -teb["roll_3"].fillna(0),
        "volatility (cv)": teb["cv"].fillna(0),
    }
    bname, base, allr = best_rule(teb["y"], cands)
    verdict(f"B. STATION SURGE — target: {tname}",
            "will this station be unusually busy next month?",
            len(grid), grid["y"].mean(), m, base, bname, allr)
    if msf:
        print(f"  scale-free feature set only: auc {msf['auc']:.3f}  ap {msf['ap']:.3f}"
              f"   -> {'still beats the rule' if msf['auc'] > base['auc'] else 'COLLAPSES — the win was station size'}")

# =======================================================================================
# D — REPEAT OFFENDING, on the ENTITY-RESOLVED identities rather than the raw PersonID.
# =======================================================================================
offs = json.load(open(os.path.join(DERIVED, "offenders.json")))
reg_of_case = dict(zip(cases["CaseMasterID"].astype(str), cases["reg"]))
did_of_case = dict(zip(cases["CaseMasterID"].astype(str), cases["did"]))
head_of_case = dict(zip(cases["CaseMasterID"].astype(str), cases["CrimeMajorHeadID"]))
grav_of_case = dict(zip(cases["CaseMasterID"].astype(str), cases["GravityOffenceID"]))

obs = pd.date_range(cases["reg"].min() + pd.Timedelta(days=365),
                    ASOF - pd.Timedelta(days=180), freq="QS")
rows = []
for o in offs:
    dated = sorted([(reg_of_case.get(str(c)), str(c)) for c in o.get("caseIds", [])
                    if reg_of_case.get(str(c)) is not None])
    if not dated:
        continue
    for t in obs:
        prior = [(d, c) for d, c in dated if d <= t]
        if not prior:
            continue
        future = [d for d, _ in dated if 0 < (d - t).days <= 180]
        pc = [c for _, c in prior]
        rows.append({
            "t": t,
            "prior_cases": len(prior),
            "days_since_last": (t - prior[-1][0]).days,
            "span_days": (t - prior[0][0]).days,
            "rate_per_yr": len(prior) / max(1.0, (t - prior[0][0]).days / 365.25),
            "n_districts": len({did_of_case.get(c) for c in pc}),
            "n_heads": len({head_of_case.get(c) for c in pc}),
            "heinous": sum(1 for c in pc if grav_of_case.get(c) == 1),
            "y": int(bool(future)),
        })
off = pd.DataFrame(rows).sort_values("t")
# coOffenders and arrestCount were removed after the first run scored 0.851 AUC. Both are
# LIFETIME totals on the offender record -- computed over every case including ones registered
# after t -- so they told the model how active this person turned out to be. A +0.29 margin
# over recency was the tell: nothing about a person's past is that predictive of their next
# six months.
FEAT_D = ["prior_cases", "days_since_last", "span_days", "rate_per_yr",
          "n_districts", "n_heads", "heinous"]
assert not BANNED.intersection(set(FEAT_D))
cutd = off["t"].quantile(0.75)
trd, ted = off[off["t"] <= cutd], off[off["t"] > cutd]
mD = fit_clf(trd[FEAT_D], trd["y"], ted[FEAT_D], ted["y"])
cands_d = {
    "recency (-days since last)": -ted["days_since_last"],
    "offending rate/yr": ted["rate_per_yr"],
    "prior case count": ted["prior_cases"],
}
bd, based, alld = best_rule(ted["y"], cands_d)
verdict("D. REPEAT OFFENDING (resolved offender x quarter)",
        "will this known offender appear on a new FIR within 180 days?",
        len(off), off["y"].mean(), mD, based, bd, alld)
