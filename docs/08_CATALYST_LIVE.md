# 08 — What is live right now

The honest state of the **KadiLabs** Catalyst project, verified by API call rather than
recalled from memory. Last verified **2026-07-26**.

Read this before any demo or interview. Everything in the "not real yet" section is
something a judge could discover on their own — you want to have said it first.

| | |
|---|---|
| Project | KadiLabs · `55468000000013048` |
| Org | `60078029367` |
| Environment | Development · `55468000000013065` |
| Data centre | IN (`console.catalyst.zoho.in`) |
| App URL | https://kadilabs-60078029367.development.catalystserverless.in/app/ |

> **The project id is a string.** The API returns `"55468000000013048"`. It exceeds JS
> `MAX_SAFE_INTEGER`, so any JSON round-trip that treats it as a number silently corrupts it
> to `...013050`. Never store it unquoted.

Everything below was created **programmatically through the Catalyst REST API** — no console
clicking. That supersedes the "Data Store tables can only be created from the console"
limitation you will find in older notes and in some Zoho documentation.

---

## Running on Catalyst — eight services

| Service | What it runs |
|---|---|
| **Web Client Hosting** | The React SPA at `/app` |
| **Serverless Functions** | `api` (21 endpoints) + `refreshanalytics` (the nightly Job) |
| **AppSail** | `kadi-appsail` — Python analytics, ~135 ms per call |
| **Data Store** | 11 tables, 40,829 FIRs, live ZCQL |
| **Stratus** | Bulk-import objects |
| **Job Scheduling + Cron** | Nightly recompute, 02:00 IST, last run SUCCESS |
| **Connections** | `kadi_quickml` OAuth, scope `deployment.READ` |
| **Authentication** | Provisioned; role model surfaced at sign-in |

## Data Store — 11 tables

| Table | table_id | Purpose |
|---|---|---|
| District | 55468000000026001 | 31 KSP districts |
| Unit | 55468000000029001 | Police stations |
| CrimeHead | 55468000000030001 | Crime groups |
| CrimeSubHead | 55468000000031001 | Crime sub-heads |
| CaseStatusMaster | 55468000000032001 | Investigation status |
| CaseMaster | 55468000000033001 | FIRs — 21 columns, full KSP schema |
| Accused | 55468000000032360 | Accused persons per FIR |
| OffenderIdentity | 55468000000034001 | Entity-resolved offenders + risk |
| DistrictInsight | 55468000000035001 | Per-capita rates + socio-economic |
| CrimeForecast | 55468000000026360 | Three-month district projections |
| Hotspot | 55468000000036001 | Spatial clusters |

### The ZCQL worth showing

The problem statement asks for "the *why* behind the *where*". This runs live against Data
Store:

```sql
SELECT DistrictName, TotalCases, RatePer100k, RankByCount, RankByRate, RankShift
FROM DistrictInsight WHERE RankShift > 5 ORDER BY RankShift DESC LIMIT 5
```

It returns the districts raw counts hide — Kodagu **31st by count, 6th per 100,000
residents**; Dharwad 23rd → 7th. That is the argument for per-capita analysis answered *in
the database*, not asserted on a slide. If you only get to run one query in front of a judge,
run this one.

---

## Not real yet — do not claim these

Eight things. Each has a diagnosis, because "it does not work" is not an engineering answer.

**1 · Authentication is provisioned, but identity is not bound.**
The app presents a **role chooser**, not a password gate, and the login page says so in plain
language. `rbac.js` trusts an `x-kadi-role` header instead of a verified JWT.

The scoping itself is genuinely real and enforced server-side — an out-of-scope read is
refused, not hidden. Only the identity check is outstanding. Fix: read the Catalyst token in
`userFromRequest` and map it to the officer's rank. One function.

**2 · The deployed API reads bundled files, not Data Store.**
The rows are in Data Store and are queryable by ZCQL from an authenticated client — but
**not from the deployed function**, which cannot present a credential (see 5). The ZCQL
adapter is written (`services/datastore.js`) and the seam to swap against is
`services/store.mock.js`; both are waiting on the credential, not on code.

**3 · The audit trail is in-memory.**
A ring buffer in `services/audit.js`. It is lost on cold start. Moving it to a Data Store
table is small and worth doing before anyone relies on it for accountability.

