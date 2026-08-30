# 12 — The assistant: four kinds of answer, and why it does not hallucinate

The assistant answers questions over the case register, the knowledge base, and a document the
officer is holding — in English or Kannada, by typing or by speaking.

It is built on one rule, and everything else here follows from it:

> **The model never retrieves. It only phrases.**

Counts, citations, intents and actions are computed by deterministic code against the register
before any language model is called. The model is handed those facts and asked to write two
sentences. It cannot invent an FIR number because it is never in a position to look one up.

---

## 1. The four sources, and why they are labelled

Every answer carries a badge naming where it came from. This is not decoration: a count from the
register and a definition from the handbook are different kinds of claim, and an officer about to
act on one needs to know which they are reading.

| Badge | Source | Example |
|---|---|---|
| **Computed from the records** (teal) | live query over 59,987 cases | "Which cases are slipping?" |
| **From the knowledge base** (purple) | RAG over 12 indexed documents | "What does a pulsing red zone mean?" |
| **Read from the document supplied** (gold) | one image, in this request only | a photographed seizure memo |
| **Wording by the model** (grey) | GLM-4.7 re-phrased the sentence | appears alongside the others |

The empty state uses the same four groups and the same colours, so the card someone clicked and
the label on what comes back are visibly the same thing.

---

## 2. The routing

```
question (text or speech, en or kn)
  │
  ├─ Kannada?  →  translate to English for ROUTING only          (~140 ms)
  │                the answer is still built in Kannada
  │                the English reading is returned as interpretedAs
  │
  ├─ deterministic intent engine  ──────────────────────────────  (0–15 ms)
  │     case_lookup · cases_query · slipping_cases · offender_history
  │     hotspots · forecast · socio_rates
  │        └─ answer + citations + action, all computed
  │
  ├─ intent 'unknown'?  →  RAG over the knowledge base            (~5 s)
  │
  └─ phrase the computed facts with GLM-4.7                       (1.2–1.7 s)
        deadline 5 s — past it, the computed answer is returned as-is
```

### How a Kannada question is routed

Every intent pattern is written against English phrasing with a handful of Kannada words bolted
on, which covers the wordings someone thought to add and nothing else. So a Kannada question is
also read in English — but the order matters, and it took two attempts to get right.

**The native patterns get first refusal.** When `ಜಾರುತ್ತಿರುವ` matches the slipping pattern, that
is certain: the word is actually there. The translation is consulted only when the native pass
returns `unknown`, or returns the catch-all list branch that any sentence containing `ಪ್ರಕರಣ`
falls into.

Translating *first* was tried and was wrong. Zia renders `ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು ಯಾವುವು?` — which
asks which cases are **slipping** — as *"Active cases"*, dropping the only word carrying the
question. Routing on that sent the reader to the generic list: they asked which cases were in
trouble and were told how many cases exist in the state.

A second fault sat underneath it. Question translation used the shared **UI-string cache**, which
is keyed on text and shared across directions — so a screen label translated *into* Kannada
becomes a reverse entry *out* of it. That is right for forty fixed strings and wrong for free
text. Questions now pass `noCache` and pay the 140 ms. Fixing it moved the Bengaluru cyber-crime
count from **6** to **4337**.

| Kannada question | routes to |
|---|---|
| `ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು ಯಾವುವು?` | `slipping_cases` — native pattern beat the translation |
| `ಬೆಂಗಳೂರಿನಲ್ಲಿ ಸೈಬರ್ ಅಪರಾಧ ಪ್ರಕರಣಗಳು ಎಷ್ಟು?` | `cases_query` |
| `ಮುಂದಿನ ತಿಂಗಳ ಮುನ್ಸೂಚನೆ` | `forecast` |
| `ಉದಯೋನ್ಮುಖ ಅಪರಾಧ ತಾಣಗಳು` | `hotspots` |
| `ಯಾವ ಜಿಲ್ಲೆಯಲ್ಲಿ ತಲಾ ಅಪರಾಧ ದರ ಹೆಚ್ಚು?` | `socio_rates` |

### Answers that are never re-worded

A branch may set `noPhrase`, and the model is then skipped entirely. One case uses it today and
it is the important one:

> Case 100310297202500003 is **not visible in your scope**. That is not the same as it not
> existing — it may be registered in a district this account does not read.

The model reliably flattens that to *"the record does not show any case numbered…"*, which tells
an officer that a case they cannot see is a case that is not there. The distinction is the entire
content of the answer, so it is returned verbatim.

---

## 3. Speech

