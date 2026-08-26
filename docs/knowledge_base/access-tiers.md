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
