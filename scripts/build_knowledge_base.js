#!/usr/bin/env node
// Builds the RAG knowledge base for the KADI assistant.
//
// WHAT BELONGS IN HERE, AND WHAT DOES NOT.
//
// The assistant already answers questions of fact — "how many cyber cases in Udupi", "who is
// linked to FIR 11597" — from the case database through a whitelisted query engine, and it
// answers them exactly. Putting those same facts in a knowledge base would be strictly worse:
// the numbers would go stale the moment the pipeline reran, and a retrieved sentence saying
// "40,829 FIRs" would contradict a live query returning 59,985.
//
// So the knowledge base holds the OTHER half — the half the query engine structurally cannot
// answer, because it is not in any column:
//
//   · what a thing MEANS      "what does a yellow zone mean", "is a link evidence?"
//   · how it is COMPUTED      "how is the risk score built", "what is peer median"
//   · what it EXCLUDES        the fairness policy, and why it is enforced in code
//   · what to DO about it     what a health flag asks an officer to do next
//   · who may SEE what        the three access tiers
//
// Counts that do appear are generated from the live corpus at build time and carried with an
// explicit as-of date, so a stale document is visibly stale rather than quietly wrong.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs/knowledge_base');
const DERIVED = path.join(ROOT, 'functions/api/data/derived');

const readJson = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DERIVED, `${name}.json`), 'utf8')); } catch { return fallback; }
};

const stats = readJson('stats', {});
const evalReport = readJson('eval_report', {});
const socio = readJson('socio', {});
const forecast = readJson('forecast', {});
const asOf = stats.computedTs || new Date().toISOString().slice(0, 10);
const n = (v) => (typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '—'));

const docs = [];
const doc = (name, title, body) => docs.push({ name, title, body: body.trim() + '\n' });

// ---------------------------------------------------------------------------------------
doc('kadi-what-it-is.md', 'What KADI is', `
# What KADI is

KADI is a crime-analytics and intelligence layer for the Karnataka State Police. It reads the
FIR register; it is not the system of record. Officers do not file or edit FIRs in KADI —
they read what has already been filed, joined together.

## The problem it addresses

FIRs are registered per station and stay there. A group working across three districts appears
as many unrelated petty crimes, because nobody holds all the registers at once. KADI holds
them as one graph, so a connection that spans stations becomes visible from any of them.

## What it does

- **Case linkage.** Every FIR is joined to every other FIR it shares real evidence with.
- **Offender resolution.** Name variants across FIRs are merged into one identity.
- **Investigation health.** Cases drifting past detection timelines are flagged with reasons.
- **Spatiotemporal analysis.** Where and when crime concentrates, against each area's own baseline.
- **Socio-economic context.** Rates per 100,000 residents rather than raw counts.
- **Grounded assistant.** Answers cite the FIR numbers they came from.

## What it explicitly does not do

- It does not file, edit or close FIRs.
- It does not do facial recognition, biometrics, or phone-record ingestion.
- It does not use caste, religion or occupation in any model, ever.
- It does not predict individual criminality. Risk scores describe recorded behaviour that has
  already happened; they are not a forecast about a person.

_Corpus as of ${asOf}._
`);

// ---------------------------------------------------------------------------------------
doc('case-linkage-explained.md', 'What a link between two cases means', `
# What a link between two cases means

Two FIRs are linked when they share **recorded evidence**, not when they merely resemble each
other. Six link types exist, and every link names which one it is and what matched.

| Link type | What it means |
|---|---|
| Shared offender | The same resolved identity appears as accused in both FIRs. |
| Co-accused | Two different people who have been named together in another case. |
| Similar modus operandi | The free-text method descriptions are near-identical. |
| Same location | The incidents fall within the same tight geographic cluster. |
| Same time window | The incidents fall in the same narrow period. |
| Shared act & section | The same act and section combination, across differing sub-heads. |

## How to read a link

**A link is a lead, not a conclusion.** Most links arise from method, place or timing rather
than from a shared person — so a linked pair is a reason to look, not proof of connection.

**Link strength** counts how many *independent kinds* of evidence back the same pair. Two
cases sharing an offender AND a modus operandi is a stronger claim than either alone, because
the two are unlikely to coincide by chance.

**Every link is click-through.** Opening one shows the exact matching attributes and the source
FIR numbers. If a link cannot show its evidence, it is a bug, not a judgement call.

## Why linkage matters operationally

A station sees only its own register. An offender working across district lines is therefore
invisible from any single desk — each station sees one or two of their cases and no reason to
connect them. Linkage is what makes that pattern visible from anywhere in the state.

_Corpus as of ${asOf}: ${n(stats.totalCases)} FIRs, ${n(stats.activeNetworks)} active offender
networks, ${n(stats.crossDistrictNetworks)} of them operating across district lines._
`);