| Direction | Model | Notes |
|---|---|---|
| In | Zia **Audio-to-Text** | en / hi / kn. Recording is re-encoded to 16 kHz mono WAV in the browser first |
| Out | Zia **Text-to-Audio** | Mary (en), Divya (hi), Anu (kn) — `female[0]` per language |

**The re-encoding is not optional.** MediaRecorder produces WebM/Opus in Chrome and Firefox and
MP4/AAC in Safari; the model accepts WAV and MP3 and rejects everything else with
`INVALID_FILE_EXTENSION`. `OfflineAudioContext` downmixes to mono and resamples to 16 kHz in one
render, then a 16-bit PCM WAV is written by hand.

Verified through the real chain — synthesise speech, play it into a MediaStream, record it with
MediaRecorder, convert, upload:

```
raw webm/opus  40868 B  →  INVALID_FILE_EXTENSION
converted wav  80684 B  →  "which cases are slipping in Mysuru."
```

**Stopping.** `speechSynthesis` *queues* utterances, so a flag set when one starts is cleared when
that one ends while the queue keeps talking. The Stop control is therefore bound to whether sound
is actually happening — polled from `speechSynthesis.speaking || pending` and the server audio
element — not to which message was last started.

---

## 4. Reading a document

`POST /assistant/document` — one image, `Qwen 3.6 35B Vision Language`, temperature **0.1**.

It is for the paper an officer is holding: a seizure memo, a handwritten complaint, a notice, a
plate in a scene photograph. A photographed memo returns in under a second with the FIR number,
station, date and every seized item.

**Two properties matter more than the capability, and both are tested against the deployed model:**

- **It refuses identification.** Not by prompt alone — the phrasings that turn a document reader
  into a face-matching system are rejected *before* the request is made. An identification
  produced by a general vision model, in a police file, is a wrong answer with a uniform behind
  it. It also refuses questions about caste, religion or community.
- **It says when the answer is not there.** Asked for an accused's name and a phone number a memo
  does not contain: *"The document does not show the name or address of the accused… These
  details are not present."* Temperature is 0.1, not the sample's 0.7, so the same photograph
  asked the same question twice cannot produce two different registration numbers.

The image is **not stored**, is **never merged with the register**, and its answers carry their
own badge. Mixing what a photograph says with what the record says into one answer makes the two
indistinguishable, and only one of them is a record.

---

## 5. Scope

Every answer is scoped before any model is reached. The server resolves the reader's tier, runs
the query under it, and only then builds a payload. A station officer asking about a district
they do not read gets the verbatim scope answer above — not a refusal, and not a fabrication.

| Tier | Sees |
|---|---|
| State (DGP, Analyst, Admin) | all 31 districts |
| District (SP, DSP) | their district |
| Station (SHO, SI) | their own register |

---

## 6. Failure behaviour

Every dependency here can fail, and none of them may take the answer down with it.

| Failure | What happens |
|---|---|
| GLM-4.7 slow or down | deadline at 5 s → the computed answer is returned, `llm: 'fallback'` |
| RAG unavailable | the deterministic answer stands |
| TTS unavailable | the text is complete; the interface says read-aloud is unavailable |
| STT unavailable | the reason is shown, typing still works |
| VLM unavailable | said plainly; it never falls back to a text model that cannot see the image |
| Empty HTTP 200 from the platform | the transport retries once, then reports it |

That last one is real and worth recording: the platform intermittently returns `200` with a
zero-byte body. `res.json()` then throws, and the interface used to say "could not be answered"
over an answer that had been computed correctly. It is retried once — the body was not parsed, so
nothing was acted on, and every call through that transport is a read.

---

## 7. What it is not

- **Not a chatbot over the database.** The model cannot query anything. Ask it something outside
  the seven intents and the knowledge base, and it says so.
- **Not an identification system.** No face matching, no naming a person from a photograph.
- **Never uses protected attributes.** Caste, religion and occupation are excluded from every
  model in the project by construction, and a unit test fails the build if one reaches a feature
  set.

---

## 8. Endpoints

| Route | Purpose |
|---|---|
| `POST /assistant/query` | text question → grounded answer, citations, action, timing |
| `POST /assistant/transcribe?lang=` | raw audio bytes → transcript |
| `POST /assistant/document?q=` | raw image bytes → answer about that image |
| `POST /tts` | answer text → WAV |
| `POST /translate` | text → the other language |
| `POST /assistant/export` | conversation → PDF briefing via SmartBrowz |
| `GET /ai/status` | every AI surface, its configuration and its last error |

Diagnostics live at `GET /diag/zia-nlp` (the three NLP models, with a live probe) and
`GET /ai/rag-probe` (retrieval, with request-shape variants).
