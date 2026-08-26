// The welcome screen.
//
// This is the first thing anyone sees, so it has to make the product's case before a single
// feature is opened. It does that with figures rather than adjectives: the counts below are
// fetched live from the running system at page load, so "59,985 FIRs joined into one graph" is
// the deployment answering for itself rather than a claim printed on a slide. If the pipeline
// were empty the page would say so, which is the point of reading them live.
//
// Access is presented as the three tiers the force actually has — state, district, station —
// because that hierarchy is the product's argument. Standing in the station view and seeing
// how little one register holds is what makes the state view mean anything.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Globe, MapPin, Building2 } from 'lucide-react';
import { setRole, Role, api } from '../lib/api';

type Tier = {
  key: string;
  icon: typeof Globe;
  label: string;
  scope: string;
  accent: string;
  posts: { role: Role; title: string; sees: string }[];
};

const TIERS: Tier[] = [
  {
    key: 'state', icon: Globe, label: 'State', scope: 'All 31 districts', accent: '#1A6FC4',
    posts: [
      { role: 'DGP', title: 'State DGP', sees: 'The command picture across all 31 districts, with drill-down into any one of them.' },
      { role: 'Analyst', title: 'SCRB Analyst', sees: 'Every FIR, state-wide offender networks, per-capita analytics, forecasting and anomaly detection.' },
      { role: 'Admin', title: 'Administrator', sees: 'Everything the state tier sees, plus the fairness report, pipeline status and the audit trail.' },
    ],
  },
  {
    key: 'district', icon: MapPin, label: 'District', scope: 'One district + what links into it', accent: '#E8871E',
    posts: [
      { role: 'SP', title: 'Superintendent of Police', sees: 'Every FIR in the district, cross-station networks, district hotspots and the audit log.' },
      { role: 'DSP', title: 'DySP / ACP', sees: 'District FIRs, the linkage graph across stations, and the sub-division health worklist.' },
      { role: 'SI', title: 'Sub-Inspector (IO)', sees: 'District FIRs with station drill-down, and the linkage graph around their own cases.' },
    ],
  },
  {
    key: 'station', icon: Building2, label: 'Station', scope: 'One station register', accent: '#2FA8A0',
    posts: [
      { role: 'SHO' as Role, title: 'Station House Officer', sees: 'Bengaluru Bazaar PS and nothing beyond it — the silo this platform exists to break. Every repeat offender on its register also offends elsewhere, and from here you cannot see where.' },
    ],
  },
];

// Live counters. Each is read from the deployed API, so the page cannot overstate the system.
function useLiveFigures() {
  const [f, setF] = useState<{ cases: number; offenders: number; networks: number; recovery: number } | null>(null);
  useEffect(() => {
    Promise.all([
      api.get<any>('/stats').catch(() => null),
      api.get<any>('/eval').catch(() => null),
    ]).then(([s, e]) => {
      if (!s) return;
      setF({
        cases: s.totalCases || 0,
        offenders: s.resolvedOffenders || 0,
        networks: s.activeNetworks || 0,
        recovery: e?.overallRecoveryPct ?? 0,
      });
    });
  }, []);
  return f;
}

