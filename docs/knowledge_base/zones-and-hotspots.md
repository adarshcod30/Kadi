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

_Corpus as of 2026-07-13: 1 emerging hotspot cluster(s)._