**4 · Export returns HTML, not PDF.**
Call it a **print-ready briefing**. SmartBrowz is not wired. Do not describe it as a PDF
pipeline.

**5 · Cache writes return 401 — and so does everything else. One root cause.**

This was recorded for a long time as a Cache-specific bug. It is not.

Hitting `/datastore/probe` on the deployed function shows ZCQL returning **byte-for-byte the
same** `401 PERMISSION_NEEDED`, and so does `userManagement().getCurrentUser()`. All three
SDK scopes — default, `admin`, `user` — fail identically.

The environment tells you why. The function receives **no credential of any kind**:

```
CATALYST_PROJECT_ID, CATALYST_RESOURCE_ID, CATALYST_FUNCTION_TYPE,
X_ZOHO_CATALYST_ACCOUNTS_URL, X_ZOHO_CATALYST_CONSOLE_URL, ...
```

Identifiers and URLs only. `X_ZOHO_CATALYST_PROJECT_KEY` is **absent**, and there is no
token or secret anywhere in the environment.

The SPA calls `/server/api/...` as a public, anonymous HTTP request, so `initialize(req)`
has nothing to resolve a credential from. Every project-owned service call therefore fails:
Cache, ZCQL and user management alike.

**This single cause sits under three of the limitations on this page — 1, 2 and 5.** Fixing
it once would unblock the Data Store read path, the Cache adapter, and the identity binding
together. It needs a project credential made available to the function (a project key set as
an environment variable, or a Connection carrying Data Store scopes), which is a console
action.

Verify any of this yourself at `/datastore/status` and `/datastore/probe`.

Zero user impact today — the KPI query recomputes in about a millisecond, so every Cache
call is simply a miss that falls through to compute.

**6 · QuickML rejects the request body.**
`400 PATTERN_NOT_MATCHED` mentioning `zoho-inputstream`. The endpoint, model id
(`crm-di-glm47b-30b-it`), org header and a valid OAuth token are all in place. Ruled out:
non-ASCII content, `Content-Length`, missing token, auth prefix. Gated off behind
`QUICKML_ENABLED`.

The assistant runs a deterministic intent engine instead — which has a real upside worth
stating: **it cannot hallucinate an FIR number.**

**7 · Zia is not enabled on the project.**
Voice runs on the browser Web Speech API, client-side. The adapter includes the recommended
degradation path (translate → English → speak) for when Zia is switched on.

**8 · API Gateway is off, deliberately.**
It was enabled once. With no routes configured it intercepted all traffic and the entire site
returned `INVALID_URL`. It needs route configuration before it is safe to turn on again.
Leave it off until then.

---

## Verified numbers

Everything quoted in the deck and README comes from here, captured live from the deployed
API and carried into the deck and this README.

| Metric | Value |
|---|---|
| FIRs analysed | 40,829 |
| Accused records → resolved identities | 36,582 → 35,662 identities · 441 repeat |
| Active networks / cross-district | 127 / 197 |
| Cases flagged by investigation health | 18,901 |
| Ground-truth recovery | 100% overall · identity ER 83.2% |
| Forecast MAPE | 3.9% — 3-month hold-out backtest |
| Correlations (n=31) | urbanisation +0.88 · literacy +0.546 · density +0.871 |
| Pipeline runtime / peak memory | 24.6 s / 738 MB (was 1,770 MB) |
| AppSail analytics latency | ~135 ms |
| Graph payload | 54.9 MB → 12.1 MB interned |
| Tests | 19 / 19 — 8 Node, 11 Python |

## Column-creation gotchas

`Create_Column` rejects non-ASCII punctuation in `description` with `PATTERN_NOT_MATCHED` —
one em-dash fails the whole batch, and the error names neither the character nor the field.

`decimal_digits` is capped: requesting 6 on a double silently yields 4. That is roughly 11 m
of positional precision, which is fine for incident mapping — but know that it happened
rather than wondering later why coordinates look rounded.

## Checking any of this yourself

```bash
curl -s https://kadilabs-60078029367.development.catalystserverless.in/server/api/health
curl -s https://kadilabs-60078029367.development.catalystserverless.in/server/api/ai/status
```

`/ai/status` exists precisely so you never have to claim an AI service is wired. Point at it.
