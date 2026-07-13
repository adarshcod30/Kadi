# 05 — App Flow & Full Implementation Plan

Part A: how the app is wired (sitemap, navigation, user journeys, key sequences).
Part B: the phased build order Claude Code follows, with per-phase tasks, files, and a "definition of done."

---

## PART A — App flow

### A1. Sitemap
```
/login
/                         Home (role-aware dashboard)
/graph                    Case-Linkage Graph explorer
  /graph?case=:id | ?offender=:id | ?cluster=:id
/cases                    Case list
  /cases/:id              Case detail
/offenders                Offender watchlist
  /offenders/:id          Offender profile
/health                   Investigation-Health cockpit
/map                      Map / hotspots
/assistant                Assistant (also dockable everywhere)
/audit                    Audit log            [ACP/Admin]
/admin                    Users/roles/ingestion [Admin]
```

### A2. Global navigation
Sidebar (Home, Graph, Cases, Offenders, Health, Map, Assistant, Audit*, Admin*) + top-bar global search (⌘K jumps to case/offender/graph), language toggle, alerts, profile/role. Assistant is dockable from any page.

### A3. Primary user journeys

**J1 — "Is this FIR connected?" (IO, the demo spine)**
`Home → search/open Case → Case detail shows "Linked cases (N)" → click → Graph assembles ego-network → click a red offender node → "Why linked" panel (shared accused across 3 stations) → open Offender profile → risk factors → "Export PDF briefing".`

**J2 — "What's slipping?" (ACP)**
`Home KPIs → Health cockpit → worklist sorted by age → flagged case shows reason + recommended action ("consolidate 3 linked cases sharing accused A2") → open in Graph → acknowledge/assign.`

**J3 — "Ask it" (any role, incl. Kannada voice)**
`Assistant → type/speak "ಈ ಆರೋಪಿಯ ಹಿಂದಿನ ಪ್ರಕರಣಗಳು?" → grounded answer + FIR citations → "show on graph" deep-link → export PDF.`

**J4 — analyst state view**
`Map hotspots → emerging-trend badge → cluster → FIRs → Graph → vulnerability analytics (victim-support framing).`

### A4. Key sequence diagrams

**Open case → graph (read path, fast):**
```
Client → GET /graph/case/:id → Function → NoSQL(ego nodes/edges)+Cache → return {nodes,edges,explanation} → Cytoscape animate
```

**Assistant NL query (structured):**
```
Client → POST /assistant/query {text, lang}
Function → RBAC scope → pick safe parametrized ZCQL (or constrained gen) → Data Store rows
        → QuickML GLM-4.7 (summarize + cite) → AuditLog write → return {answer, citations[]}
```

**Voice (Kannada):**
```
Client mic → POST /assistant/voice(audio) → Zia STT → (Kn→En translate) → same as NL query
        → answer → (En→Kn translate) → Zia TTS → return {text, audioUrl, citations}
```

**Nightly recompute (write path, async):**
```
Cron → Job(recompute_graph) [AppSail] → ER → graph build → community → MO sim → risk → anomaly → health
     → write Data Store derived tables + mirror NoSQL + refresh Cache → emit Alerts for new links/flags
```

**New FIR (incremental):**
```
Data Store insert → Signal → Event Function → enqueue incremental Job → update affected ego-graph + metrics + alerts
```

---

## PART B — Implementation plan (all-in, several weeks)

**Method:** ship a thin end-to-end slice on Catalyst in week 1, then deepen the hero. Keep `PROGRESS.md` updated. Commit after each working unit (no AI attribution — see CLAUDE.md). Where a Catalyst console action/credential is needed, mock behind an interface, note it in `PROGRESS.md → Needs Adarsh`, and continue.

### Phase 0 — Foundations (days 1–3)
**Tasks**
- Init repo, `.gitignore`, `PROGRESS.md`, folder layout (per CLAUDE.md).
- `catalyst init` (Functions + Slate; add AppSail). ⚠️ *Needs Adarsh:* create Catalyst project → project ID / org ID / env.
- Scaffold `client` (Vite+TS+Tailwind), `functions/api` (router + error envelope + SDK init), `appsail` (Flask/FastAPI hello).
- Design tokens + layout shell (topbar/sidebar/fairness banner) from UI doc.
- CI: wire **Pipelines** to GitHub (optional now).
**Done when:** `catalyst serve` + `vite` run locally; empty app shell renders; one `/health` function returns ok; first commit(s) made.

