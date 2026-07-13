# KADI — Karnataka Analytics & Detection Intelligence

**AI-driven Crime Analytics & Visualization Platform for the Karnataka State Police**
Built for **Datathon 2026, Challenge 02** (Hack2Skill) · deploys on **Zoho Catalyst**.

> *कड़ी* — "a link in a chain." KADI turns thousands of siloed FIRs into a single living
> graph, so a new FIR instantly reveals its connected past cases, serial-crime chains, and
> repeat-offender networks — plus which live investigations are silently slipping — all with
> an **explainable, fair, evidence-backed** trail.

---

## Why it matters

FIRs are registered per station and live in isolation. A gang operating across stations and
districts shows up as many unrelated petty crimes; cross-jurisdiction connections are invisible;
cases drift past detection timelines with no supervisory signal. KADI fixes this **without ever
profiling communities** — caste, religion and occupation are excluded from every model by design,
and the exclusion is proven in the UI and in tests.

## The two heroes

1. **Case-Linkage Graph** — open any FIR and watch its connected network assemble: related cases,
   shared/co-accused offenders, serial chains and gang clusters *across stations and districts*.
   Every edge is click-through to a **"Why linked"** panel with the exact matching attributes and
   source FIR numbers.
2. **Investigation-Health early warning** — a cockpit that flags cases slipping past detection
   timelines (reporting delay, ageing vs peer median, pendency, undetected-risk, false-case
   pattern) with a plain-language reason and a **recommended next action**.

Supported by: repeat-offender profiles with a **glass-box behaviour-based risk score**,
spatiotemporal hotspots + emerging-trend detection, a grounded **NL + Kannada voice assistant**,
and a full **explainability / fairness / audit / RBAC** trust layer.

---

## Architecture

```
 React SPA (Catalyst Slate)  ──HTTPS/JWT──►  Node API (Advanced I/O Functions, <30s, READ-ONLY)
 Dashboard·Graph·Cockpit·Map·Chat                 │ reads precomputed
                                                  ▼
                              NoSQL + Cache (graph, scores)   Data Store (FIR + KADI tables, ZCQL)
                                                  ▲ writes derived
                              AppSail (Python) + Catalyst Jobs  ◄── Cron (nightly) / Signals (new FIR)
                              ER · graph build · community · risk · health · anomaly · spatial
                              QuickML (GLM-4.7 + RAG) · Zia (STT/TTS/translate) · SmartBrowz (PDF)
```

**Golden rule:** the SPA and Functions **only read** precomputed graph/scores. All heavy compute
(entity resolution, graph build, ML, metric recompute) runs asynchronously in **AppSail / Jobs**
— never inside a 30-second Function.

| Layer | Tech | Catalyst service |
|---|---|---|
| Frontend | React 18 · Vite · TS · Tailwind · Cytoscape · MapLibre · Recharts · TanStack Query | Slate / Web Client Hosting |
| API | Node 20 · Express-style handler · typed envelope · RBAC | Advanced I/O Functions + API Gateway |
| Compute/ML | Python 3.11 · pandas · scikit-learn · networkx · rapidfuzz | AppSail + Jobs, Cron, Signals |
| Data | source FIR schema + derived analytics tables | Data Store (ZCQL) · NoSQL · Cache · Stratus |
| AI | grounded NL/Kannada assistant · RAG | QuickML (GLM-4.7) · Zia · SmartBrowz |
| Auth | role-based (SI/Inspector/ACP/Analyst/Admin) | Authentication |

See [`docs/`](docs/) for the full PRD, TRD, schema, UI system, plan, and data spec.

---

## Repository layout

```
KadiLabs/
├── data/generator/     synthetic FIR generator (karnataka.py, patterns.py, generate.py, validate.py)
├── data/output/        generated CSVs + _ground_truth.json + derived/ read-model (gitignored CSVs)
├── appsail/            Python analytics pipeline + Flask service + Jobs + tests
│   └── pipeline/       entity_resolution · mo_similarity · graph_build · community · risk_score
│                       · health_metrics · anomaly · spatial · run_pipeline · evaluate
├── functions/          Node API (Express app; local mock backend + Catalyst adapter) + tests
├── client/             React SPA (Vite + TS + Tailwind)
└── catalyst.json       Catalyst project config
```

---

## Run it locally (no Catalyst needed)

