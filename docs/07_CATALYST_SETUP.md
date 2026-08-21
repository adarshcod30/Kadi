# 07 — Catalyst setup runbook

Everything needed to take KADI from a local checkout to a live Catalyst URL. Values below
are read back from the real account, not placeholders.

| Value | Setting |
|---|---|
| Zoho account | `23ucs509` |
| **Org ID** | `60078029367` |
| **Project** | `KadiLabs` |
| **Project ID** | `55468000000013048` — *always quote this, see §Traps* |
| **Environment** | `Development` |
| **Project domain** | `kadilabs-60078029367.development` |
| **Data centre** | `in` → `.zoho.in` (`--dc us` fails auth; `--dc in` works) |
| Timezone | `Asia/Kolkata` |
| CLI | `zcatalyst-cli` **1.27.0** |
| AppSail runtimes | python 3.9–3.13, node 12–24, java 8–25 |

> **Rule of thumb:** the **CLI** does code and data — deploy, import, API Gateway. The
> **console** does services and credentials — enabling Data Store / Zia / QuickML, OAuth
> scopes, domain whitelisting. Most services cannot be switched on from the CLI.
>
> The one big exception you discovered: **Data Store tables can be created programmatically**
> through the REST API. The console is not the only route, whatever the docs imply.

---

## Step 0 — Prerequisites

```bash
npm i -g zcatalyst-cli
catalyst login          # `catalyst whoami` should print your account
```

If the CLI logs out later: `catalyst login --force` (add `--no-localhost` on a headless box).

## Step 1 — Bind the project to this directory

```bash
cd /Users/adarsh/Desktop/Projects/KadiLabs
catalyst project:use KadiLabs --org 60078029367 --dc in
```

Writes `.catalystrc`, which is gitignored — it is local machine state, not a secret. Verify
with `catalyst project:list` → **KadiLabs (active)**. Undo with `catalyst project:reset`.

## Step 2 — Enable services in the console

Console → <https://console.catalyst.zoho.in/> → project **KadiLabs**. Most are off by
default and are a single click.

| Service | Console path | Needed for | Status |
|---|---|---|---|
| **Authentication** | Cloud Scale → Authentication | Login, RBAC | ✅ provisioned |
| **Data Store** | Cloud Scale → Data Store | FIR tables | ✅ 11 tables, 40,829 FIRs |
| **Stratus** | Cloud Scale → Stratus | Import bucket | ✅ |
| **Cron** | Cloud Scale → Cron | Nightly rebuild | ✅ 02:00 IST |
| **AppSail** | Serverless → AppSail | Python analytics | ✅ live |
| **Web Client Hosting** | Serverless | React front-end | ✅ live |
| **Connections** | Cloud Scale → Connections | OAuth to QuickML | ✅ |
| **Cache** | Cloud Scale → Cache | KPI segment | ⚠️ 401 on write, see [08](08_CATALYST_LIVE.md) |
| **QuickML** | QuickML | GLM-4.7 + RAG | ⚠️ 400 on request body |
| **Zia** | Zia Services | Kannada STT/TTS | ❌ not enabled |
| **NoSQL** | Cloud Scale → NoSQL | — | not needed; read-model ships in the bundle |
| **Pipelines** | DevOps → Pipelines | CI/CD | not wired; deploys are CLI-driven |

### API Gateway — leave it off

```bash
catalyst apig:status
```

It is CLI-controlled. **Do not enable it without configuring routes first.** With no routes
it intercepts all traffic and the entire site returns `INVALID_URL` — the whole app goes
down, and the cause is not obvious from the error. It was enabled once, took the site out,
and has been off since.

## Step 3 — Import the synthetic data

```bash
python data/generator/generate.py          # emits 29 CSVs into data/output/
```

Import **in FK order** — see `data/output/_manifest.json` → `import_order`. Lookups first,
then `Unit` and `Employee`, then `CaseMaster`, then the child tables.

Upload the CSVs to a Stratus bucket, then bulk-write into Data Store. `ds:import` needs a
per-table config JSON mapping CSV columns to Data Store columns.

```bash
catalyst ds:import --table CaseMaster --config <config.json>
catalyst ds:status <operation> <jobid>
```

Derived tables (`LinkEdge`, `OffenderRisk`, `CaseHealthMetric`…) are **never imported** — the
pipeline computes them.

> **DDL gotcha:** `Create_Column` returns `PATTERN_NOT_MATCHED` if a column `description`
> contains a non-ASCII character. An em-dash is enough. The error does not tell you which
> character or which field. Keep DDL text plain ASCII.

