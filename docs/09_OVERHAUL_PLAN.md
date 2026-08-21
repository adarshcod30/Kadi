# 09 — The overhaul plan

### From "a good visualization platform" to what the track actually asks for

**Written:** 2026-08-20, for the Refined Prototype phase (deadline 30 Aug).
**Source:** the Challenge 02 brief + Adarsh's own gap analysis.

---

## 1 · Where we actually stand against the track

The brief names four failures of the status quo and six required capabilities. Scoring
ourselves honestly:

| Track requirement | Now | Gap |
|---|---|---|
| **Advanced visualization / interactive dashboards** | ✅ strong | — |
| **District-level drill-down** | ⚠️ partial | Map drills down; nothing else does |
| **Spatiotemporal clusters** | ✅ done | DBSCAN + hour × weekday |
| **Emerging trend alerts, red-zone pulsing** | ⚠️ weak | 1 pulsing marker. No yellow/red **zone system** |
| **Relationship mapping (node graph)** | ✅ strong | The hero |
| **Repeat offender tracking + MO across jurisdictions** | ⚠️ partial | Only 300 of 36,289 identities; weakly surfaced |
| **Association detection** | ⚠️ weak | Co-accused edges exist but are barely used |
| **Socio-economic correlation** | ✅ done | Kodagu finding |
| **Predictive risk scoring / forecast** | ✅ done | 3-month, MAPE 4.3% |
| **Anomaly detection** | ⚠️ weak | Computed, hardly visible |
| **AI/ML-driven intelligence, hidden correlations** | 🔴 **the big one** | No LLM anywhere on the read path |
| **"Storytelling", not static charts** | 🔴 missing | Charts have no narrative layer |

> **The brief says it plainly:** *"a notable absence of AI-driven approaches"* and
> *"reactive vs proactive"*. Those two lines are the whole grading rubric. Everything else we
> already do well. **The AI insight layer is the single largest scoring gap.**

And as of today it is unblocked — QuickML GLM-4.7-Flash answers from the deployed function.

---

## 2 · The nine workstreams

### W1 · Collapse 5 roles into 2 tiers + a station view 🔴 foundational

**Now:** SI · Inspector · ACP · Analyst · Admin — five roles, three scopes, confusing.

**Target:**

| Tier | Who | Sees |
|---|---|---|
| **State** | SCRB Analyst · Admin · DGP | Everything, all 31 districts |
| **District** | SI · DSP · SP | One district, and cases linked into it |
| *(later)* **Station** | — | One unit |

**Why it matters:** the track asks for "district-level drill-down" as a first-class capability.
Right now only the map drills down. Making scope a **two-position switch** rather than five
overlapping roles makes every other workstream simpler — Graph, Cases, Offenders and
Analytics all key off it.

**Files:** `rbac.js`, `Login.tsx`, `Shell.tsx`, every `queries.js` reader.
**Effort:** M · **Risk:** low · **Blocks:** W3, W5, W6

---

### W2 · The AI insight layer 🔴 highest scoring value

QuickML works. Model id is `crm-di-glm47b_30b_it` (underscores), auth `Bearer`.

**The architecture that keeps it honest:**

```
Deterministic engine  →  facts + FIR numbers + figures   (cannot hallucinate)
        ↓
GLM-4.7-Flash         →  phrases them into a narrative   (cannot invent facts,
        ↓                                                 because it only sees ours)
UI                    →  narrative + the citations underneath
```

**Never let the model produce a number or an FIR reference.** It receives computed facts and
returns prose. That preserves the property worth more than fluency: every figure on screen is
traceable.

**Where insight text appears:**
- Under each analytics panel — "what this chart says"
- On zone click (W4) — why this district is red
- On a graph network — what kind of structure this is
- On the offender profile — behavioural summary
- Dashboard — a daily "state of the state" paragraph

**Two fixes needed first:**
1. `chat_template_kwargs.enable_thinking` must be **false** — it currently leaks
   chain-of-thought into the answer.
2. Response shape is `{ response, tool_calls, usage }`, not OpenAI's `choices[]`.

**Cost control:** insights are generated **in the nightly Job**, cached into the read-model —
not per request. Keeps the 30 s cap safe and the token bill flat.

**Effort:** M–L · **Risk:** medium · **Depends:** nothing

---

### W3 · Split Intelligence into themed tabs

