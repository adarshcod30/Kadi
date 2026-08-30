# 06 — The synthetic corpus

Real FIR data is confidential and cannot leave KSP. So the build and the demo run on a
**schema-faithful synthetic corpus** that (a) matches the KSP ER diagram exactly and
(b) **plants known ground-truth patterns**, so the platform finding them is measurable rather
than asserted.

Say "synthetic" everywhere it appears — README, About page, deck, footer. Disclosure costs
nothing and buys the judge's trust. The pipeline ingests real data unchanged.

**What the generator currently produces:** 59,985 FIRs across 43 months, 31 districts, 298
police stations, 74,799 victim records and 54,337 accused records carrying 300 planted repeat
identities, plus 7 planted patterns. Deterministic under seed 2026 — it regenerates
byte-for-byte.

---

## 1. What the generator must guarantee

1. Referential integrity across every table — no orphans, correct cardinalities.
2. Realistic Karnataka geography, crime mix and temporal behaviour.
3. **Planted ground truth**, recorded separately in `data/output/_ground_truth.json`.
4. Determinism, so the demo is reproducible and the eval score is meaningful.
5. One CSV per table, ready for Data Store import.

Point 3 is the one that turns a demo into evidence. Without it linkage can only be asserted;
with it, it can be measured.

## 2. Volumes

| Table | Rows |
|---|---|
| State | Karnataka + neighbours (for cross-border arrests) |
| District | 31 — the real ones |
| Unit (police stations) | 298 |
| Employee | ~1,500 |
| **CaseMaster (FIRs)** | **59,985** |
| ComplainantDetails | 59,985 (1 per FIR) |
| Victim | 74,799 (1–3 per FIR) |
| Accused | 54,337 (0–5 per FIR) → **300 planted repeat identities**, 578 resolved by the pipeline |
| ArrestSurrender | 17,346 |
| ActSectionAssociation | 87,868 |
| ChargesheetDetails | 32,942 |
| Lookups | small, realistic |

Time span **Jan 2023 → Jul 2026** (43 months), so "this quarter" and "this year" queries
work relative to the event date.

## 3. Reference data — make it real

**Districts** — all 31 actual Karnataka districts: Bengaluru City, Bengaluru Rural, Mysuru,
Dakshina Kannada, Belagavi, Kalaburagi, Dharwad, Ballari, Vijayapura, Shivamogga, Tumakuru,
Davanagere, Udupi, Hassan, Mandya, Chitradurga, Kolar, Raichur, Bidar, Koppal, Haveri, Gadag,
Chikkamagaluru, Chamarajanagar, Kodagu, Bagalkote, Yadgir, Chikkaballapura, Ramanagara,
Uttara Kannada, Vijayanagara.

**Coordinates** — **rejection-sample inside the real district polygons** using shapely. Do
not use bounding boxes: a bounding box puts incidents in the Arabian Sea and in Tamil Nadu,
and the first person to open the map will spot it. Current corpus is 100% on land, inside
Karnataka.

**Volume distribution** — follow published statistics rather than spreading evenly.
Bengaluru City carries ~16,900 FIRs; small rural districts carry a few hundred. This
lopsidedness is exactly what makes the per-capita finding land later.

**Crime heads** — Crimes Against Property (theft, burglary, robbery, dacoity, MV theft),
Cyber Crime (UPI/OTP fraud, sextortion), Crimes Against Body, Crimes Against Women, Economic
Offences, NDPS, Missing/UDR, Traffic/PAR. Weight property and cyber heavily; they dominate
real volume and demo well.

**Acts and sections** — IPC/BNS + IT Act + NDPS + local acts with plausible codes, mapped to
crime heads through `CrimeHeadActSection`.

**Names** — a Kannada/Indian name pool. **Deliberately introduce spelling variants** for the
planted offenders: "Ravi Kumar" / "Ravikumar R" / "Ravi K." — initials, transliteration
drift, reordering. Entity resolution has nothing to prove without them.

## 4. CrimeNo format — follow the schema exactly

```
CrimeNo = [1-digit category][4-digit DistrictID][4-digit UnitID][4-digit Year][5-digit serial]
```

Category codes: FIR = 1, UDR = 3, PAR = 4, Zero-FIR = 8. The serial resets per (station,
category, year). `CaseNo` = YYYY + the 5-digit serial.

## 5. Temporal and behavioural realism

- Seasonality — festival-period property-crime bumps; weekend and night skew for the heads
  where that is true. The hour × weekday heatmap is only interesting if this is right.
- **Reporting delay** — most FIRs registered within hours or days of `InfoReceivedPSDate`,
  with a deliberate subset carrying large gaps.
- **Investigation duration** — registered → chargesheet varies by head and gravity; plant a
  subset that ages far past the peer median to feed investigation health.
- Disposition mix — roughly 70% chargesheet (A), 10% false (B), 20% undetected (C) among
  disposed cases.

## 6. The seven planted patterns

Inject these deliberately and record their IDs. This file is the demo gold.