## Step 4 — Deploy

```bash
cd client && npm run build && cd ..     # emits client/dist + the 404.html copy

catalyst deploy                          # everything
catalyst deploy --only client            # or one target at a time
catalyst deploy --only functions
catalyst deploy --only appsail
```

Live at `https://kadilabs-60078029367.development.catalystserverless.in/app/`.

Because the SPA is served from the same origin as the API, there is no CORS configuration to
do. If you ever split them, whitelist the front-end domain under Authentication — that is the
single most common Catalyst integration failure.

## Step 5 — Schedule the pipeline

Console → Cron → new Cron targeting the recompute Job, nightly at 02:00 IST. Confirm the
first run reports SUCCESS before you trust it.

---

## The real `catalyst.json` schema

Recovered by scaffolding a throwaway project with `catalyst init` + `client:setup` +
`functions:add` + `appsail:add` and reading what the CLI generated. Do this rather than
guessing — the hand-written original was wrong in every structural way.

```json
{
  "client":    { "source": "client/dist" },
  "functions": { "targets": ["api"], "ignore": [], "source": "functions" },
  "appsail":   [ { "source": "appsail", "name": "kadi-appsail" } ]
}
```

- Flat feature keys. There is **no `targets` wrapper** and no `type` field.
- **`appsail` is an array**, not an object.
- **No `project_name`, no `project_id`.** Project binding lives in `.catalystrc` alone.

### Files deploy will not work without

| File | Purpose |
|---|---|
| `functions/api/catalyst-config.json` | Per-function manifest — `advancedio`, `node20`, `main: index.js`, memory |
| `functions/api/package.json` | The function folder is self-contained; parent deps do not ship |
| `client/public/client-package.json` | Client-hosting manifest, kept in `public/` so every build emits it |
| `appsail/app-config.json` | `{ command, build_path, stack, env_variables, memory, scripts }` |

All four are committed. They **look** like config that belongs in `.gitignore` — it is not.
Deploy fails without them. Keep real secret values out of `env_variables` and set those in
the console instead.

### Runtime stack strings

From `catalyst config:list` — **underscores, no dots**. `python3.11` is not valid;
`python_3_11` is.

```
node12 node14 node16 node18 node20 node22 node24
python_3_9 python_3_10 python_3_11 python_3_12 python_3_13
java8 java11 java17 java21 java25
```

---

## Traps — every one of these cost real time

**1 · 17-digit IDs silently corrupt.**
`55468000000013048` exceeds JS `MAX_SAFE_INTEGER` (9007199254740991). `JSON.parse` cannot
represent it, so it becomes `55468000000013050` — both literals parse to the same double,
nothing throws, and the CLI writes the corrupted value straight back. It would have targeted a
project that does not exist. **Store every Catalyst id as a string.**

**2 · A Job function must be called `index.js`.**
Name it `main.js` and the Job fails **silently, with no logs at all**. There is nothing to
debug because nothing is emitted. If a Job does nothing and says nothing, check the filename
first.

**3 · AppSail ignores `requirements.txt`.**
Packages listed there do not install in the managed container. The service must be
**stdlib-only** — that is why `app.py` uses a csv/namedtuple shim instead of pandas. Heavy
libraries belong in the Job and in local runs (`requirements-dev.txt`). Symptom: the service
will not start and produces zero logs, which looks like a port or command problem and is not.

**4 · SPA deep links 404.**
Catalyst rejects a config where the 404 page is the homepage. Emit a `dist/404.html` copy of
the shell and point the client manifest at `"404": "404.html"`. Without this, every route
except `/` returns "Site Not Found" on refresh.

**5 · Jobs cap memory at 512 MB.**
Functions can go 128–512 MB, Jobs are capped at 512. The pipeline peaked at 1,770 MB until
sklearn's `working_memory` was capped at 32 MiB — see [02](02_TRD.md) §9. The default is
1 GiB, which nobody expects.

**6 · Both Functions and AppSail cap a request at 30 s.**
Confirmed by the Zoho team in the workshop Q&A, and not raisable. Only Jobs get 15 minutes.
This is the constraint that shapes the entire architecture; see [02](02_TRD.md) §10.

## Verifying a deploy

```bash
curl -s https://kadilabs-60078029367.development.catalystserverless.in/server/api/health
curl -s https://kadilabs-60078029367.development.catalystserverless.in/server/api/ai/status
```

`/ai/status` reports honestly whether QuickML and Zia are actually wired. Use it instead of
claiming anything from memory.
