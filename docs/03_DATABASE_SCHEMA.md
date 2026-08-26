# 03 — The data contract

### KADI on Catalyst Data Store (relational, queried with ZCQL)

Three parts:

- **Part A** — the **source FIR schema**, exactly as given in the KSP ER diagram. This is a
  contract, not a suggestion.
- **Part B** — the tables **you added** (app, audit, and the derived analytics tables).
- **Part C** — Catalyst specifics: type mapping, import order, and the traps.

> **Rule one: keep the source column names verbatim.** The whole point is that a real KSP
> export drops in unchanged. The moment you rename `CaseMasterID` to something tidier, you
> have built a demo instead of a system. Catalyst auto-adds `ROWID`, `CREATEDTIME`,
> `MODIFIEDTIME` and `CREATORID` to every table — never redefine those.

**Live right now:** 11 tables in Data Store, 59,985 FIRs, queryable with ZCQL. The generator
emits 29 tables in total; you imported the subset the API actually reads.

---

## PART A — Source FIR schema

### CaseMaster — the FIR core

| Column | Type | Key | Description |
|---|---|---|---|
| CaseMasterID | INT | PK | Unique FIR / case id |
| CrimeNo | VARCHAR | | 1-digit category + 4-digit district + 4-digit unit + 4-digit year + 5-digit serial. FIR `1…`, UDR `3…`, PAR `4…`, Zero FIR `8…` |
| CaseNo | VARCHAR | | YYYY + 5-digit serial (last 9 of CrimeNo) |
| CrimeRegisteredDate | DATE | | Date the FIR was registered |
| PolicePersonID | INT | FK→Employee | Registering officer |
| PoliceStationID | INT | FK→Unit.UnitID | Registering station |
| CaseCategoryID | INT | FK→CaseCategory | FIR / UDR / PAR / Zero-FIR |
| GravityOffenceID | INT | FK→GravityOffence | Heinous / Non-heinous |
| CrimeMajorHeadID | INT | FK→CrimeHead | Major crime head |
| CrimeMinorHeadID | INT | FK→CrimeSubHead | Sub-head |
| CaseStatusID | INT | FK→CaseStatusMaster | Current status |
| CourtID | INT | FK→Court | Trying court |
| IncidentFromDate | DATETIME | | Incident start |
| IncidentToDate | DATETIME | | Incident end |
| InfoReceivedPSDate | DATETIME | | When the station received the information |
| latitude | DECIMAL | | Incident GPS latitude |
| longitude | DECIMAL | | Incident GPS longitude |
| BriefFacts | NVARCHAR(MAX) | | Case summary — the MO-similarity input |

**Compute these, do not store them:** reporting delay =
`InfoReceivedPSDate − IncidentFromDate`; investigation age = `today − CrimeRegisteredDate`;
time-of-day and day-of-week from `IncidentFromDate`. Storing derived time fields is how they
drift out of sync.

### ComplainantDetails

| Column | Type | Key | Description |
|---|---|---|---|
| ComplainantID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| ComplainantName | VARCHAR | | |
| AgeYear | INT | | |
| OccupationID | INT | FK→OccupationMaster | ⚠️ **protected — excluded from every model** |
| ReligionID | INT | FK→ReligionMaster | ⚠️ **protected — excluded from every model** |
| CasteID | INT | FK→CasteMaster | ⚠️ **protected — excluded from every model** |
| GenderID | INT | | lookup |

### Victim

| Column | Type | Key | Description |
|---|---|---|---|
| VictimMasterID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| VictimName | VARCHAR | | |
| AgeYear | INT | | |
| GenderID | INT | | |
| VictimPolice | VARCHAR | | 1 if the victim is police, else 0 |

### Accused

| Column | Type | Key | Description |
|---|---|---|---|
| AccusedMasterID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| AccusedName | VARCHAR | | The entity-resolution input |
| AgeYear | INT | | |
| GenderID | INT | | |
| PersonID | VARCHAR | | Accused sort key: A1, A2, A3… |

### ArrestSurrender

| Column | Type | Key | Description |
|---|---|---|---|
| ArrestSurrenderID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| ArrestSurrenderTypeID | INT | | Arrest vs surrender |
| ArrestSurrenderDate | DATE | | |
| ArrestSurrenderStateId | INT | FK→State | |
| ArrestSurrenderDistrictId | INT | FK→District | |
| PoliceStationID | INT | FK→Unit | |
| IOID | INT | FK→Employee | Investigating officer |
| CourtID | INT | FK→Court | |
| AccusedMasterID | INT | FK→Accused | |
| IsAccused | BIT | | Primary accused? |
| IsComplainantAccused | BIT | | Complainant also accused? |

