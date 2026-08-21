# 02 — How it is wired

### Architecture, services and the constraints that produced them
**Deploy target:** Zoho Catalyst · **Stack:** React SPA + Node Function + Python AppSail / Job

> This is the architecture you actually shipped, not the one you sketched on day one. Where
> the two differ, the reason is recorded — usually a platform limit you hit at 2am. Read
> §10 before you change anything structural.

---

## 1. The shape of it

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ZOHO CATALYST — one project, one origin, no third-party runtime             │
│                                                                              │
│  PRESENTATION   ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐   │
│  what the       │ React 18 + TS  │ │ Graph · Map    │ │ EN / ಕನ್ನಡ + voice │   │
│  officer sees   │ Web Client     │ │ Cytoscape,     │ │ Web Speech API,  │   │
│                 │ Hosting · /app │ │ MapLibre,      │ │ client-side      │   │
│                 └───────┬────────┘ └───────┬────────┘ └────────┬─────────┘   │
│                         ▼                  ▼                   ▼             │
│  API            ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐   │
│  read-only,     │ 21 REST        │ │ RBAC on every  │ │ Audit + grounded │   │
│  rank-scoped    │ endpoints      │ │ query          │ │ assistant        │   │
│                 │ Node 20·512MB  │ │ server-side    │ │ cites FIR nos.   │   │
│                 └───────┬────────┘ └───────┬────────┘ └────────┬─────────┘   │
│                         ▼                  ▼                   ▼             │
│  COMPUTE        ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐   │
│  heavy work     │ AppSail        │ │ Job — full     │ │ Cron 02:00 IST   │   │
│  lives here     │ Python ~135ms  │ │ pipeline 15min │ │ full recompute   │   │
│                 └───────┬────────┘ └───────┬────────┘ └────────┬─────────┘   │
│                         ▼                  ▼                   ▼             │
│  DATA           ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐   │
│  one source     │ Data Store     │ │ Stratus bucket │ │ Cache — KPI      │   │
│  of record      │ 11 tbl·40,829  │ │ import objects │ │ segment (see §9) │   │
│                 └────────────────┘ └────────────────┘ └──────────────────┘   │
│                                                                              │
│  PLATFORM        Authentication · Connections (OAuth) · Catalyst CLI 1.27.0  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**The golden rule, and the only one that matters:** the SPA and the API **only read**
precomputed results. Everything expensive is produced asynchronously by the Job and written
down before any user asks for it. §10 explains why you have no choice.

## 2. Catalyst services — what you wired, and what you did not

Eight services are live. Be precise about this in the pitch; a judge will check.

| Capability in KADI | Catalyst service | How you use it |
|---|---|---|
| SPA hosting | **Web Client Hosting** | Serves `/app`. Same origin as the API, so no CORS dance. |
| REST API + nightly Job | **Serverless Functions** | Advanced I/O accepts an Express app. Raised to 512 MB for the read-model. |
| Python analytics | **AppSail** | Per-capita + forecast in ~135 ms. **Stdlib-only** — see §10. |
| Relational store | **Data Store** | 11 tables, 40,829 FIRs, queried with ZCQL. |
| Object storage | **Stratus** | Source objects for Data Store bulk-write. |
| Scheduled recompute | **Job Scheduling + Cron** | Nightly at 02:00 IST. Only Jobs get 15 minutes. |
| OAuth to QuickML | **Connections** | `deployment.READ` scope. QuickML refuses anonymous calls. |
| Sign-in + role model | **Authentication** | Provisioned. See §8 for the honest caveat. |

**Not wired — and you should say so before anyone asks.** Full diagnosis in
[08_CATALYST_LIVE.md](08_CATALYST_LIVE.md):

| Service | Status |
|---|---|
| **Cache** | Adapter written, segment provisioned. Writes from a deployed function return `401 PERMISSION_NEEDED`. Ruled out: segment id, SDK version, scope API, table permissions. Zero user impact — the KPI query recomputes in ~1 ms. |
| **QuickML** (GLM-4.7 + RAG) | Endpoint, model id, org header and a valid OAuth token all in place; the endpoint rejects the request body with `400 PATTERN_NOT_MATCHED`. Gated off behind `QUICKML_ENABLED`. |
| **Zia** (STT / TTS / translate) | Not enabled on the project. Voice runs on the browser Web Speech API instead. |
| **NoSQL / SmartBrowz** | Read-model ships inside the function bundle; briefing export returns print-ready HTML, not a PDF. |
| **API Gateway** | Enabled once, then disabled — with no routes configured it intercepted all traffic and the site returned `INVALID_URL`. |
| **Signals / Pipelines** | Not wired. Deploys are CLI-driven. |

## 3. Stack

**Frontend — `client/`**
React 18 · TypeScript · Vite · Tailwind (KSP palette) · React Router v6 · TanStack Query.
Cytoscape.js + fcose for the graph, MapLibre GL for maps, Recharts for charts, Framer
Motion for interaction.

