# 06 — Synthetic Dataset Specification

Real FIR data is confidential, so KADI is built and demoed on a **schema-faithful synthetic dataset** that (a) matches the KSP ER diagram exactly, and (b) **plants known ground-truth patterns** (gangs, serial chains, slipping cases) so we can *prove* the platform detects them. State clearly (README + deck footer) that data is synthetic; the pipeline ingests real data unchanged.

---

## 1. Goals of the generator
1. Referentially valid data across all tables (FK integrity, correct cardinalities).
2. Realistic Karnataka geography, crime mix, and temporal patterns.
3. **Planted ground truth** we can evaluate against (stored separately in `data/output/_ground_truth.json`).
4. Deterministic (fixed random seed) so the demo is reproducible.
5. Output = one CSV per table, ready for Catalyst Data Store import.

## 2. Volumes (tunable via config)
| Table | Rows (demo default) |
|---|---|
| State | 1 (Karnataka) + a few neighbours (for cross-border arrests) |
| District | ~31 (real Karnataka districts) |
| Unit (police stations) | ~300 (subset of the 1,100+; enough to show cross-station) |
| Employee | ~1,500 |
| CaseMaster (FIRs) | **40,000** (scale to 100k if perf allows) |
| ComplainantDetails | ~40,000 (≈1 per FIR) |
| Victim | ~55,000 (1–3 per FIR) |
| Accused | ~70,000 (0–5 per FIR) |
| ArrestSurrender | ~30,000 |
| ActSectionAssociation | ~90,000 |
| ChargesheetDetails | ~28,000 (subset of cases reaching disposal) |
| Lookups (CaseCategory, Gravity, CrimeHead/SubHead, Status, Occupation, Religion, Caste, Court, Rank, Designation, UnitType) | small, realistic |

Time span: **Jan 2023 → Jun 2026** (so "this quarter/year" queries work relative to the July 2026 event).

## 3. Reference data (make it realistic)
- **Districts (real):** Bengaluru City, Bengaluru Rural, Mysuru, Mangaluru (Dakshina Kannada), Belagavi, Kalaburagi, Hubballi-Dharwad, Ballari, Vijayapura, Shivamogga, Tumakuru, Davanagere, Udupi, Hassan, Mandya, Chitradurga, Kolar, Raichur, Bidar, Koppal, Haveri, Gadag, Chikkamagaluru, Chamarajanagar, Kodagu, Bagalkote, Yadgir, Chikkaballapura, Ramanagara, Uttara Kannada, Dharwad.
- **Lat/long:** sample within each district's bounding box; concentrate ~40% of cases in Bengaluru City with realistic ward-level clustering (so hotspots are visible). Karnataka bounds ≈ lat 11.5–18.5, long 74–78.6; Bengaluru core ≈ 12.90–13.10, 77.50–77.70.
- **Crime heads/sub-heads (realistic mix):** Crimes Against Body (Murder, Attempt to Murder, Hurt), Crimes Against Property (Theft, House Breaking/Burglary, Robbery, Dacoity, MV Theft), Crimes Against Women (per relevant sections), Cyber Crime (fraud, OTP/UPI fraud, sextortion), Economic Offences (cheating, forgery), NDPS, Missing/UDR, Traffic/PAR. Weight property + cyber heavily (they dominate real volume and demo well).
- **Acts/Sections:** IPC/BNS + IT Act + NDPS + local acts with plausible section codes; map to crime heads via CrimeHeadActSection.
- **Case categories:** FIR (majority), UDR, Zero-FIR, PAR — encode into CrimeNo per the format in schema (1-digit category prefix).
- **Statuses:** Under Investigation, Charge Sheeted, Closed, plus disposal via ChargesheetDetails.cstype (A/B/C).
- **Names:** use a Kannada/Indian name pool (first+last) so demographics and Kannada UI read authentically. **Introduce deliberate name-spelling variants** for planted offenders (e.g., "Ravi Kumar" / "Ravikumar R" / "Ravi K.") to exercise entity resolution.

## 4. CrimeNo generation (follow the schema format exactly)
`CrimeNo = [1-digit category][4-digit DistrictID][4-digit UnitID][4-digit Year][5-digit serial]`
- Category codes: FIR=1, UDR=3, PAR=4, Zero-FIR=8 (per schema examples).
- Serial resets per (station, category, year). `CaseNo = YYYY + 5-digit serial` (last 9 of CrimeNo).