**Now:** one long Intelligence page, everything stacked.

**Target — four tabs, each a theme:**

| Tab | Contains |
|---|---|
| **Where** | Per-capita ranking, rank-shift, district comparison, zones |
| **Why** | Socio-economic correlations, urbanisation bands, literacy/density |
| **When** | Temporal patterns, seasonality, **special-occasion analysis** (W8) |
| **What next** | Forecast, emerging risks, anomalies, predicted high-risk areas |

Every tab carries an **AI narrative** at the top and **period-over-period comparison**:

> *"Property crime in Kalaburagi ran at 5.2% of state volume last quarter and 10.1% this
> month — a 94% rise concentrated in two stations. Needs attention."*

That comparison sentence is exactly the "proactive, evidence-based" language the brief asks
for, and it is the thing a static chart cannot say.

**Effort:** M · **Risk:** low · **Depends:** W1, W2

---

### W4 · The zone system — yellow / red / pulsing red

**Now:** one pulsing hotspot marker. Not a *system*.

**Target:** every district and every station carries a **zone status**, computed against its
own baseline:

| Zone | Rule (against own trailing baseline) |
|---|---|
| 🟢 Normal | within expected range |
| 🟡 Yellow | elevated — watch |
| 🔴 Red | significantly above baseline |
| 🔴 **Pulsing red** | rising *and* accelerating |

Rendered on the map **and** as a state-level strip on the dashboard. **Clicking a zone opens
an AI-generated explanation** — what spiked, where, since when, which crime head, what the
comparable period looked like, and what to do.

**This is the "proactive policing" capability made visible.** It is also the most demo-able
single feature in the whole plan.

**Effort:** M · **Risk:** low · **Depends:** W2

---

### W5 · Graph — curated case sets per scope

**Now:** the graph opens on whatever case the switcher picks. Many look identical (MO-only
clusters of the same crime type).

**Target:**

- **State scope** → a curated set of **~20 cases** chosen for *variety*: different link types,
  different crime heads, different offender structures. Gang · serial chain · cyber ring ·
  cross-district · co-accused-heavy · MO-only — so a judge clicking through sees genuinely
  different network shapes.
- **District scope** → **10–15 cases from that district**, same variety principle.

**Selection rule:** maximise diversity, not link count. `featuredNetworks()` already sorts by
offender links and signal types — extend it to enforce a spread across crime head and edge-type
mix.

**Also fix here:**
- The **link-type panel** should be usable, not decorative — clicking a type should filter *and*
  explain what that evidence means.
- The **strength slider** is dead (scores cluster ~0.99). Percentile-rank them.

**Effort:** M · **Risk:** low · **Depends:** W1

---

### W6 · Scope Cases and Offenders properly

- **Cases** — state: all 40,829. District: that district's cases **plus cases linked into
  them** (silo-breaking is the whole point, so linked-in cases must remain visible).
- **Offenders** — state: all. District: offenders with a case in that district.

**Effort:** S–M · **Risk:** low · **Depends:** W1

---

### W7 · Strengthen repeat-offender tracking and association detection

The track names both explicitly. Both are currently underpowered.

**The honest problem:** entity resolution merges 36,582 accused records into 36,289 identities
— only **601 merges**. Of those, 300 appear in 2+ cases. That is thin, and it is because the
generator only plants name variants for its seven patterns.

**Fixes:**
1. **Generate more name-variant noise** across the corpus, not just in planted patterns. Real
   registers are messy; ours is too clean, which makes ER look weak.
2. **Surface MO across jurisdictions** — the track's exact phrase. An offender profile should
   show their MO signature and where it repeats.
3. **Make co-accused a first-class view** — "association detection" deserves its own panel:
   who works with whom, and which associations cross districts.
4. **Anomaly call-outs** — already computed, barely shown.

**Effort:** M–L · **Risk:** medium (touches the generator → full pipeline rerun)

---

### W8 · Special-occasion pattern analysis 🟢 genuinely novel

**Nobody else will have this.** The brief asks for temporal patterns; festivals and holidays
are where Indian crime data actually moves.

**Target:** classify every day as Normal · Festival · National Holiday · Election · Weekend,
then compare crime behaviour across those classes:

- Which crime heads spike during festivals (property, theft in crowds)
- Which fall (commercial burglary when premises are occupied)
- Whether the *hour* profile shifts
- District-level variation in festival effect

