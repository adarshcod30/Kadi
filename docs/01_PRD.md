# 01 — What you are building, and why

### KADI — AI-Driven Crime Analytics & Visualization Platform
**Program:** Datathon 2026 · Karnataka State Police × Hack2Skill · **Challenge 02**
**Deploy target:** Zoho Catalyst (mandatory — see [07](07_CATALYST_SETUP.md))
**Status:** shipped and live. Every requirement below is marked with what you actually built.

> These docs are written to you, as build instructions. Read 01 for *what* and *why*,
> [02](02_TRD.md) for *how it is wired*, [03](03_DATABASE_SCHEMA.md) for the data contract,
> and [05](05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md) for the order you built it in.
> If you are rebuilding from scratch, follow 05.

---

## 1. The one-sentence pitch

You are turning 40,836 siloed Karnataka FIRs into **one connected, explainable intelligence
picture** — one that exposes serial offenders, cross-district networks and slipping
investigations, without ever profiling a community.

Hold on to that sentence. Every feature below either serves it or gets cut.

## 2. The problem you are solving

Four things are broken, and you should be able to say all four from memory:

- **Data silos.** FIRs are registered per station and stay there. A gang working across
  three districts shows up as many unrelated petty crimes. Nobody can see the connection
  because nobody holds all the registers at once.
- **Reactive policing.** Cases drift past their detection timelines, pile up as
  "undetected", or close as "false" — and no supervisor gets a signal until it is too late.
- **Analytics gap.** Where analytics exist at all, they are static count dashboards.
  Relational and behavioural patterns go undiscovered entirely.
- **Fairness risk.** Predictive policing in India is rightly criticised for discriminating
  against caste and religious minorities. The KSP schema *contains* those fields. A
  credible solution must refuse to use them — and be able to prove the refusal.

That last point is not a disclaimer you bolt on at the end. It is a design constraint that
shapes the feature set, so treat it as one.

## 3. Goals

1. Link any FIR to related cases — same accused, co-accused, location, time window, MO,
   act & section — **across stations and districts**.
2. Surface repeat offenders and organised-crime clusters as an interactive network.
3. Give supervisors an investigation-health cockpit that flags at-risk cases *with reasons*.
4. Make every output explainable: an evidence trail on every single insight.
5. Offer a bilingual (English / ಕನ್ನಡ) assistant, by text or voice, that cites real FIRs.
6. Enforce role-based access mirroring the police hierarchy, with an audit trail.
7. Run **entirely on Catalyst**.

### Non-goals — say no to these

Writing these down is what keeps the scope survivable. You are not building:

- Real KSP data integration. You use a schema-faithful **synthetic** corpus; the pipeline
  ingests real data unchanged. See [06](06_SYNTHETIC_DATA_SPEC.md).
- Facial recognition, biometrics, or CDR / phone-tap ingestion.
- **Any** predictive use of caste, religion or occupation.
- Native mobile apps. Responsive web only.
- Case management or e-FIR filing. You *read* FIRs. You are an intelligence layer, not the
  system of record.

## 4. Who uses it

| Persona | Role in KSP | What they need from KADI |
|---|---|---|
| **Sub-Inspector / IO** | Investigating officer | "Is this FIR connected to anything? Who is this accused, really? What is my next lead?" |
| **Inspector / SHO** | Station head | Station linkage, offender watchlist, case health for the unit |
| **ACP / DySP** | Sub-division command | Cross-station patterns, where to put attention, supervisory early warning |
| **SCRB Analyst** | State Crime Records Bureau | State-wide trends, network analysis, per-capita insight, forecasting |
| **Administrator** | System admin | Roles, audit review, pipeline status, fairness report |

### The access matrix you implemented

Scoping runs off `UnitID` (police station), `DistrictID` and role rank. It is enforced
**server-side on every query** in `functions/api/services/rbac.js` — an out-of-scope read is
refused, not merely hidden in the UI. Verify that claim before you present it.

| Capability | SI | Inspector | ACP | Analyst | Admin |
|---|---|---|---|---|---|
| FIRs at own station | ✅ | ✅ | ✅ | ✅ | ✅ |
| Every FIR in the district | — | — | ✅ | ✅ | ✅ |
| All 40,836 FIRs, state-wide | — | — | — | ✅ | ✅ |
| Case-linkage graph + why-linked evidence | ✅ scoped | ✅ scoped | ✅ district | ✅ state | ✅ |
| Arrest & chargesheet detail | — | ✅ | ✅ | ✅ | ✅ |
| Per-capita analytics, forecasting, anomalies | — | — | — | ✅ | ✅ |
| Audit log | — | — | ✅ | — | ✅ |
| Fairness report & pipeline status | — | — | — | ✅ | ✅ |

## 5. Features, and what each one actually became

Priority: **P0** = demo-critical, **P1** = differentiator. All of the below ship in the
deployed build.

### F1 · Case-Linkage Graph — P0, the hero
> As an IO, when I open an FIR I want to see every related case and how they connect.

- Selecting any FIR renders an interactive ego-network centred on it — connected FIRs and
  offenders as nodes.
- Edges are **typed and labelled**: shared offender, co-accused, similar MO, same location,
  same time window, same act & section.
- Every edge is click-through to a **"why linked"** panel naming the exact matching
  attributes and the source FIR numbers. This is the feature that separates you from a
  dashboard — make sure it is the first thing you demo.
- Communities (Louvain) are grouped and expandable. 117 active networks, 7 of them
  cross-district.
- Filters: crime head, date range, district, edge type, minimum link strength.
- Reads are fast because they come from a **precomputed read-model**, never live compute.

