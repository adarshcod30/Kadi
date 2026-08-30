# 11 — The models: what was measured, what ships, and what did not

Twenty prediction tasks were measured on this corpus. **Eight ship. Twelve were rejected.**

This document exists because the rejections are the more useful half and nothing else in the
repository records them. Every number here was read off the shipped artefacts — the serving
modules in `functions/api/services/`, the metadata the pipeline writes into
`functions/api/data/derived/`, and the measurement scripts in `research/` — rather than
transcribed from a notebook. Where a figure appears in the UI it is read from the same place,
so the page and this file cannot drift apart without a test failing.

---

## 1. The rule that decided almost everything

**Every candidate is scored against the best simple rule that can see its own question — not
the first baseline that came to mind.**

That one choice decided most of these results. Against an obvious baseline nearly every
candidate wins. Against the best available one, nearly every candidate loses. A model that
cannot beat a one-line rule is worse than no model: it reads as capability while adding a
serving dependency, a credential to rotate, and a failure mode.

The spike model is the cautionary example. It was documented for months as **0.587 AUC against
a z-score rule's 0.419** — a true comparison against a badly chosen rule. Measured against the
best trivial rule available on the same columns (*inverse recent level*: small series spike more
often), the honest figures are **0.677 against 0.620**. The model still ships. Its real
contribution is +0.058, not +0.168.

### The five tests a candidate has to survive

| Test | What it catches | What it killed |
|---|---|---|
| **Time-ordered hold-out** | Autocorrelation. A random split puts test rows *between* training rows of the same series and flatters everything. | Used throughout; no candidate was ever scored on a random split. |
| **Best-available baseline** | A weak rule making a mediocre model look good. | Re-scored the spike model from +0.168 to +0.058. |
| **Scale-free re-run** | A model learning *series size* instead of risk. Strip every absolute volume and re-measure. | Station surge: 0.738 → **0.583**, below its rule. Rejected. |
| **Conditional test** | A composite target inheriting the predictability of its easy half. Score only on the subgroup where the hard question actually applies. | Property, body and economic crime types. All three *score higher* than models that ship. |
| **Degeneracy guard (serving)** | An endpoint returning one identical value for every candidate — not a ranking, though sorting by it looks like one. | Caught the original spike **classifier**, which returned a hard label and answered `0` for every candidate at the default threshold. |

### Why every model is a regressor on a 0/1 target

This looks odd and is deliberate. QuickML's classification nodes emit a hard class **label** —
there is no `predict_proba` anywhere in the operation palette. A label cannot rank: at the
default threshold the endpoint answers the same class for most of a shortlist, and the ordering
that comes back is the input ordering. Measured on the spike file:

```
classifier LABEL    auc 0.565     what the published endpoint actually returned
classifier proba    auc 0.639     not obtainable through this platform
regressor on 0/1    auc 0.677     what serves now
```

Fitting a regressor to the binary column returns a float that orders the list. Every shipped
model here is that shape, for that reason.

### Leakage: one file per target

The six offender models are nested horizons — 180 days is a subset of 365. A sibling target
left in the training frame would be handed to the model as a feature, and "back within 180
days" would give away "back within a year". So `offender_set.py` writes **one file per target,
carrying exactly its own label and nothing else**, which makes the mistake structurally
impossible rather than a thing to remember. A unit test asserts the column set of each shipped
file against the serving module's feature list.

Each task is also **censored by its own horizon**, not by the longest one. Censoring everything
at 365 days was an early error of mine: it cost h180 a fifth of its rows and measured it at
0.609 instead of its true 0.746.

---

## 2. The eight that ship

All figures are AUC on a time-ordered hold-out, against the named rule. AP is average
precision, which is the number that matters for a list read from the top.

### 2.1 Repeat offending — six questions, one panel

**Grain:** repeat offender (2+ resolved cases) × observation date · 14,197 rows ·
2024-01-01 → 2026-03-21
**Features (7):** `prior_cases`, `days_since_last`, `span_days`, `rate_per_yr`, `n_districts`,
`n_heads`, `heinous`
**Pipeline:** `appsail/pipeline/offender_set.py` · **Serving:** `services/offenderrisk.js`

