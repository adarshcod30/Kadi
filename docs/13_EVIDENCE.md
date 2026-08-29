# 13 — Evidence: reading the paper an officer is holding, and filing what it says

Every other screen in KADI reads the register. This one reads what has not reached the register
yet — a seizure memo, a notice, a property tag, a photograph of recovered property — and files
the transcription against the case it belongs to.

It is built on one asymmetry, and most of what follows is a consequence of it:

> **The reading is stored. The photograph never is.**

The image is the part carrying whoever else happened to be in frame. The text is the part with
evidentiary value. There is no blob column in this feature, and that is a decision rather than
an omission.

---

## 1. Three readers, because three answered

Zia lists five image services. This deployment was **probed rather than read about**, because
the console documents them through SDK samples and the SDK returns 401 on this project.

| Tool | Engine | Status |
|---|---|---|
| **Read the text** | Zia OCR | works — 99% confidence on a typed memo in ~2.0 s |
| **Ask about it** | Qwen 3.6 35B Vision | works — 0.2–0.9 s, answers a free-text question |
| **Scan a code** | Zia barcode scanner | works — QR in 127 ms, Code-128 in 288 ms |
| Object recognition | Zia | **404 on every REST path tried.** The vision model covers the same ground |
| Identity scanner | Zia | **404 on every REST path tried** |
| Face detection | Zia | endpoint exists, returns `ZIA_ERROR` on every image including one with a face |

The three that do not answer are **stated on the screen**, not hidden. A reader who sees three
tools where the platform advertises five should be told why rather than left to assume they were
not bothered with.

### There is no face matching, and there will not be

Not a limitation to be lifted later — a decision. Zia offers no 1:N face search, this corpus
carries no photographs of people, and a "match" assembled from neither would be a fabricated
identification handed to someone with arrest powers.

Counting the people in a scene is a contemporaneous note. Naming them is an accusation, and a
general vision model is not entitled to make one. The refusal is enforced in three places:
`vlm.js` `FORBIDDEN` patterns, the system prompt, and the route.

```
Q: "Who is the accused person in this photograph? Identify them."
A: This assistant reads documents; it does not identify people from photographs.
```

---

## 2. Who can do what

Two different permissions, deliberately not the same one.

| | Who | Why |
|---|---|---|
| **Read an uploaded image** | DGP, Administrator, SCRB Analyst | The register is *scoped*; an upload is whatever the uploader chose to photograph, and no scope applies to it. That belongs with the ranks already holding state-wide read. |
| **Read a filed note** | anyone who can see the case | The note belongs to the case. The station that registered it needs the memo transcription — and gets it without ever being able to upload an image. |

Verified against the deployment:

```
POST /evidence/ocr    DGP 200 · Admin 200 · Analyst 200 · SP 403 · DSP 403 · SHO 403 · SI 403
POST /evidence/note   DGP 200 · Admin 200 · Analyst 200 · SP 403 · DSP 403 · SHO 403 · SI 403
GET  /cases/:id/evidence   own case: all six roles visible
                           other district: DGP ✓ Analyst ✓ · SP ✗ DSP ✗ SHO ✗ SI ✗
```

### The scope check on the read is written here, not inherited

`queries.getCase()` carries a comment saying detail is visible "if in scope OR linked into an
in-scope investigation". **No code implements that.** Probing found a station SI able to open
case detail in every other district sampled: the register *list* is scoped, the register *detail*
is not.

That is a pre-existing property of the register and not something this feature changes. But a
filed reading is not a case row — it is a transcription of a photographed document, carrying
property lists, IMEIs and witness names — so `/cases/:id/evidence` calls `rbac.caseInScope`
itself. Seeing that a case in another district is *linked* to yours is the product's thesis;
reading the seizure memo filed against it is not part of that thesis.

There is a test asserting that line is present.

---

## 3. Filing a reading

```
photograph ──▶ Zia OCR / Qwen vision / barcode ──▶ reading on screen
                                                        │
                                          search the register for the case
                                                        │
                                                        ▼
                              EvidenceNote row  (text, engine, confidence, who, when)
                                                        │
                                    visible on the case to that case's own scope
```

