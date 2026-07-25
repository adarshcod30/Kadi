# PROGRESS — KADI (KadiLabs)

_Last updated: 2026-07-14_

Source of truth for build status. Three sections: **Done**, **Next**, **⚠️ Needs Adarsh**.

The whole stack runs **locally end-to-end** against a mock backend (reads generated CSVs +
precomputed read-model) behind a store interface, so the Catalyst adapters drop in unchanged.

---

## ✅ Done

### Phase 0 — Foundations
- Repo scaffold, git identity, `.gitignore`, `catalyst.json`, `.env.example` (mock|catalyst switch).

### Phase 1 — Data + vertical slice
- **Synthetic generator** (`data/generator`): 31 real districts, crime taxonomy, IPC/BNS/IT/NDPS
  sections, Kannada name pool, MO templates. Deterministic (SEED=2026); 40k FIRs + parties/acts/
  arrests/chargesheets across 29 tables in ~1.3s; CrimeNo per schema.
- **7 planted ground-truth patterns** (cross-district gang, serial burglary, cyber ring, repeat
  offender, slipping cases, false-case cluster, emerging hotspot) + 40 ordinary repeat offenders.
- **`validate.py`**: FK integrity, CrimeNo format, pattern presence, fairness chi-square — all pass.
- **Cases list + detail** end-to-end (RBAC-scoped) through the API.

### Phase 2 — Hero: linkage graph + offenders
- **AppSail pipeline**: entity resolution (rarity-aware, 12s), MO similarity (TF-IDF), graph build
  (typed LinkEdges + evidence), community detection (Louvain), risk, health, anomaly, spatial.
- **Ground-truth eval: 100%** cluster recovery, 100% single-person ER, repeat-offender High risk,
  emerging hotspot detected (target ≥90%).
- **Graph explorer** (Cytoscape fcose): animated ego-network, typed edges, cluster colours,
  **"Why linked"** evidence panel, legend, deep-links — verified live.
- **Offender watchlist + profile**: risk gauge, glass-box factor breakdown, ER variants/confidence,
  "protected attributes: none".

### Phase 3 — Intelligence + trust
- **Health cockpit** (worklist + flags + peer medians + recommended actions), **Map** (MapLibre
  hotspots + emerging trends), **Audit** log, **Admin** (fairness/eval/pipeline status).
- **RBAC** enforced server-side (SI/Inspector unit · ACP district · Analyst/Admin state) +
  capability gates; audit on every sensitive read.

### Phase 4 — Assistant + voice + export
- Grounded **NL assistant** (EN + Kannada) over safe query tools, always cites FIRs; **Web Speech**
  voice in/out; **PDF export** (HTML briefing; SmartBrowz adapter for Catalyst).

### Cross-cutting
- Node API (Express) usable locally + as Catalyst Advanced I/O Function; standard `{ok,data|error}`
  envelope; `/health`, `/me`, `/eval`.
- AppSail Flask service + Jobs (`recompute_graph` Cron, `recompute_metrics` Signal).
- **Tests:** 11 Python (fairness, ER, eval, health) + 7 Node (envelope, RBAC, graph evidence) — all
  pass. README written.

---

## 🔜 Next
- **Deploy to Catalyst** (needs the console/credential items below), then whitelist domain + CORS.
- Wire **QuickML GLM-4.7 + RAG** behind the assistant's existing tool interface (adapter stub ready).
- Wire **Zia** STT/TTS/translation (Web Speech is the local fallback today).
- **SmartBrowz** PDF render (local returns HTML briefing today).
- Catalyst **Data Store** adapter for the store interface (mock is feature-complete).
- Phase 5 polish: perf pass, a11y sweep, seed a locked flawless demo path.
- **Deck (official PPT) + demo video** — owner + content (I can draft the deck outline/script).

---

## 🔎 What is REAL vs what is MOCKED (read this before demoing)

Verified live on 2026-07-25. Nothing here is aspirational — each row was tested.

### Genuinely running on Catalyst

| Service | Evidence |
|---|---|
| **Web Client Hosting** | SPA at `/app/` returns 200 |
| **Serverless Functions** | `api` (advancedio, 512 MB) + `refreshanalytics` (job) deployed |
| **AppSail** | `kadi-appsail` live; `/analytics/socio` 135 ms, `/analytics/forecast` 158 ms |
| **Data Store** | 11 tables; **40,836 FIRs**; `SELECT COUNT(CaseMasterID)` → 40836 via ZCQL |
| **Stratus** | bucket `kadi-readmodel` holding the 8.4 MB import CSV |
| **Job Scheduling + Cron** | pool `kadi_nightly`, cron `0 2 * * *` IST, ran on demand → SUCCESS |
| **Connections** | `kadi_quickml`, scope `QuickML.deployment.READ`, status Connected |

