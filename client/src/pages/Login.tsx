// The door.
//
// Two ways through it, and they are not equals. Signing in is the product; the demo cards are
// an evaluation convenience, so sign-in holds the card and the demo sits under it, smaller and
// clearly labelled. Presenting them side by side would suggest the access model is decorative.
//
// The live figures stay because they are the one honest claim available before you are inside:
// they are read from the running deployment, so an empty pipeline would show empty counters.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Globe, MapPin, Building2, Loader2, ArrowRight, Lock, Mail, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { setRole, setToken, signOut, Role, api } from '../lib/api';
import { LoginHero } from '../components/LoginHero';

const DOMAIN = 'ksp.gov.in';

const DEMO_TIERS: { key: string; icon: typeof Globe; label: string; scope: string; role: Role; accent: string }[] = [
  { key: 'state', icon: Globe, label: 'State', scope: 'All 31 districts', role: 'DGP', accent: '#1A6FC4' },
  { key: 'district', icon: MapPin, label: 'District', scope: 'One district, switchable', role: 'SP', accent: '#E8871E' },
  { key: 'station', icon: Building2, label: 'Station', scope: 'One register', role: 'SHO', accent: '#2FA8A0' },
];

const SIGNUP_ROLES: { value: string; label: string; needsDistrict: boolean }[] = [
  { value: 'SP', label: 'Superintendent of Police', needsDistrict: true },
  { value: 'DSP', label: 'DySP / ACP', needsDistrict: true },
  { value: 'SHO', label: 'Station House Officer', needsDistrict: false },
  { value: 'SI', label: 'Sub-Inspector (IO)', needsDistrict: false },
  { value: 'Analyst', label: 'SCRB Analyst', needsDistrict: false },
];

function useLiveFigures() {
  const [f, setF] = useState<{ cases: number; offenders: number; networks: number; recovery: number } | null>(null);
  useEffect(() => {
    // Arriving at the door ends any session that was still open. Two reasons, and the second
    // is why this lives here rather than only in sign-out: a stale role in storage was biasing
    // these counters, so landing on /login after a station session advertised the product as
    // holding 276 FIRs. The headline figures are the state-wide claim; they must not inherit
    // whoever happened to be signed in last.
    signOut();
    Promise.all([api.get<any>('/stats').catch(() => null), api.get<any>('/eval').catch(() => null)])
      .then(([s, e]) => {
        if (!s) return;
        setF({
          cases: s.totalCases || 0, offenders: s.resolvedOffenders || 0,
          networks: s.activeNetworks || 0, recovery: e?.overallRecoveryPct ?? 0,
        });
      });
  }, []);
  return f;
}

function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!to) return undefined;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1000);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n.toLocaleString('en-IN')}{suffix}</>;
}