### F2 · Repeat / habitual offender profiles — P0
- One profile per resolved identity, with name variants merged by entity resolution:
  **36,890 accused records fold into 300 real people**.
- A behaviour-based risk score (0–100) with a visible factor breakdown — prior count,
  gravity mix, recency, network centrality. **No protected attributes.** If you cannot show
  the breakdown, do not show the score.
- "Also appears in" links straight back into the graph.
- Entity-resolution confidence is displayed. Low-confidence merges are flagged, not hidden.

### F3 · Investigation health & early warning — P0
- A worklist of flagged cases: reporting delay, investigation ageing against the peer
  median, pendency, undetected risk, false-case pattern. **19,006 cases** carry at least one
  flag on the current corpus.
- Each flag states *why* and recommends a next action.
- Sort and filter by IO, station, gravity, age.
- Every metric here is deterministic and auditable. Operational numbers do not get a black
  box.

### F4 · Spatiotemporal intelligence — P1
- Satellite basemap, district choropleth, point and heat layers from real lat/long.
- Hour × weekday layering; DBSCAN hotspot clusters per crime head.
- Clicking a cluster reveals its FIRs and offers "open in linkage graph".

### F5 · Socio-economic analytics — P1, fairness-forward
- Rates **per 100,000 residents**, not raw counts. This is where the headline finding comes
  from: Kodagu is 30th by count and 6th per capita.
- Correlations against area-level indicators with p-values — urbanisation r=+0.878,
  literacy r=+0.538, population density r=+0.889 across n=31 districts.
- **Hard guardrail:** these are *area-level* indicators only. They are never joined to an
  individual and never used as a feature in any person-level score.
- Three-month district forecast with a 95% interval, backtested to **3.9% MAPE**.

### F6 · Explainability & audit — P0, the trust layer
- Every edge, score and answer exposes how it was produced.
- A visible fairness statement listing what is excluded.
- Sensitive reads (case detail, offender detail, graph, assistant queries) are written to an
  audit trail.

### F7 · Bilingual assistant — P1
- Grounded Q&A over the records in English and ಕನ್ನಡ, by text or voice.
- Every answer cites the FIR numbers it drew from.
- Export the conversation as a print-ready briefing.
- **Be honest about this one.** It runs a deterministic intent engine over the case
  database, not an LLM — see [08](08_CATALYST_LIVE.md) for why QuickML is not wired. The
  upside is real: it cannot hallucinate an FIR number.

### F8 · Auth & RBAC — P0
- Catalyst Authentication is provisioned. The demo build presents a **role chooser** so an
  evaluator can exercise all five scopes without five accounts.
- The API still trusts a role header rather than a verified JWT. **Say this out loud** —
  the login screen says it too. Binding it properly is one function; see
  [05](05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md) §Next.

### F9 · Home dashboard — P0
- Role-aware landing page: KPI cards, monthly trend, hour × weekday heatmap, disposal
  funnel, and the rank-shift finding.

## 6. What "good" looks like

You should be able to demonstrate all six of these live:

- The graph reconstructs the planted gangs and serial chains — **100% ground-truth
  recovery**, recomputed on every pipeline run, never hand-entered.
- Investigation health flags the planted slipping cases with correct reasons.
- A cross-silo link spans ≥2 districts and ≥3 stations, on stage.
- The assistant answers an English *and* a Kannada question with citations.
- You can answer "how do you avoid discrimination?" in one confident sentence, and then
  show the test that enforces it.
- Everything runs from the deployed Catalyst URL.

## 7. Submission checklist

- [x] Live solution deployed **on Catalyst**
- [x] Public GitHub repo with README and setup steps
- [x] Demo video (problem → prototype → workflows)
- [x] Prototype brief, ≤1024 characters — `docs/deck/PROTOTYPE_BRIEF.txt`
- [x] Official PPT template filled — `docs/deck/`, 20 slides
- [x] All links tested and public

## 8. Assumptions you are working under

- Synthetic data is acceptable and expected; real FIR data is confidential.
- Catalyst free credits cover the build.
- Deployment is **exclusively** on Catalyst. Substituting a third-party host may invalidate
  the submission — do not be tempted, however convenient the alternative looks.

## 9. Risks, and what you did about each

| Risk | What you did |
|---|---|
| 30 s request cap on Functions **and** AppSail | All heavy compute moved to a Job (15-min budget). The web tier only reads precomputed results. This one constraint shaped the whole architecture. |
| Scope creep | F1/F2/F3/F6/F8/F9 shipped first; F4/F5/F7 layered after. |
| Data realism | Ground-truth patterns planted explicitly and scored every run; data labelled synthetic everywhere it appears. |
| Fairness backfire | Protected attributes excluded by construction, and a unit test fails the build if one appears in a feature set. |
| Presentation neglect (~half the score) | Deck and video owned from day one, not the final night. |

## 10. Where to go next

- **How it is wired** → [02_TRD.md](02_TRD.md)
- **The data contract** → [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md)
- **How it should look** → [04_UI_UX_GUIDELINES.md](04_UI_UX_GUIDELINES.md)
- **The build order** → [05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md](05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md)
- **How the corpus is generated** → [06_SYNTHETIC_DATA_SPEC.md](06_SYNTHETIC_DATA_SPEC.md)
- **Getting it onto Catalyst** → [07_CATALYST_SETUP.md](07_CATALYST_SETUP.md)
- **What is live right now** → [08_CATALYST_LIVE.md](08_CATALYST_LIVE.md)