| Slug | Question | AUC | Rule | Margin | AP | AP rule | Rows | Positives |
|---|---|---|---|---|---|---|---|---|
| `h90` | back on a new FIR within 90 days | **0.699** | 0.584 recency | +0.115 | 0.319 | 0.257 | 14,197 | 2,927 |
| `h180` | back on a new FIR within 180 days | **0.746** | 0.562 recency | +0.184 | 0.538 | 0.387 | 12,481 | 4,504 |
| `h365` | back on a new FIR within a year | **0.733** | 0.512 recency | +0.221 | 0.720 | 0.517 | 9,153 | 5,061 |
| `new365` | next FIR in a district never worked | **0.762** | 0.561 districts worked | +0.201 | 0.452 | 0.309 | 9,153 | 2,194 |
| `heinous365` | next FIR recorded Heinous | **0.661** | 0.502 recency | +0.159 | 0.089 | 0.057 | 9,153 | 643 |
| `women365` | next FIR a crime against women | **0.638** | 0.459 recency | +0.179 | 0.040 | 0.021 | 9,153 | 179 |

`h180` is the default: the widest margin on average precision.

**Why six and not one.** They share a feature set and a scoring record, so running them together
costs an endpoint each and nothing more. They are worth having separately because **their top-20
hold-out shortlists share at most one person.** Rank correlation across the whole panel runs
0.33–0.46, which reads like "much the same model" and is misleading — correlation is dominated
by the vast middle of the list nobody acts on. *The top twenty is the product.*

A caveat the UI also carries: the lists **on the page** overlap more than that, because serving
does not score all 200 offenders in scope. The recency rule takes the top 24 (cheap, supplies
the recall) and the model re-ranks those, so every model is ordering the same two dozen people.
The measured figure is what the models do picking freely from everyone; the page is what they do
inside a shared shortlist. Both are true, and the first is the one that answers "are these
different models".

### 2.2 Spike risk — district × crime head

**Grain:** district × crime head × month · 7,022 rows · 2024-02 → 2026-06 · 31 features
**Target:** month lands ≥40% above the series' own trailing 3-month mean (15.9% positive)
**Pipeline:** `appsail/pipeline/training_set.py` · **Serving:** `services/mlforecast.js`

| Task | AUC | Rule | Margin |
|---|---|---|---|
| District × head spike next month | **0.677** | 0.620 inverse recent level | +0.057 |

**Read the margin honestly.** The target "40% above the trailing mean" is simply easier to hit on
a small series, so a model given absolute volumes can win by learning which series are small.
Strip the volumes and this model falls to **0.516**. Most of its apparent edge is series size;
+0.058 is what is actually left.

**Why not forecast the count.** Predicting next month's count means predicting an arrival
process. For a Poisson count with mean λ, even a perfect predictor still misses by
`sqrt(2/(πλ))`. At the district grain that floor is 11.5% and a three-month moving average
already sits close to it. Raw target, ratio target, lean and rich feature sets, multi-horizon,
and a tuned blend all lost to the moving average. Classification escapes the problem because it
only has to rank.

### 2.3 Station pendency trajectory — the widest margin in the project

**Grain:** police station × month · 10,026 rows · 2023-06 → 2026-03 · 25 features
**Target:** `target_backlog_up_20pct_3mo` — will this register's stock of past-window cases be
≥20% larger in 3 months (33% positive, 3,313 of 10,026)
**Pipeline:** `appsail/pipeline/pendency_set.py` · **Serving:** `services/pendencyrisk.js`

| Task | AUC | Rule | Margin | AP | AP rule | Hold-out positives |
|---|---|---|---|---|---|---|
| Station pendency +20% in 3 months | **0.870** | 0.701 inflow over recent clearance | **+0.169** | 0.560 | 0.274 | 386 |

**Why this question rather than hotspots.** The Indian econometric literature is consistent, and
it does not point where the Western predictive-policing canon points. Hazra (2020), across 32
states and union territories, finds that of the available deterrence variables *charge-sheeting
rate, conviction rate and pendency* explain crime rates in India; Dutta & Husain (2009) reach the
same conclusion on earlier state panel data. The lever is **disposal**, and a FIR register can
speak to disposal.

Place-based forecasting was ruled out arithmetically, not by preference: at a 1 km cell and a
week this register averages one case, so the Poisson floor puts the best possible predictor 78%
out. A backlog **stock** averages 46 per station-month and is worth modelling — the distinction
is stock versus flow. Clearance *count* (mean 2.2) and incidence are not modellable here for the
same reason the hotspot grid is not.

**Robustness.** This is the only model that survives every sweep run against it:

| Variant | AUC |
|---|---|
| Shipped | 0.870 |
| Scale-free (every absolute volume stripped) | **0.860** |
| Earlier split | 0.871 |
| Later split | 0.807 |
| Restricted to backlog ≥ 25 | 0.835 |

