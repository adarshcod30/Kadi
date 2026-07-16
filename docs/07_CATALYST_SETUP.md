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

**API Gateway is the exception — it's CLI-controlled, and it's already done ✅:**

```bash
catalyst apig:enable     # ran 2026-07-16 -> "successfully enabled"
catalyst apig:status     # -> API Gateway: ENABLED
```

This also writes `"apig": { "enabled": true }` into `catalyst.json`.

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

## The real `catalyst.json` schema (verified, not guessed)

Recovered by scaffolding a throwaway project in a scratch dir with
`catalyst init` + `client:setup` + `functions:add` + `appsail:add`, then reading what
the CLI generated. **Our original hand-written file was wrong in every structural way**
and has been corrected:

```json
{
  "client":    { "source": "client/dist" },
  "functions": { "targets": ["api"], "ignore": [], "source": "functions" },
  "appsail":   [ { "source": "appsail", "name": "kadi-appsail" } ],
  "apig":      { "enabled": true }
}
```

- Flat feature keys — there is **no `targets` wrapper** and no `type` field.
- **`appsail` is an array**, not an object.
- **No `project_name` / `project_id`.** Project binding lives in `.catalystrc` alone.

> ### ⚠️ Why `project_id` must never sit in `catalyst.json` as a number
> `55468000000013048` is 17 digits and **exceeds JS `MAX_SAFE_INTEGER`
> (9007199254740991)**. `JSON.parse` cannot represent it, so it silently becomes
> `55468000000013050` — both literals parse to the *same* double. The CLI read our file
> and wrote the corrupted value straight back, which would have targeted a project that
> does not exist. `.catalystrc` stores every id as a **string** for exactly this reason.

### Required files deploy will not work without

| File | Purpose |
|---|---|
| `functions/api/catalyst-config.json` | per-function manifest (`advancedio`, `node20`, `main: index.js`) |
| `functions/api/package.json` | the function folder is self-contained; parent deps don't ship |
| `client/dist/client-package.json` | client-hosting manifest — kept in `client/public/` so every build emits it |
| `appsail/app-config.json` | `{command, build_path, stack, env_variables, memory, scripts}` |

All four were missing or malformed and are now fixed & committed.

### Exact runtime stack strings

From `catalyst config:list` — **underscores, no dots**. `python3.9` is not a valid stack
string; the correct value is `python_3_11`:

```
node12 node14 node16 node18 node20 node22 node24
python_3_9 python_3_10 python_3_11 python_3_12 python_3_13
java8 java11 java17 java21 java25
```

## Known gaps / things to check on first deploy

- **Data Store column limits** — confirm `BriefFacts` (long text) maps to `text`, and the
  max rows per import batch (40k CaseMaster rows may need chunking).
- The mock store loads CSVs from `DATA_DIR`; the Catalyst adapter must replace it with
  ZCQL/NoSQL reads. The store interface (`functions/api/services/store.mock.js`) is the
  single seam to implement against.
- **AppSail deps**: `requirements.txt` pins scikit-learn/pandas/networkx. Confirm the
  managed `python_3_11` image builds them, and that 1024 MB memory is enough for the
  40k-FIR pipeline (it peaks well under this locally).
