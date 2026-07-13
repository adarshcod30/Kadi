# PROGRESS — KADI (KadiLabs)

_Last updated: 2026-07-13_

Source of truth for build status. Three sections: **Done**, **Next**, **⚠️ Needs Adarsh**.

---

## ✅ Done

### Phase 0 — Foundations
- [x] Read all 6 docs + CLAUDE.md; confirmed plan.
- [x] `git init`, git identity set (Adarsh Dwivedi / adarshdwivedi256@gmail.com).
- [x] Repo folder layout created (`data/`, `functions/`, `appsail/`, `client/`).
- [x] `.gitignore`, `PROGRESS.md`, `catalyst.json`, `.env.example`.

---

## 🔜 Next (in order)

### Phase 0 (finish)
- [ ] Client scaffold: Vite + React 18 + TS + Tailwind, design tokens, app shell (topbar/sidebar/fairness banner).
- [ ] Functions API scaffold: router + error envelope + service interfaces (Catalyst adapter + local mock).
- [ ] AppSail hello + pipeline module stubs.

### Phase 1 — Data + vertical slice
- [ ] Synthetic data generator (`data/generator`) per `06_SYNTHETIC_DATA_SPEC.md` → CSVs + `_ground_truth.json` + `_manifest.json`.
- [ ] `GET /cases`, `GET /cases/:id` (RBAC-scoped) against local mock data layer.
- [ ] Client: Case list + Case detail reading through the API.
- [ ] Deploy skeleton to Catalyst (needs Adarsh — see below).

### Phase 2 — Hero: graph + offenders
- [ ] AppSail pipeline: entity_resolution → graph_build → community → mo_similarity.
- [ ] Ground-truth eval test (≥90% planted gangs recovered).
- [ ] `/graph/*`, `/offenders/*` endpoints; Cytoscape explorer + "Why linked" panel; offender profile.

### Phase 3 — Intelligence + trust
- [ ] health_metrics, anomaly, spatial, risk_score; `/health/*`, `/geo/*`, `/analytics/*`, `/audit`.
- [ ] Health cockpit, Map, Audit screens; fairness panel; RBAC hardening.

### Phase 4 — Assistant + voice + export
- [ ] `/assistant/query`, `/assistant/voice`, `/assistant/export`; assistant UI.

### Phase 5 — Harden + pitch
- [ ] Seed demo path; a11y; deploy + smoke test; deck + video.

---

## ⚠️ Needs Adarsh (console / credentials — I can't do these)

> I've mocked every one of these behind an interface so the app runs locally meanwhile.

1. **Install Catalyst CLI** on your machine so we can deploy:
   ```
   npm i -g zcatalyst-cli
   catalyst login
   ```
   (The CLI is not installed in this environment; I've written `catalyst.json` ready for it.)

2. **Catalyst project** — you gave me: project **KadiLabs**, Project ID **55468000000013048**. ✅
   Still need: **org/environment ID**, and confirm the project's data-center domain (e.g. `.catalyst.zoho.in` vs `.zoho.com`).

3. **Enable services** in the Catalyst console (Cloud Scale): Authentication, Data Store, NoSQL, Cache, Stratus, QuickML, Zia, Cron, API Gateway, Signals, AppSail, Pipelines.

4. **Data import**: create a Stratus bucket for CSV upload; confirm `catalyst data-store import` is available on your plan.

5. **QuickML** (Phase 4): LLM (GLM-4.7) deployment ID + endpoint URL; Connection with scope `quickml.deployment.read`; RAG knowledge-base document IDs.

6. **Zia** (Phase 4): enable Zia Services; confirm **Kannada STT/TTS** availability (else we use the translation fallback).

7. **Auth / CORS**: whitelist the Slate front-end domain and enable CORS once deployed.

8. **Credits**: confirm free-credit claim covers Data Store + AppSail + QuickML usage.

9. **Submission**: exact deadline + team details for README/deck.
