# 01 — Product Requirements Document (PRD)
### KADI — AI-Driven Crime Analytics & Visualization Platform
**Program:** Datathon 2026 · Karnataka State Police × Hack2Skill · **Challenge 02**
**Deploy target:** Zoho Catalyst (mandatory)
**Status:** v1 for build

---

## 1. Vision
Give every KSP investigator and supervisor a single pane of glass that **connects fragmented FIRs into intelligence** — exposing serial crimes, offender networks, and slipping investigations — in a way that is **explainable, fair, and operationally actionable**. Move KSP from reactive, Excel-bound reporting to proactive, evidence-based policing without ever profiling communities.

## 2. The problem (as stated by KSP + observed in the data)
- **Data silos.** FIRs are registered per station and live in isolation. A gang operating across stations/districts appears as many unrelated petty crimes. Cross-jurisdiction connections are invisible.
- **Reactive policing.** No systematic early warning: cases drift past detection timelines, pile up as "undetected," or close as "false" with no supervisory signal.
- **Analytics gap.** Where analytics exist, they are static dashboards; deeper behavioral, relational, and network patterns go undiscovered.
- **Fairness risk.** Naive predictive policing in India is criticized for discriminating against caste/religion minorities. The dataset contains these fields — a credible solution must *refuse* to use them for prediction and prove it.

## 3. Goals & non-goals
**Goals**
1. Automatically **link a new/selected FIR to related cases** (same accused, co-accused, location, time window, MO) across stations and districts.
2. Surface **repeat/habitual offenders and organized-crime clusters** as an interactive network.
3. Provide an **Investigation-Health cockpit** that flags at-risk cases and recommends the next action.
4. Deliver **explainable** outputs (evidence trail on every insight) and a **fairness guardrail** that excludes protected attributes.
5. Offer a **natural-language + Kannada voice assistant** to query everything and export briefings to PDF.
6. Enforce **role-based access** mirroring the police hierarchy, with full audit logging.
7. Run **entirely on Catalyst** and be demo-ready in a 7-minute pitch.

**Non-goals (explicitly out of scope for the hackathon build)**
- Real/live KSP data integration (we use a schema-faithful **synthetic** dataset; the pipeline ingests real data unchanged).
- Facial recognition, biometric matching, phone-tap/CDR ingestion.
- Any predictive use of caste, religion, or occupation.
- Native mobile apps (responsive web only).
- Full case-management / e-FIR filing workflow (we *read* FIRs; we are an intelligence layer, not the system of record).

## 4. Users & personas
| Persona | Role in KSP | Primary need in KADI |
|---|---|---|
| **Sub-Inspector (SI) / IO** | Investigating officer | "Is this FIR connected to anything? Who is this accused, really? What's my next lead?" |
| **Inspector / SHO** | Station head | Station-level linkage, offender watchlist, case health of the station. |
| **ACP / DySP** | Sub-division command | Cross-station patterns, resource/attention allocation, supervisory early warning. |
| **SCRB Analyst** | State Crime Records Bureau | State-wide trends, network analysis, socio-demographic (vulnerability) insight, reports. |
| **Admin** | System admin | User/role management, audit review, data ingestion. |

### Role-based access matrix (enforced in Data Store scopes + API)
| Capability | SI/IO | Inspector | ACP | Analyst | Admin |
|---|---|---|---|---|---|
| View own/station FIRs | ✅ own+station | ✅ station | ✅ subdivision | ✅ state (read) | ✅ |
| Case-linkage graph | ✅ scoped | ✅ scoped | ✅ subdivision | ✅ state | ✅ |
| Offender profiles | ✅ | ✅ | ✅ | ✅ | ✅ |
| Investigation Health cockpit | own cases | station | subdivision | state | ✅ |
| Socio/vulnerability analytics | ❌ | limited | ✅ | ✅ | ✅ |
| Export PDF briefings | ✅ | ✅ | ✅ | ✅ | ✅ |
| User & role management | ❌ | ❌ | ❌ | ❌ | ✅ |
| Audit log review | ❌ | ❌ | ✅ (own subdiv) | ❌ | ✅ |

