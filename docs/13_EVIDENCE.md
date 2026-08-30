# 13 — Evidence: reading the paper an officer is holding, and filing what it says

Every other screen in KADI reads the register. This one reads what has not reached the register
yet — a seizure memo, a notice, a property tag, a photograph of recovered property — and files
the transcription against the case it belongs to.

It is built on one asymmetry, and most of what follows is a consequence of it:

> **The reading is always stored. The photograph only when somebody says to keep it.**

The image is the part carrying whoever else happened to be in frame. The text is the part with
evidentiary value.

This originally said the image was **never** stored. That was too strong, and it cost something
real: a reading nobody can check against its page is a records loss dressed as a privacy win.
The default is unchanged — nothing is kept unless an officer ticks the box — and §7 sets out
what retention actually guarantees.

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

Checked against the deployment:

```
POST /evidence/ocr    DGP 200 · Admin 200 · Analyst 200 · SP 403 · DSP 403 · SHO 403 · SI 403
POST /evidence/note   DGP 200 · Admin 200 · Analyst 200 · SP 403 · DSP 403 · SHO 403 · SI 403
GET  /cases/:id/evidence   own case: all six roles visible
                           other district: DGP ✓ Analyst ✓ · SP ✗ DSP ✗ SHO ✗ SI ✗
```

### The scope check on the read is written here, not inherited

`queries.getCase()` used to carry a comment saying detail was visible "if in scope OR linked
into an in-scope investigation" with **no code implementing it**. Probing found a station SI
able to open case detail in every other district sampled: the register *list* was scoped and
the register *detail* was not. That has since been fixed — `getCase()` now enforces the rule
its comment always described, and the leak this section was written around is closed:

```
GET /cases/:id  as SI (Bengaluru Bazaar PS, 276 cases)
  before: 200 with named victims and accused, districts 2 3 5 7 11 19
  after:  59,709 of 59,709 out-of-scope cases refused, 0 allowed
```

**But this route stays stricter than `getCase()`, and that is the point of the section.** A
filed reading is not a case row — it is a transcription of a photographed document, carrying
property lists, IMEIs and witness names — so `/cases/:id/evidence` calls `rbac.caseInScope`
itself rather than inheriting the case's visibility. Seeing that a case in another district is
*linked* to yours is the product's thesis; reading the seizure memo filed against it is not
part of that thesis, so the linked allowance `getCase()` grants is deliberately not honoured
here. A case that opens with `visibility: 'linked'` returns `visible: false` from this route.

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
| `POST /evidence/note/:id/page` | author (or Admin) — keeps the page |
| `GET /evidence/note/:id/page` | scoped `getCase` + `rbac.caseInScope` — streams the image |
| `POST /evidence/note/:id/reread` | `requireRole(['DGP','Admin','Analyst'])` + scope |

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

## 5. More than one page

A PDF or a set of photographs is rendered page by page **in the browser**, read one page at a
time, and filed as one reading with page markers. A single photograph is a list of one page, so
nothing downstream carries a special case.

A three-page case diary read **3/3 at 98% in 9.1 s**.

- **pdf.js is loaded on the first PDF**, not on every page load. It is about a megabyte and the
  overwhelming majority of readings are a phone photograph that never touches it.
- **Capped at 10 pages**, and the cap is *reported* — a truncated read that presents itself as a
  whole document is the kind of quiet wrongness that ends up in a case file.
- **Two file inputs, not one.** `capture` is ignored the moment the accept list is not purely
  images, so a single input that accepts PDFs silently loses the camera on a phone — the device
  an officer standing over a seizure is actually holding.

### Built assets may not be `.mjs`

Catalyst serves `.js` as `application/javascript` and `.mjs` as `application/octet-stream`, and
a browser refuses to execute an ES module with a non-JavaScript MIME type. pdf.js ships its
worker as `pdf.worker.mjs`, so the page **200s on the worker and then dies** with "failed to
fetch dynamically imported module" — a failure that reads like a missing file and is actually a
content type. `vite.config.ts` renames `.mjs` assets to `.js` on the way out, and a test fails if
any asset is emitted as `.mjs` again.

---

## 6. Reading the same page again

Two different needs, solved two different ways.

**Before filing** the extracted pages stay in memory, so switching engine or asking a new
question costs no second upload. This is what made "Ask about it" worth its name.

**After filing**, only if the page was kept: `POST /evidence/note/:id/reread` runs any reader
over the stored image. A note filed by Zia OCR was put to the vision model and answered
correctly in 666 ms.

A re-read **does not overwrite the original and does not file itself.** It returns what the
second engine said and leaves the officer to file it separately. Comparing two engines on one
page only means something if both readings survive and stay separately attributable.

---

## 7. What retention actually guarantees

| | |
|---|---|
| **Default** | off, on every reading |
| **Choice** | per reading, next to a sentence saying what it means |
| **Scope** | the case's own scope — same check as the transcription |
| **Deletion** | the page is deleted when the reading is withdrawn |
| **Audit** | on write, on read, and on re-read |
| **Never exposed** | the file id. Only *whether* a page exists reaches the browser |

The asymmetry that makes this acceptable: **withdrawing a reading keeps the text and deletes the
photograph.** The text is the record — keeping it is what stops a note being made to have never
existed. The image is the thing this feature never wanted to be holding.

Filing and retention are **separate calls**, deliberately. If retention were part of filing, an
upload that timed out would take a correct transcription down with it and send the officer back
to retyping the memo — the exact problem the feature exists to remove.

### The upload response's file id is wrong

Catalyst's file-upload endpoint returns an id the file does not settle at: it answered
`…205060` for a file that listed as `…205058`. This is the same lie the row-insert endpoint
tells — `submissions.js` documents rows drifting **+3**, this file drifted **−2** — so there is
nothing to correct for.

Rows solved it by minting their own key. A file id belongs to Catalyst and cannot be minted, so
the file is found by **name** instead: the page is uploaded as `<noteKey>.png`, the note key is
unique, and the listing is newest-first.

---

## 8. What this still cannot do

- **No PDF text layer.** Pages are rasterised and OCR'd, so a PDF that already contains text is
  read as a picture of that text rather than having it extracted directly.
- **Only the first page is retained**, not all of them, when a multi-page document is filed.
- **`kn.json` has not had a native-speaker review** — but it can now get one a string at a time.
  See `docs/14_KANNADA.md`.

---

## 9. Data

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