**Scope comes from the register, never the request body.** `crimeNo`, `districtId` and `unitId`
are read off the case the server resolved. A request carrying `"crimeNo": "FORGED"` is filed with
the register's real crime number — asserted in a test, and confirmed live.

**This is not a `CaseUpdate`, and the distinction is load-bearing.** A `CaseUpdate` changes a
*field*: it carries a before and an after, and a supervisor decides whether the register should
now say the new thing. An OCR reading changes no field. Forcing it through the amendment queue
would put an approver in front of `afterValue: <800 characters of memo>` with no field it
corresponds to and no way to say what approving it would mean.

### Notes are withdrawn, never deleted

Attaching a reading to the wrong case is a one-click mistake and needs an undo. But a police
record that can be made to have never said something is a worse problem than a wrong note. So
withdrawal is an `UPDATE`: it sets a status, names who did it and why, and the row stays.
Withdrawn notes are hidden from the case and kept in the audit trail.

Only the officer who filed a note, or an Administrator, may withdraw it — **not** the case's own
station. Letting the subject of a record remove the record is the failure mode this design
exists to avoid.

---

## 4. The routes

| Route | Gate |
|---|---|
| `POST /evidence/:capability` | `requireRole(['DGP','Admin','Analyst'])` |
| `POST /assistant/document?q=` | any account; `vlm.refuse()` on identification phrasings |
| `POST /evidence/note` | `evidencenote.canFile` + scoped `getCase` |
| `GET /cases/:id/evidence` | scoped `getCase` + `rbac.caseInScope` |
| `GET /evidence/notes` | `requireRole(['DGP','Admin','Analyst'])` |
| `POST /evidence/note/:id/withdraw` | author, or Administrator |

**The literal routes are declared before `/evidence/:capability`.** Express matches in
declaration order, so with the wildcard first a `POST /evidence/note` resolves as "read an image
using the capability named `note`" and answers 400 — which is exactly what it did on the first
deploy, in a file that already carried this warning above `/cases/:id`. There is a test asserting
the order.

**`/evidence/note` is in `LIVE_PATHS`.** Live rows — approved but not yet analysed by the
overnight pipeline — are attached to `req.user` only on the paths that regex names. Without it,
the filing route answers "case not found" for every case registered since the last pipeline run,
which is the seizure-memo case exactly: the memo and the FIR arrive on the same afternoon.

---

## 5. What this still cannot do

- **One image per reading.** No PDF, no multi-page. A three-page case diary is three uploads.
- **No re-reading a filed note.** The transcription is stored; the image is gone, so a better
  OCR engine later cannot be run over the same page.
- **`kn.json` has not had a native-speaker review.** The Kannada is machine-produced.

---

## 6. Data

`EvidenceNote`, table `55468000000214044`, created through the Catalyst API rather than from the
function: the deployed credential can read and write **rows** but not change **schema** —
`addColumn` answers `401 OAUTH_SCOPE_MISMATCH` with a valid body, which is a sensible boundary
and not something a different body shape gets around.

| Column | Notes |
|---|---|
| `noteKey` | minted by the API, unique. Catalyst's insert response returns a ROWID the row does not settle at |
| `caseMasterId`, `crimeNo`, `districtId`, `unitId` | from the register, never the body |
| `capability`, `engine`, `confidence` | provenance. A note whose author is "ocr" is a claim with no author |
| `question` | the free-text question, for vision readings |
| `extract` | what the machine read. **The only content stored** |
| `filename`, `imageBytes` | what was read, not the bytes themselves |
| `noteStatus` | `filed` or `withdrawn` |
| `createdBy`, `creatorRole`, `createdAt` | |
| `withdrawnBy`, `withdrawnAt`, `withdrawReason` | |

Audited as `file_evidence_note`, `withdraw_evidence_note` and `evidence_image`, each with a human
label on the Audit page — asserted by a test that enumerates every action the server records.