**API — `functions/api/`** (Advanced I/O Function, Node 20)
Express app wrapped for Catalyst. Thin routes → services. Every response uses one envelope;
every insight endpoint carries an `explanation` payload.

**Compute — `appsail/`** (Python 3.11)
`pandas`, `numpy`, `networkx`, `scikit-learn`, `rapidfuzz`, `shapely`, `scipy`.

> **Two traps here.** MO similarity uses **TF-IDF + NearestNeighbors**, *not*
> `sentence-transformers` — the transformer blew the memory budget for no measurable gain.
> And the deployed AppSail service is **stdlib-only**: packages in `requirements.txt` do not
> install in the container. Heavy libraries are for the Job and for local runs
> (`requirements-dev.txt`), never for the AppSail request path.

**Data — `data/`** — generator (Python) → CSVs → Stratus → Data Store bulk-write.

## 4. Repository layout

```
client/                       React SPA
  src/{pages,components,api,lib,styles}
functions/
  api/
    index.js                  Catalyst entry — wraps app.js
    app.js                    all 21 routes
    lib/envelope.js           one response shape, one error shape
    services/
      queries.js              every read; the heart of the API
      rbac.js                 role → scope, enforced per query
      assistant.js            grounded intent engine
      audit.js                in-memory ring buffer (see §8)
      cache.js  quickml.js  zia.js  store.mock.js
    data/derived/*.json       the precomputed read-model
    catalyst-config.json      memory + env; MUST be committed
  refreshanalytics/
    index.js                  the Cron Job — MUST be named index.js
  test/api.test.js            8 Node tests
appsail/
  app.py                      stdlib-only analytics service
  pipeline/
    run_pipeline.py           orchestrates the whole DAG
    entity_resolution.py  graph_build.py  community.py  mo_similarity.py
    risk_score.py  anomaly.py  health_metrics.py  spatial.py
    socio.py  forecast.py  demographics.py  national.py
    evaluate.py               scores against planted ground truth
    build_bundle.py           interns the read-model before shipping
  jobs/{recompute_graph,recompute_metrics}.py
  tests/test_pipeline.py      11 Python tests
data/
  generator/                  generate.py, patterns.py, karnataka.py
  output/*.csv                29 tables (gitignored — regenerate)
docs/
  deck/                       submission deck, prototype brief, analytics slide
```

## 5. API surface

21 endpoints. RBAC applied server-side on every one. Error envelope:
`{ ok:false, error:{ code, message } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/me` | Current user, role, scope, capabilities |
| GET | `/lookups` | Districts, units, crime heads, statuses |
| GET | `/stats` | Dashboard KPIs (RBAC-scoped) |
| GET | `/alerts` | Recent alerts |
| GET | `/eval` | Ground-truth recovery report |
| GET | `/clusters` | Community list |
| GET | `/cases` · `/cases/:id` | FIR list and detail (audited) |
| GET | `/graph/case/:id` | Ego-network + why-linked evidence (audited) |
| GET | `/graph/featured` · `/graph/cluster/:id` · `/graph/search` | Networks |
| GET | `/offenders` · `/offenders/:id` | Watchlist and profile (audited) |
| GET | `/health/cases` · `/health/summary` | Investigation health |
| GET | `/geo/points` · `/geo/grid` · `/geo/hotspots` · `/geo/districts` · `/geo/national` | Map layers |
| GET | `/analytics/vulnerability` · `/analytics/socio` · `/analytics/forecast` | Analytics |
| POST | `/assistant/query` · `/assistant/voice` · `/assistant/export` | Assistant |
| GET | `/audit` | Audit log — ACP / Admin only |
| GET | `/ai/status` | Whether QuickML and Zia are genuinely wired |

`/ai/status` exists so you never have to *claim* an AI service is on. Point at it instead.

## 6. Data model

Source tables are the KSP FIR schema exactly as given — do not rename columns. KADI adds
`AppUser`, `AuditLog`, `Alert`, and the derived tables the pipeline writes:
`OffenderIdentity`, `OffenderIdentityMap`, `LinkEdge`, `CaseHealthMetric`, `OffenderRisk`,
`HotspotCell`. Full detail in [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md).

Derived tables are rebuilt by the Job. The API reads them, never recomputes them.

## 7. The analytics pipeline

`appsail/pipeline/run_pipeline.py` runs the DAG. Full rebuild takes **24.6 s** and peaks at
**738 MB**.

1. **Entity resolution** — block on name key + district, then `rapidfuzz` similarity with
   **rarity-aware distinctiveness** (a rare surname match counts for far more than a common
   one), plus shared co-accused / section / location signals. Union-find merges the
   clusters. 36,582 accused rows → 35,662 identities (441 repeat), each with a confidence. **No protected
   attributes.**
2. **Graph build** — a `networkx` multigraph. Edge types: shared offender, co-accused, same
   location cell, overlapping time window, MO similarity, shared act & section. Every edge
   carries an evidence payload naming what matched.
