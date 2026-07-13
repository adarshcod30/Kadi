# 02 — Technical Requirements Document (TRD)
### KADI — Architecture, Services & Implementation Contract
**Deploy target:** Zoho Catalyst · **Stack:** React + Node Functions + Python AppSail/Jobs

---

## 1. Architecture overview

```
                         ┌──────────────────────────────────────────┐
                         │        React SPA (Catalyst Slate)          │
                         │  Dashboard · Graph · Cockpit · Map · Chat  │
                         └───────────────┬────────────────────────────┘
                                         │ HTTPS (JWT from Catalyst Auth)
                                ┌────────▼─────────┐
                                │  Catalyst API     │  routing / throttle / auth
                                │  Gateway          │
                                └────────┬─────────┘
                                         │
                        ┌────────────────▼───────────────────┐
                        │  Node Advanced-I/O Functions (API)   │  <30s, READ-ONLY heavy
                        │  /cases /graph /offenders /health    │
                        │  /assistant /geo /audit              │
                        └───┬───────────┬───────────┬──────────┘
             read graph/    │           │ LLM/RAG   │ read/write
             scores         │           │           │
              ┌─────────────▼──┐  ┌─────▼──────┐  ┌─▼──────────────┐
              │ NoSQL + Cache  │  │ QuickML    │  │ Data Store      │  (relational, ZCQL)
              │ (graph, scores)│  │ LLM GLM-4.7│  │ FIR + KADI tbls │
              └─────────▲──────┘  │ + RAG      │  └─▲──────────────┘
                        │         └─────┬──────┘    │
        writes derived  │               │ Zia       │ source of truth
        graph + metrics │        ┌──────▼──────┐    │
              ┌─────────┴────────┤ Zia Services │    │
              │ AppSail (Python) │ OCR/STT/TTS  │    │
              │ + Catalyst Jobs  │ /translation │    │
              │ graph build, ER, │ └────────────┘    │
              │ ML, metrics      ├───────────────────┘
              └───────▲──────────┘
                      │ triggered by
        ┌─────────────┴───────────────┐
        │ Cron (nightly recompute)     │
        │ Signals + Event Fn (new FIR) │
        └──────────────────────────────┘

  Files/exports → Stratus (blob)   |   PDF/report render → SmartBrowz   |   CI/CD → Pipelines (GitHub)
```

**Golden rule:** the SPA and Node Functions **only read** precomputed graph/scores. All expensive computation is produced asynchronously by **AppSail/Jobs** and stored in **NoSQL/Cache/Data Store**.

## 2. Catalyst service map (what we use and how)

| # | Capability in KADI | Catalyst service | How we use it |
|---|---|---|---|
| 1 | Relational FIR + KADI tables | **Data Store** | Source of truth. Query via **ZCQL**. Import synthetic CSVs via CLI/Stratus. |
| 2 | Graph adjacency, offender scores, metrics | **NoSQL** | Precomputed node/edge docs + score docs for instant reads. |
| 3 | Hot reads (dashboard KPIs, graph frames) | **Cache** | Cache expensive read aggregations with TTL. |
| 4 | API / backend logic (fast) | **Serverless Functions** (Advanced I/O, Node) | REST endpoints; read-only heavy; ≤30s. |
| 5 | Graph build, entity resolution, ML training | **AppSail** (Python managed runtime) + **Jobs** | Long-running compute; Jobs for scheduled batch (15-min limit). |
| 6 | NL Q&A over structured data + docs | **QuickML** (LLM Serving GLM-4.7 + RAG) | LLM answers over DB (via ZCQL tool) and RAG over legal docs. |
| 7 | Custom risk/anomaly models (tabular) | **QuickML pipelines** / **Zia AutoML** | Offender risk + case anomaly models. |
| 8 | OCR, speech-to-text, text-to-speech, translation | **Zia Services** | Voice assistant pipeline; OCR scanned FIRs (stretch). |
| 9 | Login + RBAC | **Authentication** | Embedded auth; roles; table permission scopes. |
| 10 | Routing/throttling/auth in front of Functions | **API Gateway** | Single API surface; rate limiting. |
| 11 | OAuth to QuickML/Zia | **Connections** | Scope e.g. `quickml.deployment.read`. |
| 12 | File & export storage | **Stratus** | Store generated PDFs, uploaded docs, data import buckets. |
| 13 | PDF/report generation, screenshots | **SmartBrowz** | Render conversation/briefing to PDF. |
| 14 | Nightly graph/metric recompute | **Cron (Cloud Scale)** | Rebuild graph & scores on schedule. |
| 15 | React to new FIR inserts | **Signals + Event Functions** | Incrementally update graph/metrics on insert. |
| 16 | CI/CD from GitHub | **Pipelines** | Auto-deploy client/functions/appsail. |

