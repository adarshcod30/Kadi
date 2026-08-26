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
import { Globe, MapPin, Building2, Loader2, ArrowRight, Lock, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { setRole, setToken, signOut, Role, api } from '../lib/api';

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
    <div className="min-h-screen relative overflow-hidden bg-kadi-navy text-white">
      <div className="absolute inset-0" style={{
        background:
          'radial-gradient(1000px 560px at 8% -8%, rgba(26,111,196,0.32), transparent 60%),'
          + 'radial-gradient(820px 480px at 92% 106%, rgba(47,168,160,0.18), transparent 58%),'
          + 'linear-gradient(150deg, #0d3149 0%, #0B2437 55%, #08202f 100%)',
      }} />
      {/* The seal, moved up and left so it reads as the crest behind the page rather than a
          shape falling off the corner, and the node field pulled right back — it was competing
          with the form instead of sitting behind it. */}
      <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt=""
        className="pointer-events-none absolute -left-16 -top-16 w-[420px] opacity-[0.06] select-none" />
      <NetworkBackdrop />

      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1fr_460px]">
        {/* Left: identity and the numbers, nothing else */}
        <div className="flex flex-col justify-center px-8 lg:px-14 py-12">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div className="flex items-center gap-4">
              <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt="Government of Karnataka"
                className="h-16 w-16 rounded-full bg-white/95 p-1 shrink-0" />
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-kadi-gold/90">Karnataka State Police</div>
                <h1 className="text-6xl lg:text-7xl font-bold tracking-tight leading-none mt-1">KADI</h1>
                <div className="text-[12.5px] uppercase tracking-[0.18em] text-white/45 mt-1.5">
                  Crime Analytics &amp; Intelligence
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.12 }}
            className="mt-10 grid grid-cols-2 gap-2.5 max-w-lg">
            {[
              { v: figures?.cases, label: 'FIRs in one graph' },
              { v: figures?.offenders, label: 'Repeat offenders resolved' },
              { v: figures?.networks, label: 'Active offender networks' },
              { v: figures?.recovery, label: 'Ground-truth recovery', suffix: '%' },
            ].map((k) => (
              <div key={k.label} className="rounded-card border border-white/10 bg-white/[0.05] px-4 py-3">
                <div className="text-2xl font-semibold font-num text-kadi-gold tabular-nums">
                  {figures ? <Counter to={k.v || 0} suffix={k.suffix} /> : <span className="opacity-30">—</span>}
                </div>
                <div className="text-[12px] text-white/70 mt-0.5 leading-tight">{k.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Right: the door */}
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, delay: 0.08 }}
          className="bg-white/[0.07] backdrop-blur-md border-l border-white/10 flex flex-col justify-center px-7 py-10">
          {mode === 'signin'
            ? <SignInCard onSignup={() => setMode('signup')} onDone={() => nav('/')} />
            : <SignUpCard onBack={() => setMode('signin')} />}

          <div className="mt-7 pt-5 border-t border-white/10">
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-white/40 mb-2.5">
              Or explore without an account
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_TIERS.map((t) => (
                <button key={t.key}
                  onClick={() => { setToken(null); setRole(t.role); nav('/'); }}
                  className="group rounded-ctl border border-white/12 bg-white/[0.04] hover:bg-white/[0.10] hover:border-white/25 px-2.5 py-2.5 text-left transition-all">
                  <t.icon size={15} style={{ color: t.accent }} />
                  <div className="text-[12.5px] font-medium mt-1.5">{t.label}</div>
                  <div className="text-[10.5px] text-white/45 leading-tight">{t.scope}</div>
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-white/35 mt-2.5 leading-relaxed">
              Demo access. The district tier may switch between all 31 districts; a real
              account is pinned to its own.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, ...props }: any) {
  return (
    <div className="relative">
      {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />}
      <input {...props}
        className={`w-full bg-white/[0.07] border border-white/15 rounded-ctl ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2.5
          text-[13.5px] text-white placeholder-white/35 outline-none focus:border-kadi-gold/60 focus:bg-white/[0.10] transition-colors`} />
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
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Sign in</h2>
        <p className="text-[12.5px] text-white/50 mt-0.5">Use your official @{DOMAIN} address.</p>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <Field icon={Mail} type="email" required autoComplete="username" placeholder={`officer@${DOMAIN}`}
        value={email} onChange={(e: any) => setEmail(e.target.value)} />
      <Field icon={Lock} type="password" required autoComplete="current-password" placeholder="Password"
        value={password} onChange={(e: any) => setPassword(e.target.value)} />
      <button type="submit" disabled={busy}
        className="w-full flex items-center justify-center gap-2 bg-kadi-gold text-kadi-navy font-semibold rounded-ctl py-2.5 text-[14px] hover:brightness-105 disabled:opacity-60 transition-all">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <>Sign in <ArrowRight size={15} /></>}
      </button>
      <button type="button" onClick={onSignup}
        className="w-full text-[12.5px] text-white/60 hover:text-white transition-colors">
        No account? <span className="underline underline-offset-2">Request access</span>
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
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Request access</h2>
        <p className="text-[12.5px] text-white/50 mt-0.5">Approved by the DGP or Administrator.</p>
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
        className="w-full bg-white/[0.07] border border-white/15 rounded-ctl px-3 py-2.5 text-[13.5px] text-white outline-none focus:border-kadi-gold/60">
        {SIGNUP_ROLES.map((r) => <option key={r.value} value={r.value} className="text-ink">{r.label}</option>)}
      </select>
      {needsDistrict && (
        <select value={form.districtId} onChange={(e) => set('districtId', e.target.value)} required
          className="w-full bg-white/[0.07] border border-white/15 rounded-ctl px-3 py-2.5 text-[13.5px] text-white outline-none focus:border-kadi-gold/60">
          <option value="" className="text-ink">Select your district…</option>
          {districts.map((d) => <option key={d.id} value={d.id} className="text-ink">{d.name}</option>)}
        </select>
      )}
      <button type="submit" disabled={busy}
        className="w-full flex items-center justify-center gap-2 bg-kadi-gold text-kadi-navy font-semibold rounded-ctl py-2.5 text-[14px] hover:brightness-105 disabled:opacity-60 transition-all">
        {busy ? <Loader2 size={15} className="animate-spin" /> : 'Submit request'}
      </button>
      <button type="button" onClick={onBack}
        className="w-full text-[12.5px] text-white/60 hover:text-white transition-colors underline underline-offset-2">
        Back to sign in
      </button>
    </form>
  );
}

