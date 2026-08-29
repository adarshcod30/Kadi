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
// What gets stored is the transcription, never the photograph: the image is the part carrying
// whoever else was in frame, the text is the part with evidentiary value.
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
  Paperclip, Search, Check, X, MessageSquareText, History, Undo2,
} from 'lucide-react';
import { Section, Empty, Mono } from '../components/ui';
import { InfoDot } from '../components/InfoDot';
import { API_BASE } from '../lib/api';
import {
  useMe, useCases, useFileEvidenceNote, useMyEvidenceNotes, useWithdrawEvidenceNote,
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
  const [tool, setTool] = useState<Tool>('ocr');
  const [ask, setAsk] = useState(DEFAULT_ASK);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string>('');
  const [bytes, setBytes] = useState<number>(0);
  const [result, setResult] = useState<
    { ok: boolean; text: string; meta?: string; engine: string; confidence?: string; refused?: boolean } | null
  >(null);

  const run = async (file: File) => {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      setResult({ ok: false, text: tx('That is not an image. These readers take a photograph or a scan — a PDF has to be exported to an image first.'), engine: '' });
      return;
    }
    setBusy(true);
    setResult(null);
    setName(file.name);
    setBytes(file.size);
    setPreview(URL.createObjectURL(file));
    const spec = TOOLS.find((t) => t.key === tool)!;
    try {
      // The document reader is a different service from the Zia image tools, so it is a
      // different route. Both take raw bytes for the same reason: base64 in JSON would cost a
      // third more bytes and the global parser is capped well below an image.
      const url = tool === 'read'
        ? `${API_BASE}/assistant/document?q=${encodeURIComponent(ask.trim() || DEFAULT_ASK)}`
        : `${API_BASE}/evidence/${tool}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const j = await r.json();
      const d = j?.data || {};
      if (tool === 'read') {
        // A refusal is an answer, not a failure. The model is told never to identify a person
        // and the route refuses the phrasings that ask it to; showing that as "unavailable"
        // would read as a broken feature rather than a deliberate boundary.
        if (d.refused) setResult({ ok: false, refused: true, text: d.answer, engine: spec.engine });
        else if (d.ok) setResult({ ok: true, text: d.answer, meta: `${d.ms} ms`, engine: spec.engine });
        else setResult({ ok: false, text: d.detail || tx('The document reader is unavailable right now.'), engine: spec.engine });
      } else if (d.ok) {
        const inner = d.data?.data || d.data || {};
        const text = inner.text || inner.content
          || (Array.isArray(inner) ? inner.join('\n') : JSON.stringify(inner, null, 2));
        setResult({
          ok: true,
          text: String(text),
          confidence: inner.confidence != null ? String(inner.confidence) : undefined,
          meta: [inner.confidence != null ? `${inner.confidence}% confidence` : null, `${d.ms} ms`]
            .filter(Boolean).join(' · '),
          engine: spec.engine,
        });
      } else {
        setResult({ ok: false, text: String(d.detail || 'unavailable'), engine: spec.engine });
      }
    } catch (e: any) {
      setResult({ ok: false, text: e?.message || tx('The request failed.'), engine: spec.engine });
    } finally {
      setBusy(false);
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
          <button key={t.key} onClick={() => setTool(t.key)} aria-pressed={tool === t.key}
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
          </div>
        </Section>
      )}

      <Section title={<span className="flex items-center gap-2">
        <FileImage size={15} className="text-kadi-blue" /> {tx('The image')}
        {name && <span className="text-[12px] font-normal text-ink-subtle truncate max-w-[16rem]">{name}</span>}
      </span>}>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
            {/* Drop target as well as a button. An officer at a desk has the photograph in a
                folder already; making them go through a file dialog for it is a step that
                exists only because nobody wired the two events. */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragging(false);
                const f = e.dataTransfer.files?.[0]; if (f) run(f);
              }}
              className={`btn-outline w-full justify-center h-32 border-dashed disabled:opacity-50 transition-colors ${
                dragging ? 'bg-kadi-blue/10 border-kadi-blue text-kadi-navy' : ''}`}>
              {busy
                ? <><Loader2 size={16} className="animate-spin" /> {tx('Reading…')}</>
                : dragging
                  ? <><Upload size={16} /> {tx('Drop it here')}</>
                  : <><Upload size={16} /> {tx('Photograph, choose, or drag an image here')}</>}
            </button>
            {preview && (
              <img src={preview} alt={tx('The image being read')}
                className="mt-3 w-full rounded-card border border-line object-contain max-h-64 bg-surface-2" />
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
          capability={tool}
          engine={spec.engine}
          extract={result.text}
          question={tool === 'read' ? (ask.trim() || DEFAULT_ASK) : ''}
          confidence={result.confidence}
          filename={name}
          bytes={bytes}
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
  confidence?: string; filename: string; bytes: number;
}) {
  const tx = useTx();
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<{ caseMasterId: string; crimeNo: string } | null>(null);
  const [filed, setFiled] = useState<{ id: string; caseMasterId: string; crimeNo: string | null } | null>(null);
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
      });
      setFiled({ id: out.id, caseMasterId: out.caseMasterId, crimeNo: out.crimeNo });
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
            {tx('The station that registered it can read this without access to the image.')}
          </span>
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

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={submit} disabled={!picked || post.isPending}
            className="btn-primary text-[12.5px] disabled:opacity-40">
            {post.isPending
              ? <><Loader2 size={14} className="animate-spin" /> {tx('Filing…')}</>
              : <><Paperclip size={14} /> {tx('File the reading')}</>}
          </button>
          <span className="text-[11.5px] text-ink-subtle">
            {tx('Stores the text only. The photograph is not kept.')}
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