## 5. Temporal & behavioral realism
- Seasonality (festival-season property crime bumps), weekend/night skew for certain heads (time-of-day used by hotspots).
- **Reporting delay** distribution: most FIRs registered within hours–days of `InfoReceivedPSDate`; plant a subset with large `IncidentFromDate → InfoReceivedPSDate` gaps.
- **Investigation duration:** registered → chargesheet varies by head/gravity; plant a subset that ages far beyond peer median (feeds Investigation-Health).
- Disposition mix: ~70% chargesheet (A), ~10% false (B), ~20% undetected (C) among disposed cases (tune per head).

## 6. Planted ground-truth patterns (the demo gold — store in `_ground_truth.json`)
Inject these deliberately and record their IDs for evaluation:
1. **Cross-district gang (chain snatching):** 1 offender identity (with 3 name variants) + 2 co-accused appear in **8–10 FIRs across ≥3 stations and ≥2 districts**, similar MO text in BriefFacts, similar time-of-day, nearby-but-not-identical locations. → must appear as one cluster.
2. **Serial burglary chain:** same 2 accused, escalating dates, one district, similar MO. → linkage by shared offender + MO + location.
3. **Cyber-fraud ring:** several FIRs sharing an accused + repeated modus (UPI/OTP) across districts; victims skew a specific age band (for vulnerability analytics, victim-side only).
4. **Repeat offender out on bail:** an identity with prior arrests + bail, then new FIRs → high behavior-based risk + watchlist.
5. **Slipping cases:** a set of Under-Investigation cases aged well past peer median + some drifting to "undetected". → Investigation-Health flags.
6. **False-case pattern:** a small cluster of cstype=B in one station → anomaly flag.
7. **Emerging hotspot:** a spike of one crime head in one Bengaluru area in the latest 2 months vs baseline. → emerging-trend badge.

`_ground_truth.json` schema: `{ gangs:[{offenderIdentity, variants[], caseMasterIds[], districts[], stations[]}], serialChains:[…], slippingCaseIds:[…], falseCaseCluster:{…}, emergingHotspot:{district,crimeHead,cellIds[]}, riskyOffenderIds:[…] }`.

## 7. Fairness note in generation
Populate ReligionID/CasteID/Occupation on complainants for schema fidelity, but **distribute them independently of crime/offender patterns** — i.e., they carry no predictive signal by construction. This makes it demonstrably safe (and true) that excluding them costs no accuracy. Never correlate planted gangs with any protected attribute.

## 8. Output format
- `data/output/<TableName>.csv` — headers = exact column names from `03_DATABASE_SCHEMA.md`. UTF-8, RFC-4180, dates ISO `YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS`, booleans `true/false`, empty = blank.
- `data/output/_ground_truth.json` — evaluation truth (NOT imported to Data Store; used by tests + a demo slide).
- `data/output/_manifest.json` — table → row counts + import order.
- Optional: `data/output/rag/` — a few IPC/BNS/SOP markdown/PDF docs for the RAG knowledge base.

## 9. Import order (respect FKs)
1. State → District → UnitType → Unit → Rank → Designation → Employee
2. CaseCategory, GravityOffence, CrimeHead → CrimeSubHead, Act → Section, CrimeHeadActSection, CaseStatusMaster, Court, OccupationMaster, ReligionMaster, CasteMaster
3. CaseMaster
4. ComplainantDetails, Victim, Accused, ActSectionAssociation, ArrestSurrender, inv_arrestsurrenderaccused, ChargesheetDetails

## 10. Generator design (`data/generator/`)
- `karnataka.py` — reference data (districts, sample station names, bounding boxes, crime heads, acts/sections, name pools).
- `patterns.py` — injects the planted ground-truth patterns and records them.
- `generate.py` — orchestrates: build lookups → employees/units → base FIRs (weighted distributions) → parties → acts → arrests → chargesheets → inject patterns → write CSVs + `_ground_truth.json` + `_manifest.json`.
- Libs: `faker` (with `en_IN`/custom name pool), `numpy`/`random` (seeded), `pandas`.
- Config at top: `SEED=2026`, volumes, date range, Bengaluru concentration, disposition mix.

## 11. Validation checklist (run after generation)
- [ ] Every FK resolves (no orphans); cardinalities within spec.
- [ ] CrimeNo format valid; serials unique per (station,category,year).
- [ ] Planted patterns present and recorded in `_ground_truth.json`.
- [ ] Protected attributes uncorrelated with outcomes (quick chi-square sanity check ≈ independent).
- [ ] Row counts match `_manifest.json`; CSVs import-clean (no bad delimiters/encodings).
- [ ] Pipeline ground-truth eval later recovers ≥90% of planted gangs/chains.