export default function Login() {
  const nav = useNavigate();
  const figures = useLiveFigures();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#071a28] text-white">
      {/* Depth, in three layers: a cool base, a warm bloom behind the map so the state reads
          as lit from within, and a fine grid that gives the dark ground a surface. */}
      <div className="absolute inset-0" style={{
        background:
          'radial-gradient(900px 620px at 34% 42%, rgba(26,111,196,0.28), transparent 62%),'
          + 'radial-gradient(700px 460px at 88% 8%, rgba(232,180,74,0.10), transparent 60%),'
          + 'radial-gradient(800px 520px at 6% 96%, rgba(47,168,160,0.14), transparent 62%),'
          + 'linear-gradient(160deg, #0b2942 0%, #082032 52%, #061722 100%)',
      }} />
      <div className="absolute inset-0 opacity-[0.045]" style={{
        backgroundImage: 'linear-gradient(#7CC4F5 1px, transparent 1px), linear-gradient(90deg, #7CC4F5 1px, transparent 1px)',
        backgroundSize: '54px 54px',
        maskImage: 'radial-gradient(ellipse 85% 70% at 50% 45%, black, transparent)',
        WebkitMaskImage: 'radial-gradient(ellipse 85% 70% at 50% 45%, black, transparent)',
      }} />

      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1.25fr_440px]">
        {/* ---- Left: the state, the name, the numbers ---- */}
        <div className="relative flex flex-col justify-center px-8 lg:px-14 py-12 overflow-hidden">
          {/* The map sits behind the wordmark rather than beside it, so the two read as one
              composition instead of two panels sharing a column. */}
          <div className="pointer-events-none absolute right-[-3%] top-1/2 -translate-y-1/2 w-[42%] max-w-[360px] hidden xl:block opacity-80">
            <LoginHero />
          </div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}
            className="relative">
            <div className="flex items-center gap-3.5">
              <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt="Government of Karnataka"
                className="h-14 w-14 rounded-full bg-white/95 p-1 shrink-0 shadow-lg" />
              <div className="h-10 w-px bg-white/15" />
              <div className="text-[10.5px] uppercase tracking-[0.26em] text-kadi-gold/85 leading-relaxed">
                Karnataka<br />State Police
              </div>
            </div>

            <h1 className="mt-6 text-[5.5rem] lg:text-[7rem] font-bold tracking-[-0.04em] leading-[0.85]"
              style={{ textShadow: '0 4px 40px rgba(0,0,0,0.45)' }}>
              KADI
            </h1>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-px w-10 bg-kadi-gold/70" />
              <span className="text-[12px] uppercase tracking-[0.2em] text-white/55">
                Crime Analytics &amp; Intelligence
              </span>
            </div>
            <p className="mt-5 text-[15px] text-white/65 max-w-[26rem] leading-relaxed">
              Every FIR in Karnataka held as one connected graph — so a serial offender working
              across three districts stops looking like three unrelated cases.
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.14 }}
            className="relative mt-9 grid grid-cols-2 gap-x-8 gap-y-5 max-w-[24rem]">
            {[
              { v: figures?.cases, label: 'FIRs in one graph' },
              { v: figures?.offenders, label: 'Repeat offenders resolved' },
              { v: figures?.networks, label: 'Active offender networks' },
              { v: figures?.recovery, label: 'Ground-truth recovery', suffix: '%' },
            ].map((k) => (
              <div key={k.label} className="border-l-2 border-kadi-gold/45 pl-3.5">
                <div className="text-[26px] font-semibold font-num text-kadi-gold tabular-nums leading-none">
                  {figures ? <Counter to={k.v || 0} suffix={k.suffix} /> : <span className="opacity-25">—</span>}
                </div>
                <div className="text-[11.5px] text-white/55 mt-1.5 leading-tight">{k.label}</div>
              </div>
            ))}
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            className="relative mt-9 text-[11px] text-white/30 max-w-[26rem] leading-relaxed">
            Evidence and behaviour only — never caste, religion or occupation.
            Synthetic corpus, schema-faithful to the KSP FIR system.
          </motion.div>
        </div>

        {/* ---- Right: the door ---- */}
        <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
          className="relative flex flex-col justify-center px-7 py-10 border-l border-white/[0.08] overflow-hidden"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))', backdropFilter: 'blur(14px)' }}>
          {/* A gold hairline down the seam: the KSP rule that runs under the app's header,
              carried onto the entry screen so the two feel like one product. */}
          <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-kadi-gold/45 to-transparent" />
          {/* The crest behind the form. Large, faint and bled off the bottom-right so it
              anchors the column without ever sitting behind a line of text. */}
          <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt=""
            className="pointer-events-none absolute -right-24 -bottom-20 w-[400px] opacity-[0.05] select-none" />
          <div className="pointer-events-none absolute inset-x-0 -top-24 h-56"
            style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(232,180,74,0.10), transparent 70%)' }} />

          <div className="relative">
            {mode === 'signin'
              ? <SignInCard onSignup={() => setMode('signup')} onDone={() => nav('/')} />
              : <SignUpCard onBack={() => setMode('signin')} />}
          </div>

          <div className="relative mt-7 pt-5 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/35 mb-2.5">
              Or explore without an account
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_TIERS.map((t) => (
                <button key={t.key}
                  onClick={() => { setToken(null); setRole(t.role); nav('/'); }}
                  className="group relative rounded-xl px-2.5 py-3 text-left overflow-hidden transition-all duration-200 hover:-translate-y-px"
                  style={{
                    background: 'rgba(0,0,0,0.18)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)',
                  }}>
                  {/* The tier colour arrives on the top edge, where it reads as a label on the
                      card rather than an underline on the text. */}
                  <span className="absolute inset-x-0 top-0 h-[2px] opacity-40 group-hover:opacity-100 transition-opacity"
                    style={{ background: `linear-gradient(90deg, transparent, ${t.accent}, transparent)` }} />
                  <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: `radial-gradient(120% 90% at 50% 0%, ${t.accent}22, transparent 70%)` }} />
                  <t.icon size={16} style={{ color: t.accent }} className="relative" />
                  <div className="relative text-[12.5px] font-medium mt-2">{t.label}</div>
                  <div className="relative text-[10px] text-white/40 leading-tight mt-0.5">{t.scope}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/30 mt-2.5 leading-relaxed">
              The demo district tier switches between all 31 districts. A real account is
              pinned to its own.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Inputs that sit IN the surface rather than on it.
