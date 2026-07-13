# Master Build Prompt for Claude Code — KADI (KadiLabs)

> Paste the block below into Claude Code from inside the `KadiLabs/` folder. It is written to be handed over verbatim. Everything it references already exists in this repo.

---

You are the lead engineer building **KADI**, an AI-driven Crime Analytics & Visualization platform for the Karnataka State Police, for **Datathon 2026 (Challenge 02)** by Hack2Skill. We intend to win. The solution **must deploy on Zoho Catalyst**.

## Step 0 — Read before writing any code
Read, in order, and treat them as the source of truth:
1. `CLAUDE.md` (rules, stack, git, when to ask me)
2. `docs/01_PRD.md` (what to build)
3. `docs/02_TRD.md` (how — architecture, Catalyst services, APIs, ML)
4. `docs/03_DATABASE_SCHEMA.md` (data model)
5. `docs/04_UI_UX_GUIDELINES.md` (light, KSP-style design system + every screen)
6. `docs/05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md` (the phased build order — follow it)
7. `docs/06_SYNTHETIC_DATA_SPEC.md` (dataset to generate)

Then create `PROGRESS.md` with three sections: **Done**, **Next**, **⚠️ Needs Adarsh**. Keep it current as you work.

## Mission & priorities
Build the hero first: the **Case-Linkage Graph** (connect a new FIR to related past cases / serial crimes / repeat-offender networks across stations and districts), then **Investigation-Health early warning**, then the trust layer (explainability + fairness + audit + RBAC), then the **assistant (NL + Kannada voice + PDF export)**. Follow the phase order in `docs/05`. Ship a thin end-to-end slice deployed on Catalyst in Phase 1 before deepening.

## Non-negotiable constraints
- **Deploy on Catalyst**; always prefer a Catalyst service over any third-party equivalent (see `docs/02_TRD.md` service map).
- **Never run heavy compute in a serverless Function (30s limit).** Entity resolution, graph build, ML, and metric recompute run in **AppSail (Python)** / **Catalyst Jobs**, scheduled by **Cron** / triggered by **Signals**. The web app and Functions only **read** precomputed results.
- **Fairness is a feature.** Never use `CasteID`, `ReligionID`, or `OccupationID` as an input to entity resolution, linkage, risk, or any prediction. Add a unit test that fails if any protected column appears in a model's feature set. Surface the fairness statement in the UI.
- **Explainability everywhere.** Every graph edge, score, and AI answer must return and display an `explanation` (matched attributes + source FIR numbers).
- **Light, government-grade UI** per `docs/04`. No dark theme.

## Engineering standards
- TypeScript on the frontend; typed API contracts; consistent error envelope `{ ok, data?|error }`.
- Small, composable modules; thin controllers → services; no business logic in React components.
- RBAC enforced server-side on every endpoint; audit sensitive reads.
- Reads are fast (precomputed + cached). Add DB indexes per `docs/03`.
- Tests: ZCQL builders, RBAC scoping, entity-resolution matching, health-metric math, and the **ground-truth eval** (pipeline recovers ≥90% of planted gangs/chains). Smoke-test the demo path.
- Keep secrets out of git (`.env`, Catalyst config). Provide `.env.example`.

## Git rules (read carefully)
- Work on a local git repo. Commit **frequently** — after each working module/milestone.
- Use **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Do NOT include any AI/Claude attribution anywhere** — no `Co-Authored-By: Claude`, no "Generated with Claude Code", no robot emoji, in commit messages, PR text, or file headers. Commits must read as fully human-authored so nothing appears when the repo is later pushed to GitHub.
- Use my git identity (ask me for `user.name`/`user.email` if not set). **Do not push to any remote** unless I tell you to.

## When to STOP and ask me (Adarsh)
You cannot operate the Catalyst web console or hold Zoho credentials. When you need any of these, add the exact instruction to `PROGRESS.md → ⚠️ Needs Adarsh`, ask me in chat, and keep working on anything that doesn't depend on it (mock the dependency behind an interface so the app still runs locally):
- Creating the Catalyst **project**; the **project ID / org ID / environment**.
- **Enabling services** (Authentication, Data Store, NoSQL, Cache, Stratus, QuickML, Zia, Cron, API Gateway, Signals, Pipelines).
- **Connections / OAuth scopes** (e.g. `quickml.deployment.read`), social-login client ID/secret.
- **QuickML** LLM/model **deployment IDs + endpoint URLs**, and **RAG document IDs**.
- **Zia** service enablement and whether **Kannada STT/TTS** is available (else use the translation fallback).
- Importing CSVs (**Stratus bucket** + `catalyst data-store import`), and **credits**.
- Front-end **domain whitelisting + CORS**.
- Team/git identity, and the exact **submission deadline**.

Give me copy-paste-ready instructions (exact console path, exact CLI command, exact values you need back).

## Deliverables (definition of done)
A deployed Catalyst URL where a judge can log in by role → open a fresh FIR → watch it link into a cross-silo network → inspect the "why" → see Investigation-Health flags with recommended actions → ask a question in English and Kannada (voice) → export a PDF — with the fairness/audit panel visible. Plus a public GitHub repo with README + setup/run steps, and a seeded flawless demo path.

## Start now
1. Confirm you've read the docs; summarize the plan back to me in 6–8 lines.
2. Do **Phase 0** (repo scaffold, Catalyst init, app shell, design tokens) and list the first ⚠️ Needs-Adarsh items (Catalyst project/IDs).
3. Then build the **synthetic data generator** (Phase 1) so we have data to develop against, and stand up the deployed skeleton (`/cases` list + detail) end-to-end on Catalyst.
Keep `PROGRESS.md` updated and commit as you go (clean messages, no AI attribution).