### Phase 1 — Data + vertical slice (week 1)
**Tasks**
- Build the **synthetic data generator** (`data/generator`) per `06_SYNTHETIC_DATA_SPEC.md`; produce CSVs.
- Create Data Store tables (Part A + B schema). ⚠️ *Needs Adarsh:* enable Data Store; confirm import via Stratus bucket.
- Import lookups → CaseMaster → children (FK order).
- Implement `GET /cases`, `GET /cases/:id` (RBAC-scoped ZCQL).
- Client: Case list + Case detail reading real data through the deployed function.
- Deploy to Catalyst (`catalyst deploy`); whitelist front-end domain + CORS.
**Done when:** a deployed Catalyst URL lists and opens real (synthetic) FIRs. **This is the "skeleton live" milestone.**

### Phase 2 — The hero: linkage graph + offenders (week 2)
**Tasks (AppSail/Jobs)**
- `entity_resolution.py` → `OffenderIdentity`/`Map` (fairness test: no protected cols).
- `graph_build.py` → `LinkEdge` (+ evidence) ; `community.py` clusters ; `mo_similarity.py`.
- Job `recompute_graph`; mirror nodes/edges to NoSQL; **Cron** nightly. ⚠️ *Needs Adarsh:* enable NoSQL/Cron, run first job.
- Ground-truth eval test (recovers ≥90% planted gangs).
**Tasks (API + client)**
- `GET /graph/case/:id`, `/graph/cluster/:id`, `/graph/search`, `GET /offenders/:id`, `/offenders`.
- Graph explorer screen (Cytoscape) with "Why linked" panel + filters + cluster expand + animation.
- Offender profile screen (risk gauge + factor breakdown).
**Done when:** opening a case assembles a cross-silo network; offender profiles resolve name variants; "Why" shows evidence. **Hero demo works.**

### Phase 3 — Intelligence + trust (week 3)
**Tasks**
- `health_metrics.py`, `anomaly.py`, `spatial.py`; `risk_score.py` via Zia AutoML/QuickML. ⚠️ *Needs Adarsh:* QuickML/AutoML setup + deployment IDs.
- `GET /health/cases`,`/health/summary`,`/geo/points`,`/geo/hotspots`,`/analytics/vulnerability`,`/audit`.
- Screens: Health cockpit, Map/hotspots, Audit; fairness panel + factor explanations everywhere.
- RBAC hardening + Data Store permission scopes per role; AuditLog on sensitive reads.
**Done when:** cockpit flags planted slipping cases with reasons + actions; map shows hotspots; audit + fairness visible.

### Phase 4 — Assistant + voice + export (week 3–4)
**Tasks**
- `POST /assistant/query` (LLM over DB via safe ZCQL tools + citations). ⚠️ *Needs Adarsh:* QuickML LLM endpoint + Connection scope; RAG doc IDs.
- RAG over IPC/BNS/SOP docs; `POST /assistant/voice` (Zia STT/TTS/translation — verify Kannada). 
- `POST /assistant/export` → SmartBrowz PDF → Stratus URL.
- Assistant UI (chat + mic + citations + export + deep-links).
**Done when:** English + Kannada question answered with citations on stage; PDF export works.

### Phase 5 — Harden + pitch (final week)
**Tasks**
- Seed the flawless demo path; performance pass (cache, indexes); empty/error states; a11y pass.
- Full deploy + smoke test all links (Catalyst URL, GitHub, video).
- **Deck (official template) + demo video + rehearse 7-min pitch** (owner assigned day 1).
- Fill submission form fields (prototype brief, links).
**Done when:** every item in `01_PRD.md §7` is checked.

### B1. Team ownership (maps to your skills)
- **Web-dev:** client shell, graph/map/cockpit/assistant UIs, design system.
- **Backend:** Functions API, Data Store/ZCQL, RBAC, deploy/CORS, API Gateway.
- **Data/ML:** generator, AppSail pipeline (ER/graph/ML/metrics), QuickML/RAG/Zia, eval tests.
- **Design/pitch (assign one owner from day 1):** deck, demo video, narrative, UI review. *(This seat was the gap flagged earlier; do not leave it to the last night — it's ~half the score.)*

### B2. Cross-cutting definition of done
Every feature: RBAC-scoped, returns an `explanation`, has empty/loading/error states, is covered by at least a smoke test, reads from precomputed data (no heavy compute in Functions), and is committed with a clean conventional-commit message (no AI attribution).
