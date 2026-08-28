"""
measure_more.py — a second sweep, because "seven tasks" was where I stopped, not where the
space ended.

Two shipped out of seven is a defensible result only if the seven were a fair sample. This
file tests the tasks the first sweep did not reach, and one whole family it missed: the
repeat-offending model works at 180 days, so the obvious question is whether it works at other
horizons. "Who is back this month" and "who is back this year" are different operational
products for different posts, not one model shown twice.

    G  offender risk at 30 / 90 / 365 days   — same features, different horizon
    H  offender risk BY CRIME FAMILY         — who returns with a property crime specifically
    I  victim-side repeat victimisation      — does a victim reappear as a victim
    J  IO caseload breach                    — will this officer's pending pile grow
    K  co-offender link prediction           — will these two appear on a case together

Same bar as before: time-ordered hold-out, best simple rule as the baseline, no protected
attribute anywhere near a feature.
"""
import json
import os
from datetime import timedelta

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score
import lightgbm as lgb

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "output")
DERIVED = os.path.join(HERE, "..", "functions", "api", "data", "derived")
BANNED = {"ReligionID", "CasteID", "OccupationID"}
RESULTS = []


def fit(X, y, Xte, yte):
    if len(set(y)) < 2 or len(set(yte)) < 2:
        return None
    m = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=15,
                           min_child_samples=25, subsample=0.9, colsample_bytree=0.8,
                           verbose=-1, random_state=7)
    m.fit(X, y)
    p = m.predict_proba(Xte)[:, 1]
    return {"auc": roc_auc_score(yte, p), "ap": average_precision_score(yte, p)}


def verdict(key, name, question, n, rate, model, rules, yte):
    print(f"\n{'=' * 78}\n{name}\n  question : {question}\n  rows     : {n:,}   positive rate: {rate:.1%}")
    if model is None or not len(rules):
        print("  RESULT   : degenerate"); RESULTS.append((key, name, "n/a", False)); return
    scored = {k: roc_auc_score(yte, v) for k, v in rules.items()}
    best = max(scored, key=scored.get)
    base = {"auc": scored[best], "ap": average_precision_score(yte, rules[best])}
    print("  rules    : " + ", ".join(f"{k} {v:.3f}" for k, v in scored.items()))
    wins = True
    for k in ("auc", "ap"):
        better = model[k] > base[k]
        wins = wins and better
        print(f"  {k:4}     : model {model[k]:.3f}  vs best rule ({best}) {base[k]:.3f}"
              f"  -> {'WINS ' if better else 'loses'}   margin {model[k] - base[k]:+.3f}")
    RESULTS.append((key, name, f"auc {model['auc']:.3f} vs {base['auc']:.3f}", wins))


cases = pd.read_csv(os.path.join(DATA, "CaseMaster.csv"), low_memory=False)
units = pd.read_csv(os.path.join(DATA, "Unit.csv"), low_memory=False)
vic = pd.read_csv(os.path.join(DATA, "Victim.csv"), low_memory=False)
cases["reg"] = pd.to_datetime(cases["CrimeRegisteredDate"], errors="coerce")
ASOF = cases["reg"].max()
cases["did"] = cases["PoliceStationID"].astype(str).map(
    dict(zip(units["UnitID"].astype(str), units["DistrictID"].astype(str))))
print(f"corpus asOf {ASOF.date()}  cases {len(cases):,}")

offs = json.load(open(os.path.join(DERIVED, "offenders.json")))
reg_of = dict(zip(cases["CaseMasterID"].astype(str), cases["reg"]))
did_of = dict(zip(cases["CaseMasterID"].astype(str), cases["did"]))
head_of = dict(zip(cases["CaseMasterID"].astype(str), cases["CrimeMajorHeadID"]))
grav_of = dict(zip(cases["CaseMasterID"].astype(str), cases["GravityOffenceID"]))

# =======================================================================================
# G — THE SAME MODEL AT OTHER HORIZONS.
# =======================================================================================
obs = pd.date_range(cases["reg"].min() + pd.Timedelta(days=365), ASOF - pd.Timedelta(days=365),
                    freq="30D")
base_rows = []
for o in offs:
    dated = sorted(d for d in (reg_of.get(str(c)) for c in o.get("caseIds", [])) if d)
    ids = [str(c) for c in o.get("caseIds", []) if reg_of.get(str(c))]
    if len(dated) < 2:
        continue
    paired = sorted(zip(dated, ids))
    for t in obs:
        prior = [(d, c) for d, c in paired if d <= t]
        if not prior:
            continue
        fut = [(d, c) for d, c in paired if d > t]
        span = (t - prior[0][0]).days
        pc = [c for _, c in prior]
        base_rows.append({
            "t": t,
            "prior_cases": len(prior),
            "days_since_last": (t - prior[-1][0]).days,
            "span_days": span,
            "rate_per_yr": len(prior) / max(1.0, span / 365.25),
            "n_districts": len({did_of.get(c) for c in pc if did_of.get(c)}),
            "n_heads": len({head_of.get(c) for c in pc if head_of.get(c)}),
            "heinous": sum(1 for c in pc if str(grav_of.get(c)) == "1"),
            # the future, kept raw so every horizon can be cut from the same panel
            "_next_days": min([(d - t).days for d, _ in fut], default=10**6),
            "_next_head": (min(fut)[1] if fut else None),
        })
G = pd.DataFrame(base_rows).sort_values("t")
FEAT = ["prior_cases", "days_since_last", "span_days", "rate_per_yr", "n_districts", "n_heads", "heinous"]
assert not BANNED.intersection(set(FEAT))
cut = G["t"].quantile(0.75)