// Kept, but pulled well back. At the earlier weight it read as a foreground pattern and the
// sign-in form had to compete with it.
function NetworkBackdrop() {
  const [seed] = useState(() => {
    const nodes = Array.from({ length: 22 }, (_, i) => ({
      id: i, x: Math.random() * 100, y: Math.random() * 100, d: 7 + Math.random() * 9,
    }));
    const edges: { a: typeof nodes[0]; b: typeof nodes[0] }[] = [];
    for (const n of nodes) {
      const near = nodes.filter((m) => m.id !== n.id)
        .sort((p, q) => ((p.x - n.x) ** 2 + (p.y - n.y) ** 2) - ((q.x - n.x) ** 2 + (q.y - n.y) ** 2))[0];
      if (near && n.id < near.id) edges.push({ a: n, b: near });
    }
    return { nodes, edges };
  });
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100"
      preserveAspectRatio="none" aria-hidden="true">
      <g stroke="#7CC4F5" strokeWidth="0.08" opacity="0.14">
        {seed.edges.map((e, i) => <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />)}
      </g>
      <g fill="#7CC4F5">
        {seed.nodes.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r="0.16" opacity="0.2">
            <animate attributeName="opacity" values="0.08;0.3;0.08" dur={`${n.d}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>
    </svg>
  );
}
