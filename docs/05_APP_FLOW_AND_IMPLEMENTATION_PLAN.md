# 05 — App flow, and the order you built it in

**Part A** — how the app is wired: sitemap, navigation, journeys, sequences.
**Part B** — the build order, with a definition of done for each phase. If you are rebuilding
from scratch, follow Part B top to bottom.

---

## PART A — App flow

### A1. Sitemap

```
/login                    Role chooser (see the honesty note below)
/                         Home — role-aware dashboard
/about                    Platform, dataset and fairness documentation
/graph                    Case-Linkage Graph explorer
  /graph?case=:id
/cases                    Case list
  /cases/:id              Case detail
/offenders                Offender watchlist
  /offenders/:id          Offender profile
/health                   Investigation-health worklist
/map                      Map / hotspots
/intelligence             Per-capita analytics, correlations, forecast
/assistant                Bilingual assistant
```

`?as=<SI|Inspector|ACP|Analyst|Admin>` on any route opens the app directly in that rank.
Handy for sharing a view and for headless capture — but remember it bypasses the chooser, so
treat the URL as semi-public.

### A2. Navigation

Sidebar: About, Home, Graph, Cases, Offenders, Health, Map, Intelligence, Assistant. Top bar
carries global search, the En/ಕನ್ನಡ toggle, alerts and the role menu.

### A3. The journeys that matter

**J1 — "Is this FIR connected?"** (the demo spine)
`Home → open a case → "Linked cases (N)" → Graph assembles the ego-network → click an edge →
"why linked" names the shared offender across three stations → open the offender profile →
read the risk factors → export the briefing.`

Rehearse this one until it is muscle memory. It is the whole pitch in five clicks.

**J2 — "What is slipping?"**
`Home KPIs → Health → worklist sorted by age → a flagged case shows its reason and a
recommended action → open it in the graph.`

**J3 — "Just ask it"**
`Assistant → type or speak "ಈ ಆರೋಪಿಯ ಹಿಂದಿನ ಪ್ರಕರಣಗಳು?" → grounded answer with FIR citations
→ export.`

**J4 — the analyst view**
`Intelligence → Kodagu ranks 31st by count and 6th per capita → Map → hotspots → cluster →
FIRs → Graph.`

### A4. Sequences

**Open case → graph (read path — fast because nothing is computed here):**
```
Client → GET /graph/case/:id → Function → interned read-model (lazy Proxy rehydrate)
       → { nodes, edges, explanation } → Cytoscape animates
```

**Assistant query:**
```
Client → POST /assistant/query { text, lang }
Function → RBAC scope → intent routing → parametrized read over the case data
         → grounded answer + FIR citations → audit write → response
```

QuickML is two separate surfaces on this project and this paragraph is only about one of them.

**The GLM-4.7 LLM / RAG surface**, which this assistant flow would use, sits behind
`QUICKML_ENABLED`. That flag is now `true` in `functions/api/catalyst-config.json`, but the
deterministic engine remains the live path for grounded answers — it cannot invent an FIR
number, which is worth more here than fluency. `/ai/status` reports `quickml.tokenState` as
`not-attempted`, so "enabled" here means the gate is open, not that the path is exercised.

**The QuickML prediction endpoints are a different surface entirely and are live** — eight of
them, serving the ML forecaster. They are not gated by `QUICKML_ENABLED` and never were. See
`docs/11_ML_MODELS.md` for what they are, what they were measured against, and the twelve
candidates that were rejected.

**Nightly recompute (write path — where all the work happens):**
```
Cron 02:00 IST → Job → entity resolution → graph build → communities → MO similarity
               → risk → anomaly → health → spatial → socio → forecast → evaluate
               → build_bundle (intern) → derived JSON the API reads
```

### A5. Say this out loud about login

The sign-in screen is a **role chooser, not a password gate**. Catalyst Authentication is
provisioned, but the API still trusts a role header rather than a verified JWT. The login
page states this in plain language and so should you.

The role *scoping* is completely real: the API filters every query by the caller's unit,
district or state and refuses out-of-scope reads. Only the identity check is outstanding.
Binding it means changing `userFromRequest` in `rbac.js` to read the Catalyst token; nothing
else moves.

---

## PART B — The build order

**Method:** ship a thin end-to-end slice on Catalyst first, then deepen the hero. Commit
after each working unit, Conventional Commits, no AI attribution anywhere — not in commit
messages, not in file headers. Where a console action or credential is needed, mock behind an
interface and keep moving rather than blocking.

### Phase 0 — Foundations

- Init the repo, `.gitignore`, folder layout.
- `catalyst init` — Functions + Web Client Hosting; add AppSail.
- Scaffold `client` (Vite + TS + Tailwind), `functions/api` (router, error envelope, SDK
  init), `appsail`.