// Counts up to the real value. Motion here is doing a job rather than decorating: a number
// that lands rather than appears reads as measured, which is what these are.
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!to) return undefined;
    const start = performance.now();
    const dur = 1100;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      // ease-out, so it decelerates into the figure instead of stopping dead
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
  const [openTier, setOpenTier] = useState<string>('state');

  const enter = (r: Role) => { setRole(r); nav('/'); };

  return (
    <div className="min-h-screen relative overflow-hidden bg-kadi-navy text-white">
      {/* Background: the linkage graph itself, drawn faintly. The product is a graph over
          FIRs, so the wallpaper is that graph rather than a stock gradient. */}
      {/* Layer order matters: a wash first, the graph over it, the seal last. The earlier
          version put a multiply blend on top of an already-dark navy and drove the whole page
          to near-black -- every element was rendered and none of it was readable. */}
      <div className="absolute inset-0" style={{
        background:
          'radial-gradient(1100px 600px at 12% -5%, rgba(26,111,196,0.30), transparent 62%),'
          + 'radial-gradient(900px 520px at 88% 108%, rgba(47,168,160,0.20), transparent 60%),'
          + 'linear-gradient(150deg, #0d3149 0%, #0B2437 55%, #08202f 100%)',
      }} />
      <NetworkBackdrop />
      <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt=""
        className="pointer-events-none absolute -right-20 -bottom-24 w-[460px] opacity-[0.07] select-none" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 lg:py-14">
        {/* Brand */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="flex items-center gap-4">
          <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt="Government of Karnataka"
            className="h-14 w-14 rounded-full bg-white/95 p-1 shrink-0" />
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-kadi-gold/90">Karnataka State Police</div>
            <h1 className="text-5xl lg:text-6xl font-bold tracking-tight leading-none mt-0.5">KADI</h1>
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }}
          className="mt-5 text-lg lg:text-xl text-white/80 max-w-2xl leading-snug">
          Every FIR in Karnataka, joined into one connected picture — serial offenders,
          cross-district networks and slipping investigations, surfaced with the evidence
          behind each one.
        </motion.p>

        {/* Figures, read live. This is the claim and the proof in the same row. */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.16 }}
          className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { v: figures?.cases, label: 'FIRs in one graph', hint: 'not 31 registers' },
            { v: figures?.offenders, label: 'Repeat offenders resolved', hint: 'name variants merged' },
            { v: figures?.networks, label: 'Active offender networks', hint: 'groups, not lone repeats' },
            { v: figures?.recovery, label: 'Ground-truth recovery', hint: 'scored every pipeline run', suffix: '%' },
          ].map((k) => (
            <div key={k.label} className="rounded-card border border-white/12 bg-white/[0.06] backdrop-blur-sm px-4 py-3">
              <div className="text-2xl lg:text-3xl font-semibold font-num text-kadi-gold tabular-nums">
                {figures ? <Counter to={k.v || 0} suffix={k.suffix} /> : <span className="opacity-40">—</span>}
              </div>
              <div className="text-[12.5px] text-white/85 mt-0.5 leading-tight">{k.label}</div>
              <div className="text-[11px] text-white/45 leading-tight">{k.hint}</div>
            </div>
          ))}
        </motion.div>

        {/* Access */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.24 }}
          className="mt-10">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/70">Choose your access</h2>
            <span className="text-[12.5px] text-white/45">
              Scope is enforced server-side on every query, not hidden in the interface.
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            {TIERS.map((t) => {
              const active = openTier === t.key;
              return (
                <div key={t.key}
                  onMouseEnter={() => setOpenTier(t.key)}
                  className={`rounded-card border transition-all duration-200 overflow-hidden ${
                    active ? 'border-white/30 bg-white/[0.09]' : 'border-white/10 bg-white/[0.04] hover:border-white/20'}`}>
                  <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-full grid place-items-center shrink-0"
                      style={{ background: `${t.accent}22`, color: t.accent }}>
                      <t.icon size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight">{t.label}</div>
                      <div className="text-[11.5px] text-white/50 leading-tight">{t.scope}</div>
                    </div>
                  </div>
                  <div className="px-2 pb-2 space-y-1">
                    {t.posts.map((p) => (
                      <button key={p.role} onClick={() => enter(p.role)}
                        className="group w-full text-left rounded-ctl px-3 py-2.5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-medium">{p.title}</span>
                          <ArrowRight size={13} className="ml-auto opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all shrink-0" />
                        </div>
                        <div className="text-[11.5px] text-white/55 leading-snug mt-0.5">{p.sees}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="mt-8 text-[11.5px] text-white/35">
          Links and risk are built from evidence and behaviour only — never caste, religion or
          occupation. Synthetic corpus, schema-faithful to the KSP FIR system.
        </motion.div>
      </div>
    </div>
  );
}

// A slow-drifting node-link field. Generated once and animated with CSS only, so it costs
// nothing per frame in JS and never competes with the page for the main thread.
function NetworkBackdrop() {
  const [seed] = useState(() => {
    const nodes = Array.from({ length: 34 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: 1 + Math.random() * 2.6,
      d: 6 + Math.random() * 10,
    }));
    const edges: { a: typeof nodes[0]; b: typeof nodes[0] }[] = [];
    for (const n of nodes) {
      const near = nodes
        .filter((m) => m.id !== n.id)
        .sort((p, q2) => ((p.x - n.x) ** 2 + (p.y - n.y) ** 2) - ((q2.x - n.x) ** 2 + (q2.y - n.y) ** 2))
        .slice(0, 2);
      for (const m of near) if (n.id < m.id) edges.push({ a: n, b: m });
    }
    return { nodes, edges };
  });

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100"
      preserveAspectRatio="none" aria-hidden="true">
      <g stroke="#7CC4F5" strokeWidth="0.14" opacity="0.42">
        {seed.edges.map((e, i) => <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />)}
      </g>
      <g fill="#7CC4F5">
        {seed.nodes.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r={n.r / 10} opacity="0.5">
            <animate attributeName="opacity" values="0.25;0.85;0.25" dur={`${n.d}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>
    </svg>
  );
}