for H in (30, 90, 180, 365):
    g = G.copy()
    g["y"] = (g["_next_days"] <= H).astype(int)
    tr, te = g[g["t"] <= cut], g[g["t"] > cut]
    m = fit(tr[FEAT], tr["y"], te[FEAT], te["y"])
    verdict(f"G{H}", f"G. REPEAT OFFENDING at {H} days", f"back within {H} days?",
            len(g), g["y"].mean(), m,
            {"recency": -te["days_since_last"], "rate/yr": te["rate_per_yr"],
             "prior cases": te["prior_cases"]}, te["y"])

# =======================================================================================
# H — WHICH KIND of crime they come back with. A different product: a property-crime unit
# wants the property-crime returners, not everyone.
# =======================================================================================
head_names = {"1": "Body", "2": "Property", "3": "Women", "4": "Economic", "5": "Cyber"}
for hid, hname in list(head_names.items())[:3]:
    g = G.copy()
    g["y"] = ((g["_next_days"] <= 180) & (g["_next_head"].map(lambda c: str(head_of.get(c)) == hid))).astype(int)
    if g["y"].sum() < 60:
        print(f"\n(skipped H/{hname}: only {int(g['y'].sum())} positives)")
        continue
    tr, te = g[g["t"] <= cut], g[g["t"] > cut]
    m = fit(tr[FEAT], tr["y"], te[FEAT], te["y"])
    verdict(f"H{hid}", f"H. RETURNS WITH {hname.upper()} within 180 days",
            f"will their next case be {hname}?", len(g), g["y"].mean(), m,
            {"recency": -te["days_since_last"], "rate/yr": te["rate_per_yr"]}, te["y"])

# =======================================================================================
# I — VICTIM-SIDE REPEAT VICTIMISATION.
# =======================================================================================
v = vic.merge(cases[["CaseMasterID", "reg"]], on="CaseMasterID", how="left").dropna(subset=["reg"])
v["name"] = v["VictimName"].astype(str).str.strip().str.lower()
counts = v.groupby("name").size()
multi = counts[counts >= 2].index
print(f"\nvictim names appearing 2+ times: {len(multi):,} of {counts.size:,}")
rows = []
for nm, g2 in v[v["name"].isin(multi)].groupby("name"):
    d = sorted(g2["reg"].tolist())
    for i in range(len(d) - 1):
        t = d[i]
        if t > ASOF - timedelta(days=180):
            continue
        rows.append({"t": t, "prior": i + 1,
                     "days_since_last": (t - d[i - 1]).days if i else 999,
                     "span": (t - d[0]).days,
                     "y": int((d[i + 1] - t).days <= 180)})
V = pd.DataFrame(rows).sort_values("t")
if len(V) > 200 and V["y"].nunique() > 1:
    cv = V["t"].quantile(0.75)
    tr, te = V[V["t"] <= cv], V[V["t"] > cv]
    m = fit(tr[["prior", "days_since_last", "span"]], tr["y"],
            te[["prior", "days_since_last", "span"]], te["y"])
    verdict("I", "I. REPEAT VICTIMISATION (person)", "will this victim be victimised again within 180 days?",
            len(V), V["y"].mean(), m,
            {"recency": -te["days_since_last"], "prior count": te["prior"]}, te["y"])
else:
    print("\nI. REPEAT VICTIMISATION — not enough usable rows")
    RESULTS.append(("I", "I. REPEAT VICTIMISATION", "n/a", False))

# =======================================================================================
# J — IO CASELOAD BREACH. Will this officer's pending pile be materially larger next month?
# =======================================================================================
cases["ym"] = cases["reg"].dt.to_period("M").astype(str)
io = cases.dropna(subset=["PolicePersonID"]).groupby(["PolicePersonID", "ym"]).size().rename("n").reset_index()
months = sorted(io["ym"].unique())[:-1]
io = io[io["ym"].isin(months)]
grid = (pd.MultiIndex.from_product([io["PolicePersonID"].unique(), months], names=["PolicePersonID", "ym"])
        .to_frame(index=False).merge(io, how="left").fillna({"n": 0})
        .sort_values(["PolicePersonID", "ym"]))
gg = grid.groupby("PolicePersonID")["n"]
for k in (1, 2, 3):
    grid[f"lag_{k}"] = gg.shift(k)
grid["roll_3"] = gg.shift(1).rolling(3).mean().reset_index(0, drop=True)
grid["roll_6"] = gg.shift(1).rolling(6).mean().reset_index(0, drop=True)
grid["std_6"] = gg.shift(1).rolling(6).std().reset_index(0, drop=True)
grid["mi"] = grid["ym"].map({m: i for i, m in enumerate(months)})
grid = grid.dropna(subset=["roll_6", "std_6"])
grid["y"] = ((grid["roll_3"] >= 3) & (grid["n"] > 1.5 * grid["roll_3"])).astype(int)
FJ = ["lag_1", "lag_2", "lag_3", "roll_3", "roll_6", "std_6", "mi"]
cj = sorted(grid["ym"].unique())[-4]
tr, te = grid[grid["ym"] < cj], grid[grid["ym"] >= cj]
m = fit(tr[FJ], tr["y"], te[FJ], te["y"])
verdict("J", "J. IO CASELOAD SURGE (officer × month)", "will this officer take materially more next month?",
        len(grid), grid["y"].mean(), m,
        {"inverse recent level": -te["roll_3"].fillna(0),
         "z of last month": ((te["lag_1"] - te["roll_6"]) / te["std_6"].replace(0, np.nan)).fillna(0)},
        te["y"])

print("\n" + "=" * 78 + "\nVERDICT\n")
for key, name, score, wins in RESULTS:
    print(f"  {key:5} {'SHIP ' if wins else 'DROP '}  {score:26}  {name.split('. ', 1)[1]}")
