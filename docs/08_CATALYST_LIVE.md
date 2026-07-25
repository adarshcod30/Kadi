# 08 — Live Catalyst Deployment State

What is actually provisioned in the **KadiLabs** Catalyst project, verified by API call.
Everything below was created programmatically through the Catalyst REST API — no console
clicking — which supersedes the "Data Store tables can only be created from the console"
limitation recorded in [07_CATALYST_SETUP.md](07_CATALYST_SETUP.md).

| | |
|---|---|
| Project | KadiLabs · `55468000000013048` |
| Org | `60078029367` |
| Environment | Development · `55468000000013065` |
| Data centre | IN (`console.catalyst.zoho.in`) |
| App URL | https://kadilabs-60078029367.development.catalystserverless.in |

> **Note on the project id.** The API returns it as the **string** `"55468000000013048"`.
> It exceeds JS `MAX_SAFE_INTEGER`, so any JSON round-trip that treats it as a number
> corrupts it to `...013050`. Never store it unquoted.

## Data Store — 11 tables live

| Table | table_id | Purpose |
|---|---|---|
| District | 55468000000026001 | 31 KSP districts |
| Unit | 55468000000029001 | Police stations |
| CrimeHead | 55468000000030001 | Crime groups |
| CrimeSubHead | 55468000000031001 | Crime sub-heads |
| CaseStatusMaster | 55468000000032001 | Investigation status |
| CaseMaster | 55468000000033001 | FIRs (21 columns, full KSP schema) |
| Accused | 55468000000032360 | Accused persons per FIR |
| OffenderIdentity | 55468000000034001 | Entity-resolved offenders + risk |
| DistrictInsight | 55468000000035001 | Per-capita rates + socio-economic |
| CrimeForecast | 55468000000026360 | 3-month district projections |
| Hotspot | 55468000000036001 | Spatial clusters |

### Data loaded

| Table | Rows |
|---|---|
| District | 31 |
| DistrictInsight | 31 |
| CrimeHead | 8 |
| CaseStatusMaster | 4 |

### Showcase ZCQL

The problem statement asks for "the *why* behind the *where*". This runs live:

```sql
SELECT DistrictName, TotalCases, RatePer100k, RankByCount, RankByRate, RankShift
FROM DistrictInsight WHERE RankShift > 5 ORDER BY RankShift DESC LIMIT 5
```

Returns the districts that raw counts hide — Kodagu is **30th by count but 6th per
100k residents**, Dharwad 23rd → 7th. That is the argument for per-capita analysis,
answered in the database rather than asserted in a slide.

## Other services

| Service | State |
|---|---|
| **API Gateway** | ENABLED (`catalyst apig:enable`) |
| **Cache** | segment `kadi-kpi` · `55468000000036360` |
| **Stratus** | ⚠️ blocked — see below |

## ⚠️ Still needs Adarsh

1. **Stratus** returns `OPERATION_NOT_ALLOWED: User needs to be in session when accessing
   Stratus for the first time`. Open Cloud Scale → Stratus in the console **once**; the API
   works afterwards. This blocks the bulk CSV load path for CaseMaster.
2. **CaseMaster bulk load (40,836 rows).** Row-by-row inserts are impractical at this
   volume; the supported path is Stratus upload + `Create_Bulk_Write_Job`, which is gated
   on (1).
3. **QuickML** — GLM-4.7 deployment id + endpoint, Connection with scope
   `quickml.deployment.read`, RAG document ids.
4. **Zia** — enable, confirm Kannada STT/TTS.
5. **CORS** — whitelist the client domain after the first deploy.
6. **Deploy** — `catalyst deploy` publishes to your account; needs your explicit go-ahead.

## Column-creation gotcha

`Create_Column` rejects non-ASCII punctuation in `description` with
`PATTERN_NOT_MATCHED` — an em-dash is enough to fail the whole batch. Keep descriptions
plain ASCII. Also note `decimal_digits` is capped: requesting 6 on a double silently
yields 4 (~11 m of positional precision, which is fine for incident mapping).


---

## What is real vs mocked (2026-07-25, all verified live)

**Running on Catalyst:** Web Client Hosting · Serverless Functions (`api` + `refreshanalytics`
job) · AppSail (`kadi-appsail`) · Data Store (40,836 FIRs, ZCQL) · Stratus · Job Scheduling +
Cron (nightly 02:00 IST) · Connections (`kadi_quickml`).

**Not real yet — do not claim these:**

1. **Authentication** is enabled as a service but the app has **no login** and the API is
   **open**. `rbac.js` trusts an `x-kadi-role` header. The RBAC scoping logic is genuinely
   enforced server-side; only the identity binding is mocked.
2. **The deployed API reads bundled files, not Data Store.** The 40,836 rows are really in
   Data Store and really queryable via ZCQL, but the UI does not read from them.
3. **Audit log** is an in-memory ring buffer, lost on cold start.
4. **PDF export** returns HTML; SmartBrowz is not wired.
5. **Cache** writes fail 401 from inside a function.
6. **QuickML** rejects our request body (400 PATTERN_NOT_MATCHED); gated off.
7. **Zia** is not enabled; voice is the browser Web Speech API.
8. **API Gateway** is off by design - enabling it without routes took the site down.

See PROGRESS.md for the full table and the correlation caveat.
