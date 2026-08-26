# 10 — React, Forecast, live case entry, and a real ML model

A plan for review. Nothing here is built yet except the knowledge-base documents, which are
generated and waiting on one wiring step.

---

> **Status — all six phases shipped.** What follows is the plan as approved. Where execution
> diverged from it, the divergence is noted inline. Three things are worth reading before the
> rest, because they changed numbers the plan quotes:
>
> 1. **The forecast baseline was wrong, not merely imprecise.** The plan says 4.3% MAPE. The
>    real backtest was **24.4%**, and the errors were all in the same direction — ~1,780
>    predicted against ~2,340 actual, every month. The cause was a structural break: the corpus
>    steps from ~1,300 registrations a month to ~2,300 in Jan 2026 and stays there, and a
>    least-squares line drawn across a break splits the difference and then under-forecasts
>    forever. Adding level-shift detection took it to **7.8%**. A consistent one-directional
>    miss is the wrong model, not noise.
> 2. **QuickML's row-insert response cannot be trusted for identity.** It answers with a ROWID
>    that is not the ROWID the row ends up with. Submissions mint their own key.
> 3. **The write path broke the corpus clock on day one.** Momentum and emerging risk both took
>    "the last complete month" to be `months[length - 2]`. One case registered today opens a new
>    month, the partial month slides, and both silently read a fortnight as a full month —
>    the state reported -24% falling on a corpus that had not changed. Both now detect a partial
>    month rather than assume its position, with a regression test.

## 0. What I checked before proposing anything

Two findings change the shape of this plan, so they come first.

### 0.1 The RAG knowledge base can be provisioned by API, not only by hand

I probed the QuickML management surface from the deployed function:

```
GET  /quickml/v1/project/{id}/rag/documents   → 200  {"status":"success","documents":[]}
POST /quickml/v1/project/{id}/rag/documents   → 400  reason: "Error in processing `documentName` parameter"
GET  /quickml/v1/project/{id}/datasets        → 404
GET  /quickml/v1/project/{id}/models          → 404
```

So: the knowledge base **exists and is empty**, uploads go to `POST /rag/documents` as a
multipart form with a `documentName` field, and there is no REST surface for datasets or
models — **model building is console-only**. That single fact decides §3.

### 0.2 A detection-risk classifier would not work on this corpus — and it matters

Before proposing "an ML model for case records", I measured whether the outcome is actually
predictable from case features. Detection rate across 34,683 closed cases:

| Feature | Detected | Signal |
|---|---|---|
| Base rate | 68.7% | — |
| Crimes Against Property / Cyber / Body / Women | 69.9 / 70.7 / 70.3 / 70.1% | **none** |
| Linked to another case vs isolated | 67.8% vs 69.8% | **none** (and backwards) |
| Heinous vs non-heinous | 70.1% vs 68.5% | negligible |
| District spread (n>300) | 65.4% – 73.1% | weak, 7.7 points |
| **Carries a health flag vs not** | **46.0% vs 76.5%** | strong — **but circular** |

The one strong feature is leakage: the health flag is *computed from* case age and pendency,
which already encode the outcome trajectory. Training on it would produce a model that looks
excellent and tells you nothing.

**The corpus was generated with detection roughly independent of case features.** A supervised
detection-risk model would predict ~68.7% for everything. Proposing one would be exactly the
"for name sake" feature you objected to earlier.

**What this does not rule out.** Three things genuinely have structure and are what PRD items 4
and 6 actually ask for — time-series forecasting, anomaly detection, and pattern discovery.
None needs outcome labels. And once §4 lands and real cases start arriving, the data stops
being synthetic-uniform and a detection model becomes viable — so the architecture should leave
the socket open rather than fill it now.

---

## 1. RAG knowledge base — **documents ready, one step to wire**

### What is built

`scripts/build_knowledge_base.js` generates 11 documents (~16 KB) into `docs/knowledge_base/`.

The split matters. The assistant already answers questions of **fact** exactly, from the case
database through a whitelisted query engine. Putting counts in a knowledge base would be
strictly worse — they would go stale and contradict live queries. So the KB holds only what the
query engine structurally cannot answer:

