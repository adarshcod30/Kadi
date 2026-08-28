"""
measure_ef.py — two further candidate tasks, both operational rather than statistical.

E  CROSS-DISTRICT ESCALATION. Will this offender's NEXT case be registered in a district they
   have not offended in before? This is the one question no single SP can answer from their
   own register, and the state tier exists to act on it.

F  EARLY LINKAGE. Will this newly registered FIR turn out to belong to a linkage cluster?
   An SHO deciding whether to open the network on a fresh file is guessing today; the React
   tab already nudges them ("open the network first"), on nothing but whether links exist
   ALREADY. Predicting it at registration is the useful version.

Same discipline throughout: time-ordered split, best available simple rule as the baseline,
scale-free sanity check where a level artefact is plausible, no protected attributes.
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


def show(name, question, n, rate, model, rules, y_te):
    print(f"\n{'=' * 78}\n{name}\n  question : {question}\n  rows     : {n:,}   positive rate: {rate:.1%}")
    scored = {k: roc_auc_score(y_te, v) for k, v in rules.items()}
    best = max(scored, key=scored.get)
    base = {"auc": scored[best], "ap": average_precision_score(y_te, rules[best])}
    print("  rules    : " + ", ".join(f"{k} {v:.3f}" for k, v in scored.items()))
    if model is None:
        print("  RESULT   : degenerate")
        return
    for k in ("auc", "ap"):
        print(f"  {k:4}     : model {model[k]:.3f}  vs best rule ({best}) {base[k]:.3f}"
              f"  -> {'WINS ' if model[k] > base[k] else 'loses'}   margin {model[k] - base[k]:+.3f}")


cases = pd.read_csv(os.path.join(DATA, "CaseMaster.csv"), low_memory=False)
units = pd.read_csv(os.path.join(DATA, "Unit.csv"), low_memory=False)
secs = pd.read_csv(os.path.join(DATA, "ActSectionAssociation.csv"), low_memory=False)
acc = pd.read_csv(os.path.join(DATA, "Accused.csv"), low_memory=False)
vic = pd.read_csv(os.path.join(DATA, "Victim.csv"), low_memory=False)
cases["reg"] = pd.to_datetime(cases["CrimeRegisteredDate"], errors="coerce")
cases["inc"] = pd.to_datetime(cases["IncidentFromDate"], errors="coerce")
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
# E — CROSS-DISTRICT ESCALATION
# =======================================================================================
rows = []
for o in offs:
    dated = sorted([(reg_of.get(str(c)), str(c)) for c in o.get("caseIds", [])
                    if reg_of.get(str(c)) is not None])
    if len(dated) < 2:
        continue
    for i in range(len(dated) - 1):
        t, _ = dated[i]
        prior = dated[:i + 1]
        seen = {did_of.get(c) for _, c in prior}
        nxt_did = did_of.get(dated[i + 1][1])
        gaps = [(prior[j + 1][0] - prior[j][0]).days for j in range(len(prior) - 1)]
        rows.append({
            "t": t,
            "prior_cases": len(prior),
            "n_districts": len(seen),
            "district_ratio": len(seen) / len(prior),
            "span_days": (t - prior[0][0]).days,
            "mean_gap": float(np.mean(gaps)) if gaps else 999.0,
            "n_heads": len({head_of.get(c) for _, c in prior}),
            "heinous": sum(1 for _, c in prior if grav_of.get(c) == 1),
            "moved_last": int(len(prior) > 1 and did_of.get(prior[-1][1]) != did_of.get(prior[-2][1])),
            "y": int(nxt_did not in seen),
        })
E = pd.DataFrame(rows).sort_values("t")
FEAT_E = ["prior_cases", "n_districts", "district_ratio", "span_days", "mean_gap",
          "n_heads", "heinous", "moved_last"]
assert not BANNED.intersection(set(FEAT_E))
cut = E["t"].quantile(0.75)
tr, te = E[E["t"] <= cut], E[E["t"] > cut]
mE = fit_clf(tr[FEAT_E], tr["y"], te[FEAT_E], te["y"])
show("E. CROSS-DISTRICT ESCALATION (offender, at each case)",
     "will this offender's next case be in a district they have not worked before?",
     len(E), E["y"].mean(), mE,
     {"share of districts so far": te["district_ratio"],
      "districts so far": te["n_districts"],
      "moved last time": te["moved_last"].astype(float),
      "inverse prior cases": -te["prior_cases"]}, te["y"])

# =======================================================================================
# F — EARLY LINKAGE, decided at registration.
# =======================================================================================
clusters = json.load(open(os.path.join(DERIVED, "clusters.json")))
in_cluster = set()
for c in clusters:
    for cid in c.get("caseIds", []) or []:
        in_cluster.add(str(cid))
print(f"cases in a linkage cluster: {len(in_cluster):,}")

n_acc = acc.groupby("CaseMasterID").size()
n_vic = vic.groupby("CaseMasterID").size()
n_sec = secs.groupby("CaseMasterID").size()
sec_list = secs.groupby("CaseMasterID")["SectionID"].apply(list)

F = cases.dropna(subset=["reg"]).copy()
F["y"] = F["CaseMasterID"].astype(str).isin(in_cluster).astype(int)
F["n_acc"] = F["CaseMasterID"].map(n_acc).fillna(0)
F["n_vic"] = F["CaseMasterID"].map(n_vic).fillna(0)
F["n_sec"] = F["CaseMasterID"].map(n_sec).fillna(0)
F["report_delay"] = (F["reg"] - F["inc"]).dt.days.clip(-5, 400).fillna(0)
F["hour"] = pd.to_datetime(F["IncidentFromDate"], errors="coerce").dt.hour.fillna(-1)
F["moy"] = F["reg"].dt.month
F["dow"] = F["reg"].dt.dayofweek
F["has_geo"] = F["latitude"].notna().astype(int)
F = F.sort_values("reg").reset_index(drop=True)
# Track record of the station and sub-head, from strictly earlier rows only.
for key, col in (("PoliceStationID", "stn_rate"), ("CrimeMinorHeadID", "sub_rate")):
    csum = F.groupby(key)["y"].cumsum() - F["y"]
    ccnt = F.groupby(key).cumcount()
    F[col] = (csum / ccnt.replace(0, np.nan)).fillna(F["y"].mean())
FEAT_F = ["CrimeMajorHeadID", "CrimeMinorHeadID", "GravityOffenceID", "CaseCategoryID",
          "PoliceStationID", "n_acc", "n_vic", "n_sec", "report_delay", "hour", "moy",
          "dow", "has_geo", "stn_rate", "sub_rate"]
assert not BANNED.intersection(set(FEAT_F))
cutf = F["reg"].quantile(0.75)
trf, tef = F[F["reg"] <= cutf], F[F["reg"] > cutf]
mF = fit_clf(trf[FEAT_F], trf["y"], tef[FEAT_F], tef["y"])
show("F. EARLY LINKAGE (case, at registration)",
     "will this fresh FIR turn out to belong to a linkage cluster?",
     len(F), F["y"].mean(), mF,
     {"sub-head history": tef["sub_rate"], "station history": tef["stn_rate"],
      "accused named": tef["n_acc"]}, tef["y"])