Everything runs locally against a **mock backend** that reads the generated data + precomputed
read-model, behind a store interface so the Catalyst adapters drop in unchanged.

**Prereqs:** Node 20+, Python 3.11+.

```bash
# 1) Python env + deps
python3 -m venv .venv && . .venv/bin/activate
pip install -r appsail/requirements.txt

# 2) Generate the synthetic dataset (deterministic, ~1.3s) and validate it
python data/generator/generate.py --cases 40000 --out data/output
python data/generator/validate.py --dir data/output

# 3) Run the analytics pipeline (ER → graph → community → risk → health → spatial), ~22s
python appsail/pipeline/run_pipeline.py --data data/output

# 4) API (mock backend) on :9000
cd functions && npm install && npm start

# 5) Client on :5173 (proxies /api → :9000)
cd ../client && npm install && npm run dev
```

Open **http://localhost:5173**. Switch role from the top-right menu (demo). Set `x-kadi-role`
to `SI|Inspector|ACP|Analyst|Admin` to see RBAC scoping.

### Tests

```bash
.venv/bin/python -m pytest appsail/tests -q     # fairness, ER, eval, health math
cd functions && node --test                     # envelope, RBAC, graph evidence
```

---

## The 90-second demo path

1. **Dashboard** → KPIs (open / flagged / offender networks / resolved offenders), alerts, and a
   *"Detection validated — 100%"* proof card.
2. **Graph** → open the chain-snatching gang FIR → the cross-district network snaps together;
   click an edge → **"Why linked"** shows *shared offender "Ravi Kumar Doddamani" + similar MO*
   with source FIRs.
3. **Offender profile** → risk gauge + **glass-box factor breakdown**; *"Protected attributes used:
   none."*
4. **Health cockpit** → cases slipping past peer-median age, each with a **recommended action**.
5. **Map** → emerging MV-theft hotspot (saffron ring) vs baseline.
6. **Assistant** → ask *"which cases are slipping?"* and, in Kannada, *"ಈ ಆರೋಪಿಯ ಹಿಂದಿನ
   ಪ್ರಕರಣಗಳು?"* → grounded answers with FIR citations; export to PDF.
7. **Audit** (ACP/Admin) → every sensitive read + AI query logged.

---

## Fairness & explainability (a feature, not an afterthought)

- **Excluded by design:** `CasteID`, `ReligionID`, `OccupationID` never enter entity resolution,
  linkage, risk or any prediction. Enforced by `assert_no_protected()` and a **unit test that fails
  if any protected column appears in a model's feature set**. In the synthetic data these fields are
  distributed *independently* of outcomes (validated by a chi-square check), so excluding them costs
  no accuracy — and we can prove it.
- **Every insight is explainable:** each edge, score and answer returns an `explanation` (matched
  attributes + source FIRs). Offender risk is a transparent weighted sum with a per-factor breakdown.
- **Audit + RBAC:** roles mirror the KSP hierarchy; scopes enforced server-side; sensitive reads and
  AI queries are logged.

## Proven detection (ground-truth evaluation)

The synthetic data plants known gangs / serial chains / rings / slipping cases. The pipeline's
`evaluate.py` measures recovery against that ground truth (target ≥ 90%):

| Metric | Result |
|---|---|
| Gang recovery (cases in one cluster) | **100%** |
| Serial-chain / cyber-ring recovery | **100%** |
| Offender entity-resolution accuracy | **100%** |
| Repeat offender flagged high risk | **✓** |
| Emerging hotspot detected | **✓** |

## Data

Real FIR data is confidential, so KADI is built on a **schema-faithful synthetic dataset** (40k FIRs
across 31 real Karnataka districts, Jan 2023 – Jun 2026) that matches the KSP ER-diagram exactly and
plants explicit ground-truth patterns. The pipeline ingests a real KSP export **unchanged**. A
*"Demo dataset (synthetic)"* tag is shown in the UI.

## Deploying to Catalyst

Set `KADI_BACKEND=catalyst` and provide the IDs in `.env` (see `.env.example`), then
`catalyst deploy` (client → Slate, functions → Advanced I/O, appsail → AppSail). Import CSVs via a
Stratus bucket + `catalyst data-store import`; schedule `recompute_graph` on Cron; wire Signals for
new-FIR increments. Console-side steps that need the project owner are tracked in
[`PROGRESS.md`](PROGRESS.md) → **Needs Adarsh**.