| Document | Answers |
|---|---|
| `kadi-what-it-is` | What the system is and explicitly is not |
| `case-linkage-explained` | The six link types; why a link is a lead, not proof |
| `offender-risk-score` | The seven factors; what the score is **not** |
| `entity-resolution` | How identities merge; what ER confidence means |
| `investigation-health` | Each flag, and what to do about it |
| `zones-and-hotspots` | Why a busy station is not automatically red |
| `fairness-policy` | The exclusion, and that it is enforced in code |
| `access-tiers` | The three tiers and why the station tier exists |
| `data-dictionary` | Heads, sub-heads, statuses, gravity, station types |
| `per-capita-and-forecast` | Why rates rather than counts; how to read an interval |
| `how-to-read-the-screens` | Each screen, and the intelligence band |

Counts that do appear are generated from the live corpus with an explicit as-of date, so a
stale document is visibly stale rather than quietly wrong.

### What remains

1. Upload the 11 documents via `POST /rag/documents` (multipart, `documentName` + file). I will
   write `scripts/upload_knowledge_base.js` and a `POST /admin/sync-knowledge-base` route so the
   KB refreshes from the same command that regenerates it.
2. Capture the returned document ids into `QUICKML_RAG_KB_ID`.
3. `ragAnswer()` is already written and gated on exactly that value — it starts working the
   moment it is set.

**Effort: small.** The code path exists; this is provisioning.

---

## 2. The two new tabs

Intelligence stays as the **explanatory** surface — per-capita, correlations, socio-economic,
station roster. The two new tabs split what is currently missing along the tense of the question.

### React — *what is happening now that needs a response*

Present tense, over data already recorded. A triage surface, not a dashboard: everything on it
is something an officer can act on today, ordered by what fails first.

- **Priority worklist** — one merged, ranked queue drawn from health flags, pulsing stations,
  active high-risk offenders and inbound cross-district links. Today these live on four
  separate screens; nothing tells you which to do first.
- **Ageing wall** — cases nearest their peer-median failure point, with days remaining.
- **Active offenders needing attention** — high risk **and** recently active **and** unarrested,
  which is the intersection none of the current sorts produce.
- **Inbound links** — cases registered elsewhere that connect into your scope, arriving as a
  feed rather than a buried tab.
- **Pending approvals** — for supervisors, the §4 queue.

Every row: what it is, why it surfaced, what to do, and one click to the case or offender.

### Forecast — *what is coming, and what changed*

Future tense and change detection. This is PRD 4 and 6.

- **District volume forecast** — three months ahead with 95% intervals, per crime head. Exists
  statistically; §3 upgrades the model behind it.
- **Emerging risk board** — district × sub-head combinations rising fastest against their own
  baseline, ranked by how unusual the rise is rather than by size.
- **Anomaly detection** — station-months, sub-head mixes and time-of-day patterns that deviate
  from their own history. Unsupervised; needs no labels.
- **Pattern discovery** — which sub-heads co-occur in the same places and windows; which MO
  phrases (from Zia) cluster with which districts. Association mining, not prediction.
- **Seasonality and occasions** — festival and holiday effects against ordinary days.
- **Backtest panel** — every forecast shown with its historical error. A projection without its
  track record is not a forecast, it is a guess.

---

## 3. The ML model — what it should actually be

Given §0.2, the honest model is **not** a case-outcome classifier. It is a
**district × crime-head monthly volume forecaster**, plus unsupervised anomaly scoring.

### Why this one

- The signal is real: time series carries trend, seasonality and level shifts.
- It is already measurable — the statistical forecast backtests to 7.8% MAPE (24.4% before
  level-shift detection was added), so a
  QuickML model has a number to beat rather than a vacuum to fill.
- It needs no outcome labels, so it improves as data grows rather than waiting on closures.
- It is what the brief asks for.

### The pipeline

Because there is no REST surface for datasets or models (§0.1), model building is a console
workflow. That is fine — it happens rarely. What must be automated is everything either side of it.

```
appsail/pipeline  →  training_set.csv        (we generate: one row per district-head-month)
                     ↓  upload
QuickML console   →  Dataset → Pipeline → Model → Endpoint     (manual, occasional)
                     ↓  endpoint id
functions/api     →  forecast.js calls the endpoint, falls back to the
                     statistical forecast if it is unreachable or worse
```

