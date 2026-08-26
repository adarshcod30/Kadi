# 08 — What is live right now

The honest state of the **KadiLabs** Catalyst project, verified by API call rather than
recalled from memory. Last verified **2026-08-22**.

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

## Running on Catalyst — ten services

| Service | What it runs |
|---|---|
| **Web Client Hosting** | The React SPA at `/app` |
| **Serverless Functions** | `api` (36 endpoints) + `refreshanalytics` (the nightly Job) |
| **AppSail** | `kadi-appsail` — Python analytics, ~135 ms per call |
| **Data Store** | 11 tables, 59,985 FIRs, live ZCQL |
| **Stratus** | Bulk-import objects |
| **Job Scheduling + Cron** | Nightly recompute, 02:00 IST, last run SUCCESS |
| **Connections** | `kadi_quickml` OAuth, scope `deployment.READ` |
| **Authentication** | Provisioned; role model surfaced at sign-in |
| **Cache** | `kadi-kpi` segment — dashboard KPIs, verified round-trip |
| **QuickML** | GLM-4.7-Flash — the narrative layer on every command view |

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

Eight things were listed here. **Four are now resolved** (3, 5, 6, and the read path in 2b) —
they are kept rather than deleted, because how they were diagnosed is the more useful record,
and because two of them were wrong for weeks in a way worth not repeating.

Each has a diagnosis, because "it does not work" is not an engineering answer.

**1 · Authentication is provisioned, but identity is not bound.**
The app presents a **role chooser**, not a password gate, and the login page says so in plain
language. `rbac.js` trusts an `x-kadi-role` header instead of a verified JWT.

The scoping itself is genuinely real and enforced server-side — an out-of-scope read is
refused, not hidden. Only the identity check is outstanding. Fix: read the Catalyst token in
`userFromRequest` and map it to the officer's rank. One function.

**2 · CaseMaster in Data Store is a snapshot, and the API reads the bundle.**

Data Store holds **40,836** CaseMaster rows against the current corpus's **59,985**, with
different offenders behind them -- it was never re-imported after the corpus was regenerated.
The deployed application does not read it, so the staleness is contained to
`/datastore/cases`, but the row-count claim should be stated as a snapshot.

Re-importing needs a Stratus upload plus a bulk-write job, and the upload is where it stops:
`Create_Upload_Signature` mints a policy with `content-length: 0` regardless of what is passed
for the size, so the PUT is rejected with `400 invalid_request_parameter`. Two field names
were tried. Rather than keep guessing at an undocumented body -- the third time today that
pattern has cost time -- upload `data/output/CaseMaster.csv` from the console and run the
bulk write against it.

**DistrictInsight, by contrast, is current.** It is only 31 rows, so `/admin/sync-districts`
refreshes it in place over ZCQL, and it is the table that matters most: it backs the showcase
query. Kodagu reads 332 / 51.2 per 100k / #31 to #6, matching the application.

**2b · RESOLVED — the read path works from the deployed function.**
ZCQL reads run from the function over the header-credential path in `services/datastore.js`
(see 5). What remains in item 2 is only the staleness of the CaseMaster snapshot, not the
ability to read it.

Note the deliberate decision not to serve `/cases` from Data Store yet: the table holds a
pre-regeneration snapshot, so switching the read path there returned wrong counts and empty
district scoping. Serving stale data for architectural purity is a bad trade — the bundle
stays authoritative until the re-import lands.

**3 · RESOLVED — the audit trail persists.**
`services/audit.js` writes through to Data Store over the header-credential path, with the
in-memory ring buffer kept in front as a read cache. The trail now survives cold start.

**4 · RESOLVED — the briefing exports as a real PDF.**

SmartBrowz is provisioned. The earlier "not provisioned" note came from an MCP Browser Grid
call that returned `INTERNAL_SERVER_ERROR` for its own reasons — a failing probe is not proof
a service is absent, which is the same mistake that hid Zia.

Two things had to be worked around:

- The installed SDK is **1.6.0** and has no `smartbrowz` module; it arrives in 3.x. Upgrading
  a major version on a live application to gain one feature would put the Data Store, Cache
  and Zia paths at risk, so the contract was **read** from 3.4.0 and called over raw HTTPS:
  `POST /browser360/v1/project/{id}/convert` with
  `{ html, output_options: { output_type: 'pdf' } }`.
- `pdf_options.margin: '14mm'` is rejected with `bottom cannot be less than 0` — the field is
  numeric, not a CSS length. Options are left empty; the briefing HTML sets its own padding.

Verified: 24,825 bytes, `PDF document, version 1.4, 1 pages`. The client downloads it
directly instead of opening a window and asking the browser to print.

**5 · RESOLVED — the credential was in the request headers all along.**

This page previously stated that the function "receives no credential of any kind" and that
Cache, ZCQL and user management were all blocked pending a console action. That diagnosis was
wrong, and it was wrong in the expensive direction: it closed off work that was possible.

The environment does lack a credential — that part was right. But Catalyst supplies one on
**each request, as headers**:

```
x-zc-admin-cred-token      (70 chars)
x-zc-project-secret-key    (64 chars)
x-zc-user-type: admin
```

