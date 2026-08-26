// Assistant — grounded bilingual Q&A over the case records, with voice both ways.
//
// FOUR THINGS THIS GETS RIGHT THAT THE PREVIOUS VERSION DID NOT.
//
//   1. IT SPEAKS THE LANGUAGE IT CLAIMS TO. Every string on this page went through tx(), so
//      switching to Kannada changes the page and not just the answers. Before, the toggle
//      translated the reply and left "Assistant", "Export briefing", "Thinking…" and "Listen"
//      in English, which reads as a half-built feature.
//
//   2. VOICE FAILS OUT LOUD. Chrome ships no Kannada speech-synthesis voice on most machines,
//      so asking it to speak Kannada produced silence, or English phonemes reading Kannada
//      text. The voice list is now inspected up front and the interface says what it can
//      actually do, rather than offering a button that does nothing.
//
//   3. ERRORS ARE IN THE PAGE, NOT IN AN alert(). A blocked microphone used to raise a browser
//      dialog that said nothing useful and lost the user's place.
//
//   4. PROVENANCE IS VISIBLE. An answer computed from the records and an answer retrieved from
//      the knowledge base are different kinds of claim, and the reader can now see which is
//      which without asking.
import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Send, Mic, MicOff, FileDown, ShieldCheck, Volume2, VolumeX, Languages,
  AlertTriangle, Sparkles, BookOpen, Database, Square,
} from 'lucide-react';
import { useAssistant, useExport, useTranslate } from '../api/hooks';
import { useLang, useTx } from '../lib/i18n';
import { InfoDot } from '../components/InfoDot';
import type { AssistantResponse } from '../lib/types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  res?: AssistantResponse;
  alt?: string;          // the other-language rendering, once asked for
  altLang?: string;
}

const SUGGESTIONS = [
  'Which cases are slipping?',
  'Which districts have the highest crime rate per capita?',
  'Forecast for next month',
  'Cyber-crime FIRs in Bengaluru this quarter',
  'Emerging hotspots',
  'What does a pulsing red zone mean?',
];

// What the browser can actually say, decided by looking rather than assuming. Chrome on most
// machines has no kn-IN voice at all, and a page that offers "Listen" and then stays silent is
// worse than one that says it cannot.
function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    // Chrome populates the list asynchronously, and the first call is usually empty.
    window.speechSynthesis.addEventListener('voiceschanged', read);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', read);
  }, []);
  return voices;
}