// ---------------------------------------------------------------------------------------
doc('offender-risk-score.md', 'How the offender risk score is built', `
# How the offender risk score is built

A behaviour-based score from 0 to 100, with a visible factor breakdown. Every offender profile
shows the breakdown; if the breakdown cannot be shown, the score is not shown either.

## The factors

| Factor | What it measures |
|---|---|
| Prior count | How many distinct cases resolve to this identity. |
| Re-offended after arrest | Whether offending continued after a recorded arrest. |
| Recency | How recent the offending is. |
| Arrests | Number of arrests on record. |
| Distinct districts | How many districts the person operates across. |
| Heinous ratio | The share of their cases classified heinous. |
| Network centrality | How connected they are within a co-offending group. |

## What the score is NOT built from

Caste, religion and occupation. These columns exist in the KSP schema and are excluded from
every model by construction. A unit test fails the build if one appears in a feature set — the
exclusion is enforced in code, not by convention.

## What the score does not tell you

**It is not a prediction about a person.** It summarises recorded behaviour that has already
happened. It does not say someone will offend again.

**It does not encode recency on its own.** A high scorer last active four years ago outranks
someone active last month. This is why the watchlist reports recency, escalation and tempo
separately — "still active" is a different question from "serious history", and only the
combination is an operational priority.

## Bands

High is 70 and above, Medium 40 to 69, Low below 40.

_Corpus as of ${asOf}: ${n(stats.resolvedOffenders)} repeat offenders resolved,
${n(stats.highRiskOffenders)} in the High band._
`);

// ---------------------------------------------------------------------------------------
doc('entity-resolution.md', 'How offender identities are merged', `
# How offender identities are merged

The same person appears across FIRs under spelling variants — "Ravi Kamalapur", "Ravi
Kamalapur B", "Ravi Kamalapur R". Entity resolution merges these into one identity so that a
repeat offender stops looking like three first-time offenders.

## What a merge uses

Name similarity, shared co-accused, geographic proximity of the cases, and temporal
plausibility. A rare surname carries more evidential weight than a common one — and rarity is
measured as a **rate against the corpus population**, not a fixed count, so the threshold does
not erode as the register grows.

## ER confidence

Every identity carries a confidence figure, displayed on the watchlist. Merges below the
confidence threshold are **flagged for review, not hidden**. An analyst can see that the system
was unsure and check the merge themselves.

## The repeat-offender register

The watchlist contains only identities with **two or more** cases. It is not the full accused
list — it is the subset who reoffend, which is what a watchlist is for.

## Searching

Searching any known alias returns the identity it resolved into. Looking up "Ravi Kamalapur B"
finds the merged person, not nothing.

_Corpus as of ${asOf}: ground-truth recovery ${n(evalReport.overallRecoveryPct)}%, scored on
every pipeline run against planted patterns rather than asserted._
`);

// ---------------------------------------------------------------------------------------
doc('investigation-health.md', 'Investigation health flags and what to do about them', `
# Investigation health flags and what to do about them

Every flag is deterministic and auditable — it states why it fired and what to do next. No
health figure comes from a model.

## The flags

**Reporting delay** — an unusual gap between the incident and the FIR being registered.
Evidence decays; the delay itself is worth understanding.

**Investigation ageing** — the case has been open materially longer than the **peer median**
for its own crime type. Peer median is what a comparable case normally takes, so this is
slippage against like-for-like rather than against a fixed target. A property case and a murder
are not held to the same clock.

**Pendency** — under investigation beyond the threshold for its category.

**Undetected risk** — a scored likelihood that this case ends without a detection, based on
elapsed time, crime type and whether the case has any linkage leads at all.

**False-case pattern** — the case matches a pattern associated with fabricated complaints. This
flags a case for review; it does not conclude anything.

## Severity

**High** means act now. **Medium** means it warrants attention. An unflagged case is not
necessarily healthy — it is not currently tripping any rule.

## How to act on a flag

Read it with the **linkage** figure. A flagged case that links to others has leads an isolated
one does not: the connected cases may carry an identified accused, a recovered vehicle, or a
statement that moves this one forward. A flagged case with no links needs different attention.

_Corpus as of ${asOf}: ${n(stats.flaggedCases)} cases carry at least one flag,
${n(stats.seriousFlaggedCases)} of them high severity._
`);

