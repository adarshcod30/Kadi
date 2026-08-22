# KADI — Operating Reference for Karnataka State Police

This document is the knowledge base behind the KADI assistant. It explains how every figure
on the platform is produced, so an officer can ask a question in plain language and get an
answer grounded in the actual method rather than a guess.

---

## 1. What the zone colours mean

The zone board answers one question: **is this area doing something unusual for itself?**
It never ranks by volume, because ranking by volume just re-ranks by population.

| Zone | Meaning |
|---|---|
| **Pulsing red** | Well above its own normal AND still climbing. Needs someone today. |
| **Red** | Well above its own normal, but the rise has levelled off. Needs review. |
| **Yellow** | Above its own normal. Worth watching, not yet worth deploying against. |
| **Normal** | Inside the range this area usually occupies. |

### Why two areas with the same numbers can have different colours

Every area is measured against **its own twelve-month record**, using its own observed
month-to-month variation — not a state-wide cut-off, and not an assumed statistical
distribution.

Worked example, two stations in the same district:

- **Davanagere North PS** averages 3.8 FIRs a month and rarely moves. Its red line is **+3.8**.
- **Davanagere City PS** also averages 3.8, but swings widely month to month. Its red line
  is **+6.5**.

Same average, different bars, because a station that never moves is doing something genuinely
unusual at a smaller rise than one that swings every month.

Across districts the same logic applies: Bengaluru City needs roughly **+98** to register,
a rural district roughly **+1**. A single shared threshold would be meaningless noise for the
first and unreachable for the second.

**A rise must also be at least 25% above that area's own average.** This keeps the bar
proportionate rather than absolute.

### Category alerts

A district can sit flat overall while one crime type doubles underneath it. Every crime head
is therefore tested separately. Mandya, for example, was **down 11% overall** and still had a
body-crime rise well outside its own range — something a total-volume view cannot detect.

---

## 2. Spatiotemporal clusters — where, layered with when

A hotspot on a map says where to go but not when to be there.

Each spatial cluster's incidents are binned into four six-hour windows, roughly a patrol
shift. A cluster is only listed as time-concentrated if its peak window **beats chance**:
with four windows, a small cluster lands entirely in one of them often enough that ranking on
percentage alone would surface noise first. The test is an exact binomial tail at p < 0.01.

Clustering density is also set per district. Bengaluru clusters at 0.44 km; rural districts
at up to 2.22 km, because incidents there are genuinely further apart. A rural district gets
a wider net, not a lower standard.

---

## 3. How cases are linked

Two FIRs are connected only when there is real evidence tying them:

| Link type | What it means |
|---|---|
| **Shared offender** | The same resolved individual appears in both. Strongest signal. |
| **Co-accused** | Their accused were arrested together elsewhere. |
| **Similar MO** | The written method matches distinctively. |
| **Same location** | Same ~1 km cell. |
| **Same time window** | Same crime type within a short period. |
| **Shared section** | The same act and section across *different* crime types. |

**Distinctiveness governs everything.** A feature is evidence only if it is rare. A surname
shared by half the state identifies nobody, and neither does a narrative shared by 140 FIRs.
Boilerplate MO text appearing in more than 20 cases of a crime type generates no link at all.
Likewise, two cases of the same sub-head share an IPC section by definition, so that is not
counted — it would be the crime type restated, not corroboration.

**Corroborating evidence** counts how many *independent* kinds of evidence back a link. Two
cases sharing an offender *and* a modus operandi is a stronger claim than either alone.

---

## 4. Offenders and entity resolution

36,890 accused records resolve to 36,289 distinct identities. The merges are made on name
similarity, address, and co-offending patterns — never on caste, religion or occupation.

A surname is only treated as identifying when it appears in 20 or fewer accused records.
Common names carry no weight.

**Risk bands** reflect offending behaviour: number of cases, gravity, recency, cross-district
reach and network size. They are a prioritisation aid for investigators, never a prediction
about an individual, and never an input to any charging decision.

---

## 5. Investigation health

A case is flagged when its progress departs from what comparable cases achieve — long
periods without action, ageing past the point where similar cases closed, or no accused
recorded after a substantial time.

Flagging means "this file needs a look", not "this officer did wrong".

---

## 6. Behavioural outliers

Each case is compared with others of the same crime type on reporting delay, investigation
age, and the number of accused and victims. A high score means the file behaves unlike its
peers and deserves human attention. The specific reason is always shown next to the score.

Station-level outliers compare false-case rates against the station's peer group.

---

## 7. Forecasting

Three-month projections use a linear trend plus month-of-year seasonality.

Accuracy is a **hold-out backtest**: the last three months are hidden from the model,
predicted, and scored against what actually happened. Current error is **4.3% MAPE**.

**A projected move smaller than the model's own error is inside the noise** and should not be
acted on as if it were a finding.

---

## 8. Per-capita analysis — the "why" behind the "where"

Raw counts mostly measure population. Normalising to incidents per 100,000 residents changes
the picture substantially: Kodagu is 31st by raw count and 6th per capita.

Crime rate correlates with urbanisation (+0.88), population density (+0.87) and literacy
(+0.55) across the 31 districts. These are **correlations across areas, not causes**, and
they say nothing about any individual.

For a district view, the comparison is against **peer districts** — same urbanisation band,
nearest by density. Comparing a metro with a hill district explains nothing.

---

## 9. Access model

Two tiers:

- **State** — SCRB Analyst, State DGP, Administrator. All 31 districts, and can drill into
  any one of them.
- **District** — SP, DySP/ACP, Sub-Inspector. Their own district only. They can see cases
  from elsewhere that are *linked into* their district, but never browse outside it.

Scoping is enforced server-side on every query. An out-of-scope read is refused, not hidden.

---

## 10. Fairness — non-negotiable

**Caste, religion and occupation are never inputs.** Not to entity resolution, not to
linkage, not to risk scoring, not to any prediction or ranking. This is enforced by a unit
test that fails the build if any protected column appears in a model's feature set.

Every insight rests on evidence and behaviour: what happened, where, when, and who was
already connected to it by the record.

---

## 11. What the AI does and does not do

The language model **never produces a fact**. It receives figures already computed by the
pipeline and returns prose describing them. Every number shown on screen came from the data,
which is why the assistant cannot invent an FIR number.

Zia text analytics reads the free-text account of an offence to extract people, places,
vehicles and property. It reads the narrative only.