*Scoping uses `Unit` (police station), `District`, and role hierarchy. Analysts get state-wide **read**; they cannot alter case data.*

## 5. Features & requirements
Each feature lists user stories and **acceptance criteria (AC)**. Priority: **P0** = demo-critical (build first), **P1** = strong differentiator, **P2** = nice-to-have.

### F1. Case-Linkage Graph — **P0 (the hero)**
> As an IO, when I open an FIR, I want to see every related case and how they connect, so I can identify serial crimes and gangs I'd otherwise miss.

- **AC1:** Selecting any FIR renders an interactive node-link graph centered on it, with connected FIRs, accused, victims, and locations as nodes.
- **AC2:** Edges are typed and labeled: *shared accused*, *co-accused*, *same location (≤X km)*, *same time window*, *similar MO*, *same act/section*.
- **AC3:** Every edge is **click-through** to a "Why linked" panel listing the exact matching attributes and source FIR numbers.
- **AC4:** Offender/gang **clusters** (community detection) are visually grouped and can be expanded/collapsed.
- **AC5:** Filters: crime head, date range, district, edge type, minimum link strength.
- **AC6:** Links span **across stations and districts** (cross-silo) — demonstrably, using planted synthetic gangs.
- **AC7:** Graph reads are **fast** (<1.5s) because they come from precomputed data (NoSQL/Cache), never live compute.

### F2. Repeat / Habitual Offender Profiles — **P0**
> As an Inspector, I want a single profile per offender linking all their cases and behavior, so I can prioritize watchlists.

- **AC1:** Offender page aggregates all FIRs for a resolved identity (name variants merged via entity resolution), with MO signature, jurisdictions touched, arrest/surrender & bail history, co-offenders.
- **AC2:** A **behavior-based risk score** (0–100) with a breakdown of contributing factors (prior count, gravity mix, recency, network centrality) — **no protected attributes**.
- **AC3:** "Also appears in" list linking to the graph.
- **AC4:** Entity-resolution confidence is shown; low-confidence merges are flagged, not hidden.

### F3. Investigation-Health & Early Warning — **P0 (secondary hero)**
> As an ACP, I want to know which cases are slipping before they become failures, so I can intervene.

- **AC1:** Cockpit lists cases with health flags: **reporting delay** (IncidentFromDate → InfoReceivedPSDate), **investigation ageing** (CrimeRegisteredDate → today vs. peer median), **pendency**, **undetected risk**, **false-case pattern**.
- **AC2:** Each flagged case shows *why* it's flagged and a **recommended next action** (e.g., "3 linked cases share accused A2 — consolidate investigation").
- **AC3:** Anomaly detection highlights cases deviating from norms for their crime type/area.
- **AC4:** Sort/filter by IO, station, gravity, age; export the worklist.
- **AC5:** Metrics are deterministic and auditable (no black box on operational numbers).

### F4. Spatiotemporal Intelligence — **P1 (supporting, not the star)**
> As an analyst, I want to see where and when clusters form, to support linkage and deployment.

- **AC1:** District-level choropleth + point/heat map from `latitude`/`longitude`.
- **AC2:** Time-of-day × day-of-week heat layer; hotspot clusters (DBSCAN) per crime head.
- **AC3:** Clicking a cluster reveals its FIRs and offers "open in linkage graph."
- **AC4:** Emerging-trend flag when a crime head spikes vs. its historical baseline in an area.

### F5. Sociological / Vulnerability Insight — **P1 (fairness-forward)**
> As an analyst, I want to understand victim vulnerability and social context to guide prevention — never to profile suspects.

- **AC1:** Analytics on **victim/complainant** attributes (age band, gender, occupation) and crime type — framed as *vulnerability & victim-support*, not suspect prediction.
- **AC2:** Correlations with area-level socio-economic context (urbanization proxy) for prevention planning.
- **AC3:** **Hard guardrail:** caste/religion never feed any model or offender-facing view; if shown at all, only as aggregate victim-support context with an explicit disclaimer.

