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

_Corpus as of 2026-07-13: 578 repeat offenders resolved,
60 in the High band._
