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

You are turning 59,985 siloed Karnataka FIRs into **one connected, explainable intelligence
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
- Full case management. KADI now accepts an FIR and a lifecycle change through an approval
  chain (F12), but it is still an intelligence layer over a register, not the register itself:
  there is no charge-sheet drafting, no court workflow, no property or exhibit tracking.

## 4. Who uses it

| Persona | Tier | What they need from KADI |
|---|---|---|
| **Sub-Inspector (IO)** | Station | "Is this FIR connected to anything? Who is this accused, really? What is my next lead?" |
| **Station House Officer** | Station | The station's own register, its offender watchlist, its case health — and, deliberately, nothing beyond it |
| **DySP / ACP** | District | Cross-station patterns, where to put attention, supervisory early warning |
| **Superintendent of Police** | District | The district's whole caseload, and the approval queue for cases its stations file |
| **SCRB Analyst** | State | State-wide trends, network analysis, per-capita insight, forecasting |
| **State DGP** | State | The state view, plus approval authority anywhere |
| **Administrator** | State | Accounts, audit review, pipeline status, fairness report |

### The access matrix, as built

**Three tiers, mirroring how the force is organised** — state, district, station. Each is a
real read boundary enforced **server-side on every query** in
`functions/api/services/rbac.js`, not a label on a menu. An out-of-scope read is refused.

The station tier is the one the whole product argues against: an SHO sees their own register
and nothing else, which is precisely the silo the brief describes. Giving that view its own
login makes the argument demonstrable rather than asserted — you can stand in it, see how
little is visible, and then step up a tier.

| Capability | SI / SHO | DySP | SP | Analyst | DGP | Admin |
|---|---|---|---|---|---|---|
| FIRs at own station | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Every FIR in the district | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| All 59,985 FIRs, state-wide | — | — | — | ✅ | ✅ | ✅ |
| Case-linkage graph + why-linked evidence | ✅ station | ✅ district | ✅ district | ✅ state | ✅ | ✅ |
| Per-capita analytics, forecasting, anomalies | — | ✅ district | ✅ district | ✅ state | ✅ | ✅ |
| **Register a case** | ✅ | — | — | — | — | — |
| **Approve a case or a lifecycle change** | — | — | ✅ own district | — | ✅ anywhere | ✅ anywhere |
| Approve an account request | — | — | — | — | ✅ | ✅ |
| Audit log | — | — | ✅ | ✅ | ✅ | ✅ |
| Fairness report & pipeline status | — | — | — | ✅ | ✅ | ✅ |

**Scope comes from the account, not from a header.** A signed-in officer's district and
station are read out of the HMAC-signed session token, so SP Mysuru cannot reach Bengaluru
City by editing a URL, a header, or anything else a browser can set. The demo role chooser
survives alongside it because it is honestly labelled as a demo — 36 provisioned
`@ksp.gov.in` accounts are listed in `docs/ACCESS_CREDENTIALS.md`.

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
- Communities (Louvain) are grouped and expandable. **127 active networks, 335 of them
  spanning more than one district** — the cross-silo finding, stated as a count.
- Filters: crime head, date range, district, edge type, minimum link strength.
- Reads are fast because they come from a **precomputed read-model**, never live compute.

### F2 · Repeat / habitual offender profiles — P0
- One profile per resolved identity, with name variants merged by entity resolution:
  **54,337 accused records resolve into 578 repeat-offender identities**, recovered at
  85.9% against planted ground truth.
- A behaviour-based risk score (0–100) with a visible factor breakdown — prior count,
  gravity mix, recency, network centrality. **No protected attributes.** If you cannot show
  the breakdown, do not show the score.
- "Also appears in" links straight back into the graph.
- Entity-resolution confidence is displayed. Low-confidence merges are flagged, not hidden.

### F3 · Investigation health & early warning — P0
- A worklist of flagged cases: reporting delay, investigation ageing against the peer
  median, pendency, undetected risk, false-case pattern. **26,168 cases** carry at least one flag on the
  current corpus, 16,136 of them serious.
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
  from: Kodagu is 31st by count and 6th per capita.
- Correlations against area-level indicators with p-values — urbanisation r=+0.88,
  literacy r=+0.546, population density r=+0.871 across n=31 districts.
- **Hard guardrail:** these are *area-level* indicators only. They are never joined to an
  individual and never used as a feature in any person-level score.
- Three-month district forecast with a 95% interval, backtested to **7.8% MAPE** over three
  withheld months. The figure is read live from the artifact, never hardcoded in the UI.
- The forecaster detects **level shifts** and refits from after them. It matters here: the
  corpus steps from ~1,300 registrations a month to ~2,300 in Jan 2026 and stays there, and a
  trend line drawn across that break scored 24.4% MAPE while predicting ~1,780 against ~2,340
  actual — every month, in the same direction. A consistent one-directional miss is the wrong
  model, not noise.

### F6 · Explainability & audit — P0, the trust layer
- Every edge, score and answer exposes how it was produced.
- A visible fairness statement listing what is excluded.
- Sensitive reads (case detail, offender detail, graph, assistant queries) are written to an
  audit trail.