> **User-intervention items** (Claude Code must ask Adarsh): project/org/env IDs, enabling each service, Connections + OAuth scopes, QuickML deployment IDs + endpoint URLs, RAG document IDs, credits. See `CLAUDE.md` → "When to STOP and ask".

## 3. Tech stack & versions
**Frontend (`/client`)** — deploy to Slate
- React 18, Vite, TypeScript, TailwindCSS.
- Graph: **Cytoscape.js** (+ `cytoscape-fcose` / `cytoscape-cola` layout). Maps: **MapLibre GL JS**. Charts: **Recharts**.
- Data fetching: **TanStack Query**. Routing: React Router v6. State: Zustand (light).
- Catalyst **Web SDK** for auth + client calls.

**API (`/functions`)** — Catalyst Advanced I/O Functions (Node 20)
- Express-style handler; `zcatalyst-sdk-node` for Data Store/ZCQL/NoSQL/Cache/Stratus.
- Thin controllers → services; all responses typed; consistent error envelope.

**Compute/ML (`/appsail`)** — Catalyst AppSail (Python 3.11) + Jobs
- `pandas`, `numpy`, `networkx`, `scikit-learn`, `rapidfuzz` (fuzzy match), `sentence-transformers` (MO embeddings), `python-louvain` (community detection), `hdbscan`/`scikit` DBSCAN (spatial), `zcatalyst-sdk-python`.
- Exposes internal endpoints (called by Jobs/Functions) + batch jobs.

**Data (`/data`)** — generator (Python + Faker) → CSVs → Data Store import.

## 4. Repository structure
```
functions/
  api/                     # one Advanced I/O function (single deployable) OR split by domain
    index.js               # router
    routes/
      cases.js  graph.js  offenders.js  health.js  geo.js  assistant.js  audit.js  auth.js
    services/
      datastore.js  nosql.js  cache.js  quickml.js  zia.js  rbac.js
    lib/ (zcql builders, error envelope, validators)
  catalyst-config.json     # env vars, memory (bump to 512MB)
appsail/
  app.py                   # AppSail entry (Flask/FastAPI managed runtime)
  pipeline/
    entity_resolution.py  graph_build.py  community.py  mo_similarity.py
    risk_score.py  anomaly.py  health_metrics.py  spatial.py
  jobs/
    recompute_graph.py  recompute_metrics.py
client/
  src/{pages,components,features,api,hooks,styles,lib}
data/
  generator/generate.py  patterns.py  karnataka.py
  output/*.csv
```

