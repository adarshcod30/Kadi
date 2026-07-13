# 03 — Database Schema
### KADI on Catalyst Data Store (relational, queried with ZCQL)

This doc has three parts:
- **Part A** — the **source FIR schema** exactly as given in the KSP ER-diagram PDF (this is the data contract; do not rename columns).
- **Part B** — **KADI-added tables** (app/auth/audit + derived analytics tables the platform needs).
- **Part C** — **Catalyst Data Store notes** (type mapping, system columns, import).

> Naming: keep the source column names from the PDF verbatim so a real KSP export drops in unchanged. Catalyst auto-adds `ROWID`, `CREATEDTIME`, `MODIFIEDTIME`, `CREATORID` to every table — do not redefine those.

---

## PART A — Source FIR schema (from the KSP ER diagram)

### CaseMaster (the FIR core)
| Column | Type | Key | Description |
|---|---|---|---|
| CaseMasterID | INT | PK | Unique FIR/case id |
| CrimeNo | VARCHAR | | Structured crime number: 1-digit category + 4-digit district + 4-digit PS(unit) + 4-digit year + 5-digit serial. e.g. FIR `104430006202600001`, UDR `3…`, Zero FIR `8…`, PAR `4…` |
| CaseNo | VARCHAR | | YYYY + 5-digit serial (last 9 of CrimeNo) |
| CrimeRegisteredDate | DATE | | Date FIR registered |
| PolicePersonID | INT | FK→Employee.EmployeeID | Registering officer |
| PoliceStationID | INT | FK→Unit.UnitID | Registering station |
| CaseCategoryID | INT | FK→CaseCategory.CaseCategoryID | FIR/UDR/PAR/Zero-FIR |
| GravityOffenceID | INT | FK→GravityOffence.GravityOffenceID | Heinous/Non-heinous |
| CrimeMajorHeadID | INT | FK→CrimeHead.CrimeHeadID | Major crime head |
| CrimeMinorHeadID | INT | FK→CrimeSubHead.CrimeSubHeadID | Sub-head |
| CaseStatusID | INT | FK→CaseStatusMaster.CaseStatusID | Current status |
| CourtID | INT | FK→Court.CourtID | Trying court |
| IncidentFromDate | DATETIME | | Incident start |
| IncidentToDate | DATETIME | | Incident end |
| InfoReceivedPSDate | DATETIME | | When PS received info |
| latitude | DECIMAL | | Incident GPS lat |
| longitude | DECIMAL | | Incident GPS long |
| BriefFacts | NVARCHAR(MAX) | | Case summary (used for MO similarity) |