### F6. Explainability & Audit Trail — **P0 (trust layer)**
- **AC1:** Every edge, score, and AI answer exposes "How was this produced?" with sources.
- **AC2:** A visible **fairness panel**: lists inputs used and explicitly states protected attributes are excluded.
- **AC3:** All user queries and AI responses are written to an **AuditLog** (who, what, when).

### F7. Conversational + Kannada Voice Assistant — **P1 (borrowed wow)**
> As any user, I want to ask questions in English or Kannada, by text or voice, and get grounded answers.

- **AC1:** Text chat answers over the **structured DB** (LLM + ZCQL) — e.g., "show cyber-crime FIRs in Bengaluru this quarter."
- **AC2:** Answers over **documents** (IPC/BNS sections, SOPs) via **RAG**.
- **AC3:** **Voice** input/output; **Kannada** supported (via Zia STT/translation/TTS — *verify Kannada coverage with Catalyst; fallback: LLM handles Kannada text + Zia translation*).
- **AC4:** Every answer cites source FIRs/documents; **export conversation to PDF**.
- **AC5:** Assistant can deep-link into the graph/cockpit ("show me on the graph").

### F8. Auth & Role-Based Access — **P0**
- **AC1:** Catalyst Authentication login (embedded); optional social login.
- **AC2:** Role assigned per user; data + views scoped per §4 matrix; enforced in API and Data Store scopes.
- **AC3:** Session handling, sign-out, and unauthorized-access handling.

### F9. Home Dashboard — **P0**
- **AC1:** Role-aware landing page: KPI cards (open cases, flagged cases, active offender networks, new links today), recent alerts, quick search, jump-in to graph/cockpit.

## 6. Success metrics (what "good" looks like in the demo)
- On planted data, the graph **correctly reconstructs ≥90%** of injected gangs/serial chains (measurable against ground truth).
- Investigation-Health flags the **planted slipping cases** with correct reasons.
- Cross-silo link demonstrably spans **≥2 districts and ≥3 stations** in the live demo.
- Assistant answers an English **and** a Kannada question correctly on stage, with citations + PDF export.
- Fairness panel is shown; team can answer "how do you avoid discrimination?" in one confident sentence.
- Everything runs from the **deployed Catalyst URL**.

## 7. Hackathon compliance (must all be true at submission)
- [ ] Live solution deployed **on Catalyst**.
- [ ] Public **GitHub** repo + README + setup/run steps.
- [ ] Public **demo video** (problem → prototype → workflows).
- [ ] **Prototype brief** (problem, features, stack, impact).
- [ ] Official **PPT template** filled, exported to PDF (≤5 MB).
- [ ] All links tested and public.

## 8. Assumptions
- Synthetic data is acceptable and expected (real FIR data is confidential).
- Catalyst free credits cover the build (per Zoho session, they are "more than sufficient").
- Kannada voice is achievable via Zia; if a specific model is missing, text-Kannada + translation is the fallback.

## 9. Key risks → mitigations
- *Function 30s timeout* → all heavy compute in AppSail/Jobs; app reads precomputed results.
- *Scope creep* → F1/F2/F3/F6/F8/F9 are P0; ship those first; F4/F5/F7 layered after.
- *Data realism* → plant explicit ground-truth patterns; label data synthetic.
- *Fairness backfire* → protected attributes excluded by design and shown as excluded.
- *Presentation neglect* (~50% of score) → deck + demo video owned from day 1.

## 10. Milestones (see `05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md` for the detailed plan)
1. Skeleton deployed on Catalyst reading one real query (week 1).
2. Case-Linkage Graph + offender profiles (week 2).
3. Investigation Health + spatiotemporal + fairness/audit (week 3).
4. Assistant + Kannada voice + PDF export (week 3–4).
5. Harden, seed demo path, deck + video + rehearsal (final week).
