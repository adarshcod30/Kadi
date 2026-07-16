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

## ⚠️ Needs Adarsh (console / credentials — I can't do these)

> Every one of these is mocked behind an interface, so the app runs fully locally meanwhile.
> Full runbook: **[docs/07_CATALYST_SETUP.md](docs/07_CATALYST_SETUP.md)**.

### Resolved 2026-07-16 (verified against the live account — no longer blocking)

- ~~Install CLI + login~~ — CLI **v1.26.2** present; `catalyst whoami` → `23ucs509`.
- ~~Org / environment ID / data centre~~ — org **60078029367**, env **Development** (id `60078029367`),
  DC **`in`**, domain `kadilabs-60078029367.development`. Project bound via `catalyst project:use`.
- ~~AppSail Python 3.9 vs 3.11~~ — `catalyst config:list` shows python3_9…3_13; **3.11 available**.

### Still blocking

1. **Enable services** (console only — no CLI equivalent): Authentication, Data Store, NoSQL, Cache,
   Stratus, Zia, Cron, Signals, AppSail, Slate, QuickML, Pipelines → <https://console.catalyst.zoho.in/>
2. **API Gateway** is currently **DISABLED** (`catalyst apig:status`). One command fixes it:
   `catalyst apig:enable` — say the word and I'll run it.
3. **Data import**: create a Stratus bucket; `catalyst ds:import --table <T> --config <cfg>` in the FK
   order from `data/output/_manifest.json`. Needs a per-table column-mapping config.
4. **QuickML**: GLM-4.7 deployment ID + endpoint URL; Connection scope `quickml.deployment.read`;
   RAG knowledge-base document IDs (IPC/BNS/SOP docs).
5. **Zia**: enable Zia Services; confirm **Kannada STT/TTS** availability (else translation fallback).
6. **Auth / CORS**: whitelist the Slate front-end domain + enable CORS once deployed.
7. **Credits**: confirm free-credit claim covers Data Store + AppSail + QuickML.
8. **Submission**: exact deadline + team details for README/deck.
9. **Deploy** publishes to your Zoho account — I won't run `catalyst deploy` unless you tell me to.
   Everything is built and ready meanwhile.