### Act / Section / CrimeHead group

- **Act** — ActCode (PK, VARCHAR), ActDescription, ShortName, Active
- **Section** — ActCode (FK), SectionCode, SectionDescription, Active
- **ActSectionAssociation** — CaseMasterID, ActID→Act.ActCode, SectionID→Section.SectionCode, ActOrderID, SectionOrderID
- **CrimeHead** — CrimeHeadID (PK), CrimeGroupName (e.g. "Crimes Against Body"), Active
- **CrimeSubHead** — CrimeSubHeadID (PK), CrimeHeadID (FK), CrimeHeadName (Murder, Robbery…), SeqID
- **CrimeHeadActSection** — CrimeHeadID (FK), ActCode (FK), SectionCode

### ChargesheetDetails

| Column | Type | Key | Description |
|---|---|---|---|
| CSID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| csdate | DATETIME | | Chargesheet date |
| cstype | CHAR | | A = Chargesheet, B = False Case, C = Undetected |
| PolicePersonID | INT | FK→Employee | |

### Lookup / master tables

- **CaseCategory** — CaseCategoryID, LookupValue (FIR / UDR / PAR…)
- **GravityOffence** — GravityOffenceID, LookupValue (Heinous / Non-Heinous)
- **CaseStatusMaster** — CaseStatusID, CaseStatusName
- **CasteMaster** — caste_master_id, caste_master_name · *protected*
- **ReligionMaster** — ReligionID, ReligionName · *protected*
- **OccupationMaster** — OccupationID, OccupationName · *protected*
- **Court** — CourtID, CourtName, DistrictID, StateID, Active
- **District** — DistrictID, DistrictName, StateID, Active
- **State** — StateID, StateName, NationalityID, Active
- **Unit** — UnitID, UnitName, TypeID, ParentUnit (self-ref), NationalityID, StateID, DistrictID, Active — **this is the police-station table**
- **UnitType** — UnitTypeID, UnitTypeName, CityDistState, Hierarchy, Active
- **Rank** — RankID, RankName, Hierarchy, Active
- **Designation** — DesignationID, DesignationName, Active, SortOrder
- **Employee** — EmployeeID, DistrictID, UnitID, RankID, DesignationID, KGID, FirstName, EmployeeDOB, GenderID, BloodGroupID, PhysicallyChallenged, AppointmentDate

### Junction tables

- **inv_arrestsurrenderaccused** — ArrestSurrenderID, AccusedMasterID (many accused per arrest)
- **Inv_OccuranceTime** — CaseMasterID (1:1 occurrence time/location record)

### Cardinality

- CaseMaster **1—N** Victim, Accused, ArrestSurrender, ComplainantDetails, ActSectionAssociation
- CaseMaster **N—1** CaseCategory, GravityOffence, CrimeHead, CrimeSubHead, CaseStatusMaster, Court, Employee
- ArrestSurrender **N—1** State, District, Court, Employee(IO); **N—N** Accused via the junction
- ComplainantDetails **N—1** Occupation, Religion, Caste
- Act **1—N** Section, CrimeHeadActSection · CrimeHead **1—N** CrimeSubHead, CrimeHeadActSection
- District **N—1** State · Unit **N—1** UnitType / State / District · Employee **N—1** District / Unit / Rank / Designation

---

## PART B — Tables you added

### App and audit

- **AppUser** — appUserId, catalystUserId, name, email, RoleID, UnitID, DistrictID, active
- **Role** — RoleID, roleName (SI, Inspector, ACP, Analyst, Admin), hierarchyLevel
- **AuditLog** — auditId, appUserId, action, targetType, targetId, queryText, ip, ts
- **Alert** — alertId, kind (new-link / health / anomaly / hotspot), severity, caseMasterId, offenderIdentityId, payloadJSON, unitId, districtId, ts, acknowledged

> The audit trail is currently an **in-memory ring buffer** in `services/audit.js`, not this
> table. It does not survive a cold start. Persisting it is a genuine next step — do not
> claim it is durable until it is.

### Derived tables — rebuilt by the Job, never hand-edited