### F7 · Bilingual assistant — P1
- Grounded Q&A over the records in English and ಕನ್ನಡ, by text or voice.
- Every answer cites the FIR numbers it drew from.
- Export the conversation as a print-ready briefing.
- **Deterministic first, model second, and the order is the point.** Every number, name and
  percentage is computed from the records by deterministic code. The model is asked only how
  to say it, never what is true, so it cannot invent an FIR number or a statistic.
- **Voice both ways, and honest about what it can do.** Speech-to-text and read-aloud run in
  the browser. Chrome ships no Kannada speech voice on most machines, so the voice list is
  inspected up front and the page states what it can actually do rather than offering a button
  that does nothing. Microphone errors appear in the page, not in an `alert()`.
- **Every answer can be read aloud, stopped, or shown in the other language** without re-running
  the query — re-asking could return different numbers, and the point is to read the *same*
  answer in another language.
- **Provenance is visible.** An answer computed from the records and one retrieved from the
  knowledge base are different kinds of claim, and each is labelled.
- **A Kannada question that misses the intent patterns is retried in English** before falling
  through to the knowledge base. Without it, "Which cases are slipping?" asked in Kannada
  returned "no information is provided" for a question the records answer exactly.
- When a question is not one the intent engine recognises, it falls through to **QuickML RAG**
  over a 12-document knowledge base built from these docs (`docs/knowledge_base/`), and the
  answer is labelled as coming from the knowledge base rather than from the records.
- Narrative surfaces (the intelligence bands, React, Forecast) are narrated the same way. A
  system prompt forbids the model from combining two findings into a relationship or renaming
  what a number counts, because both were observed: "74 offenders active across districts"
  came back as "74 of the currently active cases", and a cluster's 70 cases as "Bengaluru City
  accounts for 70%".

### F8 · Auth & RBAC — P0
- **Real sign-in**, alongside the demo role chooser rather than instead of it. Email and
  password against a provisioned `@ksp.gov.in` account; scrypt with a per-account salt;
  an HMAC-signed stateless session token carrying the district and station.
- Scope comes from the **token**, so a signed-in officer cannot widen it. The demo path still
  trusts `x-kadi-role` and is labelled as a demo, which is the only reason that is acceptable.
- The signing secret lives in the `AppConfig` Data Store table, not in the repository and not
  in the committed function config. A per-process key was the first attempt and it silently
  logged officers out on every cold start.
- Sign-up is a **request**, not an account: pending until the DGP or the Administrator
  approves it, enforced at the login endpoint rather than hidden from a menu.
- The session token travels as `x-kadi-token`. Catalyst's gateway claims `Authorization` for
  its own OAuth and rejects the request before the function ever runs.

### F10 · React — P0, the queue
> As an officer with an hour before a review meeting, what do I do first?

- One ranked queue merging four signal sources that already existed on four different screens
  with four different orderings: cases failing their health rules, high-risk offenders who are
  still active, stations sharply above their own baseline, and cases outside your scope that
  link into it.
- **Severity first, then urgency within severity.** A case's urgency is how far past the peer
  median *for its own type* it has run — not raw age, because an old case of a slow type is
  not in trouble and a young one of a fast type may be.
- Every item carries the action, not just the finding. A queue that says what is wrong but
  not what to do is a report with extra steps.
- Present tense only. Nothing here is predicted; that is Forecast, deliberately separate.

### F11 · Forecast — P1, what is coming
- **Emerging risk** ranked by z-score against each district-and-crime-type's *own* history,
  not by absolute rise. A district that always runs 400 a month going to 430 is noise; one
  that runs 12 going to 40 is a signal, and ranking by size surfaces the first and buries the
  second every time.
- **Co-occurrence** between crime types scored by lift over district-months — how much more
  often two types appear together than if they were unrelated. Raw counts would just rank the
  two commonest crimes together everywhere.
- Monthly momentum and a **time-of-day shift profile**, so location and time together make a
  patrol window rather than a chart.
- Every projection is shown with its backtest error. A projection without a track record is a
  guess with a chart.

### F12 · Case entry and approval — P1, the write path
> Until this, KADI only read, which made the station tier a spectator.

- A station officer registers an FIR; it stands only once a supervisor approves it. An SP
  approves their own district; the DGP and the Administrator approve anywhere.
- Lifecycle changes — arrest, chargesheet, closure, status, a party added later — go through
  the same gate and carry **before and after**, so the trail records what changed rather than
  merely that something did.
- **Scope on the way in comes from the account, never the form.** A submission's district and
  station are taken from the signed-in officer; taking them from the request body would let a
  hidden field file a case into someone else's district, and every scoped read downstream
  would honour it.
- An approved case joins the register **immediately** and is marked *"registered, awaiting
  overnight analysis"*. Linkage, entity resolution, risk and health are computed by the
  offline pipeline over the whole corpus and cannot run per request, so an empty link list on
  a new case means "nothing has looked yet", not "unconnected". Saying nothing there would
  invert the claim the product rests on.