**Derived operational signals (compute, don't store raw):** reporting delay = `InfoReceivedPSDate − IncidentFromDate`; investigation age = `today − CrimeRegisteredDate`; time-of-day/day-of-week from `IncidentFromDate`.

### ComplainantDetails
| Column | Type | Key | Description |
|---|---|---|---|
| ComplainantID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| ComplainantName | VARCHAR | | |
| AgeYear | INT | | |
| OccupationID | INT | FK→OccupationMaster | ⚠️ analytics only — never predictive |
| ReligionID | INT | FK→ReligionMaster | ⚠️ **protected — excluded from all models** |
| CasteID | INT | FK→CasteMaster | ⚠️ **protected — excluded from all models** |
| GenderID | INT | | lookup |

### Victim
| Column | Type | Key | Description |
|---|---|---|---|
| VictimMasterID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| VictimName | VARCHAR | | |
| AgeYear | INT | | |
| GenderID | INT | | m/f/t |
| VictimPolice | VARCHAR | | 1 if victim is police else 0 |

### Accused
| Column | Type | Key | Description |
|---|---|---|---|
| AccusedMasterID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| AccusedName | VARCHAR | | (entity-resolution input) |
| AgeYear | INT | | |
| GenderID | INT | | M/F/T |
| PersonID | VARCHAR | | Accused sort key: A1, A2, A3… |

### ArrestSurrender
| Column | Type | Key | Description |
|---|---|---|---|
| ArrestSurrenderID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| ArrestSurrenderTypeID | INT | | arrest vs surrender (lookup) |
| ArrestSurrenderDate | DATE | | |
| ArrestSurrenderStateId | INT | FK→State.StateID | |
| ArrestSurrenderDistrictId | INT | FK→District.DistrictID | |
| PoliceStationID | INT | FK→Unit.UnitID | |
| IOID | INT | FK→Employee.EmployeeID | Investigating officer |
| CourtID | INT | FK→Court.CourtID | |
| AccusedMasterID | INT | FK→Accused.AccusedMasterID | |
| IsAccused | BIT | | primary accused? |
| IsComplainantAccused | BIT | | complainant also accused? |

### Act / Section / CrimeHead group
**Act:** ActCode (PK, VARCHAR), ActDescription, ShortName, Active(BIT).
**Section:** ActCode (FK), SectionCode, SectionDescription, Active(BIT).
**ActSectionAssociation:** CaseMasterID(FK), ActID(FK→Act.ActCode), SectionID(FK→Section.SectionCode), ActOrderID, SectionOrderID.
**CrimeHead:** CrimeHeadID(PK), CrimeGroupName (e.g. "Crimes Against Body"), Active.
**CrimeSubHead:** CrimeSubHeadID(PK), CrimeHeadID(FK), CrimeHeadName (e.g. Murder, Robbery), SeqID.
**CrimeHeadActSection:** CrimeHeadID(FK), ActCode(FK), SectionCode.

### ChargesheetDetails
| Column | Type | Key | Description |
|---|---|---|---|
| CSID | INT | PK | |
| CaseMasterID | INT | FK→CaseMaster | |
| csdate | DATETIME | | chargesheet date |
| cstype | CHAR | | A=Chargesheet, B=False Case, C=Undetected |
| PolicePersonID | INT | FK→Employee.EmployeeID | |

### Lookup / master tables
- **CaseCategory** (CaseCategoryID PK, LookupValue: FIR/UDR/PAR…)
- **GravityOffence** (GravityOffenceID PK, LookupValue: Heinous/Non-Heinous)
- **CaseStatusMaster** (CaseStatusID PK, CaseStatusName: Under Investigation/Charge Sheeted/Closed…)
- **CasteMaster** (caste_master_id PK, caste_master_name) — *protected*
- **ReligionMaster** (ReligionID PK, ReligionName) — *protected*
- **OccupationMaster** (OccupationID PK, OccupationName)
- **Court** (CourtID PK, CourtName, DistrictID FK, StateID FK, Active)
- **District** (DistrictID PK, DistrictName, StateID FK, Active)
- **State** (StateID PK, StateName, NationalityID, Active)
- **Unit** (UnitID PK, UnitName, TypeID FK→UnitType, ParentUnit self-ref, NationalityID, StateID FK, DistrictID FK, Active) — this is the police-station table
- **UnitType** (UnitTypeID PK, UnitTypeName, CityDistState, Hierarchy, Active)
- **Rank** (RankID PK, RankName, Hierarchy, Active)
- **Designation** (DesignationID PK, DesignationName, Active, SortOrder)
- **Employee** (EmployeeID PK, DistrictID FK, UnitID FK, RankID FK, DesignationID FK, KGID, FirstName, EmployeeDOB, GenderID, BloodGroupID, PhysicallyChallenged BIT, AppointmentDate)

### Junction (referenced in relationship matrix)
- **inv_arrestsurrenderaccused** (ArrestSurrenderID FK, AccusedMasterID FK) — many-accused per arrest.
- **Inv_OccuranceTime** (CaseMasterID FK, 1:1) — occurrence time/location record (fold into CaseMaster if simpler for the build).

### Relationship summary (cardinality)
- CaseMaster **1—N** Victim, Accused, ArrestSurrender, ComplainantDetails, ActSectionAssociation.
- CaseMaster **N—1** CaseCategory, GravityOffence, CrimeHead, CrimeSubHead, CaseStatusMaster, Court, Employee.
- ArrestSurrender **N—1** State, District, Court, Employee(IO); **N—N** Accused (via junction).
- ComplainantDetails **N—1** Occupation, Religion, Caste.
- Act **1—N** Section, CrimeHeadActSection. CrimeHead **1—N** CrimeSubHead, CrimeHeadActSection.
- District **N—1** State. Unit **N—1** UnitType/State/District. Employee **N—1** District/Unit/Rank/Designation.

---

## PART B — KADI-added tables

### App / auth / audit
**AppUser** — appUserId(PK), catalystUserId, name, email, RoleID(FK), UnitID(FK, nullable), DistrictID(FK, nullable), active.
**Role** — RoleID(PK), roleName (SI, Inspector, ACP, Analyst, Admin), hierarchyLevel.
**AuditLog** — auditId(PK), appUserId(FK), action, targetType, targetId, queryText(nullable), ip, ts.
**Conversation** — convId(PK), appUserId(FK), title, createdTs; **ConversationMessage** — msgId(PK), convId(FK), role(user/assistant), content, citationsJSON, ts.
**SavedView** — viewId(PK), appUserId(FK), name, kind(graph/map/cockpit), paramsJSON.
**Alert** — alertId(PK), kind(new-link/health/anomaly/hotspot), severity, caseMasterId(nullable), offenderIdentityId(nullable), payloadJSON, unitId, districtId, ts, acknowledged.

### Derived / materialized analytics tables (rebuilt by AppSail/Jobs)
**OffenderIdentity** — offenderIdentityId(PK), canonicalName, resolvedFromCount, firstSeenDate, lastSeenDate, districtsJSON, confidence.
**OffenderIdentityMap** — id(PK), offenderIdentityId(FK), AccusedMasterID(FK), matchScore, matchReasonJSON.
**LinkEdge** — edgeId(PK), srcType, srcId, dstType, dstId, edgeType(shared_offender|co_accused|same_location|same_timewindow|mo_similarity|shared_section), strength(0–1), evidenceJSON(source FIRs + matched attrs), clusterId(nullable).
**CaseHealthMetric** — caseMasterId(PK/FK), reportingDelayHrs, investigationAgeDays, peerMedianAgeDays, pendencyFlag, undetectedRiskScore, falseCasePatternFlag, ioWorkloadAtRegister, flagsJSON, recommendationText, computedTs.
**OffenderRisk** — offenderIdentityId(PK/FK), riskScore(0–100), factorsJSON(feature→contribution), protectedAttributesUsed(BIT, must be 0), computedTs.
**HotspotCell** — cellId(PK), geohash, crimeHeadId, timeBucket, count, baselineCount, emergingFlag, centroidLat, centroidLng, computedTs.
**GraphNodeCache / GraphEdgeCache** (or NoSQL equivalents) — denormalized node/edge docs for fast reads.

> **Fairness invariant (enforce in code + tests):** `OffenderRisk.protectedAttributesUsed` must always be `0`; ER and risk features must exclude `ReligionID`, `CasteID`, `OccupationID`. Add a unit test that fails if any protected column appears in the feature set.

---

## PART C — Catalyst Data Store notes

**Type mapping (source → Catalyst column type):**
| Source | Catalyst Data Store type |
|---|---|
| INT (id/PK) | `bigint` (or `int`); use an auto-number PK where you don't import an explicit id |
| VARCHAR / CHAR | `varchar` (short) / `text` (long, e.g. BriefFacts) |
| NVARCHAR(MAX) | `text` |
| DATE | `date` |
| DATETIME | `datetime` |
| DECIMAL (lat/long) | `double` |
| BIT | `boolean` |

**System columns:** every table auto-gets `ROWID` (Catalyst PK), `CREATEDTIME`, `MODIFIEDTIME`, `CREATORID`. Keep the source PK (e.g. `CaseMasterID`) as a **unique-indexed business key** and join on it; use `ROWID` internally as needed.

**Querying:** use **ZCQL** (SQL-like) via the Node/Python SDK. Prefer parametrized, whitelisted queries (the assistant must not run arbitrary SQL). Index the hot join/filter columns: `CaseMaster(CrimeRegisteredDate, PoliceStationID, CrimeMajorHeadID, CaseStatusID)`, `Accused(CaseMasterID, AccusedName)`, `ArrestSurrender(AccusedMasterID)`, `LinkEdge(srcId,dstId,edgeType)`.

**Import (see `06_SYNTHETIC_DATA_SPEC.md`):** generate one CSV per table → upload to a **Stratus** bucket → run `catalyst data-store import` with a per-table config JSON (column mapping). Import lookup/master tables first, then CaseMaster, then child tables (respect FK order). Derived tables are populated by the pipeline, not imported.

**Graph storage decision:** relational truth in Data Store; **mirror the derived graph (nodes/edges + evidence) into NoSQL** keyed by caseMasterId/offenderIdentityId/clusterId for <1.5s ego-graph reads. Cache dashboard aggregates in **Cache** with short TTL.
