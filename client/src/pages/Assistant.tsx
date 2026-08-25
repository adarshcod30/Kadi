import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Send, Mic, MicOff, FileDown, ShieldCheck, Volume2 } from 'lucide-react';
import { useAssistant, useExport } from '../api/hooks';
import { useLang } from '../lib/i18n';
import { Chip } from '../components/ui';
import type { AssistantResponse } from '../lib/types';

interface Msg { role: 'user' | 'assistant'; content: string; res?: AssistantResponse }

// Cover every intent the engine actually handles - the socio-economic and forecasting
// answers were unreachable from here, so those capabilities were invisible to anyone
// who did not already know to ask for them.
const SUGGESTIONS = [
  'Which cases are slipping?',
  'Which districts have the highest crime rate per capita?',
  'Forecast for next month',
  'Cyber-crime FIRs in Bengaluru this quarter',
  "Show this accused's past cases",
  'Emerging hotspots',
];
const SUGGESTIONS_KN = [
  'ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು ಯಾವುವು?',
  'ತಲಾ ಜನಸಂಖ್ಯೆಯ ಅಪರಾಧ ದರ',
  'ಮುಂದಿನ ತಿಂಗಳ ಮುನ್ಸೂಚನೆ',
  'ಈ ಆರೋಪಿಯ ಹಿಂದಿನ ಪ್ರಕರಣಗಳು?',
];

export default function Assistant() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { lang, setLang } = useLang();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const ask = useAssistant();
  const exp = useExport();
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  useEffect(() => {
    const about = params.get('about');
    // From the graph's Intelligence panel "Ask the Assistant" -- a free-text follow-up
    // referencing the case just being viewed, sent immediately like the ?about= deep link
    // rather than dropped in the box for a second click that repeats work the user already did.
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
    if (!q) return;
    if (inFlight.current) return;
    // Same question twice within 1.5s is a double-fire, not a deliberate repeat.
    if (q === lastSent.current.text && Date.now() - lastSent.current.at < 1500) return;
    inFlight.current = true;
    lastSent.current = { text: q, at: Date.now() };
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    try {
      const res = await ask.mutateAsync({ text: q, lang });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, res }]);
      speak(res.ttsText || res.answer, res.lang);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: 'That query could not be answered just now. Please try again.' }]);
    } finally {
      inFlight.current = false;
    }
  };

  const speak = (text: string, l: string) => {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = l === 'kn' ? 'kn-IN' : 'en-IN';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const toggleMic = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Voice input needs Chrome/Edge (Web Speech API).'); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = lang === 'kn' ? 'kn-IN' : 'en-IN';
    rec.continuous = false;
    rec.maxAlternatives = 1;
    // Interim results are ON for live feedback in the input box, but only the FINAL
    // transcript is ever submitted. Reading e.results[0] on every event and sending it
    // was the cause of the partial-question cascade.
    rec.interimResults = true;
    let submitted = false;
    rec.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput((final || interim).trim());          // live feedback only
      if (final.trim() && !submitted) {
        submitted = true;
        try { rec.stop(); } catch { /* already stopping */ }
        send(final.trim());
      }
    };
    rec.onerror = () => { setListening(false); };
    rec.onend = () => setListening(false);
    rec.start(); recRef.current = rec; setListening(true);
  };

  const doExport = async () => {
    const r: any = await exp.mutateAsync({
      title: 'KADI Assistant Briefing',
      messages: msgs.map((m) => ({ role: m.role, content: m.content, citations: m.res?.citations })),
    });
    // SmartBrowz renders a real PDF. The old path opened a window and asked the browser to
    // print, which produced whatever that machine's print dialog produced.
    if (r.format === 'pdf' && r.base64) {
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename || 'KADI_briefing.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a delay: revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return;
    }
    // Fallback keeps the export working when SmartBrowz is unreachable.
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

  return (
    <div className="max-w-3xl mx-auto flex flex-col" style={{ height: 'calc(100vh - 9rem)' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Assistant</h1>
          <p className="text-xs text-ink-muted flex items-center gap-1"><ShieldCheck size={12} className="text-kadi-blue" /> Grounded answers over the case records · cites FIRs · never uses protected attributes.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLang(lang === 'en' ? 'kn' : 'en')} className="btn-outline text-sm">{lang === 'en' ? 'ಕನ್ನಡ' : 'English'}</button>
          <button onClick={doExport} disabled={!msgs.length} className="btn-outline text-sm disabled:opacity-40"><FileDown size={14} /> Export briefing</button>
        </div>
      </div>

      <div className="flex-1 card overflow-auto p-4 space-y-3">
        {!msgs.length && (
          <div className="text-sm text-ink-muted">
            <p className="mb-3">Ask about cases, offenders, slipping investigations, per-capita crime rates, forecasts or hotspots. Try:</p>
            <div className="flex flex-wrap gap-2">
              {(lang === 'kn' ? SUGGESTIONS_KN : SUGGESTIONS).map((s) => (
                <button key={s} onClick={() => send(s)} className={`chip bg-kadi-blue50 text-kadi-blue hover:bg-kadi-blue hover:text-white ${lang === 'kn' ? 'kn' : ''}`}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-card px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink'} ${lang === 'kn' ? 'kn' : ''}`}>
              <div>{m.content}</div>
              {m.res && (
                <div className="mt-2 space-y-2">
                  {m.res.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.res.citations.map((c, j) => <button key={j} onClick={() => openCitation(c)} className="chip bg-white text-kadi-blue border border-line hover:bg-kadi-blue50">{c.label}</button>)}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {m.res.action && <button onClick={() => openAction(m.res!.action)} className="text-xs link">Open in KADI →</button>}
                    <button onClick={() => speak(m.content, m.res!.lang)} className="text-xs text-ink-muted flex items-center gap-1"><Volume2 size={12} /> Listen</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {ask.isPending && <div className="text-sm text-ink-muted">Thinking…</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3 flex gap-2">
        <button type="button" onClick={toggleMic} className={`btn ${listening ? 'bg-danger text-white' : 'btn-outline'}`} title="Voice">
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={lang === 'kn' ? 'ಪ್ರಶ್ನೆ ಕೇಳಿ…' : 'Ask a question…'} className={`input flex-1 ${lang === 'kn' ? 'kn' : ''}`} />
        <button type="submit" className="btn-primary"><Send size={18} /></button>
      </form>
    </div>
  );
}