1. **Cross-district chain-snatching gang** — one identity with 3 name variants plus 2
   co-accused across 8–10 FIRs, ≥3 stations, ≥2 districts, similar MO text, similar
   time-of-day, nearby-but-not-identical locations. Must resolve to one cluster.
2. **Serial burglary chain** — same two accused, escalating dates, one district, similar MO.
3. **Cyber-fraud ring** — shared accused, repeated UPI/OTP modus, across districts; victims
   skew to one age band (victim-side analytics only).
4. **Repeat offender out on bail** — prior arrests and bail, then new FIRs. Should surface as
   high behavioural risk.
5. **Slipping cases** — Under-Investigation cases aged well past the peer median, some
   drifting to undetected.
6. **False-case pattern** — a small cluster of `cstype=B` in one station.
7. **Emerging hotspot** — a spike of one crime head in one Bengaluru area over the latest two
   months versus baseline.

`_ground_truth.json` shape:

```json
{
  "gangs":         [{ "offenderIdentity": …, "variants": [], "caseMasterIds": [], "districts": [], "stations": [] }],
  "serialChains":  [ … ],
  "slippingCaseIds": [],
  "falseCaseCluster": { … },
  "emergingHotspot": { "district": …, "crimeHead": …, "cellIds": [] },
  "riskyOffenderIds": []
}
```

> **The pipeline must never read this file.** It is written before the pipeline runs and read
> only afterwards, by `evaluate.py`. If the pipeline can see it, the 100% recovery figure is
> worthless — and someone will ask.

## 7. Fairness in generation

Populate `ReligionID`, `CasteID` and `OccupationID` on complainants for schema fidelity, but
**distribute them independently of crime and offender patterns**. They carry no predictive
signal by construction.

This matters more than it looks: it makes it demonstrably true that excluding them costs no
accuracy. Never correlate a planted gang with a protected attribute, not even accidentally
through a shared name pool.

## 8. Output

- `data/output/<TableName>.csv` — headers exactly as in
  [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md). UTF-8, RFC-4180, ISO dates, `true`/`false`
  booleans, blank for empty.
- `data/output/_ground_truth.json` — evaluation truth. **Not imported.**
- `data/output/_manifest.json` — table → row counts and import order.
- `data/output/rag/` — a few IPC/BNS/SOP documents for a RAG knowledge base.

The CSVs are gitignored because they are large and regenerable. The two small spec artefacts
(`_ground_truth.json`, `_manifest.json`) are committed.

## 9. Import order — respect the FKs

1. State → District → UnitType → Unit → Rank → Designation → Employee
2. CaseCategory, GravityOffence, CrimeHead → CrimeSubHead, Act → Section,
   CrimeHeadActSection, CaseStatusMaster, Court, OccupationMaster, ReligionMaster, CasteMaster
3. CaseMaster
4. ComplainantDetails, Victim, Accused, ActSectionAssociation, ArrestSurrender,
   inv_arrestsurrenderaccused, ChargesheetDetails

Get this wrong and the import fails partway, leaving a half-populated table and a confusing
error. Order is not optional.

## 10. Generator layout — `data/generator/`

- `karnataka.py` — reference data: districts, station names, real district polygons, crime
  heads, acts and sections, name pools.
- `patterns.py` — injects the planted patterns and records them.
- `generate.py` — orchestrates: lookups → units and employees → base FIRs (weighted) →
  parties → acts → arrests → chargesheets → inject patterns → write CSVs, `_ground_truth.json`
  and `_manifest.json`.

Config at the top of `generate.py`: `SEED = 2026`, volumes, date range, Bengaluru
concentration, disposition mix.

```bash
python data/generator/generate.py
```

## 11. Validate after every generation

- [ ] Every FK resolves; no orphans; cardinalities within spec
- [ ] `CrimeNo` format valid; serials unique per (station, category, year)
- [ ] All 7 planted patterns present and recorded
- [ ] Protected attributes uncorrelated with outcomes — a quick chi-square sanity check
- [ ] Row counts match `_manifest.json`; CSVs import cleanly
- [ ] Every coordinate falls inside a Karnataka district polygon
- [ ] The pipeline's ground-truth eval recovers the planted patterns (currently 100%)

## 12. Be honest about where it shows

The question of how realistic it is always comes up. The answer is ready, and the weaknesses are volunteered —
it reads as rigour, not apology:

- MO narratives are template-drawn, so they are cleaner and more uniform than real free text.
- The urbanisation correlation is **partly circular**: the generator weights urban crime
  upward, so finding that urbanisation correlates with crime rate is partly confirming the
  own assumption. The method is sound and runs unchanged on real data — but on this corpus it
  is confirmation, not discovery.
- Names come from a finite pool, making resolution slightly easier than reality.
- There are no missing fields, typos or duplicate registrations. Real registers are far
  messier.
- Census 2011 population, literacy and urbanisation figures are **real**, and are used as the
  per-capita denominator.
