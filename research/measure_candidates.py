"""
measure_candidates.py — does each proposed forecasting model actually beat its honest baseline?

NOT SHIPPED CODE. This is the evidence behind which models the Forecast tab serves, kept in
the repo because the alternative is a claim nobody can check. It needs pandas/sklearn/lightgbm,
which the deployed AppSail container deliberately does not have; run it locally.

    python3 research/measure_candidates.py

The bar is the one the existing pipeline already set: four tasks were built, three lost to a
one-line baseline and were dropped. A model that cannot beat a rule is worse than no model,
because it reads as capability while adding failure modes and a serving dependency.

Every task is scored on a TIME-ORDERED hold-out, never a random split. Crime series are
autocorrelated: a random split lets a model see the future of the same series it is predicting,
and every task below would look substantially better than it is.

FAIRNESS: no caste, religion or occupation reaches any feature set, enforced by check_fair().
Person age and gender are excluded from the offender task as well — the risk score already
works to "behaviour and evidence only", and quietly widening that here would be a change of
policy made in a research script.
"""
import os
from datetime import timedelta

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score
import lightgbm as lgb

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "output")
BANNED = {"ReligionID", "CasteID", "OccupationID"}


def load(name):
    return pd.read_csv(os.path.join(DATA, f"{name}.csv"), low_memory=False)


def check_fair(cols):
    bad = BANNED.intersection(set(cols))
    if bad:
        raise SystemExit(f"FAIRNESS VIOLATION: {sorted(bad)}")


def fit_clf(X, y, Xte, yte):
    """LightGBM at small-data settings. The corpus gives thousands of rows, not millions."""
    if len(set(y)) < 2 or len(set(yte)) < 2:
        return None
    m = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=15,
                           min_child_samples=30, subsample=0.9, colsample_bytree=0.8,
                           verbose=-1, random_state=7)
    m.fit(X, y)
    p = m.predict_proba(Xte)[:, 1]
    return {"auc": roc_auc_score(yte, p), "ap": average_precision_score(yte, p)}


RESULTS = []


def report(key, name, question, n, pos_rate, model, base, base_name, note=""):
    print(f"\n{'=' * 78}\n{name}\n  question : {question}\n  rows     : {n:,}"
          f"{f'   positive rate: {pos_rate:.1%}' if pos_rate is not None else ''}")
    if model is None:
        print("  RESULT   : could not evaluate (degenerate split)")
        RESULTS.append((key, name, "n/a", False))
        return
    wins = True
    for k in ("auc", "ap"):
        b = base.get(k)
        better = model[k] > b
        wins = wins and better
        print(f"  {k:4}     : model {model[k]:.3f}   vs {base_name} {b:.3f}   -> {'WINS ' if better else 'loses'}")
    if note:
        print(f"  note     : {note}")
    RESULTS.append((key, name, f"auc {model['auc']:.3f} vs {base['auc']:.3f}", wins))


print("loading corpus ...")
cases = load("CaseMaster")
cs = load("ChargesheetDetails")
acc = load("Accused")
vic = load("Victim")
secs = load("ActSectionAssociation")
units = load("Unit")

cases["reg"] = pd.to_datetime(cases["CrimeRegisteredDate"], errors="coerce")
cases["inc"] = pd.to_datetime(cases["IncidentFromDate"], errors="coerce")
cs["csd"] = pd.to_datetime(cs["csdate"], errors="coerce")

ASOF = cases["reg"].max()
print(f"corpus asOf = {ASOF.date()}   cases = {len(cases):,}")

unit_district = dict(zip(units["UnitID"].astype(str), units["DistrictID"].astype(str)))
cases["did"] = cases["PoliceStationID"].astype(str).map(unit_district)
cases["csd"] = cases["CaseMasterID"].map(cs.groupby("CaseMasterID")["csd"].min())
cases["days_to_cs"] = (cases["csd"] - cases["reg"]).dt.days

n_acc = acc.groupby("CaseMasterID").size()
n_vic = vic.groupby("CaseMasterID").size()
n_sec = secs.groupby("CaseMasterID").size()