- **OffenderIdentity** — offenderIdentityId, canonicalName, resolvedFromCount, firstSeenDate, lastSeenDate, districtsJSON, confidence
- **OffenderIdentityMap** — offenderIdentityId, AccusedMasterID, matchScore, matchReasonJSON
- **LinkEdge** — edgeId, srcType, srcId, dstType, dstId, `edgeType` ∈ {shared_offender, co_accused, same_location, same_timewindow, mo_similarity, shared_section}, strength 0–1, evidenceJSON (source FIRs + matched attributes), clusterId
- **CaseHealthMetric** — caseMasterId, reportingDelayHrs, investigationAgeDays, peerMedianAgeDays, pendencyFlag, undetectedRiskScore, falseCasePatternFlag, ioWorkloadAtRegister, flagsJSON, recommendationText, computedTs
- **OffenderRisk** — offenderIdentityId, riskScore 0–100, factorsJSON (feature → contribution), `protectedAttributesUsed` (must be 0), computedTs
- **HotspotCell** — cellId, geohash, crimeHeadId, timeBucket, count, baselineCount, emergingFlag, centroidLat, centroidLng, computedTs

> **The fairness invariant.** `OffenderRisk.protectedAttributesUsed` must always be `0`, and
> entity resolution, linkage and risk features must never contain `ReligionID`, `CasteID` or
> `OccupationID`. There is a unit test that fails the build if any of them appears in a
> feature set. That test is the reason you can make the claim out loud — protect it.

`evidenceJSON` on `LinkEdge` is what powers every "why linked" panel. If you ever find
yourself tempted to drop it to save space, intern the strings instead (see
[02](02_TRD.md) §9) — do not lose the evidence.

---

## PART C — Catalyst specifics

### Type mapping

| Source | Catalyst Data Store type |
|---|---|
| INT (id / PK) | `bigint` — see the precision trap below |
| VARCHAR / CHAR | `varchar` (short) / `text` (long, e.g. BriefFacts) |
| NVARCHAR(MAX) | `text` |
| DATE | `date` |
| DATETIME | `datetime` |
| DECIMAL (lat/long) | `double` |
| BIT | `boolean` |

### Three traps that will cost you an evening each

1. **17-digit IDs break `JSON.parse`.** Catalyst project and row IDs exceed
   `Number.MAX_SAFE_INTEGER`. They corrupt *silently* — `...013048` becomes `...013050` and
   nothing throws. **Store and pass them as strings.** This is why `.catalystrc` keeps IDs
   quoted and why `catalyst.json` carries no `project_id` at all.
2. **`Create_Column` rejects non-ASCII.** A single em-dash in a column `description` returns
   `PATTERN_NOT_MATCHED` with no hint as to which character. Keep DDL descriptions plain
   ASCII.
3. **Deploy manifests look like secrets but are not.** `functions/*/catalyst-config.json`
   and `appsail/app-config.json` **must be committed** — deploy fails without them. Keep
   their `env_variables` free of real values; those live in the Catalyst console.

### System columns

Every table gets `ROWID` (the Catalyst PK), `CREATEDTIME`, `MODIFIEDTIME` and `CREATORID`.
Keep the source PK (`CaseMasterID`) as a unique-indexed **business key** and join on it. Use
`ROWID` only internally.

### Querying

Use **ZCQL** through the Node or Python SDK. Prefer parametrized, whitelisted queries — the
assistant must never be able to run arbitrary SQL. Index the hot columns:

```
CaseMaster(CrimeRegisteredDate, PoliceStationID, CrimeMajorHeadID, CaseStatusID)
Accused(CaseMasterID, AccusedName)
ArrestSurrender(AccusedMasterID)
LinkEdge(srcId, dstId, edgeType)
```

### Import order

Generate one CSV per table → upload to a **Stratus** bucket → bulk-write into Data Store.
Respect FK order or the import fails halfway and leaves you with a partial table:

1. Lookup and master tables (State, District, Unit, Rank, Act, Section, CrimeHead…)
2. `CaseMaster`
3. Child tables (Victim, Accused, ArrestSurrender, ActSectionAssociation, Chargesheet…)

Derived tables are **populated by the pipeline**, never imported. Details in
[06_SYNTHETIC_DATA_SPEC.md](06_SYNTHETIC_DATA_SPEC.md).

### Where the graph actually lives

The original plan was to mirror the derived graph into **NoSQL** for fast ego-graph reads.
You did not do that, and the reason is worth remembering: the read-model ships **inside the
function bundle** as interned JSON, which is faster still and has no extra service
dependency. A 121 MB naive bundle broke the deployed function outright; interning brought it
to 12.1 MB with identical evidence text.

**Cache** was intended for dashboard aggregates. The adapter is written and the segment is
provisioned, but writes from inside a deployed function return `401 PERMISSION_NEEDED`. The
KPI query recomputes in about a millisecond, so the miss costs nothing — the adapter is a
no-op until the permission is sorted. See [08_CATALYST_LIVE.md](08_CATALYST_LIVE.md).
