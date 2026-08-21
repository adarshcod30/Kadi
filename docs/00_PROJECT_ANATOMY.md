# 00 — KADI, end to end

### Every part of this project, from scratch, with nothing hidden

**Written:** 2026-08-20 · **Verified against:** the code at commit `195cd2b` and the live
deployment, not from memory.

This is the reference to read before deciding what to refine. It documents what exists, what
works, what does not, and where the numbers came from. Where a claim elsewhere in the repo
is **wrong**, this file says so and gives the measured value instead.

> **Standing rule for this document:** every figure here was produced by running something —
> a query, a `wc -l`, a `curl`, a `du`. Nothing is quoted from another document. Where I could
> not verify something, it says so explicitly.

**Contents**

1. [The project in one page](#1--the-project-in-one-page)
2. [Repository anatomy](#2--repository-anatomy)
3. [The data layer](#3--the-data-layer)
4. [The pipeline](#4--the-pipeline)
5. [The read-model](#5--the-read-model)
6. [The API](#6--the-api)
7. [The client](#7--the-client)
8. [Catalyst services](#8--catalyst-services)
9. [Tests](#9--tests)
10. [Everything that is wrong or unfinished](#10--everything-that-is-wrong-or-unfinished)
11. [Refinement backlog](#11--refinement-backlog)

---

## 1 · The project in one page

**KADI** — *Karnataka Analytics & Detection Intelligence*. `ಕಡಿ / कड़ी` means "a link in a
chain", which is what the product does.

**The problem.** Karnataka's FIRs are registered per police station and stay there. A gang
operating across three districts appears as many unrelated petty crimes, because no single
register holds them all. Analysis is Excel-driven and retrospective, so cases drift past
detection timelines with no supervisory signal. And the FIR schema contains caste, religion
and occupation — so any predictive system built on it risks discriminating, which is the
standard and fair criticism of predictive policing in India.

**The solution.** Fold 40,829 FIRs into one graph where every edge is provable evidence, then
build analytics on top that explain rather than merely count — and exclude protected
attributes by construction, enforced by a test rather than a policy.

**Scale of the codebase**, measured:

| Area | Files | Lines |
|---|---:|---:|
| `client/src` — React SPA | 29 | 4,150 |
| `appsail/pipeline` — Python analytics | 16 | 2,394 |
| `data/generator` — synthetic corpus | 5 | 1,701 |
| `functions/api` — Node REST API | 12 | 1,748 |
| **Total** | **62** | **~10,000** |

**Live URLs**

| What | Where |
|---|---|
| Application | `https://kadilabs-60078029367.development.catalystserverless.in/app/` |
| API base | `…/server/api` |
| AppSail | `https://kadi-appsail-50043957273.development.catalystappsail.in` |
| Repository | `https://github.com/adarshcod30/Kadi` |

---

## 2 · Repository anatomy

Five top-level folders. Everything else was removed in the consolidation at `8d3c1f5`.

```
appsail/     Python analytics — the pipeline and the AppSail service
client/      React SPA
data/        Synthetic corpus generator
docs/        These documents + docs/deck (submission artefacts)
functions/   Node REST API + the nightly Cron Job
```

### `functions/` — the API and the Job

```
functions/
├── api/                          the Advanced I/O Function
│   ├── index.js                  Catalyst entry point; wraps app.js
│   ├── app.js                    every route (see §6)
│   ├── lib/envelope.js           one response shape, one error shape
│   ├── services/
│   │   ├── queries.js            every read against the bundle — the heart of the API
│   │   ├── store.mock.js         loads CSVs + derived JSON into memory (the "seam")
│   │   ├── rbac.js               role → scope; enforced per query
│   │   ├── assistant.js          the grounded intent engine
│   │   ├── audit.js              in-memory ring buffer
│   │   ├── datastore.js          ZCQL adapter (new — see §8)
│   │   ├── cache.js              Catalyst Cache adapter (401, see §10)
│   │   ├── quickml.js            GLM-4.7 adapter (gated off)
│   │   └── zia.js                STT/TTS adapter (not enabled)
│   ├── data/derived/*.json       the precomputed read-model
│   ├── catalyst-config.json      memory + env — MUST be committed
│   └── package.json              function folder is self-contained
├── refreshanalytics/
│   ├── index.js                  the Cron Job — MUST be named index.js
│   └── catalyst-config.json
├── local-server.js               runs the API on :9000 without Catalyst
└── test/api.test.js              8 Node tests
```

**Two hard-won constraints encoded here:**

- `refreshanalytics/index.js` **must** be called `index.js`. Named `main.js`, the Job fails
  silently with zero logs — nothing to debug, because nothing is emitted.
- `catalyst-config.json` files **must** be committed. They look like config that belongs in
  `.gitignore`; deploy fails without them.

### `appsail/` — Python compute

```
appsail/
├── app.py                        the AppSail HTTP service — STDLIB ONLY
├── app-config.json               command, stack, memory
├── requirements.txt              intentionally empty (see below)
├── requirements-dev.txt          the real dependency list, for local + Job
├── pipeline/                     16 modules, 2,394 lines (see §4)
├── jobs/                         Job entry points
├── tests/test_pipeline.py        11 Python tests
└── data/                         6 lookup CSVs the AppSail service reads
```

> **The AppSail trap.** Packages listed in `requirements.txt` **do not install** in the
> managed container. The service must be stdlib-only — which is why `app.py` uses a
> csv/namedtuple shim instead of pandas. The symptom is that the service will not start and
> emits **zero logs**, which looks exactly like a port or command misconfiguration and is not.

### `client/` — the SPA

```
client/src/
├── pages/          14 route components
├── components/     Shell, ui, viz, illustrations, HomeAnalytics, AboutSections
├── features/graph/ GraphCanvas.tsx, WhyPanel.tsx — the hero screen
├── api/hooks.ts    TanStack Query hooks, one per endpoint
└── lib/            api.ts (fetch + role header), i18n.ts (58 keys), types.ts
```

### `data/` — the generator

```
data/generator/     generate.py, patterns.py, karnataka.py + 2 more (1,701 lines)
data/output/        29 CSVs — gitignored, regenerable with seed 2026
```

---

## 3 · The data layer

### Everything is synthetic — and that is a deliberate, disclosed choice

No real case, person or complainant appears anywhere. Real KSP records cannot leave KSP. The
corpus is generated against the **real schema, real geography and real published statistics**,
so the analytics exercise the same shapes they would in production.

### What the generator produces

| Table | Rows |
|---|---:|
| CaseMaster (FIRs) | **40,829** |
| Victim | 50,656 |
| Accused | **36,582** → 300 resolved identities |
| ComplainantDetails | ~40,000 |
| ArrestSurrender | ~30,000 |
| ActSectionAssociation | ~90,000 |
| ChargesheetDetails | ~28,000 |
| Districts / stations | 31 / 298 |

Span: Jan 2023 → Jul 2026, 43 months. Seed `2026`, regenerates byte-for-byte.

> **Corrected figure.** The accused count was written as **36,289** in nine places across the
> README, five docs and the deck. The generated table holds **36,582**. Fixed at `82e9154`.
> The About page in the app read the right number all along.

### How realism is achieved

1. **Real skeleton** — 31 actual districts, 298 stations, the IPC/BNS/IT/NDPS section list
   and the KSP crime taxonomy.
2. **Volume from published statistics** — Bengaluru City carries ~16,900 FIRs; small rural
   districts a few hundred. That lopsidedness is what makes the per-capita finding land.
3. **Coordinates rejection-sampled inside real district polygons** using shapely. A bounding
   box would put incidents in the Arabian Sea and in Tamil Nadu — the first thing anyone
   notices on a map. 100% of points are on land, inside Karnataka.
4. **Kannada name pool with deliberate variants** — "Ravi Kumar" / "Ravikumar R" / "Ravi K."
   Entity resolution has nothing to prove without them.
5. **Seven planted ground-truth patterns**, written to `_ground_truth.json` **before** the
   pipeline runs. The pipeline never reads that file; `evaluate.py` scores against it after.

### Where the synthetic origin shows — state these before being asked

- MO narratives are template-drawn, so cleaner and more uniform than real free text. One
  observed case reads *"…injured the complainant office hours"* — a dangling template slot —
  and its incident timestamp (02:05) contradicts "office hours".
- The urbanisation correlation is **partly circular**: the generator weights urban crime
  upward, so finding that urbanisation correlates with crime rate partly confirms an input.
- Names come from a finite pool, making resolution easier than reality.
- No missing fields, typos or duplicate registrations. Real registers are far messier.
- Census 2011 population, literacy and urbanisation are **real**, used as the per-capita
  denominator (projected ×1.17 to 2026).

### Where the data actually lives — this is the confusing part

There are **two** stores, and only one is on the read path.

| Store | Contents | On the read path? |
|---|---|---|
| **Data Store** (Catalyst) | CaseMaster 40,829 · DistrictInsight 31 · **Accused 0 · OffenderIdentity 0** | ❌ no |
| **Bundle** (`functions/api/data/`) | everything the UI reads | ✅ yes |

Verified by ZCQL on 2026-08-20:

```sql
SELECT COUNT(ROWID) FROM CaseMaster        → 40836
SELECT COUNT(ROWID) FROM DistrictInsight   → 31
SELECT COUNT(ROWID) FROM Accused           → 0
SELECT COUNT(ROWID) FROM OffenderIdentity  → 0
```

**So two things are true at once:** the claim "40,829 FIRs are in Data Store" is *correct*,
and the deployed application does not read them. §8 and §10 explain why.

---

## 4 · The pipeline

`appsail/pipeline/run_pipeline.py` orchestrates the DAG. **24.6 s**, peak **738 MB**.

Stage order, taken from the `step()` calls in the source:

| # | Stage | Module | What it does |
|---|---|---|---|
| 1 | loading source tables | `common.py` | reads the 29 CSVs |
| 2 | **entity resolution** | `entity_resolution.py` (258 ln) | blocking → rapidfuzz → union-find. 36,582 → 35,662 identities · 441 repeat |
| 3 | MO similarity | `mo_similarity.py` (73 ln) | TF-IDF + NearestNeighbors cosine |
| 4 | graph build + community | `graph_build.py` (174) · `community.py` (28) | typed edges + Louvain → 127 networks |
| 5 | offender risk | `risk_score.py` (130) | transparent additive score with factors |
| 6 | investigation health | `health_metrics.py` (147) | deterministic flags + peer medians |
| 7 | anomaly detection | `anomaly.py` (92) | outliers per head/area |
| 8 | spatial hotspots | `spatial.py` (80) | DBSCAN + emerging-trend baseline |
| 9 | assembling read-model | `run_pipeline.py` | derived JSON |
| 10 | socio-economic | `socio.py` (207) | per-capita rates, Pearson + Spearman |
| 11 | forecasting | `forecast.py` (216) | trend × month-of-year seasonality |
| 12 | writing artifacts | — | derived/*.json |
| 13 | **ground-truth evaluation** | `evaluate.py` (114) | scores against the planted patterns |

### The three optimisations worth understanding

**1 · sklearn `working_memory` — 1,770 MB → 738 MB**
Peak RSS was over the 512 MB Job ceiling. Profiling showed 1,216 MB of it was a single
scratch buffer: sklearn's brute-force `kneighbors` sizes its distance block from
`working_memory`, which **defaults to 1 GiB** — twice the entire Job budget. A scoped
`config_context(working_memory=32)` cut it, with **byte-identical output and no speed cost**.

**2 · String interning — 54.9 MB → 12.1 MB**
70% of the adjacency file was an evidence blob, mostly redundant: `sourceFIRs` was always
`[thisCase, neighbour]` (both known at read time), and `matched[].detail` drew from **362
unique sentences written 137,616 times**. Dropping the first and interning the second gives a
4.5× reduction with identical rendered text. A JS `Proxy` rehydrates one case's edges on
access, so serving an ego-network never materialises the whole graph.

**3 · Integer precision**
Catalyst's 17-digit IDs exceed `Number.MAX_SAFE_INTEGER` and corrupt *silently* through
`JSON.parse` — `…013048` became `…013050`, nothing threw, and the CLI wrote the corrupted
value back. **Every Catalyst id is stored as a string.**

### MO similarity uses TF-IDF, not embeddings

`sentence-transformers` was tried and dropped: it blew the memory budget for no measurable
gain in recovery. TF-IDF + `NearestNeighbors` cosine within candidate blocks does the job at a
fraction of the cost. This is worth stating — reviewers assume embeddings and it reads as a
considered choice rather than an omission.

---

## 5 · The read-model

The pipeline writes `functions/api/data/derived/*.json`. The API reads only this. Measured
sizes:

| File | Size | What it carries |
|---|---:|---|
| `graph_adjacency.json` | **12.1 MB** | the interned linkage graph |
| `case_health.json` | 10.7 MB | per-case health flags + peer medians |
| `offender_map.json` | 5.9 MB | accused record → resolved identity |
| `clusters.json` | 1.1 MB | 117 communities |
| `offenders.json` | 393 KB | 300 profiles + risk factors |
| `case_linked_count.json` | 263 KB | link count per case (26,845 entries) |
| `anomalies.json` | 330 KB | outliers + station false-case patterns |
| `forecast.json` | 29 KB | state + district projections |
| `district_stats.json` | 19 KB | per-district rollups |
| `hotspots.json` | 17 KB | DBSCAN cells |
| `socio.json` | 15 KB | correlations + composition |
| `stats.json` | 6.8 KB | dashboard KPIs |
| `national.json` | 3.8 KB | India context |
| `eval_report.json` | 962 B | ground-truth recovery |
| `alerts.json` | 4.9 KB | cross-district + high-risk alerts |

> ⚠️ **Measured, and it contradicts the code comment.** `store.mock.js` line 11 describes the
> bundle as *"a self-contained ~860KB subset"*. It is **46 MB**, and the whole deployed
> `functions/api` folder is **52 MB**. That comment is stale by roughly 50×.
>
> This matters operationally: every `catalyst deploy --only functions` uploads 52 MB, and the
> function's cold-start has to read 46 MB of JSON off disk. It works, but it is the single
> largest thing standing between the current architecture and a genuinely fast cold start.

**Why this design exists:** Functions and AppSail both cap a request at **30 seconds**
(confirmed by the Zoho team in the workshop Q&A, not raisable). Only Jobs get 15 minutes. The
pipeline needs ~25 s. So heavy compute runs in the Job and the web tier only ever *reads* what
the Job already wrote. That single constraint shaped the entire architecture.

---

## 6 · The API

`functions/api/app.js`. Every route returns `{ ok, data }` or `{ ok:false, error:{code,message} }`.
RBAC applied server-side per query.

> ⚠️ **Corrected count.** README and docs say **"21 REST endpoints"**. The actual count in
> `app.js` is **33** (30 before the three `/datastore/*` routes added this week). The 21
> figure is stale and appears in the deck too.

| Route | Purpose | Audited |
|---|---|---|
| `GET /health` | liveness | |
| `GET /me` | user, role, scope, capabilities, fairness statement | |
| `GET /lookups` | districts, units, heads, statuses | |
| `GET /stats` | dashboard KPIs — **state-wide, not scoped** | |
| `GET /alerts` | cross-district + high-risk offenders | |
| `GET /eval` | ground-truth recovery report | |
| `GET /clusters` | community list (capped 100) | |
| `GET /cases` | FIR list, filtered + paged | |
| `GET /cases/:id` | full FIR detail | ✅ |
| `GET /graph/case/:id` | ego-network + evidence | ✅ |
| `GET /graph/featured` | networks with richest link diversity | |
| `GET /graph/cluster/:id` | full community subgraph | |
| `GET /graph/search` | clusters by filter | |
| `GET /offenders` | watchlist | |
| `GET /offenders/:id` | profile + glass-box risk | ✅ |
| `GET /health/cases` | flagged worklist — **correctly scoped** | |
| `GET /health/summary` | health rollup — **correctly scoped** | |
| `GET /geo/points` | incident points (sampled) | |
| `GET /geo/grid` | binned density for the heatmap | |
| `GET /geo/hotspots` | DBSCAN cells + emerging flags | |
| `GET /geo/districts` | choropleth data | |
| `GET /geo/national` | India context | |
| `GET /analytics/socio` | per-capita + correlations | |
| `GET /analytics/forecast` | projections + backtest | |
| `GET /analytics/vulnerability` | victim analytics — role-gated | |
| `POST /assistant/query` | grounded Q&A | ✅ |
| `POST /assistant/voice` | same + TTS attempt | ✅ |
| `POST /assistant/export` | print-ready briefing HTML | |
| `GET /audit` | audit trail — ACP/Admin only | |
| `GET /ai/status` | whether QuickML/Zia are really wired | |
| `GET /datastore/status` | **live** ZCQL row counts | |
| `GET /datastore/probe` | credential diagnosis | |
| `GET /datastore/cases` | **live** ZCQL register read | |

### RBAC — how scoping actually works

`services/rbac.js`. `userFromRequest` reads the `x-kadi-role` header and maps to a user with
`unitId` / `districtId`. Every query in `queries.js` passes through `scoped(user, rows)`.

| Role | Sees |
|---|---|
| SI, Inspector | own station (`unitId`) |
| ACP | own district (`districtId`) |
| Analyst, Admin | state-wide |

This scoping is **genuinely enforced** — out-of-scope reads are refused, not hidden. Only the
*identity check* is missing: the role comes from a header, not a verified JWT.

---

## 7 · The client

14 route components, 13 routes. React 18 + TypeScript + Vite + Tailwind + TanStack Query.

| Route | Page | What it is |
|---|---|---|
| `/login` | `Login.tsx` | **role chooser, not a password gate** — and says so on the page |
| `/` | `Dashboard.tsx` | Command Dashboard — KPIs, trend, heatmap, funnel, rank-shift, alerts |
| `/about` | `About.tsx` | 6 sections incl. what is **not** wired, with diagnoses |
| `/graph` | `GraphExplorer.tsx` | **the hero** — Cytoscape ego-network |
| `/cases` · `/cases/:id` | `Cases.tsx` · `CaseDetail.tsx` | the register + full FIR detail |
| `/offenders` · `/offenders/:id` | `Offenders.tsx` · `OffenderDetail.tsx` | watchlist + glass-box risk |
| `/health` | `Health.tsx` | Investigation-Health Cockpit |
| `/map` | `MapPage.tsx` | MapLibre — 3 layers, time filter, hotspots |
| `/intelligence` | `Intelligence.tsx` | per-capita, correlations, forecast |
| `/assistant` | `Assistant.tsx` | bilingual grounded Q&A |
| `/audit` | `Audit.tsx` | audit trail — ACP/Admin |
| `/admin` | `Admin.tsx` | admin view |

`?as=<SI|Inspector|ACP|Analyst|Admin>` on any route enters directly in that rank — added for
shareable demo links and headless screenshot capture.

### The graph — visual grammar

This is the screen that carries the product, so its encoding matters.

| Channel | Meaning |
|---|---|
| **Rounded square** | an FIR |
| **Circle** | a person |
| Square colour | crime head (Property blue, Cyber teal, Body red, Women pink, …) |
| **Circle colour** | **risk band** — High red, Medium amber, Low green |
| Node size | degree — the hub is biggest, before you read a label |
| Orange 4px ring | the focus / selected node |
| Edge colour | evidence type (see below) |
| Edge thickness | `0.8 + strength × 2.2` |

> ⚠️ Red on a **square** = crime against body. Red on a **circle** = high-risk person. Same
> colour, different meaning, disambiguated only by shape.

Edge colours, from `GraphCanvas.tsx`:

| Colour | Type | Strength as evidence |
|---|---|---|
| dark navy `#0f2f44` | shared offender | strongest |
| blue `#1A6FC4` | co-accused | strong |
| teal `#2FA8A0` | similar MO | medium |
| grey `#8A94A3` | same location | weak |
| lilac `#B7A5D6` | same time window | weak |
| pale `#C9D3E0` | shared section | weakest — deliberately near-invisible |
| orange dashed `#E8871E` | appears-in (person→case) | structural, not a finding |

**Link-type counts do not sum to the edge count** — one line can carry several evidence types
at once (`new Set([edgeType, ...allTypes])`). 9+7+4+9 = 29 across 27 links is correct, not a
bug.

### i18n

58 keys in `lib/i18n.ts`, English + Kannada. Every string is meant to live here; a
half-translated page (Kannada headings, English body) is worse than none.

---

## 8 · Catalyst services

### Live — eight services

| Service | Running | Notes |
|---|---|---|
| **Web Client Hosting** | React SPA at `/app` | same origin as API → no CORS |
| **Serverless Functions** | `api` (33 routes) + `refreshanalytics` (Job) | 512 MB |
| **AppSail** | `kadi-appsail`, Python | ~135 ms; **stdlib-only** |
| **Data Store** | 11 tables, 40,829 FIRs | live ZCQL — but see below |
| **Stratus** | bulk-import objects | |
| **Job Scheduling + Cron** | nightly 02:00 IST | last run SUCCESS |
| **Connections** | `kadi_quickml` OAuth | `deployment.READ` |
| **Authentication** | provisioned | **0 users registered** |

### Project identifiers

| | |
|---|---|
| Project | KadiLabs · `55468000000013048` |
| Org | `60078029367` |
| Environment | Development · `55468000000013065` |
| Data centre | IN (`console.catalyst.zoho.in`) |
| CLI | zcatalyst-cli 1.27.0 |

Table ids: District `…026001` · Unit `…029001` · CrimeHead `…030001` · CrimeSubHead `…031001` ·
CaseStatusMaster `…032001` · **CaseMaster `…033001`** · Accused `…032360` ·
OffenderIdentity `…034001` · DistrictInsight `…035001` · CrimeForecast `…026360` ·
Hotspot `…036001`.

### The ZCQL that actually proves the product

Runs live against Data Store and returns the headline finding:

```sql
SELECT DistrictName, TotalCases, RatePer100k, RankByCount, RankByRate, RankShift
FROM DistrictInsight WHERE RankShift > 5 ORDER BY RankShift DESC LIMIT 5
```

→ Kodagu 335 FIRs, 51.6/100k, **#31 → #6** · Dharwad #23 → #7 · Ramanagara #19 → #11.

If you get to run one query in front of a judge, run this one.

### 🔴 The root cause behind three limitations

This is the most important finding in the project and it was mis-diagnosed for weeks.

`docs/08` recorded the Cache 401 as *"platform-level and unresolved"*. It is neither.

Hitting `/datastore/probe` on the deployed function shows **ZCQL returning byte-for-byte the
same `401 PERMISSION_NEEDED`**, and `userManagement().getCurrentUser()` too. All three SDK
init scopes fail identically:

| Init mode | Result |
|---|---|
| `initialize(req)` | 401 |
| `initialize(req, {scope:'admin'})` | 401 |
| `initialize(req, {scope:'user'})` | 401 |
| `getCurrentUser()` | 401 |

The environment explains it. The function receives **no credential of any kind**:

```
CATALYST_FUNCTION_STACK, CATALYST_FUNCTION_TYPE, CATALYST_MAX_TIMEOUT,
CATALYST_PROJECT_ID, CATALYST_PROJECT_TIMEZONE, CATALYST_RESOURCE_ID,
CATALYST_USER_ENVIRONMENT, X_ZOHO_CATALYST_ACCOUNTS_URL,
X_ZOHO_CATALYST_CONSOLE_URL, X_ZOHO_CATALYST_ENVIRONMENT,
X_ZOHO_CATALYST_RESOURCE_ID, X_ZOHO_CATALYST_SERVER_LISTEN_PORT,
X_ZOHO_HEADLESS_CHROME_URL, X_ZOHO_STRATUS_RESOURCE_SUFFIX
```

Identifiers and URLs only. **`X_ZOHO_CATALYST_PROJECT_KEY` is absent.** No token, no secret.

And permissions were never the obstacle:

```
App Administrator → SELECT, UPDATE, INSERT, DELETE
App User          → SELECT
```

**`App User` already holds SELECT on CaseMaster.** The function is not being *denied* — it
is not *anybody*. The SPA calls `/server/api` as an anonymous public request, so
`initialize(req)` has nothing to resolve against and never reaches the role that would let it
through.

**One cause, three symptoms:** Cache writes (limitation 5), the Data Store read path
(limitation 2), and identity binding (limitation 1) are the same problem wearing three
costumes. That is why fixing them individually kept failing.

**The unlock:** if a signed-in user's Catalyst session cookie reached the function — the SPA
and API are same-origin, so it would — `initialize(req)` resolves them as App User, and
SELECT works. **Binding authentication *is* how the Data Store read path opens.**

Blocked on one console action: enabling Catalyst Authentication. That is a project-wide switch
on a live submission, and the last project-wide switch (API Gateway) took the site down.

### Not wired — and why

| Service | Diagnosis |
|---|---|
| **Cache** | 401 — the credential problem above. Zero user impact: KPI recomputes in ~1 ms |
| **QuickML** GLM-4.7 | `400 PATTERN_NOT_MATCHED` on `zoho-inputstream`. Endpoint, model id `crm-di-glm47b-30b-it`, org header and OAuth token all valid. Ruled out: non-ASCII, Content-Length, missing token, auth prefix. Gated behind `QUICKML_ENABLED` |
| **Zia** | Not enabled on the project. Voice runs on browser Web Speech |
| **NoSQL** | Never provisioned — the bundle replaced it |
| **SmartBrowz** | Not wired. Export returns print-ready HTML, **not PDF** |
| **API Gateway** | Enabled once → intercepted all traffic with no routes → `INVALID_URL`, site down. Off deliberately |
| **Signals / Pipelines** | Not wired. Deploys are CLI-driven |

> A Connection created in Cloud Scale **cannot** be read by the SDK's `app.connection()` —
> that API is for self-managed connectors and fails with `client_id cannot be null`. Worth
> knowing before trying that route to a credential.

---

## 9 · Tests

**19 total, all passing.**

```bash
cd functions && npm test              # 8 Node
./.venv/bin/python -m pytest appsail/tests -q   # 11 Python
```

**Node — `functions/test/api.test.js`**

1. envelope shapes
2. rbac scope: analyst state-wide, SI unit-only
3. rbac scope: ACP district-level
4. rbac requireRole gates capabilities
5. userFromRequest defaults to Analyst, honours role header
6. store + queries: cases scoped, graph carries explanation + fairness
7. geoGrid bins the full dataset, honours head + hour filters
8. fairness: vulnerability role-gated + excludes protected

**Python — `appsail/tests/test_pipeline.py`**

1. `test_assert_no_protected_raises`
2. `test_model_feature_sets_exclude_protected` ← **the fairness invariant**
3. `test_offender_risk_reports_no_protected_attrs`
4. `test_normalize_name_handles_initials_and_merged_tokens`
5. `test_soundex`
6. `test_er_structural_gate`
7. `test_ground_truth_recovery_over_`
8. `test_repeat_offender_flagged_high_or_medium`
9. `test_emerging_hotspot_detected`
10. `test_health_flags_are_deterministic_and_explained`
11. `test_planted_slipping_cases_are_flagged`

The fairness invariant is the one that matters most — it fails the build if `CasteID`,
`ReligionID` or `OccupationID` reaches any model's feature set. It is what converts the
fairness claim from editorial to executable. **Never delete it, never let it be skipped.**

```python
# appsail/pipeline/common.py
PROTECTED_COLUMNS = {"ReligionID", "CasteID", "OccupationID", "caste_master_id",
                     "caste_master_name", "ReligionName", "OccupationName"}

def assert_no_protected(feature_columns) -> None:
    used = PROTECTED_COLUMNS.intersection(set(feature_columns))
    if used:
        raise ValueError(f"FAIRNESS VIOLATION: protected attributes in feature set: {sorted(used)}")
```

**Not covered by tests:** no frontend tests at all — no component, integration or E2E. The
entire 4,150-line client is verified only by eye.

---

## 10 · Everything that is wrong or unfinished

Nothing withheld. Grouped by how much it costs you.

### A · Blocked on a console action

| # | Issue | Detail |
|---|---|---|
| A1 | **Function has no credential** | The root cause in §8. Blocks Cache, Data Store reads and identity binding at once |
| A2 | **Authentication has 0 users** | Provisioned but nobody registered; enabling is a project-wide switch |

### B · Real defects, fixable now

| # | Issue | Where | Impact |
|---|---|---|---|
| B1 | **Link-strength slider does nothing** | `GraphExplorer.tsx` | MO scores cluster ~0.99, shared-offender ~0.95, so 0.30→0.90 changes nothing. The UI *admits this in its own help text*. Fix: percentile-rank the scores |
| B2 | **Graph edge-type mix skewed** | `build_bundle.py` | `MAX_NEIGHBOURS=14` ranked by raw strength quietly favours MO (0.993) over shared-offender (0.954). Only 740 of 26,845 cases have a shared-offender edge. Fix: rank by edge *kind* first |
| B3 | **Audit trail is in-memory** | `services/audit.js` | Ring buffer, lost on cold start. Cannot support the accountability claim |
| B4 | **Export called PDF in places** | — | Returns HTML. Say "print-ready briefing" |
| B5 | **No frontend tests** | `client/` | 4,150 lines with zero automated coverage |

### C · Stale or wrong claims in the repo

| # | Claim | Reality |
|---|---|---|
| C1 | "21 REST endpoints" — README, docs, deck | **33** |
| C2 | "~860KB subset" — `store.mock.js:11` | **46 MB** (function folder 52 MB) |
| C3 | "36,289 accused" — 9 places | **36,582** — fixed at `82e9154` |
| C4 | `InfoReceivedPSDate` in schema doc | Column **does not exist** in the Data Store table |
| C5 | docs/08 "Cache… platform-level and unresolved" | Wrong diagnosis — corrected at `0d9f11a` |

### D · Data-quality artefacts

| # | Issue |
|---|---|
| D1 | Template artefact in some BriefFacts — *"…injured the complainant office hours"*, incident at 02:05 contradicting "office hours" |
| D2 | Urbanisation correlation partly circular by construction |
| D3 | **Pearson +0.88 vs Spearman +0.517** — the linear coefficient is leveraged by two metros; honest read is *moderate* |
| D4 | Crime mix nearly identical across urbanisation bands (41.7/41.5/40.9% property) — plausibly a generator artefact, not a finding |
| D5 | Chamarajanagar "+8.4% rising" is **0.6 of a case** on a base of 7.8 — inside noise |
| D6 | `Accused` and `OffenderIdentity` empty in Data Store — no offender read path available |
| D7 | Avg investigation age 672 d — inflated by the generator leaving cases open |

### E · Architectural debt

| # | Issue |
|---|---|
| E1 | 52 MB function deploy; 46 MB of JSON read at cold start |
| E2 | `/stats` ignores its `user` argument — dashboard is state-wide while Health is scoped. Now *labelled* honestly, not fixed |
| E3 | `/datastore/cases` not wired into `/cases` — needs a mapper that can't be tested without a credential |
| E4 | No CI. Deploys are manual CLI |
| E5 | Deck build tooling deleted at `8d3c1f5` — the deck can't be regenerated without restoring it from history |

---

## 11 · Refinement backlog

Ranked by value per unit of risk.

### Tier 1 — highest value

| Item | Effort | Risk | Why |
|---|---|---|---|
| **Enable Auth → unlock the credential** | M | ⚠️ high | Unblocks A1, and with it Cache + Data Store + identity. Biggest single win available |
| **Fix the link-strength slider** (B1) | S | none | A visibly broken control on the hero screen. Percentile-rank the scores |
| **Rebalance graph edge types** (B2) | S–M | low | Makes the graph show its *interesting* edges instead of MO everywhere |

### Tier 2 — credibility

| Item | Effort | Risk |
|---|---|---|
| Correct the "21 endpoints" claim everywhere (C1) | S | none |
| Fix the stale 860KB comment (C2) | S | none |
| Persist the audit trail to Data Store (B3) | S–M | low |
| Add frontend smoke tests (B5) | M | none |

### Tier 3 — if time allows

| Item | Effort | Risk |
|---|---|---|
| Shrink the 46 MB bundle (E1) | M | medium |
| Scope `/stats` per role properly (E2) | M | medium — changes figures the deck quotes |
| Bulk-load Accused + OffenderIdentity via Stratus (D6) | M–L | low |
| Restore deck build tooling (E5) | S | none |

### Blocked externally

QuickML (`400` from Zoho's endpoint), Zia (not enabled on the project), API Gateway (needs
route configuration first).

---

## What to say when challenged

The strongest position this project has is that **it already knows its own weaknesses**. Every
item in §10 is written down, most of them in the product itself on the About page.

Three specifically worth volunteering before anyone asks:

1. **"The correlation is partly circular."** The generator weights urban crime upward. The
   method is sound and runs unchanged on real data — but here it is confirmation, not
   discovery.
2. **"Pearson and Spearman disagree."** 0.88 vs 0.517 means two metros carry the linear fit.
   The honest read is a moderate monotonic relationship.
3. **"The assistant is not an LLM."** It is a deterministic intent engine — which cannot
   hallucinate an FIR number. In police work that trade is worth making.

Saying these first is what separates an analyst's work from a student project. And you can
afford to say them, because the things that *do* work — 100% ground-truth recovery, 4.3% MAPE
on a hold-out backtest, a fairness guarantee enforced by a failing test — are all measured.
