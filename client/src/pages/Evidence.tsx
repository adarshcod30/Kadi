// Evidence — reading the paper and photographs an officer is holding, and filing what was read.
//
// WHY THIS SCREEN EXISTS. Everything else in KADI reads the register. This reads what has not
// reached the register yet: a seizure memo, a notice, a photograph of recovered property. The
// gap between "this is in my hand" and "this is in the record" is where an hour of a shift
// goes, and it is the one place a vision model earns its keep without being asked to judge
// anybody.
//
// THE READING IS ONLY HALF THE JOB. For its first version this screen transcribed a memo
// perfectly and then dropped it on the floor — the officer still had to retype it somewhere
// else, so the whole thing demonstrated a capability rather than saving anyone a minute. A
// reading can now be FILED against a case, which is what makes this a step in a day's work.
//
// WHAT GETS STORED: always the transcription, and the photograph only when the officer ticks
// the box saying to keep it. The image is the part carrying whoever else was in frame, so not
// keeping it stays the default — but "never" was too strong a rule, because a reading nobody
// can check against its page is a records loss dressed as a privacy win. Retention is a
// decision, deleted with the note, and never a behaviour.
//
// A DOCUMENT IS NOT ALWAYS ONE PAGE. A PDF or a set of photographs is read page by page and
// filed as one reading, and the pages stay in memory afterwards so a second engine or a better
// question costs no second upload.
//
// WHAT IS ON THIS PAGE IS WHAT ACTUALLY ANSWERED. Zia's image services were probed rather than
// read about, because the console documents them through SDK samples and the SDK returns 401
// on this project. Of the five, two answer: OCR and the barcode scanner. Object recognition and
// the identity scanner return 404 on every REST path tried, and face detection reaches an
// endpoint that then returns ZIA_ERROR on both a text image and a face. Those three are stated
// as unavailable rather than mocked — a screen that fakes a capability in front of a police
// officer is worse than a screen that does less.
//
// THERE IS NO FACE MATCHING HERE, AND THERE WILL NOT BE. Zia offers no 1:N face search, this
// corpus carries no photographs, and a "match" assembled from neither would be a fabricated
// identification handed to someone with arrest powers. Counting the people in a scene is a
// contemporaneous note; naming them is an accusation.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileImage, ScanLine, ScanText, Sparkles, AlertTriangle, Upload, Loader2,
  Paperclip, Search, Check, X, MessageSquareText, History, Undo2, RefreshCw, Archive, Camera,
} from 'lucide-react';
import { Section, Empty, Mono } from '../components/ui';
import { InfoDot } from '../components/InfoDot';
import { API_BASE } from '../lib/api';
import { toPages, joinPages, MAX_PAGES, type Page } from '../lib/pages';
import {
  useMe, useCases, useFileEvidenceNote, useMyEvidenceNotes, useWithdrawEvidenceNote,
  useRereadEvidencePage,
} from '../api/hooks';
import { useTx } from '../lib/i18n';

type Tool = 'ocr' | 'barcode' | 'read';

const TOOLS: { key: Tool; icon: any; title: string; blurb: string; engine: string }[] = [
  {
    key: 'ocr',
    icon: ScanText,
    title: 'Read the text',
    blurb: 'Every character on the page, printed or handwritten, with a confidence score.',
    engine: 'Zia OCR',
  },
  {
    key: 'read',
    icon: Sparkles,
    title: 'Ask about it',
    blurb: 'Put your own question to the document or photograph — what it is, which fields it carries, what is visible in the scene.',
    engine: 'Qwen 3.6 vision',
  },
  {
    key: 'barcode',
    icon: ScanLine,
    title: 'Scan a code',
    blurb: 'A barcode or QR code on a property tag, a seized carton, a notice.',
    engine: 'Zia barcode scanner',
  },
];

// The question the vision reader is asked when the officer has not written their own. It is a
// starting point in an editable box rather than a hidden constant, because the previous
// version sent exactly one canned prompt and called the tool "Ask about it" — which was a
// promise the screen did not keep.
const DEFAULT_ASK = 'What is this document, and what fields does it carry? If it is a '
  + 'photograph rather than a document, describe what is visible. Do not identify anyone.';