export default function Assistant() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { lang, setLang } = useLang();
  const tx = useTx();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [notice, setNotice] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const ask = useAssistant();
  const exp = useExport();
  const translate = useTranslate();
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const voices = useVoices();

  const speechSupported = typeof window !== 'undefined'
    && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const knVoice = useMemo(() => voices.find((v) => /^kn([-_]|$)/i.test(v.lang)), [voices]);
  const enVoice = useMemo(
    () => voices.find((v) => /^en[-_]IN/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)),
    [voices],
  );

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, ask.isPending]);
  useEffect(() => {
    const about = params.get('about');
    const q = params.get('q');
    if (about) send(`Tell me about FIR ${about} and its linked cases`);
    else if (q) send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard against re-entrant and duplicate sends. Voice previously fired one request per
  // interim transcript, so a single spoken sentence produced a cascade of partial queries
  // ("Why", "Why there", "Why there are"...) each with its own answer.
  const inFlight = useRef(false);
  const lastSent = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || inFlight.current) return;
    if (q === lastSent.current.text && Date.now() - lastSent.current.at < 1500) return;
    inFlight.current = true;
    lastSent.current = { text: q, at: Date.now() };
    setInput(''); setInterim(''); setNotice(null);
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    try {
      const res = await ask.mutateAsync({ text: q, lang });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, res }]);
      if (autoSpeak) speak(res.ttsText || res.answer, res.lang, msgs.length + 1);
    } catch {
      setNotice({ kind: 'error', text: tx('That query could not be answered just now. Please try again.') });
    } finally {
      inFlight.current = false;
    }
  };

  const stopSpeaking = () => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeakingIdx(null);
  };

  const speak = (text: string, l: string, idx: number) => {
    if (!ttsSupported || !text) return;
    const wantKn = l === 'kn';
    // The honest branch. If Kannada text is handed to an English voice the result is not
    // accented Kannada, it is nonsense -- so say so once and speak nothing rather than
    // producing noise the officer has to interpret.
    if (wantKn && !knVoice) {
      setNotice({
        kind: 'warn',
        text: tx('This browser has no Kannada speech voice installed, so the answer cannot be read aloud. The text above is complete.'),
      });
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = wantKn ? knVoice : enVoice;
    if (v) u.voice = v;
    u.lang = wantKn ? (v?.lang || 'kn-IN') : (v?.lang || 'en-IN');
    u.rate = 0.98;
    u.onend = () => setSpeakingIdx(null);
    u.onerror = () => setSpeakingIdx(null);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeakingIdx(idx);
  };

  const toggleMic = () => {
    if (!speechSupported) {
      setNotice({ kind: 'warn', text: tx('Voice input needs Chrome or Edge. Type the question instead.') });
      return;
    }
    if (listening) { try { recRef.current?.stop(); } catch { /* already stopping */ } setListening(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = lang === 'kn' ? 'kn-IN' : 'en-IN';
    rec.continuous = false;
    rec.maxAlternatives = 1;
    // Interim results are ON for live feedback, but only the FINAL transcript is ever
    // submitted. Reading e.results[0] on every event was the partial-question cascade.
    rec.interimResults = true;
    let submitted = false;
    rec.onresult = (e: any) => {
      let live = ''; let final = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else live += r[0].transcript;
      }
      setInterim(live.trim());
      if (final.trim()) setInput(final.trim());
      if (final.trim() && !submitted) {
        submitted = true;
        try { rec.stop(); } catch { /* already stopping */ }
        send(final.trim());
      }
    };
    rec.onerror = (e: any) => {
      setListening(false);
      const why = e?.error === 'not-allowed' || e?.error === 'service-not-allowed'
        ? tx('Microphone access was refused. Allow it in the browser address bar, then try again.')
        : e?.error === 'no-speech'
          ? tx('Nothing was heard. Try again, closer to the microphone.')
          : tx('Voice input stopped unexpectedly. Type the question instead.');
      setNotice({ kind: 'warn', text: why });
    };
    rec.onend = () => { setListening(false); setInterim(''); };
    try {
      rec.start(); recRef.current = rec; setListening(true); setNotice(null);
    } catch {
      setNotice({ kind: 'warn', text: tx('Voice input could not start. Type the question instead.') });
    }
  };

  // Render one answer in the other language, on demand. Kept per-message rather than
  // re-asking, because re-running the query could return different numbers and the point is
  // to read the SAME answer in another language.
  const toggleTranslation = async (i: number) => {
    const m = msgs[i];
    if (!m || m.role !== 'assistant') return;
    if (m.alt) { setMsgs((all) => all.map((x, j) => (j === i ? { ...x, alt: undefined } : x))); return; }
    const to = (m.res?.lang || 'en') === 'kn' ? 'en' : 'kn';
    try {
      const out = await translate.mutateAsync({ texts: [m.content], to });
      const t = out.items?.[0];
      if (t?.translated) {
        setMsgs((all) => all.map((x, j) => (j === i ? { ...x, alt: t.text, altLang: to } : x)));
      } else {
        setNotice({ kind: 'warn', text: tx('That answer could not be translated just now.') });
      }
    } catch {
      setNotice({ kind: 'warn', text: tx('That answer could not be translated just now.') });
    }
  };

  const doExport = async () => {
    const r: any = await exp.mutateAsync({
      title: 'KADI Assistant Briefing',
      messages: msgs.map((m) => ({ role: m.role, content: m.content, citations: m.res?.citations })),
    });
    if (r.format === 'pdf' && r.base64) {
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.filename || 'KADI_briefing.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return;
    }
    const w = window.open('', '_blank');
    if (w) { w.document.write(r.html); w.document.close(); setTimeout(() => w.print(), 400); }
  };

  const openAction = (a: any) => {
    if (!a) return;
    if (a.type === 'open_health') nav('/health');
    else if (a.type === 'open_map') nav('/map');
    else if (a.type === 'open_offender') nav(`/offenders/${a.offenderId}`);
    else if (a.type === 'open_cases') {
      const p = new URLSearchParams();
      Object.entries(a.filters || {}).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
      nav(`/cases?${p.toString()}`);
    }
  };
  const openCitation = (c: any) => {
    if (c.type === 'case') nav(`/graph?case=${c.id}`);
    else if (c.type === 'hotspot') nav('/map');
  };

  const kn = lang === 'kn';

  return (
    <div className="max-w-3xl mx-auto flex flex-col" style={{ height: 'calc(100vh - 9rem)' }}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h1 className={`text-xl font-semibold text-kadi-navy flex items-center gap-2 ${kn ? 'kn' : ''}`}>
            {tx('Assistant')}
            <InfoDot label={tx('How the assistant answers')} align="left" width="w-80">
              <b className="block mb-1 text-kadi-navy">{tx('Deterministic first, model second')}</b>
              {tx('Every number, name and percentage is computed from the records by code. The model is asked only how to say it, never what is true, so it cannot invent an FIR number or a statistic.')}
              <b className="block mt-1.5 text-kadi-navy">{tx('When it does not know')}</b>
              {tx('A question the intent engine does not recognise falls through to the knowledge base, and the answer is labelled as coming from there rather than from the records.')}
              <b className="block mt-1.5 text-kadi-navy">{tx('Fairness')}</b>
              {tx('Caste, religion and occupation are excluded from every model here by construction, not by convention.')}
            </InfoDot>
          </h1>
          <p className={`text-xs text-ink-muted flex items-center gap-1 ${kn ? 'kn' : ''}`}>
            <ShieldCheck size={12} className="text-kadi-blue shrink-0" />
            {tx('Grounded answers over the case records · cites FIRs · never uses protected attributes.')}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setLang(kn ? 'en' : 'kn')} className="btn-outline text-sm" title={tx('Change language')}>
            <Languages size={14} /> {kn ? 'English' : 'ಕನ್ನಡ'}
          </button>
          <button onClick={doExport} disabled={!msgs.length} className={`btn-outline text-sm disabled:opacity-40 ${kn ? 'kn' : ''}`}>
            <FileDown size={14} /> {tx('Export briefing')}
          </button>
        </div>
      </div>

      {/* Capability line. Stated up front rather than discovered by pressing a button that does
          nothing — Chrome ships no Kannada voice on most machines. */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-subtle mb-2 ${kn ? 'kn' : ''}`}>
        <span className="flex items-center gap-1">
          <Mic size={11} /> {speechSupported ? tx('Voice input ready') : tx('Voice input unavailable in this browser')}
        </span>
        <span className="flex items-center gap-1">
          {ttsSupported && (kn ? knVoice : enVoice) ? <Volume2 size={11} /> : <VolumeX size={11} />}
          {!ttsSupported
            ? tx('Read-aloud unavailable in this browser')
            : kn
              ? (knVoice ? tx('Kannada read-aloud ready') : tx('No Kannada voice installed — answers are shown as text'))
              : tx('Read-aloud ready')}
        </span>
        <button onClick={() => setAutoSpeak((v) => !v)} className="flex items-center gap-1 hover:text-kadi-blue">
          {autoSpeak ? <Volume2 size={11} /> : <VolumeX size={11} />}
          {autoSpeak ? tx('Speak answers automatically') : tx('Answers are not spoken')}
        </button>
        {speakingIdx !== null && (
          <button onClick={stopSpeaking} className="flex items-center gap-1 text-danger hover:underline">
            <Square size={10} /> {tx('Stop')}
          </button>
        )}
      </div>

      {notice && (
        <div className={`mb-2 rounded-ctl border px-3 py-2 text-[12.5px] flex items-start gap-2 ${kn ? 'kn' : ''} ${
          notice.kind === 'error' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      <div className="flex-1 card overflow-auto p-4 space-y-3">
        {!msgs.length && (
          <div className={`text-sm text-ink-muted ${kn ? 'kn' : ''}`}>
            <p className="mb-3">{tx('Ask about cases, offenders, slipping investigations, per-capita crime rates, forecasts or hotspots. Try:')}</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(kn ? tx(s) : s)}
                  className={`chip bg-kadi-blue50 text-kadi-blue hover:bg-kadi-blue hover:text-white ${kn ? 'kn' : ''}`}>
                  {tx(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] rounded-card px-3.5 py-2.5 text-sm ${
              m.role === 'user' ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink'} ${kn ? 'kn' : ''}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>

              {m.alt && (
                <div className={`mt-2 pt-2 border-t border-line/70 text-[13px] text-ink-muted ${m.altLang === 'kn' ? 'kn' : ''}`}>
                  {m.alt}
                </div>
              )}

              {m.res && (
                <div className="mt-2 space-y-2">
                  {/* Where the answer came from. Records and knowledge base are different kinds
                      of claim and the reader should not have to ask which this is. */}
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    {m.res.source === 'knowledge_base' ? (
                      <span className="chip bg-purple-100 text-purple-800 flex items-center gap-1">
                        <BookOpen size={10} /> {tx('From the knowledge base')}
                      </span>
                    ) : (
                      <span className="chip bg-teal-100 text-teal-800 flex items-center gap-1">
                        <Database size={10} /> {tx('Computed from the records')}
                      </span>
                    )}
                    {(m.res as any).llm && (
                      <span className="chip bg-surface text-ink-muted border border-line flex items-center gap-1">
                        <Sparkles size={10} /> {tx('Wording by the model')}
                      </span>
                    )}
                  </div>

                  {m.res.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.res.citations.map((c, j) => (
                        <button key={j} onClick={() => openCitation(c)}
                          className="chip bg-white text-kadi-blue border border-line hover:bg-kadi-blue50">
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className={`flex items-center gap-3 text-xs text-ink-muted ${kn ? 'kn' : ''}`}>
                    {m.res.action && (
                      <button onClick={() => openAction(m.res!.action)} className="link">{tx('Open in KADI')} →</button>
                    )}
                    <button onClick={() => (speakingIdx === i ? stopSpeaking() : speak(m.content, m.res!.lang, i))}
                      className="flex items-center gap-1 hover:text-kadi-blue">
                      {speakingIdx === i ? <><Square size={10} /> {tx('Stop')}</> : <><Volume2 size={12} /> {tx('Listen')}</>}
                    </button>
                    <button onClick={() => toggleTranslation(i)} disabled={translate.isPending}
                      className="flex items-center gap-1 hover:text-kadi-blue disabled:opacity-50">
                      <Languages size={12} />
                      {m.alt ? tx('Hide translation') : (m.res.lang === 'kn' ? tx('Show in English') : tx('Show in Kannada'))}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {ask.isPending && <div className={`text-sm text-ink-muted ${kn ? 'kn' : ''}`}>{tx('Thinking…')}</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3 flex gap-2">
        <button type="button" onClick={toggleMic} title={tx('Voice')}
          className={`btn ${listening ? 'bg-danger text-white animate-pulse' : 'btn-outline'} ${!speechSupported ? 'opacity-50' : ''}`}>
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <div className="flex-1 relative">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? tx('Listening…') : tx('Ask a question…')}
            className={`input w-full ${kn ? 'kn' : ''}`} />
          {/* Live transcript sits under the box rather than overwriting what was typed. */}
          {interim && (
            <div className={`absolute left-3 -top-5 text-[11.5px] text-ink-subtle italic truncate max-w-full ${kn ? 'kn' : ''}`}>
              {interim}
            </div>
          )}
        </div>
        <button type="submit" className="btn-primary" title={tx('Send')}><Send size={18} /></button>
      </form>
    </div>
  );
}