// ---------------------------------------------------------------------------------------
doc('zones-and-hotspots.md', 'Zones, hotspots and what "emerging" means', `
# Zones, hotspots and what "emerging" means

## Zones — measured against an area's own history

A zone is **not** a volume ranking. A busy city station is not red simply for being busy. Each
area is compared to its **own** historical average, so a quiet station with an unusual month is
correctly red while a permanently busy one at its normal level is not.

| Zone | Meaning |
|---|---|
| Red, pulsing | Sharply above this area's own average. |
| Red | Well above its own average. |
| Yellow | Above its own average. |
| Normal | At baseline. |

This is why "which district has the most cases" and "which district needs attention" give
different answers, and only the second is actionable.

## Hotspots

Spatial clusters found with DBSCAN, per crime head, using density parameters tuned per
district — an urban cluster and a rural one are not the same size.

**Emerging** means recent density is well above that cluster's own historical baseline. It is
a change signal, not a volume signal.

## Time of day

Location tells you where; time tells you when to be there. The two together produce a patrol
window, which is the deployable output. A finding that crime concentrates in a three-hour
evening block across every weekday is a shift-timing conclusion, not a weekend one.

_Corpus as of ${asOf}: ${n(stats.emergingHotspots)} emerging hotspot cluster(s)._
`);

// ---------------------------------------------------------------------------------------
doc('fairness-policy.md', 'The fairness policy, and how it is enforced', `
# The fairness policy, and how it is enforced

## The statement

KADI links cases and scores offenders using **evidence and behaviour only** — never caste,
religion or occupation. These fields exist in the KSP schema and are excluded from every model
by design.

## Why this is a design constraint, not a disclaimer

Predictive policing is rightly criticised for reproducing discrimination against caste and
religious minorities. The KSP schema contains those fields. A credible system must refuse to
use them and be able to **prove** the refusal — so the exclusion is enforced in code and a unit
test fails the build if a protected attribute reaches a feature set.

## Area-level indicators are a separate thing

Socio-economic analysis uses indicators such as literacy, urbanisation and population density.
These are **area-level** figures about places. They are never joined to an individual and never
used as a feature in any person-level score. "This district has high urbanisation" is a
statement about a district; it says nothing about anyone living in it.

## Every offender profile states its own compliance

Each profile reports **protected attributes used: none**, alongside the factor breakdown that
produced the score. The claim is checkable on the record itself, not only in documentation.
`);

// ---------------------------------------------------------------------------------------
doc('access-tiers.md', 'Who can see what', `
# Who can see what

Three tiers, mirroring how the force is organised. Scope is enforced **server-side on every
query**. An out-of-scope read is refused, not merely hidden in the interface, and editing a URL
or a request header does not widen it.

| Tier | Posts | Reads |
|---|---|---|
| State | DGP, SCRB Analyst, Administrator | All 31 districts. May drill into any district and back out. |
| District | SP, DySP | Exactly one district, plus cases linked into it from elsewhere. |
| Station | SHO, Sub-Inspector | Exactly one station's own register. |

## Why the station tier exists

It is the ground floor of the hierarchy and the view the whole product argues against: an
officer who sees their own register and nothing else. Standing in it — and seeing how many of
your own cases connect to cases you cannot open — is what makes the state view mean something.

## Linked-in cases

A district tier user also sees cases registered **elsewhere** that share evidence with a case
inside their district. This is deliberate: it is the silo-breaking answer, and a plain filtered
list can never surface it.

## Audit

Every sensitive read — case detail, offender detail, linkage graph, assistant query — is
written to an audit trail recording who, what and when.
`);

// ---------------------------------------------------------------------------------------
doc('data-dictionary.md', 'Data dictionary', `
# Data dictionary

## Crime heads

Crimes Against Body, Crimes Against Property, Crimes Against Women, Cyber Crime, Economic
Offences, NDPS, Missing / UDR, Traffic / PAR. Each divides into sub-heads — Cyber Crime, for
example, contains Online Financial Fraud (UPI/OTP), Sextortion, Phishing and others.

**Why the sub-head matters.** A sub-head says a case is Online Financial Fraud. It cannot say
whether the method was a fake KYC call or a QR-code scam — and a criminal series shares the
*method*, not the sub-head. That distinction is why the free-text modus operandi is read
separately.

## Case status

Under Investigation, Charge Sheeted, Closed, Undetected.

## Gravity

Heinous and Non-Heinous, under the KSP gravity scale.

## Case category

FIR, UDR (unnatural death report), PAR (police assistance request), Zero FIR.

## Police station types

Law and Order (Town/City), Law and Order (Rural), Traffic, Women, CEN (Cyber, Economic and
Narcotics), Cyber Crime, and Railway. Deployment is not uniform: traffic policing concentrates
in high-urbanisation districts, CEN and Women's stations run roughly one per district, and
Cyber Crime stations concentrate in Bengaluru City.

## CrimeNo

The FIR identifier. It embeds the unit and the year, and it is the field to quote when
referring to a case.

_Corpus as of ${asOf}._
`);