# =======================================================================================
# A — DISPOSAL-IN-WINDOW RISK, decided at REGISTRATION.
#
# The question an SHO has on day one, and the metric NCRB actually reports on: will this file
# be charge-sheeted inside its statutory window, or turn into pendency? Every feature is
# knowable the day the FIR is written; nothing that happened afterwards leaks in.
# =======================================================================================
WINDOW = 90
elig = cases[cases["reg"] <= ASOF - timedelta(days=WINDOW)].copy()
elig["y"] = ((elig["days_to_cs"].notna()) & (elig["days_to_cs"] <= WINDOW)).astype(int)
elig["report_delay"] = (elig["reg"] - elig["inc"]).dt.days.clip(-5, 400).fillna(0)
elig["n_acc"] = elig["CaseMasterID"].map(n_acc).fillna(0)
elig["n_vic"] = elig["CaseMasterID"].map(n_vic).fillna(0)
elig["n_sec"] = elig["CaseMasterID"].map(n_sec).fillna(0)
elig["month"] = elig["reg"].dt.month
elig["dow"] = elig["reg"].dt.dayofweek
elig = elig.sort_values("reg").reset_index(drop=True)


def expanding_rate(df, key, target):
    """Track record from rows registered STRICTLY EARLIER.

    An ordinary group mean would hand the model the answer for the row it is scoring. The
    expanding mean is the only honest way to give it "how this station usually performs".
    """
    csum = df.groupby(key)[target].cumsum() - df[target]
    ccnt = df.groupby(key).cumcount()
    return (csum / ccnt.replace(0, np.nan)).fillna(df[target].mean())


elig["stn_rate"] = expanding_rate(elig, "PoliceStationID", "y")
elig["io_rate"] = expanding_rate(elig, "PolicePersonID", "y")
elig["sub_rate"] = expanding_rate(elig, "CrimeMinorHeadID", "y")

FEAT_A = ["CrimeMajorHeadID", "CrimeMinorHeadID", "GravityOffenceID", "CaseCategoryID",
          "PoliceStationID", "month", "dow", "report_delay", "n_acc", "n_vic", "n_sec",
          "stn_rate", "io_rate", "sub_rate"]
check_fair(FEAT_A)
cut = elig["reg"].quantile(0.75)
tr, te = elig[elig["reg"] <= cut], elig[elig["reg"] > cut]
mA = fit_clf(tr[FEAT_A], tr["y"], te[FEAT_A], te["y"])
# The honest baseline is what an experienced officer already knows: thefts here usually go in
# on time, dowry cases do not. If the model cannot beat the sub-head's own history it is
# adding nothing to that officer's judgement.
baseA = {"auc": roc_auc_score(te["y"], te["sub_rate"]),
         "ap": average_precision_score(te["y"], te["sub_rate"])}
report("A", "A. DISPOSAL-IN-WINDOW RISK (case, at registration)",
       f"will this FIR be charge-sheeted within {WINDOW} days?",
       len(elig), elig["y"].mean(), mA, baseA, "sub-head history")

# =======================================================================================
# B — STATION SURGE. The station-rank sibling of the district x head spike classifier that
# already exists, so an SHO and an SP get a warning about their own ground.
# =======================================================================================
cases["ym"] = cases["reg"].dt.to_period("M").astype(str)
sm = cases.groupby(["PoliceStationID", "ym"]).size().rename("n").reset_index()
months = sorted(sm["ym"].unique())[:-1]                      # drop the trailing partial month
sm = sm[sm["ym"].isin(months)]
grid = (pd.MultiIndex.from_product([sm["PoliceStationID"].unique(), months],
                                   names=["PoliceStationID", "ym"]).to_frame(index=False)
        .merge(sm, how="left").fillna({"n": 0}).sort_values(["PoliceStationID", "ym"]))
g = grid.groupby("PoliceStationID")["n"]
for k in (1, 2, 3, 12):
    grid[f"lag_{k}"] = g.shift(k)