Compare station surge, which was rejected: 0.738 → 0.583 scale-free. What carries pendency are
*ratios* — the stale share of the register, the pile's own recent growth, the heinous share, the
clearance rate — not station size.

**Two things this model must not become.** It scores **registers, not people**; no person is a
feature or a unit of analysis. And its strongest feature is the stale share of the register,
which an officer could improve by *declining to register cases*. That is a supervision
instrument with a supervision failure mode, and it belongs in front of an SP who knows the
difference. A station forecast to fall behind is somewhere to send help, not a unit to punish.

**A limit in the data, stated plainly.** A case leaves this backlog only when a charge-sheet is
recorded, because that is the only dated disposal event in the schema. Cases closed or filed
undetected by another route keep counting. The *level* is therefore not a pendency statistic —
the **trajectory** is what is modelled.

---

## 3. The twelve that did not ship

Three of these score **higher** than models that ship. That is the point of the conditional
test.

### Rejected on the conditional test — composite targets

"Comes back AND it is a property crime" inherits the predictability of "comes back", which is
0.733 on its own. Ask instead whether the model can say **what** they come back with — score it
only on the people who did come back — and the margin collapses.

| Task | AUC | Rule | Looks like | Conditional margin |
|---|---|---|---|---|
| Next FIR is a property crime | 0.657 | 0.562 | +0.095 | **+0.022** |
| Next FIR is a body crime | 0.710 | 0.575 | +0.135 | **+0.074** |
| Next FIR is an economic crime | 0.728 | 0.508 | +0.220 | **+0.085** |

Heinous and crimes-against-women were put through the same test and **held**, which is why they
ship and these do not.

### Rejected on the scale-free test

| Task | AUC | Rule | Scale-free | Why |
|---|---|---|---|---|
| Station surge next month | 0.738 | 0.717 | **0.583** | Wins by +0.021, then falls below its rule once absolute volumes are removed. It was learning station size, not risk. |

### Rejected for losing to the rule outright

| Task | AUC | Rule | Why |
|---|---|---|---|
| Next FIR is a cyber crime | 0.464 | 0.566 prior case count | Loses outright. |
| Location re-victimisation, 14 days | 0.621 | 0.632 26-week rate | Persistence — "somewhere that had a crime recently will have another" — is most of the signal. |
| Cross-district escalation (per case) | 0.586 | 0.691 share of districts so far | Loses to a one-line ratio by a wide margin. **See the note below.** |
| Repeat victimisation (person) | 0.692 | 0.758 prior count | Loses to counting, and near-degenerate: 91% of observed victims are victimised again inside six months, so there is almost nothing to separate. |
| Charge-sheet within 90 days, at registration | 0.520 | 0.527 sub-head history | No signal beyond what the crime type already says. |

### Rejected despite beating the rule

| Task | AUC | Rule | Why |
|---|---|---|---|
| Back within 30 days | 0.658 | 0.588 recency | +0.069 AUC and only +0.013 AP. Its shortlist genuinely is distinct — 1 of 20 shared with the six-month list — but a list that names different people *less accurately* is just a different wrong list. |
| IO caseload surge | 0.731 | 0.589 z of last month | Beats the rule on AUC and is still not worth shipping: the event happens to 0.1% of officer-months, so AP is **0.018**. A model that is right about almost nothing ranks well and helps no one. |
| Linkage at registration | 0.930 | 0.929 sub-head history | Scores 0.930 and adds +0.002. The linkage pipeline keys on modus operandi and MO derives from sub-head, so the target is nearly a function of one input column. |

**The framing was the problem, not the question.** "Cross-district escalation" loses badly when
asked *once per case*. Re-asked on the offender × observation-date panel as "will their next FIR
be in a district they have never worked", the same underlying idea wins by +0.201 and ships as
`new365`. Worth recording: a rejected result is sometimes a rejected *framing*.

---

## 4. How a model gets from the pipeline to the screen

```
appsail/pipeline/*.py          builds the training file + a *_meta.json beside it
  └─ training_set*.csv         one file per target; no sibling labels
QuickML console                dataset → Prediction pipeline → Regression Ensemble → Execute
  └─ endpoint                  created + Published, e.g. kadi-pendency-endpoint
AppConfig (Data Store)         the endpoint key, pasted via Admin → Model endpoint keys
services/<model>risk.js        candidates() → score() → falls back to the rule on any failure
functions/api/app.js           /analytics/<x> returns items + rankedBy + serving diagnostics
client/src/pages/Forecast.tsx  ML forecaster tab; the chip says model or rule, never guesses
```

