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

_Corpus as of 2026-07-13._
