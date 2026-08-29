# 14 — Kannada: correcting what the machine wrote

Every Kannada string in KADI was written by a model. There are **1,167** of them and not one had
been read by a Kannada speaker before it shipped.

That was listed as a known limitation, which is honest and does exactly nothing about it:

> A limitation that can only be fixed by an offline review nobody has scheduled is a limitation
> that stays.

So the fix is not to find a reviewer. It is to make the review something that can happen **a
sentence at a time**, by the officers already reading the Kannada interface, at the moment they
notice a word is wrong. That is the only version of this review that ever actually happens.

---

## 1. Four layers, in order of authority

| Layer | Written by | Where |
|---|---|---|
| **Corrections** | a person, with a name attached | `TranslationFix`, fetched at startup |
| `DICT` | a model, curated and committed | `i18n.ts` — the navigation labels |
| `kn.json` | a model, built offline | 1,133 strings, committed |
| runtime | a model, on demand | `/translate`, cached per browser |

```js
const hit = fixes[text] || BUILT[text] || runtime[text];
```

**A correction always starts from a string one of the machine layers already holds** — so if
`fixes` were not first in that chain, every correction would be dead on arrival. There is a test
asserting the order.

### Corrections reach the navigation layer too

`DICT` is only ~70 entries against `kn.json`'s 1,133, but it holds the **navigation labels** —
the Kannada every officer sees on every screen. `tr()` consults corrections keyed by the entry's
*English*, so one correction covers both layers.

Correcting "Evidence" and watching the sidebar keep the machine's word is exactly how somebody
concludes the review screen does not work. It was the first thing this got wrong.

### And they are in the reverse map

Switching back to English works by looking up the Kannada on screen and restoring its English. A
corrected string missing from `reverseKn()` would be Kannada that map has never seen, and it
would stay Kannada while everything around it turned over.

---

## 2. What a correction is

| | |
|---|---|
| **Who may write one** | any signed-in officer |
| **When it applies** | immediately, for everyone |
| **What replaces approval** | attribution and history |
| **What is stored** | the new Kannada, what the machine had said, and optionally why |
| **Editing** | none — a correction *supersedes*, both rows stay |
| **Undo** | any string can be put back to the machine wording |

**Any signed-in officer, deliberately.** The people reading the Kannada interface all day are
station officers, and they are the ones who know that a word is a technically correct translation
and not what anybody in a police station actually calls that thing. Restricting this to
administrators would restrict it to the people least likely to use the Kannada UI.

**No approval queue, deliberately.** A queue for interface wording becomes the bottleneck the
review dies in — and unlike a case record, a label is not a claim about a person.

Live example:

```
"Evidence"   machine: ಸಾಕ್ಷ್ಯ   →   corrected: ಸಾಕ್ಷ್ಯಾಧಾರ
             by U-SI (SI) — "what a station actually writes on the register"
```

A Latin-script "correction" is somebody typing in the wrong box, and is refused: the text must
contain at least one character in U+0C80–U+0CFF.

---

## 3. The routes

| Route | Notes |
|---|---|
| `GET /translations/overrides` | the map the interface lays over its dictionary |
| `POST /translations` | write a correction |
| `POST /translations/revert` | back to the machine wording |
| `GET /translations/history?source=` | every correction ever written for one string |
| `GET /translations/recent` | the latest across all strings |

### The source string is a key, and is never trimmed

Every other field is something a person typed and should be tidied. The source is a **lookup
key** and has to survive byte for byte — the interface looks a string up by its exact text, so a
correction stored against a trimmed copy of a string with surrounding whitespace would be saved,
reported as saved, and match nothing. Caught by a test whose fixture ends in a space.

### Keyed by hash, not by text

Catalyst capped the `sourceText` column at 255 characters and the longest interface copy is well
past that — and long paragraphs are exactly where machine translation goes wrong most, so keying
on the truncated column would exclude the strings that most need review. The full English lives
in a text column and is matched on its SHA256.

### ZCQL refuses any `LIMIT` above 300

It answers `ZCQL CANNOT HAVE MORE THAN 300 ROWS in LIMIT` — an **error, not a truncation** — so
the whole query returns nothing. `LIMIT offset, count` works, so `overrides()` pages.

This is also a bug it turned up elsewhere: `audit.js` clamped to 500, so `/audit?limit=400` fell
through to the in-memory buffer and served **one row**. Asking for more history quietly gave
less, which is the worst way for an audit log to be wrong. A test now fails on any ZCQL `LIMIT`
above 300.

---

## 4. The review screen

`/kannada`, reached from the icon beside the language toggle in the top bar — not from the
workspace rail.

Correcting the machine's Kannada is not a feature of the product; it is a tool for maintaining
one. A place in the rail beside Cases and Offenders would advertise it as something an officer
does as part of the job. It is also where somebody is standing at the moment they need it: you
notice a bad translation right after switching the language.

- English above Kannada, stacked rather than in columns — the two scripts have very different
  line lengths and a two-column layout leaves one side ragged at every width worth supporting.
- Search across the English, the machine Kannada and the corrections.
- Filter to *not yet reviewed* or *corrected*.
- Progress as a **fraction, not a bar**. 1,167 strings and one reviewed is the honest picture; a
  bar at 0.1% invites nobody, and a count invites somebody to make it one higher.

### The specimens carry `data-notranslate`

Essential rather than tidy. The rows are **specimens under review, not interface copy** — without
it the page translator renders the English source into Kannada and the reviewer is shown Kannada
above Kannada with nothing to compare, which is the one thing this screen exists to let them do.
It shipped that way for one deploy.

---

## 5. A bug this turned up: the translator never stopped

Switching to English left the page rendering Kannada and quietly accumulating fresh runtime
translations — 431 of them in English mode.

`schedule()` armed a `setTimeout` the cleanup never cleared, and `run()` **ends by calling
`observer.observe()`**. So a single timer left in flight when the language switched re-attached
the observer that cleanup had just disconnected, and every later mutation was translated back
into Kannada. The effect reported English and rendered Kannada.

Fixed by keeping the timer handle and a `cancelled` flag, both cleared on teardown. After it:

```
nav in Kannada  →  toggle  →  every label English
                              1 Kannada run left on the page: the ಕನ್ನಡ button itself
```

---

## 6. What is still true

The Kannada is still **machine-written** — that has not changed, and this screen does not
pretend otherwise. What has changed is that the review is now possible, incremental, attributed,
reversible, and visible to everyone doing it.

`0.1%` of the interface has been read by a person. The number is on the screen.