## 5. API design (REST, behind API Gateway)
All routes require a valid Catalyst Auth JWT; RBAC applied server-side. JSON in/out. Standard error envelope: `{ ok:false, error:{code,message} }`.

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/cases` | List/search FIRs (filters, pagination) | RBAC-scoped |
| GET | `/cases/:id` | FIR detail (parties, acts, status, timeline) | |
| GET | `/graph/case/:id` | Ego-graph around an FIR (nodes/edges + why) | reads NoSQL |
| GET | `/graph/cluster/:clusterId` | Full gang/community subgraph | |
| GET | `/graph/search` | Graph by filters (crime head, district, date) | |
| GET | `/offenders/:id` | Resolved offender profile + risk breakdown | |
| GET | `/offenders` | Watchlist / ranked offenders | RBAC-scoped |
| GET | `/health/cases` | Investigation-health worklist + flags | |
| GET | `/health/summary` | Cockpit KPIs (by station/subdivision) | |
| GET | `/geo/points` | Map points (bbox, filters) | |
| GET | `/geo/hotspots` | Precomputed clusters | |
| GET | `/analytics/vulnerability` | Victim-vulnerability aggregates | Analyst/ACP only |
| POST | `/assistant/query` | NL query (text) → grounded answer + citations | calls QuickML LLM/RAG |
| POST | `/assistant/voice` | audio → STT → answer → TTS | calls Zia |
| POST | `/assistant/export` | Render conversation/briefing → PDF (Stratus URL) | SmartBrowz |
| GET | `/audit` | Audit log (RBAC) | ACP/Admin |
| GET | `/me` | Current user + role + scope | |
| Admin | `/admin/users` … | User/role management | Admin only |

**Every insight endpoint returns an `explanation` object** (inputs used, matching attributes, source FIR IDs) to power the "Why" UI and satisfy explainability ACs.

## 6. Data model (summary — full detail in `03_DATABASE_SCHEMA.md`)
- **Source tables** = the provided FIR schema (CaseMaster, ComplainantDetails, Victim, Accused, ArrestSurrender, Act/Section, CrimeHead/SubHead, master/lookup, ChargesheetDetails, etc.).
- **KADI-added tables:** `AppUser`, `Role`, `AuditLog`, `Conversation`, `SavedView`, `Alert`, and **derived/materialized**: `OffenderIdentity` (entity-resolved), `OffenderIdentityMap` (accused→identity), `LinkEdge` (FIR/entity edges + type + strength + evidence), `CaseHealthMetric`, `OffenderRisk`, `HotspotCell`.
- Derived tables are **rebuilt by AppSail/Jobs**; the API reads them (or their NoSQL mirror).

## 7. ML / analytics pipeline (in AppSail/Jobs)
Runs as a DAG; nightly full rebuild + incremental on new-FIR Signal.

1. **Entity resolution** (`entity_resolution.py`): cluster Accused rows into `OffenderIdentity` using blocking (name soundex + district) then `rapidfuzz` name similarity + shared signals (co-accused, section, location, phone if present). Output confidence per merge. **No protected attributes used.**
2. **Graph build** (`graph_build.py`): build `networkx` multigraph. Node types: Case, Offender, Victim, Location(cell), Act/Section. Edge types + strength:
   - shared offender identity (weight high), co-accused, same location cell (geohash ~≤X km), overlapping time window, MO similarity ≥ threshold, shared act/section.
   - Persist edges → `LinkEdge` (+ evidence JSON) → mirror to NoSQL.
3. **Community detection** (`community.py`): Louvain on the offender/case projection → gang clusters → tag nodes with `clusterId`.
4. **MO similarity** (`mo_similarity.py`): embed `BriefFacts` with `sentence-transformers`; cosine similarity within candidate blocks; store top-k similar case pairs.
5. **Offender risk** (`risk_score.py`): features = prior FIR count, gravity mix, recency, arrest/bail history, network centrality (degree/betweenness), distinct districts. Model via **Zia AutoML**/QuickML or transparent gradient-boosting; output score + SHAP-style factor breakdown. **Protected attributes excluded and asserted in output metadata.**
6. **Anomaly detection** (`anomaly.py`): IsolationForest per crime head/area on case features → flag outliers.
7. **Health metrics** (`health_metrics.py`): deterministic — reporting delay, ageing vs peer median, pendency, undetected/false-case flags, IO workload.
8. **Spatial** (`spatial.py`): DBSCAN on lat/long per crime head + time bucket → `HotspotCell`; baseline vs current for emerging-trend flags.

Each stage writes an **explanation payload** alongside results.

## 8. AI integration
**LLM over structured DB (text-to-insight):**
- System prompt: "You are KADI, an assistant for a police crime-records system. Answer only from provided data. Always cite FIR numbers. Never infer or use caste/religion/occupation for any judgment."
- Pattern: API receives NL query → generates a **constrained ZCQL** query (whitelisted tables/columns, RBAC-scoped) OR uses a set of safe parametrized query "tools" → runs on Data Store → passes rows to GLM-4.7 for natural-language summarization with citations. (Prefer tool/parametrized queries over free-form SQL generation for safety.)
**RAG over documents:**
- Upload IPC/BNS sections, KSP SOPs to a QuickML **RAG knowledge base**; assistant answers legal/procedural questions with document citations. RAG document IDs come from the console (**ask Adarsh**).
**Voice (Zia):** audio → **STT** → (if Kannada) **translation** → LLM → answer → **translation back** → **TTS**. *Verify Kannada STT/TTS coverage in Zia; fallback = Kannada handled as text by the LLM + Zia translation.*
**PDF export:** assistant/briefing HTML → **SmartBrowz** → PDF → store in **Stratus** → return signed URL.

## 9. Auth, RBAC & security
- **Catalyst Authentication** (embedded) issues JWT; Web SDK on client.
- Server derives user → `AppUser.role` + scope (`UnitID`/`DistrictID`).
- **Data Store permission scopes** set per role (application-user select-only on case tables; write restricted). API adds a second RBAC layer (defense in depth).
- **Audit:** every read of sensitive data and every AI query writes an `AuditLog` row (userId, action, target, timestamp, ip).
- **CORS/whitelisting:** register the Slate front-end domain under Cloud Scale → Authentication → whitelisting (the #1 integration gotcha from Zoho's session).
- Secrets (client secret, connection tokens) live in Catalyst config/env, never in git.

## 10. Handling the 30-second Function limit (critical)
- Functions do **reads and light orchestration only**.
- Graph build, ER, ML, metric recompute → **AppSail endpoints** and/or **Catalyst Jobs** (15-min limit), triggered by **Cron** (nightly) and **Signals/Event Functions** (on new FIR insert).
- The assistant's LLM call stays within 30s; if a query is heavy, precompute or stream a "working…" state and complete via a job + notification.

## 11. Deployment
1. `npm i -g zcatalyst-cli`; `catalyst init` (select Functions + Slate; add AppSail).
2. Local dev: `catalyst serve` (functions), `vite` (client).
3. Import data: upload CSVs to a **Stratus** bucket → `catalyst data-store import` (config JSON per table) — see `06_SYNTHETIC_DATA_SPEC.md`.
4. Configure **Connections** (QuickML/Zia scopes), env vars in `catalyst-config.json` (project ID, org ID, endpoint URLs, RAG doc IDs).
5. `catalyst deploy` (or `--only client|functions|appsail`).
6. Whitelist front-end domain + enable CORS.
7. Wire **Pipelines** to the GitHub repo for CI/CD (optional but a scoring plus).

## 12. Non-functionals
- **Performance:** graph/dashboard reads <1.5s (precomputed + cached). Assistant <10s typical.
- **Scale:** synthetic ~50–100k FIRs; design so ingesting real 1,100-station data needs no code change (only more compute in jobs).
- **Reliability:** idempotent recompute jobs; incremental updates safe to re-run.
- **Observability:** structured logs; a `/health` diagnostic endpoint; job run status in `PROGRESS.md` during build.
- **Accessibility:** WCAG AA (see UI doc).

## 13. Testing
- Unit tests for ZCQL builders, RBAC scoping, entity-resolution matching, health-metric math.
- **Ground-truth eval:** since synthetic data has planted gangs/serial chains, add a test asserting the pipeline recovers ≥90% of them (precision/recall on links). This doubles as a killer demo slide.
- API contract tests for each endpoint; RBAC tests per role.
- Frontend: smoke tests on the demo path.

## 14. Open items to confirm with Catalyst / Adarsh
- Exact **QuickML** model deployment IDs + endpoint URLs; RAG document IDs.
- **Zia** Kannada STT/TTS availability (else translation fallback).
- Data Store **column type** limits and max rows per import batch.
- Whether **AppSail** managed runtime Python version = 3.11 (adjust libs if not).
