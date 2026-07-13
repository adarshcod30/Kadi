# CLAUDE.md — KADI (KadiLabs)

> This file orients Claude Code. Read it first, then read everything in `docs/` before writing code.

## What we are building
**KADI** — *Karnataka Analytics & Detection Intelligence* — an AI-driven **Crime Analytics & Visualization Platform** for the Karnataka State Police (KSP), built for **Datathon 2026, Challenge 02** (Hack2Skill). The name plays on the Hindi *कड़ी* ("link/chain") and the detective idiom *कड़ी से कड़ी जोड़ना* ("connect link to link").

**One-line product:** KADI turns thousands of siloed FIRs into a single living graph, so a new FIR instantly reveals its connected past cases, serial-crime chains, and repeat-offender networks — plus which live investigations are silently slipping — all with an explainable, fair, evidence-backed trail.

**The hero (build this best):** the **Case-Linkage Graph**. Everything else supports it. Secondary hero: **Investigation-Health early warning**. Do these two exceptionally well before adding breadth.

## Hard rules (non-negotiable — this is a hackathon we intend to win)
1. **Must deploy on Zoho Catalyst.** Using a third-party service where a Catalyst service exists can invalidate the submission. Prefer Catalyst services always (see `docs/02_TRD.md` §Catalyst service map).
2. **Serverless Functions have a 30-second timeout.** Never run graph builds, entity resolution, or ML training inside a Function. Heavy compute runs in **AppSail (Python)** or **Catalyst Jobs** (15-min limit), scheduled via **Cron** or triggered via **Signals/Event Functions**. The web app only *reads* precomputed results.
3. **Fairness is a feature, not an afterthought.** Never use caste, religion, or occupation as an input to any linkage, risk score, or prediction. Show this exclusion in the UI. This directly answers the jury's hardest question.
4. **Explainability everywhere.** Every graph edge, score, and AI answer must be click-through to its source FIR(s) and the reason it was produced.
5. **Light, government-grade UI.** Follow `docs/04_UI_UX_GUIDELINES.md`. Clean, trustworthy, KSP-like. No dark theme.

## Documentation index (read in this order)
1. `docs/01_PRD.md` — what to build and why (product, users, features, acceptance criteria).
2. `docs/02_TRD.md` — how to build it (architecture, Catalyst services, APIs, ML, deployment).
3. `docs/03_DATABASE_SCHEMA.md` — the data model (FIR schema + KADI-specific tables).
4. `docs/04_UI_UX_GUIDELINES.md` — the design system and every screen.
5. `docs/05_APP_FLOW_AND_IMPLEMENTATION_PLAN.md` — flows + the phased build order to follow.
6. `docs/06_SYNTHETIC_DATA_SPEC.md` — the dataset to generate and its format.

## Tech stack (summary — details in TRD)
- **Frontend:** React 18 + Vite + TypeScript, TailwindCSS, Cytoscape.js (graph), MapLibre GL (maps), Recharts (charts), React Router, TanStack Query. Hosted on **Catalyst Slate / Web Client Hosting**.
- **API:** Node.js 20+ **Catalyst Advanced I/O Functions** behind **API Gateway**.
- **Heavy compute / ML:** Python 3.11 on **Catalyst AppSail** (managed runtime) + **Catalyst Jobs**; `pandas`, `networkx`, `scikit-learn`, `rapidfuzz`, `sentence-transformers`.
- **Data:** **Catalyst Data Store** (relational, queried with **ZCQL**) + **NoSQL** (graph adjacency) + **Cache** + **Stratus** (files/exports).
- **AI:** **QuickML** LLM Serving (GLM-4.7) + **RAG**; **Zia Services** (OCR, speech-to-text, text-to-speech, translation).
- **Auth:** **Catalyst Authentication** with role-based table scopes.

## Repository layout (create this)
```
KadiLabs/
├── CLAUDE.md                     # this file
├── CLAUDE_CODE_BUILD_PROMPT.md   # the master build prompt
├── PROGRESS.md                   # you maintain this: what's done / next / blockers
├── docs/                         # the 6 specs (already written)
├── data/
│   ├── generator/                # Python synthetic data generator
│   └── output/                   # generated CSVs for Data Store import (gitignored if large)
├── functions/                    # Catalyst Node serverless functions (API)
├── appsail/                      # Python AppSail app (graph + ML services)
├── client/                       # React frontend (deployed to Slate)
├── catalyst.json                 # Catalyst project config
└── .gitignore
```

## Git rules (IMPORTANT — read carefully)
- Initialize a **local git repo** and commit **frequently** (after each working milestone/module).
- Use **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- **Do NOT add any AI/Claude attribution.** No `Co-Authored-By: Claude`, no "Generated with Claude Code", no 🤖 lines in commit messages or PR bodies. Commits must look fully human-authored so nothing surfaces when pushed to GitHub later.
- Set the git author to the user (ask for name/email if not already configured; otherwise use the repo's existing `user.name`/`user.email`).
- Do **not** push to any remote unless explicitly told. Local commits only.
- Keep secrets out of git: API keys, client secrets, Catalyst IDs go in `.env` / `catalyst` config and are gitignored.

## When to STOP and ask the user (Adarsh)
Claude Code cannot click inside the Catalyst web console or hold Zoho credentials. **Pause and ask** whenever you need:
- Catalyst **project creation / project ID / org ID / environment IDs**.
- Enabling a **service** in the console (Authentication, QuickML, Zia, Data Store, Stratus, Connections).
- **Connections / OAuth scopes** (e.g. `quickml.deployment.read`), client ID/secret for social login.
- **QuickML** LLM endpoint URLs, RAG document IDs, model deployment IDs.
- **Credits** claim, quotas, or anything requiring a login.
- The exact **submission deadline** and team details.

When you hit one of these, write the exact step needed into `PROGRESS.md` under "⚠️ Needs Adarsh", ask in chat, and continue with any work that doesn't depend on it (e.g. mock the endpoint behind an interface so the app runs locally).

## Definition of done for the hackathon
A deployed Catalyst URL where a judge can: log in by role → open a fresh FIR → watch it link into a network → inspect the "why" → see Investigation-Health flags → ask a question (incl. Kannada/voice) → export a PDF — with the fairness/audit panel visible. Plus: public GitHub repo w/ README, demo video, filled official PPT template.