**The console step is manual and that is a platform constraint, not an oversight.** QuickML
exposes no REST surface for creating datasets, pipelines or endpoints; the console is the only
way in. What the repository can own — the training file, its schema, its measurement and its
serving contract — it owns.

### The serving contract

Every serving module follows the same shape, and the discipline is the point:

- **`configured()` reads the measurement, not a flag.** A model serves only while
  `auc > rule && ap > apRule`. Revise a measurement downward and the model unplugs itself.
- **`score()` returns `null` on *any* failure** — no key, no token, HTTP error, timeout, or a
  degenerate response. Every caller then keeps the rule's ordering.
- **The fallback ordering is the rule the model was measured against**, so when the endpoint is
  unreachable the list is a known quantity rather than an arbitrary one.
- **`rankedBy` is published** on every response and rendered on every panel. The reader is always
  told which of the two orderings they are looking at.
- **The degeneracy guard fires only on two or more candidates.** A set of one is a narrow scope
  (a station officer sees one register), not a broken endpoint. One score is not a ranking, but
  it is still a prediction.
- **Endpoint keys live in AppConfig, never in the repository**, and no route ever reads one back.

### Scope

Every model is scoped by the reader's tier before it is scored — state sees all, a district
officer sees their district, a station officer sees their own register. Verified end to end:
298 / 120 / 1 stations for the pendency model at state / SP / SHO. A signed-in account is pinned
to the district and unit in its token; `?district=` and `?unit=` are ignored below state tier.

### Endpoints and config keys

| Model | Endpoint | AppConfig key |
|---|---|---|
| `h90` | `kadi-offender-h90-endpoint` | `quickml.offenderH90EndpointKey` |
| `h180` | `kadi-offender-endpoint` | `quickml.offenderEndpointKey` |
| `h365` | `kadi-offender-h365-endpoint` | `quickml.offenderH365EndpointKey` |
| `new365` | `kadi-offender-new365-endpoint` | `quickml.offenderNew365EndpointKey` |
| `heinous365` | `kadi-offender-heinous365-endpoint` | `quickml.offenderHeinous365EndpointKey` |
| `women365` | `kadi-offender-women365-endpoint` | `quickml.offenderWomen365EndpointKey` |
| spike | `kadi-spike-regressor-endpoint` | `quickml.spikeRegressorEndpointKey` |
| pendency | `kadi-pendency-endpoint` | `quickml.pendencyEndpointKey` |

---

## 5. Fairness

**No protected attribute is a feature of any model here.** Not caste, not religion, not
occupation, not age, not gender. The offender models use counts, dates, districts and heads
spanned, and recorded gravity. The spike and pendency models use counts, calendar positions and
area-level indicators only.

This is enforced, not asserted: `assert_no_protected` runs over the feature list **before any
training file is written**, and a unit test fails the build if a protected column reaches a
feature set.

Two further limits worth carrying into any real deployment:

- **The pendency model scores registers, not people**, and its failure mode is described in §2.3.
- **Reporting propensity is a confound this corpus cannot resolve.** All-women police stations
  raised *reported* crime against women by 22% with no matching change in victimisation. A model
  trained on reports is modelling reports.

---

## 6. The caveat that applies to every number above

**This is synthetic data.** Some of the offender margin may be the generator giving each
offender a stable offending rate, which `prior_cases` and `span_days` together recover almost
exactly. Re-measure on real records before relying on any figure in this document. The
*protocol* — time-ordered splits, best-available baselines, the scale-free and conditional
tests — is what should survive the move to real data. The numbers are provisional.

---

## 7. Reproducing this

```bash
# rebuild every training file and its metadata
python appsail/pipeline/offender_set.py
python appsail/pipeline/pendency_set.py
python appsail/pipeline/training_set.py

# re-measure
python research/measure_family.py      # the six offender models
python research/measure_pendency.py    # station pendency + its robustness sweep
python research/measure_candidates.py  # the rejected field

# the contract tests: feature lists, target files, margins, scope, guards
cd functions && npm test
```

Training files are downloadable from the running app at
`/server/api/ml/training-set.csv?grain=<grain>` — `pendency`, `spike`, or
`offender:<slug>` — which is also how they reach the QuickML console.

**Numbers must come from the file that ships.** An early version of this work quoted the
pendency model at 0.878 from a research prototype while the shipped builder — which rounds its
ratios to 4dp — produced 0.870. Both were "true"; only one was reproducible from the artefacts
in this repository.
