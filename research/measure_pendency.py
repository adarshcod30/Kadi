"""
measure_pendency.py — is a station's pendency trajectory predictable, and by more than a one-line rule?

WHY THIS TASK AT ALL. The Indian econometric literature is unusually consistent that the deterrence
variables which move crime rates here are charge-sheeting rate, conviction rate and PENDENCY -- Hazra
(2020) on 32 states 2010-16, Dutta & Husain (2009) on 1999-2005. That is a different causal story from
the Western hotspot literature, and it is the one a FIR register can actually tell.

WHY THE OBVIOUS TARGETS ARE WRONG, both found by looking before modelling:

  "will the backlog grow"          grew in 40 of 42 months statewide, 92.9% of station-quarters. A
                                   target that is almost always 1 is not a prediction.
  "will clearance fall below norm"  mean clearance is 2.2 cases per station-month. A comparison against
                                   a rolling mean of a count that small is mostly counting noise, and
                                   it is exactly the shape that made station-surge look like a winner
                                   while it was learning station size.

The backlog STOCK averages 46 per station-month, which is well enough conditioned to model. So the
target is a stock comparison at a materiality threshold: will this register be at least a fifth deeper
in three months. 33% positive, and an SP can act on it.
"""
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import roc_auc_score, average_precision_score

p = pd.read_pickle('/tmp/pend.pkl').sort_values(['unit','m']).reset_index(drop=True)
g = p.groupby('unit')
p['mi'] = p.m.rank(method='dense').astype(int)
p['moy'] = p.m.str[-2:].astype(int)
for k in (1,2,3):
    p[f'bl_lag{k}'] = g.backlog.shift(k)
    p[f'clr_lag{k}'] = g.cleared.shift(k)
    p[f'inf_lag{k}'] = g.inflow.shift(k)
p['bl_r3']   = g.backlog.transform(lambda s: s.shift(1).rolling(3).mean())
p['clr_r3']  = g.cleared.transform(lambda s: s.shift(1).rolling(3).mean())
p['inf_r3']  = g.inflow.transform(lambda s: s.shift(1).rolling(3).mean())
p['bl_f3']   = g.backlog.shift(-3)

# --- derived, scale-free: the ratios a supervisor would actually reason with -------------------
p['growth_3']   = p.backlog / p.bl_r3.replace(0, np.nan)          # momentum
p['growth_1']   = p.backlog / p.bl_lag1.replace(0, np.nan)
p['clr_rate']   = p.cleared / p.backlog.replace(0, np.nan)        # how fast it works the pile down
p['clr_rate_r3']= p.clr_r3 / p.bl_r3.replace(0, np.nan)
p['load']       = p.inflow / p.clr_r3.replace(0, np.nan)          # arriving vs being closed
p['bl_share']   = p.backlog / p.open.replace(0, np.nan)           # how much of the register is stale
p['hein_share'] = p.bl_hein / p.backlog.replace(0, np.nan)

ABS  = ['backlog','open','inflow','cleared','bl_hein','bl_lag1','bl_lag2','bl_lag3',
        'clr_lag1','clr_lag2','clr_lag3','inf_lag1','inf_lag2','inf_lag3','bl_r3','clr_r3','inf_r3']
FREE = ['growth_3','growth_1','clr_rate','clr_rate_r3','load','bl_share','hein_share','moy']
FEAT = ABS + FREE + ['mi']

d = p[p.bl_f3.notna() & (p.backlog >= 10)].copy()
d = d.dropna(subset=['bl_r3','clr_r3','growth_3'])
d['y'] = (d.bl_f3 > 1.20 * d.backlog).astype(int)

cut = d.mi.quantile(0.75)
tr, te = d[d.mi <= cut], d[d.mi > cut]
print(f"panel {len(d):,} station-quarters | {d.unit.nunique()} stations | positives {d.y.mean():.1%}")
print(f"time-ordered split at month index {cut:.0f}: train {len(tr):,} / test {len(te):,}, test positives {int(te.y.sum())}\n")

def fit(cols, tr, te):
    m = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=15,
                           min_child_samples=25, subsample=0.9, colsample_bytree=0.8,
                           verbose=-1, random_state=7)
    m.fit(tr[cols], tr.y)
    q = m.predict_proba(te[cols])[:, 1]
    return q, m

# The baselines are the one-line rules a supervisor already has. Momentum is the honest one: a pile
# that has been growing keeps growing. Anything that cannot beat it is not worth an endpoint.
RULES = {
    'momentum (backlog / own 3-mo mean)': lambda t: t.growth_3,
    'last month growth':                  lambda t: t.growth_1,
    'inverse clearance rate':             lambda t: -t.clr_rate.fillna(0),
    'load (inflow / clearance)':          lambda t: t.load.fillna(0),
    'backlog size':                       lambda t: t.backlog,
    'stale share of register':            lambda t: t.bl_share,
}
sc = {k: roc_auc_score(te.y, v(te)) for k, v in RULES.items()}
best = max(sc, key=sc.get)
print("simple rules on the hold-out:")
for k, v in sorted(sc.items(), key=lambda x: -x[1]): print(f"   {k:<38}{v:.3f}")

q, model = fit(FEAT, tr, te)
auc, ap = roc_auc_score(te.y, q), average_precision_score(te.y, q)
b_auc = sc[best]; b_ap = average_precision_score(te.y, RULES[best](te))
print(f"\nmodel (all {len(FEAT)} features)   AUC {auc:.3f}  AP {ap:.3f}")
print(f"best rule ({best})   AUC {b_auc:.3f}  AP {b_ap:.3f}")
print(f"margin                             AUC {auc-b_auc:+.3f}  AP {ap-b_ap:+.3f}"
      f"   -> {'WINS' if (auc>b_auc and ap>b_ap) else 'LOSES'}")

# THE SCALE TEST. "+20% in three months" is easier to hit on a small pile, so a model can win by
# learning station size and never learning anything about pendency. Strip every absolute volume and
# see what survives; station-surge fell from 0.738 to 0.583 at exactly this step.
q2, _ = fit(FREE + ['mi'], tr, te)
a2, p2 = roc_auc_score(te.y, q2), average_precision_score(te.y, q2)
print(f"\nscale-free features only ({len(FREE)+1})  AUC {a2:.3f}  AP {p2:.3f}"
      f"   margin {a2-b_auc:+.3f} / {p2-b_ap:+.3f}"
      f"   -> {'SURVIVES' if (a2>b_auc and p2>b_ap) else 'ARTEFACT'}")

imp = sorted(zip(FEAT, model.feature_importances_), key=lambda x: -x[1])[:8]
print("\ntop features:", ", ".join(f"{k}" for k, _ in imp))
