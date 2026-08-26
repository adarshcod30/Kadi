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