- Design tokens and the layout shell from [04](04_UI_UX_GUIDELINES.md).

**Done when:** the app shell renders locally and `/health` returns ok.

> Do not hand-write `catalyst.json`. Scaffold a throwaway project and copy its real schema —
> you will otherwise burn an afternoon on a file whose format is undocumented. And leave
> `project_id` out of it entirely; the binding belongs in `.catalystrc`, as strings.

### Phase 1 — Data and a vertical slice

- Build the generator per [06](06_SYNTHETIC_DATA_SPEC.md); emit CSVs.
- Create the Data Store tables ([03](03_DATABASE_SCHEMA.md)); import in FK order via a
  Stratus bucket.
- Implement `GET /cases` and `GET /cases/:id`, RBAC-scoped.
- Client: case list and case detail against the deployed function.
- Deploy.

**Done when:** a deployed Catalyst URL lists and opens real FIRs. This is the "skeleton live"
milestone and it is worth more than it looks — everything after it is addition, not
integration risk.

### Phase 2 — The hero: linkage graph and offenders

- `entity_resolution.py` → identities, with the fairness test in place **from the first
  commit**, not retrofitted.
- `graph_build.py` → typed edges with evidence · `community.py` · `mo_similarity.py`.
- The recompute Job, plus Cron nightly.
- Ground-truth evaluation scoring the planted patterns.
- `GET /graph/case/:id`, `/graph/cluster/:id`, `/graph/search`, `/offenders`, `/offenders/:id`.
- Graph explorer with the "why linked" panel, filters and cluster expansion.
- Offender profile with the risk gauge and factor breakdown.

**Done when:** opening a case assembles a cross-silo network, offender profiles resolve name
variants, and "why" shows real evidence.

> **Watch the edge-type mix here.** Capping neighbours by raw strength quietly favours MO
> similarity (scores ~0.99) over shared-offender links (~0.95), so the graph fills with the
> least interesting edge type and the strength slider stops discriminating. Rank by edge
> *kind* first, strength second.

### Phase 3 — Intelligence and trust

- `health_metrics.py`, `anomaly.py`, `spatial.py`, `risk_score.py`.
- `/health/*`, `/geo/*`, `/analytics/*`, `/audit`.
- Screens: health worklist, map, intelligence.
- RBAC hardening; audit on sensitive reads; the fairness statement surfaced in the UI.

**Done when:** the worklist flags the planted slipping cases with reasons and actions, the
map shows hotspots, and the audit trail and fairness statement are both visible.

### Phase 4 — Assistant, voice, export

- `POST /assistant/query` with citations.
- `POST /assistant/voice` — browser Web Speech for STT/TTS.
- `POST /assistant/export` → print-ready briefing HTML.
- Assistant UI: chat, mic, citations, export, deep links.

**Done when:** an English *and* a Kannada question are answered with citations.

> Call the export a **print-ready briefing**, not a PDF. It returns HTML. Claiming a PDF
> pipeline that does not exist is exactly the kind of thing a judge checks.

### Phase 5 — Harden and pitch

- Seed the demo path; performance pass; empty and error states; accessibility pass.
- Full deploy, then smoke-test every link.
- Deck (`docs/deck/`), demo video, rehearse the pitch.
- Fill the submission form: prototype brief, links.

**Done when:** every box in [01 §7](01_PRD.md) is ticked.

### B1. Definition of done — applies to every feature

- RBAC-scoped.
- Returns an `explanation` payload.
- Has empty, loading and error states.
- Covered by at least a smoke test.
- Reads precomputed data — **no heavy compute in a Function**.
- Committed with a clean conventional-commit message and no AI attribution.

### B2. What is left

In priority order, and each is genuinely small:

1. **Bind Catalyst Authentication** — swap the role header for a verified JWT in
   `userFromRequest`. One function.
2. **Read from Data Store** — replace the bundled read-model with ZCQL reads behind the
   existing store interface.
3. **Finish QuickML and Zia** — settle the request-body contract with Zoho support, then
   enable Kannada STT/TTS server-side.
4. **Persist the audit trail** — move the in-memory ring buffer into a Data Store table.
5. **Ingest live data** — Signals on FIR insert for incremental recompute instead of a
   nightly full rebuild.
6. **Extend the graph** — vehicle numbers, phone/IMEI and bank accounts as first-class link
   types.

### B3. Where the hours actually went

Worth knowing before you estimate anything similar again: the pipeline logic was the
predictable part. The time went on platform archaeology — a silent integer-precision bug, an
undocumented `catalyst.json` schema, an AppSail container that ignores `requirements.txt`, a
Job that fails silently unless its entry file is called `index.js`, and an API Gateway that
takes the whole site down when enabled without routes.

Budget for that. It is not a sign anything is going wrong.