`initialize(req)` in the SDK does not pick these up, which is why every scope returned an
identical `401 PERMISSION_NEEDED`. Raw HTTPS to `api.catalyst.zoho.in` presenting **both**
headers works. The token alone gives `404 INVALID_RESOURCE` — both are required.

The identical error across unrelated services was the clue: five services failing the same
way is one cause, not five.

Now working over that path:
- **Data Store** — live ZCQL reads from the deployed function (`services/datastore.js`)
- **Cache** — read and write both verified; check `/diag/cache` for a live round-trip
- **Audit** — write-through to Data Store, so the trail survives cold start

Cache field names, since they are not obvious and cost a deploy cycle to learn: the POST body
wants `cache_name` (**not** `cache_key`), and the GET query parameter is `cacheKey`.

Still genuinely outstanding on this path: **DDL**. Row writes and ZCQL reads succeed, but
schema changes return `401 OAUTH_SCOPE_MISMATCH`. Create columns through the console or MCP —
and note that MCP wants `audit_consent`, `is_unique`, `is_mandatory` and
`search_index_enabled` as the **strings** `"true"`/`"false"`, not booleans.

**6 · RESOLVED — QuickML is live.** GLM-4.7-Flash generates the narrative layer.

The `400 PATTERN_NOT_MATCHED` was a model id with hyphens. It is
`crm-di-glm47b_30b_it` — **underscores**. Auth prefix `Bearer`, plus
`CATALYST-ORG: 60078029367`.

Two things had to be handled beyond getting a 200 back:

- **Reasoning leaked into output.** Asked to reply "KADI OK" the model returned
  "1. **Analyze the User's Input:**...". Fixed with
  `chat_template_kwargs: { enable_thinking: false }`.
- **Numbers were mangled** — 256 came back as "2,56". Numbers are now pre-rendered as
  strings by `humanise()` in `services/insight.js` so the model copies rather than reformats.

The governing rule is unchanged and worth stating to a judge: **the model never produces a
fact.** It receives computed figures and returns prose. Every number on screen came from the
pipeline, so the assistant still cannot invent an FIR number. Verify the live source at
`/stats?explain=true` — it reports `insightSource`.

Zone values are mapped to plain language before they reach the model, for the same
copy-verbatim reason: an unmapped `red_pulsing` will otherwise appear in officer-facing text.

**7 · RESOLVED — Zia was never disabled. The adapter was aimed at the wrong capabilities.**

This page said Zia needed a console toggle. It did not. `catalyst.initialize(req).zia()`
returns a working handle; the problem was that `zia.js` targeted **speech-to-text,
text-to-speech and translation**, and this Zia has none of them. Every call therefore
returned nothing, which read as "not enabled".

What it actually exposes:

```
getNERPrediction   getKeywordExtraction   getSentimentAnalysis   getTextAnalytics
extractOpticalCharacters   extractAadhaarCharacters   scanBarcode
detectObject   moderateImage   analyseFace   compareFace   automl
```

The SDK's own methods still return `401 PERMISSION_NEEDED` — byte-identical to the Data
Store and Cache failures — so calls go over the raw-HTTPS header-credential path instead.

Two lessons, both already paid for once:

- **Ask the service, do not trust a flag you set yourself.** `ZIA_ENABLED=false` was our own
  config, and it proved nothing about the project. `/diag/zia` now asks Zia directly.
- **Read the SDK, do not guess the URL.** Five guessed paths returned
  `404 INVALID_URL_PATTERN`. The real ones are in
  `zcatalyst-sdk-node/lib/zia/zia-text-analysis.js`: `/ml/text-analytics/ner`, body
  `{ document: [...] }`. That file is the documentation.

**Live now:** `/cases/:id/entities` runs NER and key-phrase extraction over an FIR's own
narrative. On a snatching report it returns `Ramesh Kumar`, `Lakshmi Devi`,
`Pulsar motorcycle`, `gold chain`, `Majestic Bus` — suspect, victim, vehicle and property,
pulled out of free text.

FAIRNESS: this reads the account of the offence only. Caste, religion and occupation are not
in the narrative and are excluded from every model by design.

Voice remains the browser Web Speech API, client-side, because this Zia has no TTS/STT to
replace it with.

**8 · API Gateway is off, deliberately — and should stay off until after judging.**
It was enabled once. With no routes configured it intercepted all traffic and the entire site
returned `INVALID_URL`. The API is submitted at a fixed URL, so an outage here is not a
recoverable experiment. Configure routes first, verify in a throwaway project, and only then
enable. There is no partial-credit version of this: until routes exist, enabling it takes the
whole site down.

---

## Verified numbers

Everything quoted in the deck and README comes from here, captured live from the deployed
API and carried into the deck and this README.

| Metric | Value |
|---|---|
| FIRs analysed | 59,985 |
| Accused records → resolved identities | 54,337 → 52,928 identities · 578 repeat |
| Active networks / cross-district | 127 / 197 |
| Cases flagged by investigation health | 26,168 |
| Ground-truth recovery | 100% overall · identity ER 83.2% |
| Forecast MAPE | 7.8% — 3-month hold-out backtest |
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