3. **Communities** — Louvain over the case projection → 127 networks, 7 cross-district.
4. **MO similarity** — TF-IDF over `BriefFacts`, then `NearestNeighbors` cosine within
   candidate blocks.
5. **Offender risk** — prior count, gravity mix, recency, arrest/bail history, network
   centrality, distinct districts. Transparent scoring with a factor breakdown. Protected
   attributes excluded, and asserted in the output metadata.
6. **Anomaly detection** — per crime head and area, flag outliers.
7. **Health metrics** — deterministic: reporting delay, ageing vs peer median, pendency,
   undetected risk, false-case pattern. 18,901 cases flagged.
8. **Spatial** — DBSCAN per crime head and time bucket → hotspots; baseline vs current for
   emerging trends.
9. **Socio + forecast** — per-capita rates against Census indicators; linear trend ×
   multiplicative month-of-year seasonality, partial months excluded.
10. **Evaluate** — score the recovered clusters against the planted ground truth.
11. **Bundle** — `build_bundle.py` interns the read-model before it ships.

Every stage writes an explanation payload alongside its results. That is what makes the
"why" panels possible.

## 8. Auth, RBAC and audit

- Catalyst Authentication is provisioned. **The API currently trusts a role header rather
  than a verified JWT**, so the sign-in screen is a role chooser. The login page says this
  in plain language — keep it that way. Binding it properly means changing
  `userFromRequest` in `rbac.js` to read the Catalyst token and map it to the officer's
  rank; nothing else changes.
- The API is the enforcement point: every query is filtered by the caller's unit, district
  or state, and an out-of-scope read is **refused**.
- Sensitive reads and every assistant query write an audit row. The buffer is **in-memory**
  today — it does not survive a cold start. Moving it to a Data Store table is a small,
  honest next step, not a rewrite.
- Secrets live in Catalyst env config, never in git. `catalyst-config.json` files are deploy
  manifests and **must** be committed; just keep real values out of them.

## 9. Performance work worth knowing

Three optimisations you should be able to explain, because they are the interesting part:

- **sklearn `working_memory`.** Peak RSS was 1,770 MB — over the 512 MB Job ceiling. Setting
  `config_context(working_memory=32)` cut it to **738 MB with byte-identical output**. The
  default is 1 GiB, which nobody expects.
- **String interning.** The graph adjacency payload was 54.9 MB, and a 121 MB read-model
  broke the deployed function outright. Interning the repeated edge-reason strings brings it
  to **12.1 MB** with identical evidence text. A JS `Proxy` rehydrates it lazily on read.
- **JSON integer precision.** Catalyst's 17-digit IDs exceed `Number.MAX_SAFE_INTEGER` and
  corrupt silently through `JSON.parse`. Store them as **strings**. This one cost you a
  deploy: `...013048` became `...013050` and nothing errored.

## 10. The 30-second cap — the constraint behind everything

Both Functions **and** AppSail cap a request at 30 seconds. This was confirmed by the Zoho
team in the workshop Q&A and it is not raisable. Only **Jobs** get 15 minutes.

The pipeline needs ~25 s and ~740 MB. That is uncomfortably close to the cap even when it
fits, so:

- Functions do reads and light orchestration. Nothing else.
- Entity resolution, graph build, ML and metric recompute run in the **Job**, triggered by
  **Cron**.
- The web tier reads only what the Job has already written.

That single limit is why every screen loads instantly instead of waiting on a model. When
you present the architecture, lead with the constraint — it makes the design look inevitable
rather than arbitrary.

Two smaller traps in the same family: a Job function **must** be named `index.js`
(`main.js` fails silently, with no logs), and Jobs cap memory at 512 MB.

## 11. Deploying

```bash
npm i -g zcatalyst-cli && catalyst login
catalyst project:use            # binds .catalystrc — IDs stored as strings
cd client && npm run build      # emits dist/ + a 404.html copy for SPA deep links
catalyst deploy                 # or --only client|functions|appsail
```

Full runbook, including data import, in [07_CATALYST_SETUP.md](07_CATALYST_SETUP.md).

## 12. Non-functionals

- **Performance** — dashboard and graph reads well under 1.5 s, because they are
  precomputed. AppSail analytics ~135 ms against a 30 s cap.
- **Scale** — designed so that ingesting the real register (~800,000 FIRs/year) needs more
  compute in the Job, not a code change.
- **Reliability** — the recompute Job is idempotent and safe to re-run.
- **Observability** — `/health` and `/ai/status` endpoints; structured logs; Cron run status
  in the console.
- **Accessibility** — WCAG AA, see [04_UI_UX_GUIDELINES.md](04_UI_UX_GUIDELINES.md).

## 13. Tests — 19, all green

```bash
cd functions && npm test        # 8 Node: envelope, RBAC scoping, endpoints
pytest appsail/tests            # 11 Python: ER, health math, ground-truth recovery
```

The one that matters most: **a test fails the build if `CasteID`, `ReligionID` or
`OccupationID` appears in any model's feature set.** That is what turns the fairness claim
from editorial into executable. Never delete it, and never let it be skipped.