### Mocked, stubbed, or not wired — be upfront about these

| # | Thing | Reality |
|---|---|---|
| 1 | **Authentication** | Service is enabled, but **the app has no login and the API is open**. `rbac.js` reads a `x-kadi-role` header anyone can set, so the role switcher is self-declared. The RBAC *logic* (SI→unit, ACP→district, Analyst→state) is real and enforced server-side on every query; only the identity binding is fake. |
| 2 | **Runtime data source** | The deployed API reads **bundled CSV/JSON shipped inside the function**, not Data Store. The 40,836 rows in Data Store are real and ZCQL-queryable, but the UI does not read from them. |
| 3 | **Audit log** | In-memory ring buffer in `audit.js`. Wiped on every cold start — `/audit` currently returns `[]`. Not persisted to Data Store. |
| 4 | **PDF export** | Returns **HTML**, not PDF. SmartBrowz is not wired. |
| 5 | **Cache** | Adapter written; writes fail `401 PERMISSION_NEEDED` from inside a function. Every call is a miss that recomputes. No user impact. |
| 6 | **QuickML** | Endpoint/model/token all correct; the endpoint rejects our body with `400 PATTERN_NOT_MATCHED`. Gated off via `QUICKML_ENABLED`. The assistant is a deterministic intent engine, not an LLM. |
| 7 | **Zia** | Adapter written, service not enabled. Voice is the **browser Web Speech API**, client-side. |
| 8 | **The dataset** | Synthetic by design (40,836 FIRs from `data/generator`). Real Census 2011 population is used as the per-capita denominator. |
| 9 | **API Gateway** | Deliberately **off** — enabling it with no routes configured took the whole site down. |

### One caveat to state if asked about the correlation

The urbanisation↔crime-rate correlation (r=0.878) is **partly circular**: the generator was
built with urban weighting, so "cities have more crime" is partly by construction. The
analysis is sound and would run identically on real KSP data — but it is not a discovery.

---

## ⚠️ Needs Adarsh (console / credentials — I can't do these)

> Every one of these is mocked behind an interface, so the app runs fully locally meanwhile.
> Full runbook: **[docs/07_CATALYST_SETUP.md](docs/07_CATALYST_SETUP.md)**.

### Resolved 2026-07-16 (verified against the live account — no longer blocking)

- ~~Install CLI + login~~ — CLI installed; `catalyst whoami` → `23ucs509`.
- ~~Org / environment ID / data centre~~ — org **60078029367**, env **Development** (id `60078029367`),
  DC **`in`**, domain `kadilabs-60078029367.development`. Project bound via `catalyst project:use`.
- ~~AppSail Python 3.9 vs 3.11~~ — `catalyst config:list` shows python_3_9…3_13; **3.11 pinned**.
- ~~CLI version~~ — upgraded 1.26.2 → **1.27.0**.
- ~~**API Gateway**~~ — **ENABLED** via `catalyst apig:enable` ✅.
- ~~`catalyst.json` schema risk~~ — **resolved**. Recovered the real schema from a scratch
  scaffold; our hand-written file was structurally wrong and its numeric `project_id` was
  silently corrupted by JS float precision. Fixed, plus the 4 missing deploy manifests.

### Still blocking

1. **Enable services** (console only — no CLI equivalent): Authentication, Data Store, NoSQL, Cache,
   Stratus, Zia, Cron, Signals, AppSail, Slate, QuickML, Pipelines → <https://console.catalyst.zoho.in/>
2. **Data import**: create a Stratus bucket; `catalyst ds:import --table <T> --config <cfg>` in the FK
   order from `data/output/_manifest.json`. Needs a per-table column-mapping config.
3. **QuickML**: GLM-4.7 deployment ID + endpoint URL; Connection scope `quickml.deployment.read`;
   RAG knowledge-base document IDs (IPC/BNS/SOP docs).
4. **Zia**: enable Zia Services; confirm **Kannada STT/TTS** availability (else translation fallback).
5. **Auth / CORS**: whitelist the Slate front-end domain + enable CORS once deployed.
6. **Credits**: confirm free-credit claim covers Data Store + AppSail + QuickML.
7. **Submission**: exact deadline + team details for README/deck.
8. **Deploy** — `catalyst deploy` publishes to your Zoho account, so it needs your explicit
   go-ahead (a blanket "do everything" doesn't cover it). Configs are fixed and the build is
   current, so it's a single command whenever you say. Services above must be enabled first
   or functions/appsail will fail.
