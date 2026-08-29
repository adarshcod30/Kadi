# research/ — evidence for which forecasting models ship

Not shipped code. Needs pandas/scikit-learn/lightgbm, which the deployed AppSail container
deliberately does not have. Run locally:

    python3 research/measure_candidates.py     # tasks A-D, first pass
    python3 research/measure_bd.py             # B and D, after two construction bugs
    python3 research/measure_ef.py             # tasks E and F

## Why this exists

The pipeline had already measured four candidate ML tasks and rejected three. These scripts
apply the same bar to six more, and the answer is that almost nothing survives it.

| task | model | best simple rule | verdict |
|---|---|---|---|
| A disposal within 90 days, at registration | 0.520 | 0.527 sub-head history | drop |
| B station surge next month | 0.738 | 0.717 inverse volume | drop |
| C location re-victimisation, 14 days | 0.621 | 0.632 26-week rate | drop |
| **D repeat offending within 180 days** | **0.827** | 0.562 recency | **ship** |
| E cross-district escalation | 0.586 | 0.691 district share | drop |
| F early linkage at registration | 0.930 | 0.929 sub-head history | drop |

AUC on time-ordered hold-outs. A random split would flatter every one of them: crime series
are autocorrelated, so random test rows sit between training rows of the same series.

## The one methodological choice that decided most of it

Against the OBVIOUS baseline, most of these models win. Against the BEST simple rule
available on the same information, most lose.

B is the clearest case. It scores 0.738 against the z-score rule's 0.504 and looks like a
comfortable win — but "inverse recent level" alone scores 0.717, because the target
`n > 1.4 x roll_3` is simply easier to hit on a small register: a station averaging 5 needs 7,
one averaging 50 needs 70. Strip absolute volumes from the features and the model falls to
0.583, BELOW the rule. It was learning station size.

F is the other kind. It scores 0.930 and the sub-head's own history scores 0.929, because the
linkage pipeline keys on modus operandi and MO is derived from sub-head — the target is very
nearly a function of one input column.

## This also corrects a number already on the site

The shipped district x head spike classifier is documented as 0.587 AUC against a rule's
0.419. Re-measured against the best trivial rule on the same file:

    full features         auc 0.678
    inverse recent level  auc 0.620    <- the real baseline
    scale-free only       auc 0.516    <- the win was series size

SUPERSEDED TWICE SINCE, both recorded in docs/11_ML_MODELS.md. The classifier was replaced by a
regressor on the same 0/1 target, because QuickML's classification endpoints return a hard LABEL
and a label cannot rank -- the published classifier answered 0 for every candidate at the
default threshold and the degeneracy guard fell back to the rule every time. The shipped
regressor scores 0.677 against the same 0.620 baseline; the 0.678 above is the research
prototype's figure, and the shipped builder's is the one that counts.

Its honest margin is +0.058, not +0.168. It still beats the rule, so it stays.

## Two data facts worth not rediscovering

`Accused.PersonID` is a within-case index — three distinct values across 54,337 rows, not a
person. An offender panel built on it collapses to 27 rows. Real identities come only from the
entity-resolution pipeline (`derived/offenders.json`).

D's first draft scored 0.851 because `coOffenders` and `arrestCount` were included. Both are
LIFETIME totals on the offender record, computed over cases registered after the observation
date. That is leakage; removed, it holds at 0.827.

## Caveat carried into production

Some of D's margin may be the corpus generator giving each offender a stable offending rate,
which (prior_cases, span_days) then recovers almost exactly — the same circularity the
socio-economic panel already declares about urbanisation. Re-measure on real KSP data before
relying on the figure.

---

## Where the full record lives

This file covers the early sweep only. The complete measured field -- twenty tasks, eight
shipped, twelve rejected, with the test that killed each and the serving contract -- is
`docs/11_ML_MODELS.md`. Read that first; this file is kept for the working notes behind it.