grid["roll_3"] = g.shift(1).rolling(3).mean().reset_index(0, drop=True)
grid["roll_6"] = g.shift(1).rolling(6).mean().reset_index(0, drop=True)
grid["roll_12"] = g.shift(1).rolling(12).mean().reset_index(0, drop=True)
grid["std_6"] = g.shift(1).rolling(6).std().reset_index(0, drop=True)
grid["mi"] = grid["ym"].map({m: i for i, m in enumerate(months)})
grid["moy"] = grid["ym"].str[5:7].astype(int)
grid["accel"] = grid["roll_3"] / grid["roll_12"].replace(0, np.nan)
grid = grid.dropna(subset=["roll_12", "std_6", "lag_12"])
grid["y"] = ((grid["roll_3"] >= 5) & (grid["n"] > 1.4 * grid["roll_3"])).astype(int)
FEAT_B = ["lag_1", "lag_2", "lag_3", "lag_12", "roll_3", "roll_6", "roll_12",
          "std_6", "mi", "moy", "accel"]
cutb = sorted(grid["ym"].unique())[-4]
trb, teb = grid[grid["ym"] < cutb], grid[grid["ym"] >= cutb]
mB = fit_clf(trb[FEAT_B], trb["y"], teb[FEAT_B], teb["y"])
# Compete against the BEST simple rule available on the same information, not merely the one
# the product happens to use today. Beating a badly-chosen baseline proves nothing.
cands = {
    "z-score (lag1 vs 6mo)": ((teb["lag_1"] - teb["roll_6"]) / teb["std_6"].replace(0, np.nan)).fillna(0),
    "acceleration 3/12": (teb["roll_3"] / teb["roll_12"].replace(0, np.nan)).fillna(1),
    "inverse recent level": -teb["roll_3"].fillna(0),
}
scored_b = {k: roc_auc_score(teb["y"], v) for k, v in cands.items()}
best_b = max(scored_b, key=scored_b.get)
zb = cands[best_b]
baseB = {"auc": roc_auc_score(teb["y"], zb), "ap": average_precision_score(teb["y"], zb)}
print(f"  [best simple rule for B: {best_b} — all: "
      + ", ".join(f'{k} {v:.3f}' for k, v in scored_b.items()) + "]")
report("B", "B. STATION SURGE (station x month)",
       "will this station run >=40% above its own 3-month mean next month?",
       len(grid), grid["y"].mean(), mB, baseB, f"best rule ({best_b})")

# =======================================================================================
# C — LOCATION RE-VICTIMISATION. Near-repeat as a forecast rather than a description.
# The baseline is PERSISTENCE, which is the honest one here and is genuinely hard to beat:
# "somewhere that had a crime recently will have another" is most of the signal.
# =======================================================================================
geo = cases.dropna(subset=["latitude", "longitude", "reg"]).copy()
geo["cell"] = geo["latitude"].round(2).astype(str) + "_" + geo["longitude"].round(2).astype(str)
geo["wk"] = geo["reg"].dt.to_period("W").astype(str)
cw = geo.groupby(["cell", "wk"]).size().rename("n").reset_index()
weeks = sorted(cw["wk"].unique())
busy = cw.groupby("cell")["n"].sum()
busy = busy[busy >= 20].index
cg = (pd.MultiIndex.from_product([busy, weeks], names=["cell", "wk"]).to_frame(index=False)
      .merge(cw[cw["cell"].isin(busy)], how="left").fillna({"n": 0})
      .sort_values(["cell", "wk"]))
gc = cg.groupby("cell")["n"]
cg["l1"], cg["l2"], cg["l3"] = gc.shift(1), gc.shift(2), gc.shift(3)
cg["r4"] = gc.shift(1).rolling(4).mean().reset_index(0, drop=True)
cg["r12"] = gc.shift(1).rolling(12).mean().reset_index(0, drop=True)
cg["r26"] = gc.shift(1).rolling(26).mean().reset_index(0, drop=True)
cg["wi"] = cg["wk"].map({w: i for i, w in enumerate(weeks)})
cg["y"] = ((gc.shift(-1).fillna(0) + gc.shift(-2).fillna(0)) > 0).astype(int)
cg = cg.dropna(subset=["r26"])
FEAT_C = ["l1", "l2", "l3", "r4", "r12", "r26", "wi"]
cutc = weeks[int(len(weeks) * 0.75)]
trc = cg[cg["wk"] < cutc]
tec = cg[(cg["wk"] >= cutc) & (cg["wk"] < weeks[-2])]
mC = fit_clf(trc[FEAT_C], trc["y"], tec[FEAT_C], tec["y"])
baseC = {"auc": roc_auc_score(tec["y"], tec["r4"]),
         "ap": average_precision_score(tec["y"], tec["r4"])}