// ---------------------------------------------------------------------------------------
const topRate = (socio.districts || []).slice().sort((a, b) => (b.ratePer100k || 0) - (a.ratePer100k || 0))[0];
const rising = (forecast.districts || []).filter((d) => d.direction === 'rising').length;
doc('per-capita-and-forecast.md', 'Rates per capita, and the forecast', `
# Rates per capita, and the forecast

## Why rates rather than counts

Bengaluru City records the most cases because it holds the most people. A count ranking
therefore mostly measures population, and tells a commander very little.

Rates per 100,000 residents ask a different question — where is crime *concentrated relative to
the people living there* — and the two rankings disagree sharply. A district can sit near the
bottom by count and near the top per capita, and only the second reading identifies where
per-officer pressure is genuinely highest.

## Correlations

Area-level indicators are correlated against district crime rates with p-values reported.
Urbanisation, literacy and population density all correlate positively. These describe places
and are never applied to individuals.

## The forecast

A three-month projection per district with a 95% interval, backtested against held-out months
and reported as MAPE. A forecast is a projection of a trend, not a statement about what will
happen — the interval is the honest part and should be read with the central figure.

**Direction** — rising, flat or falling — describes the projected trend against the district's
recent average.

_Corpus as of ${asOf}: ${rising} district(s) projected rising.${topRate ? ` Highest rate per 100,000: ${topRate.districtName} at ${topRate.ratePer100k}.` : ''}_
`);

// ---------------------------------------------------------------------------------------
doc('how-to-read-the-screens.md', 'How to read each screen', `
# How to read each screen

**Home** — the command picture for your tier. State sees 31 districts ranked by concern;
district sees its own stations; station sees its own register and, deliberately, the count of
connected cases it cannot open.

**Graph** — the case-linkage network around one FIR. Nodes are FIRs and offenders; edges are
proven links. Click an edge for the evidence behind it.

**Cases** — the register, filterable. The **Links** column shows how many other cases each FIR
connects to. The **Health** dot shows whether it carries an investigation-health flag; hover it
for the specific reasons.

**Offenders** — the repeat-offender watchlist. Two or more cases resolved to one identity.
Sortable by risk, recency, case count, reach, network size or arrests.

**Health** — the investigation-health worklist, ordered so the cases nearest failure surface
first. Each carries its reasons and a recommended action.

**Map** — density, heatmap and individual incidents over satellite, streets or a night basemap.
Filter by crime head, period and time of day. Pulsing red marks areas sharply above their own
baseline.

**Intelligence** — the analytical layer: per-capita rates, socio-economic correlation,
forecasting, station roster.

**Audit** — who read what, and when.

**Assistant** — ask in English or Kannada. Answers cite the FIR numbers they drew from.

## The intelligence band

Several screens carry a collapsible band of findings computed over **whatever is currently
filtered**, not the whole register. Each finding carries the query that reproduces it, so it
can be opened rather than merely read. The wording is AI-drafted; every figure in it is
computed deterministically from the records in view.
`);

// ---------------------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
// Clear previously generated documents so a renamed one does not linger and get retrieved.
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('.md') && f !== 'KADI_Operating_Reference.md') fs.unlinkSync(path.join(OUT, f));
}
let bytes = 0;
for (const d of docs) {
  fs.writeFileSync(path.join(OUT, d.name), d.body);
  bytes += Buffer.byteLength(d.body);
}
fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  corpusAsOf: asOf,
  documents: docs.map((d) => ({ name: d.name, title: d.title, bytes: Buffer.byteLength(d.body) })),
}, null, 2)}\n`);

console.log(`wrote ${docs.length} knowledge-base documents (${Math.round(bytes / 1024)} KB) to docs/knowledge_base/`);
for (const d of docs) console.log(`  ${d.name.padEnd(32)} ${d.title}`);
