# 07 — Catalyst Setup Runbook (from scratch)

Everything needed to take KADI from a local build to a live Catalyst URL.

**Values below are verified against the real account** (not placeholders) — read back
from `catalyst project:use` on 2026-07-16.

| Value | Setting |
|---|---|
| Zoho account | `23ucs509` |
| **Org ID** | `60078029367` |
| **Project** | `KadiLabs` |
| **Project ID** | `55468000000013048` |
| **Environment** | `Development` (id `60078029367`, type 3) |
| **Project domain** | `kadilabs-60078029367.development` |
| **Data centre** | `in` → `.zoho.in` (confirmed: `--dc us` fails auth, `--dc in` works) |
| Timezone | `Asia/Kolkata` |
| AppSail runtimes available | python **3.9 – 3.13** (so 3.11 is fine), node 12–24, java 8/11/17 |

> **Rule of thumb:** the **CLI** does code + data (deploy, import, API Gateway).
> The **console** does services + credentials (enabling Data Store/NoSQL/Zia/QuickML,
> OAuth scopes, domain whitelisting). You cannot enable most services from the CLI.

---

## Step 0 — Prerequisites (done ✅)

```bash
npm i -g zcatalyst-cli     # installed: v1.26.2
catalyst login             # done — `catalyst whoami` prints 23ucs509
```

If the CLI ever logs out: `catalyst login --force` (add `--no-localhost` on a headless box).

## Step 1 — Bind the project to this directory (done ✅)

```bash
cd /Users/adarsh/Desktop/Projects/KadiLabs
catalyst project:use KadiLabs --org 60078029367 --dc in
```

This writes `.catalystrc` (git-ignored — it's local machine state, no secrets).
Verify with `catalyst project:list` → **KadiLabs (active)**.
To undo: `catalyst project:reset`.

## Step 2 — Enable services in the console  ⚠️ ONLY YOU CAN DO THIS

Console → <https://console.catalyst.zoho.in/> → project **KadiLabs**.
Enable each of these (most are one click; they're off by default):

| Service | Console path | Needed for |
|---|---|---|
| **Authentication** | Cloud Scale → Authentication | login + RBAC |
| **Data Store** | Cloud Scale → Data Store | FIR tables (source of truth) |
| **NoSQL** | Cloud Scale → NoSQL | graph/score read-model |
| **Cache** | Cloud Scale → Cache | dashboard KPIs |
| **Stratus** | Cloud Scale → Stratus | CSV import bucket + PDF exports |
| **Cron** | Cloud Scale → Cron | nightly pipeline rebuild |
| **Signals / Event Fn** | Cloud Scale → Signals | incremental update on new FIR |
| **AppSail** | Serverless → AppSail | the Python analytics pipeline |
| **Slate** | Serverless → Slate | React front-end hosting |
| **QuickML** | QuickML | GLM-4.7 LLM + RAG (assistant) |
| **Zia** | Zia Services | Kannada STT/TTS/translation |
| **Pipelines** | DevOps → Pipelines | CI/CD from GitHub (optional) |

**API Gateway is the exception — it's CLI-controlled.** Currently **DISABLED**:

```bash
catalyst apig:status     # -> API Gateway: DISABLED
catalyst apig:enable     # turn it on
```

## Step 3 — Permissions / credentials to send back to me

These are the only things still blocking a full deploy:

1. **QuickML** → create an LLM (GLM-4.7) deployment. Send me:
   - deployment ID, endpoint URL
   - a **Connection** with scope `quickml.deployment.read`
   - RAG knowledge-base document IDs (after uploading IPC/BNS/SOP docs)
2. **Zia** → enable, and confirm whether **Kannada STT/TTS** is offered.
   *(If not: we already have the fallback — browser Web Speech + Zia translation.)*
3. **Authentication → domain whitelisting**: after the first client deploy, whitelist the
   Slate domain and enable CORS. This is the #1 integration gotcha.
4. **Credits**: confirm the free-tier claim covers Data Store + AppSail + QuickML.

Until these land, `KADI_BACKEND=mock` keeps everything running locally — nothing is blocked.

## Step 4 — Import the synthetic data

```bash
python data/generator/generate.py --cases 40000 --out data/output   # 29 CSVs
```

Import **in FK order** (see `data/output/_manifest.json` → `import_order`):
lookups → `Unit`/`Employee` → `CaseMaster` → children.

```bash
catalyst ds:import --table CaseMaster --config <config.json>
catalyst ds:status <operation> <jobid>
```

`ds:import` needs a per-table config JSON mapping CSV columns → Data Store columns.
Add `--production` only when targeting the production environment.

> Derived tables (LinkEdge, OffenderRisk, CaseHealthMetric…) are **not imported** —
> the AppSail pipeline computes them.

## Step 5 — Deploy

```bash
cd client && npm run build && cd ..    # emits client/dist

catalyst deploy                        # everything
catalyst deploy --only client          # or one target at a time
catalyst deploy --only functions
catalyst deploy --only appsail
```

Expected URL: `https://kadilabs-60078029367.development.catalystserverless.in`

Then: **whitelist that domain** under Authentication (Step 3.3), or the SPA's API calls
will be blocked by CORS.

## Step 6 — Schedule the pipeline

Console → Cron → new Cron → target the AppSail job `jobs/recompute_graph.py`
(nightly). Signals → on `CaseMaster` insert → `jobs/recompute_metrics.py`.

---

## Known gaps / things to check on first deploy

- **`catalyst.json` schema** — ours is hand-written. The CLI only validated `.catalystrc`
  so far; if `catalyst deploy` rejects it, run `catalyst init --force` in a scratch copy
  to see the generated schema and reconcile. Don't run `init` over the repo blind — it
  can restructure `functions/` and `client/`.
- **`appsail/app-config.json`** currently pins `python3.9`; `python3_11` is available and
  matches what we develop against — worth switching once AppSail is enabled.
- **Data Store column limits** — confirm `BriefFacts` (long text) maps to `text`, and the
  max rows per import batch (40k CaseMaster rows may need chunking).
- The mock store loads CSVs from `DATA_DIR`; the Catalyst adapter must replace it with
  ZCQL/NoSQL reads. The store interface (`functions/api/services/store.mock.js`) is the
  single seam to implement against.