**The fallback is not a nicety.** The existing statistical forecast stays as the floor, and the
served forecast is whichever backtests better. A model that loses to the baseline should not
ship just because it is a model.

### Retraining as cases arrive

A nightly job rebuilds `training_set.csv` from the current corpus plus approved live cases
(§4), writes it to Stratus, and records the row count and date range. Retraining stays a
deliberate console action — silent automatic retraining on a police system is a liability, and
someone should look at the backtest before a new model serves.

---

## 4. Live case entry — the write path

This is the largest piece, and it changes KADI's nature: today it only reads.

### The flow

```
SI / SHO submits          →  CaseSubmission (status: pending)
   FIR + accused + victims + acts & sections
        ↓
Supervisor reviews         →  approve / reject / return for correction
   (SP for their district; DGP or Admin state-wide)
        ↓
Approved                   →  written to CaseMaster + child tables
        ↓
Read model                 →  live rows unioned over the bundle
        ↓
Nightly                    →  pipeline re-derives linkage, ER, health, hotspots
```

### Update path after approval

The same review gate, for lifecycle events on an existing case: **case closure**, **accused
arrested**, **chargesheet filed**, **status change**, **adding an accused or victim later**.
Each is a `CaseUpdate` row carrying the before and after, so the audit trail records what
changed and who approved it — not merely that something changed.

### Tables (Data Store, creatable via MCP as `AppUser` and `AppConfig` were)

| Table | Holds |
|---|---|
| `CaseSubmission` | Draft FIR, submitter, status, reviewer, timestamps, rejection reason |
| `SubmissionParty` | Accused / victim / complainant rows attached to a submission |
| `CaseUpdate` | Lifecycle change requests: type, target case, before/after, status |

### The hard part, stated plainly

**The read model is a precomputed bundle.** Linkage, entity resolution, risk and health are all
computed by the Python pipeline over the full corpus — they cannot be computed per-request for
a new case inside a 30-second function. So a newly approved case will be **visible immediately
in the register** but **not yet linked, resolved or scored** until the next pipeline run.

The interface must say so rather than let someone assume a new case has been analysed and found
unconnected. I would mark such cases explicitly — *"registered, awaiting overnight analysis"* —
because a silent gap here would undermine the one claim the product rests on.

---

## 5. Phasing

Each phase is independently shippable and leaves the system working.

| Phase | Delivers | Depends on |
|---|---|---|
| **1** | RAG knowledge base wired end to end | nothing — documents are ready |
| **2** | **Forecast** tab over existing statistical forecast, anomaly detection, pattern discovery, backtest panel | nothing |
| **3** | **React** tab — merged priority worklist across existing signals | nothing |
| **4** | Case submission + approval; live rows in the read model | Data Store tables |
| **5** | Lifecycle updates (closure, arrest, chargesheet) | phase 4 |
| **6** | QuickML forecasting model, served with fallback to the statistical baseline | phase 4 for growing data |

Phases 2 and 3 deliver visible value with no new infrastructure, so I would do those first
unless you want the write path sooner.

---

## 6. Risks, and what I would do about each

**Detection-risk modelling is not viable yet (§0.2).** Do not build it. Revisit once live cases
have accumulated real outcome variance.

**A model that loses to the baseline.** Serve whichever backtests better; keep the statistical
forecast as the floor. Show both errors in the UI.

**New cases appearing unanalysed.** Label them explicitly until the nightly pipeline has run.

**Approval becoming a rubber stamp.** The queue shows what changed, not just that something
did; every decision is audited with the approver's identity.

**Write path breaking reads.** Live rows union over the bundle at the query layer, so a Data
Store outage degrades to the bundle rather than to an error — the same pattern the existing
adapters already use.

**Scope.** Phases 4–6 are substantially larger than 1–3. If time is short, 1–3 alone give the
Forecast and React tabs and a working knowledge base.

---

## 7. What I need from you

1. **Phase order** — agree with 1→2→3 first, or do you want the write path (4/5) sooner?
2. **The ML finding in §0.2** — confirm you are happy dropping the detection-risk classifier in
   favour of forecasting plus anomaly detection. This is the one judgement worth your explicit
   agreement, because it contradicts the obvious reading of "a case-record ML model".
3. **Who submits** — should SI and SHO both submit, with SP approving? And should the DGP be
   able to approve for any district, or only Admin?