//
// The flat grey rectangle with a 1px border is what made this read as a decade-old form. A
// recessed well — darker than its surround, with a soft inner shadow — plus a gold focus ring
// that grows rather than switches, is the difference between a control and a box.
function Field({ icon: Icon, ...props }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative group">
      {Icon && (
        <Icon size={15}
          className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
            focused ? 'text-kadi-gold' : 'text-white/30'}`} />
      )}
      <input {...props}
        onFocus={(e: any) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e: any) => { setFocused(false); props.onBlur?.(e); }}
        className={`w-full rounded-xl ${Icon ? 'pl-10' : 'pl-3.5'} pr-3.5 py-3 text-[13.5px] text-white
          placeholder-white/30 outline-none transition-all duration-200`}
        style={{
          background: focused ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.22)',
          border: `1px solid ${focused ? 'rgba(232,180,74,0.55)' : 'rgba(255,255,255,0.09)'}`,
          boxShadow: focused
            ? 'inset 0 1px 3px rgba(0,0,0,0.35), 0 0 0 3px rgba(232,180,74,0.13)'
            : 'inset 0 1px 3px rgba(0,0,0,0.30)',
        }} />
    </div>
  );
}

function Notice({ kind, children }: { kind: 'error' | 'ok'; children: any }) {
  const err = kind === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-ctl px-3 py-2 text-[12.5px] leading-snug ${
      err ? 'bg-red-500/15 text-red-200 border border-red-400/25' : 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/25'}`}>
      {err ? <AlertCircle size={14} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  );
}

