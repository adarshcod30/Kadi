// Evidence — reading the paper and photographs an officer is holding.
//
// WHY THIS SCREEN EXISTS. Everything else in KADI reads the register. This reads what has not
// reached the register yet: a seizure memo, a notice, a photograph of recovered property. The
// gap between "this is in my hand" and "this is in the record" is where an hour of a shift
// goes, and it is the one place a vision model earns its keep without being asked to judge
// anybody.
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
import {
  FileImage, ScanLine, ScanText, Sparkles, AlertTriangle, Upload, Loader2,
} from 'lucide-react';
import { Section, Empty } from '../components/ui';
import { InfoDot } from '../components/InfoDot';
import { API_BASE } from '../lib/api';
import { useMe } from '../api/hooks';
import { useTx } from '../lib/i18n';

type Tool = 'ocr' | 'barcode' | 'read';

const TOOLS: { key: Tool; icon: any; title: string; blurb: string; engine: string; ask?: string }[] = [
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
    blurb: 'Put a question to the document or photograph — what it is, which fields it carries, what is visible in the scene.',
    engine: 'Qwen 3.6 vision',
    ask: 'What is this document, and what fields does it carry? If it is a photograph rather than a document, describe what is visible. Do not identify anyone.',
  },
  {
    key: 'barcode',
    icon: ScanLine,
    title: 'Scan a code',
    blurb: 'A barcode or QR code on a property tag, a seized carton, a notice.',
    engine: 'Zia barcode scanner',
  },
];

export default function Evidence() {
  const tx = useTx();
  const { data: me } = useMe();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tool, setTool] = useState<Tool>('ocr');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string>('');
  const [result, setResult] = useState<{ ok: boolean; text: string; meta?: string; engine: string } | null>(null);

  const run = async (file: File) => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setName(file.name);
    setPreview(URL.createObjectURL(file));
    const spec = TOOLS.find((t) => t.key === tool)!;
    try {
      // The document reader is a different service from the Zia image tools, so it is a
      // different route. Both take raw bytes for the same reason: base64 in JSON would cost a
      // third more bytes and the global parser is capped well below an image.
      const url = tool === 'read'
        ? `${API_BASE}/assistant/document?q=${encodeURIComponent(spec.ask || '')}`
        : `${API_BASE}/evidence/${tool}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const j = await r.json();
      const d = j?.data || {};
      if (tool === 'read') {
        setResult(d.ok
          ? { ok: true, text: d.answer, meta: `${d.ms} ms`, engine: spec.engine }
          : { ok: false, text: d.detail || tx('The document reader is unavailable right now.'), engine: spec.engine });
      } else if (d.ok) {
        const inner = d.data?.data || d.data || {};
        const text = inner.text || inner.content
          || (Array.isArray(inner) ? inner.join('\n') : JSON.stringify(inner, null, 2));
        setResult({
          ok: true,
          text: String(text),
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
        hint={tx('Reading an uploaded image is a state-tier permission — Administrator, DGP or SCRB Analyst. The register itself remains available at your own scope.')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          {tx('Evidence')}
          {/* The info affordance every other screen carries. What this reads, where the answer
              comes from, and — the part that matters on a page about photographs — what it
              refuses to do. */}
          <InfoDot width="w-[26rem]">
            <b className="block mb-1 text-kadi-navy">What this screen is for</b>
            Every other screen in KADI reads the register. This one reads what has not reached
            the register yet: a memo, a notice, a photograph of recovered property. The answer
            comes from the image in front of you and is never mixed with the case database, and
            the image is not stored.
            <b className="block mt-1.5 text-kadi-navy">What answers each question</b>
            Text extraction is Zia OCR. Codes are Zia&apos;s barcode scanner. Open questions go to
            the Qwen 3.6 vision model, which is told to say when the image does not show the
            answer rather than guessing a number it cannot read.
            <b className="block mt-1.5 text-kadi-navy">There is no face matching here</b>
            Not as a limitation to be lifted later — as a decision. Zia offers no face search,
            this corpus holds no photographs of people, and a match assembled from neither would
            be a fabricated identification handed to someone with arrest powers. Counting the
            people in a scene is a contemporaneous note; naming them is an accusation.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">
          {tx('Read a document or photograph you are holding. Nothing here is stored, and nothing is matched against a person.')}
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

      <Section title={<span className="flex items-center gap-2">
        <FileImage size={15} className="text-kadi-blue" /> {tx('The image')}
        {name && <span className="text-[12px] font-normal text-ink-subtle truncate max-w-[16rem]">{name}</span>}
      </span>}>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="btn-outline w-full justify-center h-32 border-dashed disabled:opacity-50">
              {busy
                ? <><Loader2 size={16} className="animate-spin" /> {tx('Reading…')}</>
                : <><Upload size={16} /> {tx('Photograph or choose an image')}</>}
            </button>
            {preview && (
              <img src={preview} alt={tx('The image being read')}
                className="mt-3 w-full rounded-card border border-line object-contain max-h-64 bg-surface-2" />
            )}
          </div>

          <div>
            {!result && !busy && (
              <Empty title={tx('Nothing read yet')}
                hint={tx('Choose a tool above, then photograph or upload the page.')} />
            )}
            {result && (
              <div>
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] mb-2">
                  <span className={`chip border ${result.ok
                    ? 'bg-kadi-gold/25 text-ink border-kadi-gold/40'
                    : 'bg-surface-3 text-ink-muted border-line'}`}>
                    {result.ok ? tx('Read from the image you supplied') : tx('Not answered')}
                  </span>
                  <span className="text-ink-subtle">{result.engine}</span>
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
          </div>
        </div>
      </Section>
    </div>
  );
}