### F13 · A trained model, and the floor under it — P2
- The pipeline writes `derived/training_set.csv` every run: **7,022 rows** over 248
  district-by-crime-head monthly series, with lag, rolling-mean and calendar features and no
  person-level attribute of any kind.
- Model building is a **console workflow** — QuickML exposes no REST surface for datasets,
  pipelines or models — so everything either side of it is automated and the middle is a
  deliberate act. Silent automatic retraining on a police system is a liability.
- The served forecast is **whichever of model and baseline backtests better**, and the
  response says which answered and what both scored. A model that loses to the baseline does
  not ship just because it is a model.
- **Why volume and not case outcome.** The obvious pitch is a detection classifier. We
  measured it first: detection runs at a 68.7% base rate and moves under two points across
  crime head (69.9 / 70.7 / 70.3 / 70.1), linkage (67.8 vs 69.8 — backwards) and gravity
  (70.1 vs 68.5). The only feature that separates is the health flag, and that is circular —
  a case is flagged *because* it is stalling. Such a model would predict the base rate for
  everything and call it intelligence.

### F14 · Bilingual interface — P0, and it means the whole interface
> Switching to ಕನ್ನಡ used to change the answers and leave the buttons in English.

- **605 interface strings, 99% pre-translated** into `client/src/lib/kn.json` — built once by
  a script and *committed*, so the toggle is instant and the Kannada can be corrected in a diff
  by someone who reads it. The remainder resolve at runtime and cache in the browser.
- Coverage does not depend on anyone remembering to wrap a string. A DOM-level translator walks
  the rendered text and the placeholder, title and aria-label attributes.
- **What it refuses to touch is the design.** Anything inside `[data-notranslate]`, `.font-mono`
  or `.font-num`, any form control, and anything that looks like an identifier, a figure, a date
  or a URL. An FIR number rendered in Kannada numerals is a corrupted record, and an officer
  searching for `100010064202600888` must find it whatever language the chrome is in. The
  exclusions are deliberately over-broad: leaving a label in English costs nothing.
- **Zia translates, speaks and listens — through QuickML, not the SDK.** An earlier probe of
  `catalyst.zia()` found object detection, OCR, barcode, face analysis, sentiment, keyword
  extraction and NER and nothing linguistic, and concluded the platform had none. That was
  right about the SDK and wrong about Catalyst: the three models ship as QuickML **Trained NLP
  Models** on a different host path. All three are now wired:
  - **Text Translation** (11 languages) is the primary translator. Its Kannada is markedly
    better than the LLM's — "Which cases are slipping?" went from roughly *"what operation is
    being left"* to *"ಯಾವ ಪ್ರಕರಣಗಳು ಜಾರಿಬೀಳುತ್ತಿವೆ"*. The LLM stays as the fallback.
  - **Text-to-Audio** (en/hi/kn, three Kannada speakers) reads answers aloud, so read-aloud
    works on machines with no Kannada system voice — which is most of them.
  - **Audio-to-Text** (en/hi/kn) backs voice input where the browser's own recogniser is weak.
  - Translations are batched, cached on the **masked** template, and identifiers are masked out
    before the model sees them and restored after.
- The cache is keyed on the **masked** text. Sixty worklist rows reading "Open 1283 days — 2.6x
  the peer median (501d)" are one template: one model call and fifty-nine cache hits instead of
  sixty calls. This is what makes translating a data-heavy page affordable at all.
- A translation that lost a placeholder is **refused**. Fluent Kannada with the numbers silently
  gone is worse than a sentence left in English.

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
- **File a case as an SI, approve it as the SP, and watch it appear in the register marked as
  awaiting analysis** — then try to approve it as SP Mysuru and be refused.
- React answers "what do I do today" in one ranked list, and every item names its action.
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
| A new case looking analysed when it is not | Approved cases are labelled *awaiting overnight analysis* in the register, on the detail page, and in the API response. |
| The model losing to the baseline | Serve whichever backtests better, keep the statistical forecast as the floor, and show both errors. |
| A forecaster that ignores a structural break | Level-shift detection with a test, after fitting across one cost 24.4% MAPE and a consistent one-directional miss. |
| Trusting a store's own insert response | Catalyst's row insert answers with a ROWID that is not the row's. Submissions mint their own key. |

## 10. Where to go next

- **How it is wired** → [02_TRD.md](02_TRD.md)
- **The data contract** → [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md)
- **How it should look** → [04_UI_UX_GUIDELINES.md](04_UI_UX_GUIDELINES.md)
- **The build order** → [05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md](05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md)
- **How the corpus is generated** → [06_SYNTHETIC_DATA_SPEC.md](06_SYNTHETIC_DATA_SPEC.md)
- **Getting it onto Catalyst** → [07_CATALYST_SETUP.md](07_CATALYST_SETUP.md)
- **What is live right now** → [08_CATALYST_LIVE.md](08_CATALYST_LIVE.md)