report("C", "C. LOCATION RE-VICTIMISATION (cell x week)",
       "will this ~1 km cell see another incident in the next 14 days?",
       len(cg), cg["y"].mean(), mC, baseC, "recent-4-week rate")

# =======================================================================================
# D — REPEAT OFFENDING. Does a named accused reappear on a NEW FIR within 180 days?
# Person-level, so the fairness bar is highest: behaviour and evidence only. No age, no
# gender, and none of the protected columns.
# =======================================================================================
ac = (acc.merge(cases[["CaseMasterID", "reg", "did", "GravityOffenceID", "CrimeMajorHeadID"]],
                on="CaseMasterID", how="left")
      .dropna(subset=["reg", "PersonID"]).sort_values("reg"))

# A PANEL, not one row per case. The first attempt built a row for every case except an
# offender's last and asked whether the next one came within 180 days -- which made every row
# positive by construction (100% base rate, degenerate split). Observing every known offender
# at fixed quarterly dates is what creates real negatives: the people who were around and did
# NOT come back.
obs_dates = pd.date_range(ac["reg"].min() + pd.Timedelta(days=365),
                          ASOF - pd.Timedelta(days=180), freq="QS")
by_person = {pid: g.sort_values("reg") for pid, g in ac.groupby("PersonID")}
rows = []
for pid, g2 in by_person.items():
    regs = g2["reg"].tolist()
    for t in obs_dates:
        prior_mask = [r <= t for r in regs]
        k = sum(prior_mask)
        if k == 0:
            continue                                  # not yet known to police at time t
        prior = g2.iloc[:k]
        first, last = regs[0], regs[k - 1]
        span = max(1.0, (t - first).days / 365.25)
        future = [r for r in regs[k:] if (r - t).days <= 180]
        rows.append({
            "t": t,
            "prior_cases": k,
            "span_days": (t - first).days,
            "rate_per_yr": k / span,
            "days_since_last": (t - last).days,
            "n_districts": prior["did"].nunique(),
            "n_heads": prior["CrimeMajorHeadID"].nunique(),
            "heinous": int((prior["GravityOffenceID"] == 1).sum()),
            "y": int(bool(future)),
        })
off = pd.DataFrame(rows).sort_values("t")
FEAT_D = ["prior_cases", "span_days", "rate_per_yr", "days_since_last",
          "n_districts", "n_heads", "heinous"]
check_fair(FEAT_D)
cutd = off["t"].quantile(0.75)
trd, ted = off[off["t"] <= cutd], off[off["t"] > cutd]
mD = fit_clf(trd[FEAT_D], trd["y"], ted[FEAT_D], ted["y"])
# Recency is the honest baseline here and it is a strong one: "who was active lately" explains
# most of who is active next. A risk model has to beat that or it is just re-deriving it.
cands_d = {
    "recency (-days since last)": -ted["days_since_last"],
    "offending rate/yr": ted["rate_per_yr"],
    "prior case count": ted["prior_cases"],
}
scored_d = {k: roc_auc_score(ted["y"], v) for k, v in cands_d.items()}
best_d = max(scored_d, key=scored_d.get)
baseD = {"auc": roc_auc_score(ted["y"], cands_d[best_d]),
         "ap": average_precision_score(ted["y"], cands_d[best_d])}
print("  [best simple rule for D: " + best_d + " — all: "
      + ", ".join(f'{k} {v:.3f}' for k, v in scored_d.items()) + "]")
report("D", "D. REPEAT OFFENDING (offender x quarter)",
       "will this known offender appear on a new FIR within 180 days?",
       len(off), off["y"].mean(), mD, baseD, f"best rule ({best_d})")

print("\n" + "=" * 78 + "\nVERDICT — only tasks winning on BOTH auc and ap are worth shipping\n")
for key, name, score, wins in RESULTS:
    print(f"  {key}  {'SHIP ' if wins else 'DROP '}  {score:26}  {name.split('. ', 1)[1]}")
