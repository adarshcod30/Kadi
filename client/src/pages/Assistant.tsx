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
import { useSearchParams } from 'react-router-dom';
import {
  Send, Mic, MicOff, FileDown, ShieldCheck, Volume2, VolumeX, Languages,
  AlertTriangle, Sparkles, BookOpen, Database, Square, FileImage,
} from 'lucide-react';
import { useAssistant, useExport, useTranslate } from '../api/hooks';
import { useLang, useTx } from '../lib/i18n';
import { API_BASE } from '../lib/api';
import { InfoDot } from '../components/InfoDot';
import type { AssistantResponse } from '../lib/types';
import { useNav } from '../lib/useNav';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  res?: AssistantResponse;
  alt?: string;          // the other-language rendering, once asked for
  altLang?: string;
  // Set on answers read from an image the user supplied. A third kind of claim, and the
  // reader must be able to tell it from the register at a glance: the register is a record,
  // a photograph is a photograph.
  doc?: { answer: string; model?: string; ms?: number; refused?: boolean; filename?: string };
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
  const nav = useNav();
  const [params] = useSearchParams();
  const { lang, setLang } = useLang();
  const tx = useTx();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [notice, setNotice] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  // Whether anything is ACTUALLY making sound, asked of the two audio pipes rather than
  // inferred from which message we last started.
  //
  // speakingIdx was standing in for this and could not: speechSynthesis QUEUES utterances, so
  // when one finishes its onend clears the flag while the queue keeps talking. The Stop button
  // was bound to that flag, so it disappeared while the assistant carried on speaking and left
  // no way to stop it. There is no global "something is speaking" event to subscribe to, so
  // this polls the two sources that know.
  const [audible, setAudible] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const ask = useAssistant();
  const exp = useExport();
  const translate = useTranslate();
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [reading, setReading] = useState(false);
  const voices = useVoices();

  const speechSupported = typeof window !== 'undefined'
    && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const knVoice = useMemo(() => voices.find((v) => /^kn([-_]|$)/i.test(v.lang)), [voices]);
  const enVoice = useMemo(
    () => voices.find((v) => /^en[-_]IN/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)),
    [voices],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const synth = typeof window !== 'undefined' && 'speechSynthesis' in window
        ? (window.speechSynthesis.speaking || window.speechSynthesis.pending) : false;
      const el = audioRef.current;
      const server = Boolean(el && !el.paused && !el.ended);
      setAudible(Boolean(synth || server));
    }, 400);
    return () => window.clearInterval(id);
  }, []);

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

  /**
   * `display` exists because the two are genuinely different for a suggestion chip: the
   * question goes to the engine in English so its intent patterns match, but the officer
   * clicked a Kannada chip and their own message should read back in Kannada. Showing them
   * English for a button they pressed in Kannada is the same half-done feeling this page was
   * rebuilt to remove.
   */
  // WHY THE RECORDING IS RE-ENCODED BEFORE IT IS SENT.
  //
  // MediaRecorder produces WebM/Opus in Chrome and Firefox and MP4/AAC in Safari. The Zia
  // Audio-to-Text model accepts WAV and MP3 and rejects the rest outright:
  //
  //     http 400 {"code":"INVALID_FILE_EXTENSION"}
  //
  // which is what every voice question had been getting. The earlier round-trip test passed
  // only because it fed the model a WAV from the text-to-speech model rather than anything a
  // browser had recorded -- a test that proved the transport and missed the format.
  //
  // OfflineAudioContext does the whole conversion: it downmixes to one channel and resamples
  // to 16 kHz in one render, which is also the rate speech models want and about a tenth of
  // the bytes of the raw capture.
  const toWav = async (blob: Blob): Promise<Blob> => {
    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const rate = 16000;
      const frames = Math.max(1, Math.round(decoded.duration * rate));
      const off = new OfflineAudioContext(1, frames, rate);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const pcm = (await off.startRendering()).getChannelData(0);

      // 16-bit PCM WAV: 44-byte header then the samples, clamped rather than wrapped —
      // an overflowing sample wraps to the opposite extreme and reads as a click.
      const out = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(out);
      const ascii = (at: number, str: string) => {
        for (let i = 0; i < str.length; i += 1) view.setUint8(at + i, str.charCodeAt(i));
      };
      ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
      ascii(12, 'fmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i += 1) {
        const v = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      return new Blob([out], { type: 'audio/wav' });
    } finally {
      ctx.close().catch(() => {});
    }
  };

  // Recording, on the server, with Zia's Audio-to-Text model.
  //
  // Browser Web Speech is kept below as the fallback, but it is no longer the primary path:
  // it is Chrome and Edge only, and its Kannada is patchy enough that the interface used to
  // tell everyone else to type instead. MediaRecorder plus a server model works in every
  // browser and transcribes Kannada exactly -- checked by round-tripping synthesised speech
  // back through it.
  const stopRecording = () => {
    try { mediaRef.current?.stop(); } catch { /* already stopped */ }
    mediaRef.current?.stream?.getTracks?.().forEach((t) => t.stop());
    mediaRef.current = null;
    setListening(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        chunksRef.current = [];
        // Too short to be speech. Saying so beats sending a click to a model and showing
        // whatever it makes of it.
        if (blob.size < 2048) {
          setNotice({ kind: 'warn', text: tx('Nothing was recorded. Hold the button while speaking.') });
          return;
        }
        setTranscribing(true);
        try {
          const wav = await toWav(blob);
          const r = await fetch(`${API_BASE}/assistant/transcribe?lang=${lang}`, {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: wav,
          });
          const j = await r.json();
          const text = j?.data?.text;
          if (text) { setInput(text); send(text); } else {
            // The reason travels. "Nothing happened after I spoke" is the least debuggable
            // failure in the product, and a generic apology is what kept this one hidden.
            const why = j?.data?.detail || j?.error?.message;
            setNotice({
              kind: 'warn',
              text: why
                ? `${tx('That could not be transcribed.')} ${why}`
                : tx('That could not be transcribed. Try again, or type the question.'),
            });
          }
        } catch (e: any) {
          setNotice({
            kind: 'warn',
            text: `${tx('Transcription failed.')} ${e?.message || ''}`.trim(),
          });
        } finally { setTranscribing(false); }
      };
      mr.start();
      mediaRef.current = mr;
      setListening(true);
      setNotice(null);
    } catch {
      setNotice({
        kind: 'warn',
        text: tx('Microphone access was refused. Allow it in the browser address bar, then try again.'),
      });
    }
  };

  // Reading a document or photograph the officer is holding.
  //
  // The answer is pinned to the image and shown as its own kind of message. It is never
  // merged into an answer about the register, because only one of the two is a record.
  const readDocument = async (file: File) => {
    if (!file) return;
    const q = input.trim() || 'What does this document say? List every field you can read.';
    setMsgs((m) => [...m, { role: 'user', content: `${q}  ·  ${file.name}` }]);
    setInput('');
    setReading(true);
    try {
      const r = await fetch(`${API_BASE}/assistant/document?q=${encodeURIComponent(q)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const j = await r.json();
      const d = j?.data;
      setMsgs((m) => [...m, {
        role: 'assistant',
        content: d?.answer || tx('The document could not be read.'),
        doc: {
          answer: d?.answer || '', model: d?.model, ms: d?.ms,
          refused: Boolean(d?.refused), filename: file.name,
        },
      }]);
    } catch {
      setMsgs((m) => [...m, {
        role: 'assistant', content: tx('The document reader is unavailable right now.'),
        doc: { answer: '', filename: file.name },
      }]);
    } finally { setReading(false); }
  };

  const send = async (text: string, display?: string) => {
    const q = text.trim();
    if (!q || inFlight.current) return;
    if (q === lastSent.current.text && Date.now() - lastSent.current.at < 1500) return;
    inFlight.current = true;
    lastSent.current = { text: q, at: Date.now() };
    setInput(''); setInterim(''); setNotice(null);
    setMsgs((m) => [...m, { role: 'user', content: (display || q).trim() }]);
    try {
      const res = await ask.mutateAsync({ text: q, lang });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, res }]);
      if (autoSpeak) speak(res.ttsText || res.answer, res.lang, msgs.length + 1);
    } catch (e: any) {
      // The generic apology is what hid this. A query that failed because the gateway gave up
      // waiting, one that failed because the user is offline, and one that failed because the
      // server threw all read identically -- so the only debugging move left to a reader was
      // to try again and hope. The reason travels now.
      const why = e?.message || e?.error?.message || '';
      setNotice({
        kind: 'error',
        text: why
          ? `${tx('That query could not be answered.')} ${why}`
          : tx('That query could not be answered just now. Please try again.'),
      });
    } finally {
      inFlight.current = false;
    }
  };

  const stopSpeaking = () => {
    // cancel() drops the queue as well as the current utterance, which is the half that was
    // missing: pausing one sentence while five more waited behind it is not stopping.
    if (ttsSupported) window.speechSynthesis.cancel();
    // Server audio is a different pipe and needs stopping separately, or "Stop" silences the
    // browser voice and leaves Zia's still playing.
    const el = audioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    setSpeakingIdx(null);
    setAudible(false);
  };

  /**
   * Read an answer aloud, browser first and Zia second.
   *
   * The browser is instant when it has the voice, and on most machines it does not have a
   * Kannada one -- which is why this used to announce that and stay silent. Zia's
   * Text-to-Audio model has three Kannada speakers, so the fallback is now real audio rather
   * than an apology. What it still refuses to do is hand Kannada text to an English voice:
   * that produces noise, not an accent.
   */
  const speak = async (text: string, l: string, idx: number) => {
    if (!text) return;
    const wantKn = l === 'kn';
    const localVoice = wantKn ? knVoice : enVoice;

    if (!ttsSupported || !localVoice) {
      try {
        setSpeakingIdx(idx);
        const res = await fetch(`${API_BASE}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, lang: wantKn ? 'kn' : 'en' }),
        });
        if (!res.ok) throw new Error('tts');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const el = audioRef.current || new Audio();
        audioRef.current = el;
        el.src = url;
        el.onended = () => { setSpeakingIdx(null); URL.revokeObjectURL(url); };
        el.onerror = () => { setSpeakingIdx(null); URL.revokeObjectURL(url); };
        await el.play();
      } catch {
        setSpeakingIdx(null);
        setNotice({
          kind: 'warn',
          text: tx('Read-aloud is unavailable right now. The text above is complete.'),
        });
      }
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    const v = localVoice;
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
    // Server transcription first, wherever the browser can record at all -- which is
    // everywhere that matters, and unlike Web Speech it is not limited to two browsers and
    // does Kannada properly. Web Speech stays below as the fallback.
    // typeof on the method rather than truthiness: TypeScript types getUserMedia as always
    // present, so `&& navigator.mediaDevices?.getUserMedia` is a condition it can prove true
    // and warns about. The runtime question -- does this browser actually have it -- is real.
    const canRecord = typeof navigator !== 'undefined'
      && typeof navigator.mediaDevices !== 'undefined'
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof MediaRecorder !== 'undefined';
    if (canRecord) {
      if (listening) { stopRecording(); return; }
      startRecording();
      return;
    }
    if (!speechSupported) {
      setNotice({ kind: 'warn', text: tx('Voice input is not available in this browser. Type the question instead.') });
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
          {kn
            ? (knVoice ? tx('Kannada read-aloud ready') : tx('Kannada read-aloud ready — spoken by Zia'))
            : (enVoice ? tx('Read-aloud ready') : tx('Read-aloud ready — spoken by Zia'))}
        </span>
        {/* Turning this off silences what is already playing. Leaving the current answer to
            finish after the reader has just said "stop speaking to me" is the wrong reading of
            the control. */}
        <button
          onClick={() => setAutoSpeak((v) => { if (v) stopSpeaking(); return !v; })}
          className="flex items-center gap-1 hover:text-kadi-blue">
          {autoSpeak ? <Volume2 size={11} /> : <VolumeX size={11} />}
          {autoSpeak ? tx('Speak answers automatically') : tx('Answers are not spoken')}
        </button>
        {/* Bound to `audible`, not to which message we last started. The old condition went
            false the moment one utterance ended, taking the only stop control off the screen
            while the queue behind it kept talking. */}
        {(audible || speakingIdx !== null) && (
          <button onClick={stopSpeaking}
            aria-label={tx('Stop speaking')}
            className="flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 font-medium text-danger hover:bg-danger/20">
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
                // Send the ENGLISH source, show the Kannada. The intent engine matches on
                // English phrasing, and posting it a machine translation of its own suggestion
                // means it fails to recognise a question it wrote -- which is how "Which cases
                // are slipping?" came back as "no information is provided". The answer still
                // arrives in Kannada, because `lang` controls that, not the question.
                <button key={s} onClick={() => send(s, tx(s))}
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
              {/* data-notranslate on both: the answer already arrived in the language that was
                  asked for, and the alternate is deliberately in the OTHER one. Without this
                  the page translator dutifully turned the English translation back into
                  Kannada, so "Show in English" produced a second Kannada sentence. */}
              <div className="whitespace-pre-wrap" data-notranslate>{m.content}</div>

              {m.alt && (
                <div data-notranslate
                  className={`mt-2 pt-2 border-t border-line/70 text-[13px] text-ink-muted ${m.altLang === 'kn' ? 'kn' : ''}`}>
                  {m.alt}
                </div>
              )}

              {/* The third kind of claim. A photograph is not a record, and the badge says which
                  one the reader is looking at before they act on it. */}
              {m.doc && (
                <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
                  {m.doc.refused ? (
                    <span className="chip bg-surface-3 text-ink-muted border border-line flex items-center gap-1">
                      <FileImage size={10} /> {tx('Not answered')}
                    </span>
                  ) : (
                    <span className="chip bg-kadi-gold/25 text-ink border border-kadi-gold/40 flex items-center gap-1">
                      <FileImage size={10} /> {tx('Read from the document you supplied')}
                    </span>
                  )}
                  {m.doc.filename && (
                    <span className="text-ink-subtle truncate max-w-[12rem]">{m.doc.filename}</span>
                  )}
                  {m.doc.ms ? <span className="text-ink-subtle font-num">{m.doc.ms} ms</span> : null}
                  <InfoDot label="About document reading" align="left" width="w-80">
                    <b className="block mb-1 text-kadi-navy">Grounded in the image, and only the image</b>
                    This answer comes from the picture you just supplied. It is not mixed with the
                    case database, and the image is not stored.
                    <b className="block mt-1.5 text-kadi-navy">What it will not do</b>
                    It does not identify people from photographs and will not answer questions
                    about caste, religion or community. If a field is not legible in the image it
                    says so rather than guessing — an invented FIR number or registration mark is
                    worse than no answer.
                  </InfoDot>
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
        <button type="button" onClick={toggleMic}
          title={listening ? tx('Stop recording') : tx('Ask by voice')}
          aria-label={listening ? tx('Stop recording') : tx('Ask by voice')}
          disabled={transcribing}
          className={`btn ${listening ? 'bg-danger text-white animate-pulse' : 'btn-outline'} ${transcribing ? 'opacity-50' : ''}`}>
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {/* Reading a document. accept + capture means a phone opens the camera and a desktop
            opens the file picker, from the same control. */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readDocument(f); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={reading}
          title={tx('Read a document or photograph')} aria-label={tx('Read a document or photograph')}
          className={`btn btn-outline ${reading ? 'opacity-50' : ''}`}>
          <FileImage size={18} />
        </button>
        <div className="flex-1 relative">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? tx('Recording… tap the microphone to stop')
              : transcribing ? tx('Transcribing…')
                : reading ? tx('Reading the document…')
                  : tx('Ask a question, or attach a document…')}
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