// Written for the questions an officer standing over a seizure actually has, not to show off
// the model. Each one puts a different demand on it: a field extraction, a legibility
// judgement, a count, a verbatim read.
const SUGGESTED = [
  'List every field on this form with its value, one per line.',
  'What is the FIR number, the date, and the police station on this page?',
  'Read the handwritten portion only. Mark anything you cannot make out.',
  'What property is listed here, with quantities and any serial or registration marks?',
  'How many people are visible in this photograph? Do not identify anyone.',
];

export default function Evidence() {
  const tx = useTx();
  const { data: me } = useMe();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const [tool, setTool] = useState<Tool>('ocr');
  const [ask, setAsk] = useState(DEFAULT_ASK);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string>('');
  const [bytes, setBytes] = useState<number>(0);
  // THE PAGES ARE KEPT IN STATE, AND THAT IS THE WHOLE RE-READ FEATURE. Before this, an officer
  // who ran OCR and then wanted to ask the vision model a question had to find and upload the
  // same file a second time. Holding the extracted pages means switching tools re-runs on what
  // is already here.
  const [pages, setPages] = useState<Page[]>([]);
  const [dropped, setDropped] = useState(0);
  const [readWith, setReadWith] = useState<Tool | null>(null);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [perPage, setPerPage] = useState<{ label: string; text: string; ok: boolean }[]>([]);
  const [result, setResult] = useState<
    { ok: boolean; text: string; meta?: string; engine: string; confidence?: string; refused?: boolean } | null
  >(null);

  // Read one page with the current tool. Returns the reading rather than setting state, so the
  // multi-page loop can collect them.
  const readPage = async (page: Page, spec: typeof TOOLS[number]) => {
    // The document reader is a different service from the Zia image tools, so it is a different
    // route. Both take raw bytes for the same reason: base64 in JSON would cost a third more
    // bytes and the global parser is capped well below an image.
    const url = spec.key === 'read'
      ? `${API_BASE}/assistant/document?q=${encodeURIComponent(ask.trim() || DEFAULT_ASK)}`
      : `${API_BASE}/evidence/${spec.key}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': page.mime },
      body: page.blob,
    });
    const j = await r.json();
    const d = j?.data || {};
    if (spec.key === 'read') {
      if (d.refused) return { ok: false, refused: true, text: d.answer, ms: 0 };
      if (d.ok) return { ok: true, text: String(d.answer), ms: d.ms };
      return { ok: false, text: String(d.detail || tx('The document reader is unavailable right now.')), ms: 0 };
    }
    if (d.ok) {
      const inner = d.data?.data || d.data || {};
      // The barcode scanner answers `content: ""` for a page with no code, which is correct and
      // falsy — so a plain `||` chain falls through and shows the officer `{"content":""}`.
      // A reader who is handed raw JSON in place of a finding will paste raw JSON into a file.
      const found = inner.text != null ? String(inner.text)
        : (inner.content != null ? String(inner.content) : null);
      const text = found !== null
        ? (found.trim() || tx('No code found on this page.'))
        : (Array.isArray(inner) ? inner.join('\n') : JSON.stringify(inner, null, 2));
      return {
        // An empty scan is answered, but there is nothing in it to file — so it reports as a
        // reading that succeeded and produced no content, and the filing panel stays away.
        ok: found === null || Boolean(found.trim()),
        text: String(text),
        ms: d.ms,
        confidence: inner.confidence != null ? String(inner.confidence) : undefined,
      };
    }
    return { ok: false, text: String(d.detail || 'unavailable'), ms: 0 };
  };

  // Read every page with the given tool. Called both on a fresh upload and on "read again with"
  // — the second path passes the pages already in state and touches no file input.
  const readAll = async (list: Page[], tool_: Tool) => {
    const spec = TOOLS.find((t) => t.key === tool_)!;
    setBusy(true);
    setResult(null);
    setPerPage([]);
    setReadWith(tool_);
    const readings: { label: string; text: string; ok: boolean; ms: number; confidence?: string }[] = [];
    try {
      for (let i = 0; i < list.length; i += 1) {
        setProgress({ at: i + 1, of: list.length });
        // Sequential on purpose. Firing ten pages at the readers in parallel is ten concurrent
        // model calls from one officer pressing one button, and the per-page progress below is
        // only meaningful if the pages actually finish in order.
        // eslint-disable-next-line no-await-in-loop
        const out = await readPage(list[i], spec);
        readings.push({ label: list[i].label, ...out } as any);
        setPerPage(readings.map((x) => ({ label: x.label, text: x.text, ok: x.ok })));
      }
      const anyOk = readings.some((x) => x.ok);
      const refused = readings.length === 1 && (readings[0] as any).refused;
      const conf = readings.find((x) => x.confidence)?.confidence;
      setResult({
        ok: anyOk,
        refused: Boolean(refused),
        text: joinPages(readings),
        confidence: conf,
        engine: spec.engine,
        meta: [
          list.length > 1 ? `${readings.filter((x) => x.ok).length}/${list.length} ${tx('pages read')}` : null,
          conf ? `${conf}% ${tx('confidence')}` : null,
          `${readings.reduce((a, x) => a + (x.ms || 0), 0)} ms`,
        ].filter(Boolean).join(' · '),
      });
    } catch (e: any) {
      setResult({ ok: false, text: e?.message || tx('The request failed.'), engine: spec.engine });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // A fresh selection: one photograph, several photographs, or a PDF.
  const take = async (files: FileList | File[] | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    setResult(null);
    setPerPage([]);
    try {
      const extracted = await toPages(list);
      if (!extracted.pages.length) throw new Error(tx('Nothing readable in that selection.'));
      setPages(extracted.pages);
      setDropped(extracted.dropped);
      setBytes(extracted.pages.reduce((a, p) => a + p.blob.size, 0));
      setName(list.length === 1 ? list[0].name : `${list.length} ${tx('files')}`);
      setPreview(URL.createObjectURL(extracted.pages[0].blob));
      setBusy(false);
      await readAll(extracted.pages, tool);
    } catch (e: any) {
      setBusy(false);
      setPages([]);
      setResult({ ok: false, text: e?.message || tx('That file could not be opened.'), engine: '' });
    }
  };

  // The server refuses this to anyone below state tier. Saying so here means a district
  // officer who follows a link gets an explanation rather than three tools that 403.
  const allowed = ['DGP', 'Admin', 'Analyst'].includes(String((me as any)?.user?.role || ''));
  if (me && !allowed) {
    return (
      <Empty
        title={tx('Evidence reading is restricted')}
        hint={tx('Reading an uploaded image is a state-tier permission — Administrator, DGP or SCRB Analyst. Readings filed against a case stay visible to that case’s own station, at your normal scope.')}
      />
    );
  }

  const spec = TOOLS.find((t) => t.key === tool)!;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          {tx('Evidence')}
          {/* The info affordance every other screen carries. What this reads, where the answer
              comes from, what happens to it afterwards, and — the part that matters on a page
              about photographs — what it refuses to do. */}
          <InfoDot width="w-[26rem]">
            <b className="block mb-1 text-kadi-navy">What this screen is for</b>
            Every other screen in KADI reads the register. This one reads what has not reached
            the register yet: a memo, a notice, a photograph of recovered property. The answer
            comes from the image in front of you and is never mixed with the case database.
            <b className="block mt-1.5 text-kadi-navy">What answers each question</b>
            Text extraction is Zia OCR. Codes are Zia&apos;s barcode scanner. Your own questions
            go to the Qwen 3.6 vision model, which is told to say when the image does not show
            the answer rather than guessing a number it cannot read.
            <b className="block mt-1.5 text-kadi-navy">What is stored, and what is not</b>
            Filing a reading against a case stores the TEXT. The photograph is never stored —
            it is the part carrying whoever else was in frame, and it has no evidentiary value
            the transcription lacks. A filed reading is visible to the station whose register
            holds that case, and can be withdrawn but never deleted.
            <b className="block mt-1.5 text-kadi-navy">There is no face matching here</b>
            Not as a limitation to be lifted later — as a decision. Zia offers no face search,
            this corpus holds no photographs of people, and a match assembled from neither would
            be a fabricated identification handed to someone with arrest powers. Counting the
            people in a scene is a contemporaneous note; naming them is an accusation.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">
          {tx('Read a document or photograph you are holding, then file what it says against the case it belongs to.')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {TOOLS.map((t) => (
          <button key={t.key} disabled={busy}
            onClick={() => {
              setTool(t.key);
              // Pages already in hand: switch and read them again, no second upload. The
              // vision reader is the exception -- its question box appears first, so the
              // officer writes the question and presses the button below rather than having a
              // default question fired at their page the moment they change tool.
              if (pages.length && t.key !== 'read') readAll(pages, t.key);
            }}
            aria-pressed={tool === t.key}
            className={`relative text-left rounded-card border p-4 pl-5 transition-all duration-150 ${
              tool === t.key ? 'bg-surface border-kadi-navy/25 shadow-hover' : 'bg-surface-2 border-line hover:bg-surface'}`}>
            <span className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-card ${tool === t.key ? 'bg-kadi-navy' : 'bg-transparent'}`} />
            <div className="flex items-center gap-2">
              <t.icon size={15} className={tool === t.key ? 'text-kadi-navy' : 'text-ink-muted'} />
              <span className={`text-[13.5px] font-semibold ${tool === t.key ? 'text-kadi-navy' : 'text-ink'}`}>{tx(t.title)}</span>
            </div>
            <p className="text-[12px] text-ink-muted mt-1.5 leading-snug">{tx(t.blurb)}</p>
            <div className="text-[11px] text-ink-subtle mt-2">{t.engine}</div>
          </button>
        ))}
      </div>

      {/* The question box, shown only for the tool that takes one. A textarea rather than a
          single-line input because these questions run long, and pre-filled rather than blank
          because a blank box in front of a model nobody has used before produces "what is
          this" and a disappointing answer. */}
      {tool === 'read' && (
        <Section title={<span className="flex items-center gap-2">
          <MessageSquareText size={15} className="text-kadi-blue" /> {tx('Your question')}
        </span>}>
          <div className="p-4 space-y-2.5">
            <textarea
              className="input w-full text-[13px] leading-relaxed min-h-[4.5rem] resize-y"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder={DEFAULT_ASK}
              aria-label={tx('Your question')} />
            <div className="flex items-center gap-1.5 flex-wrap">
              {SUGGESTED.map((s) => (
                <button key={s} onClick={() => setAsk(s)}
                  className="chip border border-line bg-surface-2 hover:bg-surface-3 text-[11px] text-ink-muted text-left">
                  {tx(s)}
                </button>
              ))}
              {ask !== DEFAULT_ASK && (
                <button onClick={() => setAsk(DEFAULT_ASK)}
                  className="chip border border-line text-[11px] text-ink-subtle hover:text-ink">
                  {tx('Reset')}
                </button>
              )}
            </div>
            <p className="text-[11.5px] text-ink-subtle">
              {tx('The model answers only from the image and is told to say what is missing rather than guess a number it cannot read. It will refuse to identify anyone.')}
            </p>
            {/* The page is already in hand, so a new question does not need a new upload. This
                is the button that makes the question box worth having: an officer reads the
                memo, thinks of a better question, and asks it against the same page. */}
            {pages.length > 0 && (
              <button onClick={() => readAll(pages, 'read')} disabled={busy}
                className="btn-primary text-[12.5px] disabled:opacity-40">
                {busy
                  ? <><Loader2 size={14} className="animate-spin" /> {tx('Reading…')}</>
                  : <><RefreshCw size={14} /> {tx('Ask this of the page already loaded')}</>}
              </button>
            )}
          </div>
        </Section>
      )}

      <Section title={<span className="flex items-center gap-2">
        <FileImage size={15} className="text-kadi-blue" /> {tx('The image')}
        {name && <span className="text-[12px] font-normal text-ink-subtle truncate max-w-[16rem]">{name}</span>}
      </span>}>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
            {/* A second, camera-only input. One input cannot both accept a PDF and open the
                camera: `capture` is ignored the moment the accept list is not purely images,
                so putting them together silently loses the camera on a phone -- which is the
                device an officer standing over a seizure is actually holding. */}
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
            {/* Drop target as well as a button. An officer at a desk has the photograph in a
                folder already; making them go through a file dialog for it is a step that
                exists only because nobody wired the two events. */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
              className={`btn-outline w-full justify-center h-32 border-dashed disabled:opacity-50 transition-colors ${
                dragging ? 'bg-kadi-blue/10 border-kadi-blue text-kadi-navy' : ''}`}>
              {busy
                ? (
                  <><Loader2 size={16} className="animate-spin" />
                    {progress && progress.of > 1
                      ? `${tx('Reading page')} ${progress.at}/${progress.of}…`
                      : tx('Reading…')}</>
                )
                : dragging
                  ? <><Upload size={16} /> {tx('Drop it here')}</>
                  : <><Upload size={16} /> {tx('Choose images or a PDF, or drag them here')}</>}
            </button>
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => camRef.current?.click()} disabled={busy}
                className="btn-outline text-[12px] py-1 disabled:opacity-40">
                <Camera size={13} /> {tx('Use the camera')}
              </button>
              <span className="text-[11px] text-ink-subtle">
                {tx('Up to')} {MAX_PAGES} {tx('pages per reading.')}
              </span>
            </div>
            {dropped > 0 && (
              <p className="text-[11.5px] text-warning mt-2">
                {tx('Only the first')} {MAX_PAGES} {tx('pages were read.')} {dropped} {tx('more were left out — read them as a second document.')}
              </p>
            )}
            {preview && (
              <img src={preview} alt={tx('The image being read')}
                className="mt-3 w-full rounded-card border border-line object-contain max-h-64 bg-surface-2" />
            )}
            {pages.length > 1 && (
              <p className="text-[11.5px] text-ink-subtle mt-1.5">
                {pages.length} {tx('pages. The preview shows the first.')}
              </p>
            )}
          </div>

          <div>
            {!result && !busy && (
              <Empty title={tx('Nothing read yet')}
                hint={tx('Choose a tool above, then photograph, upload or drag in the page.')} />
            )}
            {result && (
              <div>
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] mb-2">
                  <span className={`chip border ${result.ok
                    ? 'bg-kadi-gold/25 text-ink border-kadi-gold/40'
                    : 'bg-surface-3 text-ink-muted border-line'}`}>
                    {result.ok ? tx('Read from the image you supplied')
                      : result.refused ? tx('Refused') : tx('Not answered')}
                  </span>
                  {result.engine && <span className="text-ink-subtle">{result.engine}</span>}
                  {result.meta && <span className="text-ink-subtle font-num">{result.meta}</span>}
                </div>
                <pre className={`text-[12.5px] whitespace-pre-wrap leading-relaxed rounded-ctl border border-line p-3 max-h-80 overflow-y-auto ${
                  result.ok ? 'bg-surface-2 text-ink' : 'bg-surface-2 text-ink-muted'}`}>
                  {result.text}
                </pre>
                {/* Which pages answered, named. On a multi-page read the joined text above
                    carries page markers, but a page that failed is easy to miss inside 3000
                    characters -- and "page 4 was not read" is the one thing a reader must not
                    discover later. */}
                {perPage.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {perPage.map((pp) => (
                      <span key={pp.label}
                        className={`chip border text-[10.5px] ${pp.ok
                          ? 'bg-surface-2 border-line text-ink-muted'
                          : 'bg-surface-3 border-warning/40 text-warning'}`}>
                        {pp.ok ? <Check size={10} className="mr-1" /> : <X size={10} className="mr-1" />}
                        {pp.label}
                      </span>
                    ))}
                  </div>
                )}
                {/* Read the same pages with a different engine. No re-upload, and both readings
                    stay comparable because this replaces nothing that was filed. */}
                {pages.length > 0 && !busy && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-2.5 text-[11.5px]">
                    <span className="text-ink-subtle">{tx('Read again with')}</span>
                    {TOOLS.filter((t) => t.key !== readWith).map((t) => (
                      <button key={t.key} onClick={() => { setTool(t.key); readAll(pages, t.key); }}
                        className="chip border border-line bg-surface-2 hover:bg-surface-3 text-ink-muted">
                        <RefreshCw size={10} className="mr-1" />{t.engine}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* The half that turns a viewer into a tool. Only offered on a reading that actually
          said something — filing a blank barcode scan would put an empty entry on a case that
          a later reader has to open to discover says nothing. */}
      {result?.ok && result.text.trim() && (
        <FileAgainstCase
          key={readWith || tool}
          capability={readWith || tool}
          engine={spec.engine}
          extract={result.text}
          question={(readWith || tool) === 'read' ? (ask.trim() || DEFAULT_ASK) : ''}
          confidence={result.confidence}
          filename={name}
          bytes={bytes}
          pages={pages}
        />
      )}

      <FiledLately />

      {/* Stated, not hidden. Three of Zia's five image services do not answer on this
          deployment, and a reader who sees three tools where the platform advertises five
          should be told why rather than left to assume they were not bothered with. */}
      <Section title={<span className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-warning" /> {tx('What this deployment cannot do')}
      </span>}>
        <div className="p-4 space-y-2 text-[12.5px] text-ink-muted">
          <p>
            {tx('Zia lists five image services. Two answer here and are on this page. The others were tried, not skipped:')}
          </p>
          <div className="space-y-1.5">
            <div><b className="text-ink">Object recognition</b> — {tx('every REST path tried returns 404 on this project. The vision model above covers the same ground and is used instead.')}</div>
            <div><b className="text-ink">Identity scanner</b> — {tx('same: no reachable REST endpoint.')}</div>
            <div><b className="text-ink">Face detection</b> — {tx('the endpoint exists and returns ZIA_ERROR on every image tried, including one containing a face. Left off rather than shipped as a control that fails.')}</div>
            <div><b className="text-ink">Multi-page documents</b> — {tx('one image per reading. A PDF or a multi-page case diary has to be exported page by page.')}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ---- filing --------------------------------------------------------------------------------
// The case is chosen by searching the register rather than typed as a free-text id. An
// eighteen-digit crime number typed from memory is a transcription error waiting to attach a
// seizure memo to the wrong case, and the search already matches on crime number.
function FileAgainstCase(props: {
  capability: Tool; engine: string; extract: string; question: string;
  confidence?: string; filename: string; bytes: number; pages: Page[];
}) {
  const tx = useTx();
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<{ caseMasterId: string; crimeNo: string } | null>(null);
  const [filed, setFiled] = useState<{ id: string; caseMasterId: string; crimeNo: string | null; kept: boolean } | null>(null);
  // OFF BY DEFAULT, AND IT HAS TO BE. The photograph carries whoever else was in frame; the
  // transcription does not. Keeping it is sometimes right and is never the thing that happens
  // because nobody looked at the box.
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState('');
  const search = useCases({ search: term, pageSize: 6 });
  const post = useFileEvidenceNote();

  const rows = term.trim().length >= 2 ? ((search.data as any)?.items || []) : [];

  const submit = async () => {
    if (!picked) return;
    setError('');
    try {
      const out = await post.mutateAsync({
        caseMasterId: picked.caseMasterId,
        capability: props.capability,
        engine: props.engine,
        extract: props.extract,
        question: props.question,
        confidence: props.confidence || '',
        filename: props.filename,
        bytes: String(props.bytes),
        pageCount: String(props.pages.length || 1),
      });
      // The page goes up SECOND, and a failure here does not fail the filing. The reading is
      // the record; the page is a convenience. An officer whose upload timed out should have a
      // filed transcription and a note that the page was not kept, not be sent back to retype
      // the memo.
      let kept = false;
      if (keep && props.pages.length) {
        const first = props.pages[0];
        const r = await fetch(`${API_BASE}/evidence/note/${out.id}/page`, {
          method: 'POST', headers: { 'Content-Type': first.mime }, body: first.blob,
        }).catch(() => null);
        kept = Boolean(r && r.ok);
      }
      setFiled({ id: out.id, caseMasterId: out.caseMasterId, crimeNo: out.crimeNo, kept });
    } catch (e: any) {
      setError(e?.message || tx('Could not file the reading.'));
    }
  };

  if (filed) {
    return (
      <Section title={<span className="flex items-center gap-2">
        <Check size={15} className="text-good" /> {tx('Filed')}
      </span>}>
        <div className="p-4 text-[13px] text-ink flex items-center gap-2 flex-wrap">
          <span>{tx('This reading is now on crime no.')}</span>
          <Mono>{filed.crimeNo || filed.caseMasterId}</Mono>
          <Link to={`/cases/${encodeURIComponent(filed.caseMasterId)}`} className="btn-outline text-[12px] py-1">
            {tx('Open the case')}
          </Link>
          <span className="text-ink-subtle text-[12px]">
            {filed.kept
              ? tx('The page was kept with it, so the reading can be checked against it later.')
              : tx('The station that registered it can read this without access to the image.')}
          </span>
          {keep && !filed.kept && (
            <span className="text-warning text-[12px]">
              {tx('The page itself could not be kept. The reading is filed.')}
            </span>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section title={<span className="flex items-center gap-2">
      <Paperclip size={15} className="text-kadi-blue" /> {tx('File this against a case')}
    </span>}>
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            className="input w-full pl-8 text-[13px]"
            value={picked ? (picked.crimeNo || picked.caseMasterId) : term}
            onChange={(e) => { setPicked(null); setTerm(e.target.value); }}
            placeholder={tx('Crime number, station, or a word from the FIR')}
            aria-label={tx('Find the case')} />
          {picked && (
            <button onClick={() => { setPicked(null); setTerm(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
              aria-label={tx('Choose a different case')}>
              <X size={14} />
            </button>
          )}
        </div>

        {!picked && rows.length > 0 && (
          <div className="rounded-ctl border border-line divide-y divide-line overflow-hidden">
            {rows.map((c: any) => (
              <button key={c.caseMasterId}
                onClick={() => setPicked({ caseMasterId: c.caseMasterId, crimeNo: c.crimeNo })}
                className="w-full text-left px-3 py-2 hover:bg-surface-2 transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-ink">{c.crimeNo}</span>
                  <span className="text-[12px] text-ink-muted">{c.crimeSubHead || c.crimeHead}</span>
                </div>
                <div className="text-[11px] text-ink-subtle">
                  {[c.unitName, c.districtName, c.crimeRegisteredDate].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        )}
        {!picked && term.trim().length >= 2 && !search.isFetching && rows.length === 0 && (
          <p className="text-[12px] text-ink-subtle">{tx('No case in your scope matches that.')}</p>
        )}

        {error && <p className="text-[12px] text-bad">{error}</p>}

        {/* The retention choice, stated in full rather than as a bare label. This is the one
            control on the screen that changes what the system holds about people who are not
            the subject of the case, so it says so. */}
        <label className="flex items-start gap-2 rounded-ctl border border-line bg-surface-2 p-3 cursor-pointer">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)}
            className="mt-0.5 accent-kadi-navy" />
          <span className="text-[12px] leading-snug">
            <b className="text-ink flex items-center gap-1.5">
              <Archive size={12} /> {tx('Keep the page image as well as the reading')}
            </b>
            <span className="text-ink-muted">
              {tx('Off by default. The reading is always stored; the photograph normally is not, because it carries whoever else was in frame. Keep it when the reading will need checking against the page — it can then be read again by a different engine, it is visible only at this case’s scope, and it is deleted if the reading is withdrawn.')}
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={submit} disabled={!picked || post.isPending}
            className="btn-primary text-[12.5px] disabled:opacity-40">
            {post.isPending
              ? <><Loader2 size={14} className="animate-spin" /> {tx('Filing…')}</>
              : <><Paperclip size={14} /> {tx('File the reading')}</>}
          </button>
          <span className="text-[11.5px] text-ink-subtle">
            {props.pages.length > 1
              ? `${props.pages.length} ${tx('pages, filed as one reading.')}`
              : tx('Stores the text.')}
            {keep ? ` ${tx('The first page is kept too.')}` : ` ${tx('The photograph is not kept.')}`}
          </span>
        </div>
      </div>
    </Section>
  );
}

// ---- what this officer filed lately --------------------------------------------------------
// Proof the loop closed, on the same screen that closed it. Without this the officer files a
// reading and has to navigate to a case to confirm anything happened.
function FiledLately() {
  const tx = useTx();
  const { data, refetch } = useMyEvidenceNotes();
  const withdraw = useWithdrawEvidenceNote();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const items = data?.items || [];
  if (!items.length) return null;

  const doWithdraw = async (id: string) => {
    await withdraw.mutateAsync({ id, reason }).catch(() => null);
    setOpen(null); setReason('');
    refetch();
  };

  return (
    <Section title={<span className="flex items-center gap-2">
      <History size={15} className="text-kadi-blue" /> {tx('Readings you have filed')}
    </span>}>
      <div className="divide-y divide-line">
        {items.map((n) => (
          <div key={n.id} className="px-4 py-2.5">
            <div className="flex items-start gap-2 flex-wrap">
              <Link to={`/cases/${encodeURIComponent(n.caseMasterId)}`}
                className="font-mono text-[12px] text-kadi-blue hover:underline">
                {n.crimeNo || n.caseMasterId}
              </Link>
              <span className="chip border border-line bg-surface-2 text-[10.5px] text-ink-muted">
                {tx(n.capabilityLabel)}
              </span>
              <span className="text-[11px] text-ink-subtle">{n.engine}</span>
              <span className="text-[11px] text-ink-subtle ml-auto">
                {new Date(n.createdAt).toLocaleString('en-IN')}
              </span>
            </div>
            <p className="text-[12px] text-ink-muted mt-1 line-clamp-2">{n.extract}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10.5px]">
              {n.pages > 1 && (
                <span className="chip border border-line bg-surface-2 text-ink-subtle">
                  {n.pages} {tx('pages')}
                </span>
              )}
              {n.retained && (
                <span className="chip border border-kadi-teal/40 bg-kadi-teal/10 text-ink-muted">
                  <Archive size={10} className="mr-1" />{tx('page kept')}
                </span>
              )}
              {n.rereads > 0 && (
                <span className="text-ink-subtle">{tx('read again')} {n.rereads}×</span>
              )}
            </div>
            {n.retained && <Reread noteId={n.id} onDone={refetch} />}
            {open === n.id ? (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input className="input text-[12px] flex-1 min-w-[12rem]" value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={tx('Why is it being withdrawn?')} />
                <button className="btn-outline text-[12px] py-1" disabled={reason.trim().length < 5}
                  onClick={() => doWithdraw(n.id)}>{tx('Withdraw')}</button>
                <button className="text-[12px] text-ink-subtle hover:text-ink"
                  onClick={() => { setOpen(null); setReason(''); }}>{tx('Cancel')}</button>
              </div>
            ) : (
              <button onClick={() => setOpen(n.id)}
                className="mt-1 text-[11.5px] text-ink-subtle hover:text-ink inline-flex items-center gap-1">
                <Undo2 size={12} /> {tx('Withdraw this')}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="px-4 py-2 text-[11px] text-ink-subtle border-t border-line">
        {tx('A withdrawn reading is hidden from the case and kept in the audit trail. Nothing here is deleted.')}
      </div>
    </Section>
  );
}

// ---- reading a kept page again -------------------------------------------------------------
// The entire reason retention exists. A reading filed by Zia OCR can be put to the vision model
// six months later without anyone finding the original photograph again — and the result is
// SHOWN rather than filed, because comparing two engines on one page only means something if
// both readings survive separately. Filing the second one is an ordinary, separate act.
function Reread({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string; engine?: string } | null>(null);
  const reread = useRereadEvidencePage();

  const go = async (capability: 'ocr' | 'barcode' | 'read') => {
    setOut(null);
    const r = await reread.mutateAsync({
      id: noteId,
      capability,
      question: capability === 'read' ? DEFAULT_ASK : '',
    }).catch(() => null);
    if (!r) return setOut({ ok: false, text: tx('That reader did not answer.') });
    if (r.refused) return setOut({ ok: false, text: String(r.answer) });
    setOut(r.ok
      ? { ok: true, text: String(r.text), engine: r.engine }
      : { ok: false, text: String(r.detail || tx('That reader did not answer.')) });
    onDone();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-1 mr-3 text-[11.5px] text-ink-subtle hover:text-ink inline-flex items-center gap-1">
        <RefreshCw size={12} /> {tx('Read the kept page again')}
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-ctl border border-line bg-surface-2 p-2.5">
      <div className="flex items-center gap-1.5 flex-wrap text-[11.5px]">
        <span className="text-ink-subtle">{tx('Read it with')}</span>
        {TOOLS.map((t) => (
          <button key={t.key} onClick={() => go(t.key)} disabled={reread.isPending}
            className="chip border border-line bg-surface hover:bg-surface-3 text-ink-muted disabled:opacity-40">
            {t.engine}
          </button>
        ))}
        <button onClick={() => { setOpen(false); setOut(null); }}
          className="text-ink-subtle hover:text-ink ml-auto">{tx('Close')}</button>
      </div>
      {reread.isPending && (
        <p className="text-[11.5px] text-ink-subtle mt-2 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> {tx('Reading the kept page…')}
        </p>
      )}
      {out && (
        <div className="mt-2">
          <div className="text-[10.5px] text-ink-subtle mb-1">
            {out.ok ? `${tx('This reading is not filed. File it separately if it is worth keeping.')} ${out.engine || ''}` : ''}
          </div>
          <pre className={`text-[12px] whitespace-pre-wrap leading-relaxed rounded-ctl border border-line p-2.5 max-h-56 overflow-y-auto ${
            out.ok ? 'bg-surface text-ink' : 'bg-surface text-ink-muted'}`}>
            {out.text}
          </pre>
        </div>
      )}
    </div>
  );
}