Surfaced as its own analytics panel with an AI narrative, and used to make the forecast
occasion-aware.

**Effort:** M · **Risk:** low · **Depends:** generator emits a calendar (may already be
inferable from dates)

---

### W9 · Debt from `00_PROJECT_ANATOMY.md` §10

Fold in while touching adjacent code:

| Item | |
|---|---|
| Link-strength slider dead | → W5 |
| Graph edge-type mix skewed to MO | → W5 |
| Audit trail in-memory | now fixable — Data Store works |
| Cache 401 | same header bypass should fix it |
| `/cases` onto live ZCQL | mapper now testable |
| "36 endpoints" → 33 | correct everywhere |
| ~~`store.mock.js` "860KB"~~ | ✅ corrected to ~48 MB |
| No frontend tests | add smoke tests |
| 46 MB cold start | shrink the bundle |

---

## 3 · Status — as of 2026-08-22

| | Workstream | State |
|---|---|---|
| W1 | Two access tiers | ✅ done |
| W2 | AI narrative layer | ✅ done — GLM-4.7 live behind the deterministic engine |
| W3 | Intelligence in four tabs | ✅ done |
| W4 | Zone system | ✅ done — computed, served, and on screen |
| W5 | Curated case variety per scope | ✅ done |
| W6 | Scoped Cases and Offenders | ✅ done |
| W7 | Recurring offender population | ✅ done — 601 → 920 merges, 7 → 197 cross-district |
| W8 | Festival and holiday patterns | ✅ done |
| W9 | Debt | ◐ partial — endpoint count and bundle comment fixed; audit persistence and frontend tests outstanding |

**Still open, in priority order**

1. **Audit persistence** — the ring buffer still loses everything on cold start. Data Store
   writes now work, so this is unblocked; it needs an `AuditLog` table creating first.
2. **Frontend tests** — 4,150 lines with no automated coverage.
3. **Association detection view** — co-accused is computed and carried on edges, but has no
   panel of its own. The brief names it explicitly.
4. **`/cases` onto live ZCQL** — the reader works at `/datastore/cases`; swapping the main
   route needs a mapper from raw columns to the enriched rows the UI expects.
5. **48 MB cold start** — every deploy ships it and the first request reads all of it.

---

## 4 · Sequence

**Phase 1 — foundation (do first, everything depends on it)**
1. **W1** role model → 2 tiers
2. **W2a** QuickML hardening — `enable_thinking: false`, response shape, insight service

**Phase 2 — the scoring gap**
3. **W2b** AI insights generated in the Job, cached into the read-model
4. **W4** zone system + AI explanation on click
5. **W3** Intelligence split into four themed tabs

**Phase 3 — depth**
6. **W5** curated case sets + fix the slider and edge mix
7. **W6** scoped Cases and Offenders
8. **W8** special-occasion analysis

**Phase 4 — if time**
9. **W7** stronger ER and association detection *(needs a pipeline rerun — do it early or not
   at all)*
10. **W9** remaining debt

> **On W7:** it requires regenerating the corpus, which changes every figure in the deck and
> README. Either do it **first** in Phase 1, or leave it. Doing it late means re-verifying
> every number under deadline.

---

## 4 · What this buys, in track language

| Track phrase | What we ship |
|---|---|
| *"absence of AI-driven approaches"* | W2 — LLM narrative on every analytical surface |
| *"reactive vs proactive"* | W4 — zone system with baseline-relative alerting |
| *"district-level drill-down"* | W1 + W6 — real two-tier scoping across every screen |
| *"emerging trend alerts, red-zone pulsing"* | W4 — literally the requested feature |
| *"repeat offender tracking, MO across jurisdictions"* | W7 |
| *"association detection"* | W7 — co-accused as a first-class view |
| *"beyond static charts into storytelling"* | W2 + W3 — narrative + period comparison |
| *"hidden correlations, anomalies, predicted risk"* | W3 "What next" tab |

---

## 5 · The one principle that must survive the overhaul

**The LLM never produces a fact.**

It receives computed figures and returns prose. Every number, every FIR reference, every
percentage on screen comes from the deterministic pipeline and is traceable to a row.

That is what separates this from a chatbot bolted onto a dashboard — and it is the answer to
the only question that really threatens an AI-heavy police tool: *"how do you know it isn't
making this up?"*