function SignInCard({ onSignup, onDone }: { onSignup: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const out = await api.post<any>('/auth/login', { email, password });
      setToken(out.token);
      // The role header still rides along for the demo path; the server ignores it while a
      // valid token is present, but keeping it in sync stops the shell flashing the wrong
      // label before /me resolves.
      setRole(out.user.role);
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div className="pb-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-kadi-gold/75">
          <ShieldCheck size={13} /> Secure access
        </div>
        <h2 className="text-[26px] font-semibold tracking-tight mt-2 leading-none">Sign in</h2>
        <p className="text-[12.5px] text-white/45 mt-1.5">Use your official @{DOMAIN} address.</p>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <Field icon={Mail} type="email" required autoComplete="username" placeholder={`officer@${DOMAIN}`}
        value={email} onChange={(e: any) => setEmail(e.target.value)} />
      <Field icon={Lock} type="password" required autoComplete="current-password" placeholder="Password"
        value={password} onChange={(e: any) => setPassword(e.target.value)} />
      <button type="submit" disabled={busy}
        className="group w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold
          text-[#14202b] disabled:opacity-60 transition-all duration-200 hover:-translate-y-px active:translate-y-0"
        style={{
          background: 'linear-gradient(180deg, #F2C75C 0%, #E0A93C 100%)',
          boxShadow: '0 6px 18px -6px rgba(224,169,60,0.55), inset 0 1px 0 rgba(255,255,255,0.35)',
        }}>
        {busy ? <Loader2 size={15} className="animate-spin" />
          : <>Sign in <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" /></>}
      </button>
      <button type="button" onClick={onSignup}
        className="w-full text-[12.5px] text-white/50 hover:text-white/85 transition-colors pt-0.5">
        No account? <span className="text-kadi-gold/85 underline underline-offset-[3px] decoration-kadi-gold/35">Request access</span>
      </button>
    </form>
  );
}

function SignUpCard({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'SP', districtId: '' });
  const [districts, setDistricts] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get<any>('/lookups').then((l) => setDistricts(l.districts || [])).catch(() => {});
  }, []);

  const needsDistrict = SIGNUP_ROLES.find((r) => r.value === form.role)?.needsDistrict;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/auth/signup', form);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Could not submit the request.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Request submitted</h2>
        <Notice kind="ok">
          Your account is recorded and awaiting approval by the DGP or the Administrator. You
          will not be able to sign in until it is approved.
        </Notice>
        <button onClick={onBack} className="w-full text-[12.5px] text-white/60 hover:text-white underline underline-offset-2">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div className="pb-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-kadi-gold/75">
          <ShieldCheck size={13} /> Verified access
        </div>
        <h2 className="text-[26px] font-semibold tracking-tight mt-2 leading-none">Request access</h2>
        <p className="text-[12.5px] text-white/45 mt-1.5">Approved by the DGP or Administrator.</p>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <Field required placeholder="Full name" value={form.fullName}
        onChange={(e: any) => set('fullName', e.target.value)} />
      <Field icon={Mail} type="email" required placeholder={`officer@${DOMAIN}`} value={form.email}
        onChange={(e: any) => set('email', e.target.value)} />
      <Field icon={Lock} type="password" required autoComplete="new-password"
        placeholder="Password — at least 10 characters" value={form.password}
        onChange={(e: any) => set('password', e.target.value)} />
      <select value={form.role} onChange={(e) => set('role', e.target.value)}
        className="w-full rounded-xl px-3.5 py-3 text-[13.5px] text-white outline-none transition-all"
        style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.09)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
        {SIGNUP_ROLES.map((r) => <option key={r.value} value={r.value} className="text-ink">{r.label}</option>)}
      </select>
      {needsDistrict && (
        <select value={form.districtId} onChange={(e) => set('districtId', e.target.value)} required
          className="w-full rounded-xl px-3.5 py-3 text-[13.5px] text-white outline-none transition-all"
          style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.09)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
          <option value="" className="text-ink">Select your district…</option>
          {districts.map((d) => <option key={d.id} value={d.id} className="text-ink">{d.name}</option>)}
        </select>
      )}
      <button type="submit" disabled={busy}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold
          text-[#14202b] disabled:opacity-60 transition-all duration-200 hover:-translate-y-px active:translate-y-0"
        style={{
          background: 'linear-gradient(180deg, #F2C75C 0%, #E0A93C 100%)',
          boxShadow: '0 6px 18px -6px rgba(224,169,60,0.55), inset 0 1px 0 rgba(255,255,255,0.35)',
        }}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : 'Submit request'}
      </button>
      <button type="button" onClick={onBack}
        className="w-full text-[12.5px] text-white/60 hover:text-white transition-colors underline underline-offset-2">
        Back to sign in
      </button>
    </form>
  );
}

