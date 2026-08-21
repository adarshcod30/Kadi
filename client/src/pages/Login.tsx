// Login — the entry point, and an honest one.
//
// Catalyst Authentication is provisioned on the project, but the identity binding is not
// wired: the API derives the caller's role from a header rather than a verified JWT. Rather
// than fake a password box that accepts anything, this screen presents the five real KSP
// roles, states exactly what each one may see, and says plainly which part is demo. An
// evaluator can then exercise every RBAC scope in seconds instead of needing five accounts.
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Info, ArrowRight, Lock } from 'lucide-react';
import { setRole, Role } from '../lib/api';

const ROLES: { role: Role; title: string; scope: string; sees: string; colour: string; tier: 'state' | 'district' }[] = [
  // --- STATE TIER: the whole of Karnataka ---
  {
    role: 'Analyst', title: 'SCRB Analyst', scope: 'Entire state', tier: 'state',
    sees: 'Every FIR in Karnataka, state-wide offender networks, per-capita analytics, forecasting, anomaly detection and the zone board.',
    colour: '#0f2f44',
  },
  {
    role: 'DGP', title: 'State DGP', scope: 'Entire state', tier: 'state',
    sees: 'The command picture across all 31 districts, with drill-down into any of them.',
    colour: '#1A6FC4',
  },
  {
    role: 'Admin', title: 'Administrator', scope: 'State + governance', tier: 'state',
    sees: 'Everything the state tier sees, plus the fairness report, pipeline status and the full audit trail.',
    colour: '#7C5CBF',
  },
  // --- DISTRICT TIER: one district, and whatever links into it ---
  {
    role: 'SP', title: 'Superintendent of Police', scope: 'Own district', tier: 'district',
    sees: 'Every FIR in the district, cross-station offender networks, district hotspots and the audit log.',
    colour: '#E8871E',
  },
  {
    role: 'DSP', title: 'DySP / ACP', scope: 'Own district', tier: 'district',
    sees: 'District FIRs, the linkage graph across stations, and the investigation-health worklist for the sub-division.',
    colour: '#C9820A',
  },
  {
    role: 'SI', title: 'Sub-Inspector (IO)', scope: 'Own district', tier: 'district',
    sees: 'District FIRs with station drill-down, the linkage graph around their cases, and their own health worklist.',
    colour: '#2FA8A0',
  },
];

const TIERS = [
  { key: 'state' as const, label: 'State access', note: 'All 31 districts. SCRB, DGP and Administrator.' },
  { key: 'district' as const, label: 'District access', note: 'One district, plus every case linked into it. SP, DySP and Sub-Inspector.' },
];

export default function Login() {
  const nav = useNavigate();

  const enter = (r: Role) => {
    setRole(r);
    nav('/');
  };

  return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center p-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }} className="w-full max-w-3xl">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-5">
          <img src="/seal-karnataka.svg" alt="Government of Karnataka" className="h-12 w-12 rounded-full bg-white p-0.5 border border-line" />
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded bg-kadi-navy grid place-items-center text-kadi-gold font-bold kn text-sm">ಕ</span>
              <h1 className="text-xl font-semibold text-kadi-navy">KADI</h1>
            </div>
            <p className="text-sm text-ink-muted">Karnataka State Police — Crime Analytics &amp; Intelligence</p>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <ShieldCheck size={17} className="text-kadi-blue" /> Sign in by role
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            Access runs in two tiers — <b className="text-ink">state</b> and <b className="text-ink">district</b>.
            Pick a rank to enter with exactly the data it is entitled to see; scoping is
            enforced server-side on every query, and a district rank can drill into any
            station within its own district but never outside it.
          </p>

          <div className="mt-4 space-y-4">
            {TIERS.map((tier) => (
              <div key={tier.key}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-kadi-navy">{tier.label}</span>
                  <span className="text-[11.5px] text-ink-muted">{tier.note}</span>
                </div>
                <div className="space-y-2">
            {ROLES.filter((r) => r.tier === tier.key).map((r) => (
              <motion.button key={r.role} whileHover={{ x: 3 }} onClick={() => enter(r.role)}
                className="w-full text-left rounded-card border border-line hover:border-kadi-blue hover:bg-kadi-blue50/40 transition-colors px-4 py-3 flex items-start gap-3">
                <span className="w-9 h-9 rounded-full grid place-items-center text-white text-xs font-semibold shrink-0"
                  style={{ background: r.colour }}>{r.role[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <b className="text-sm text-ink">{r.title}</b>
                    <span className="chip bg-surface-3 text-ink-muted">{r.scope}</span>
                  </span>
                  <span className="block text-[12.5px] text-ink-muted mt-0.5">{r.sees}</span>
                </span>
                <ArrowRight size={15} className="text-ink-muted mt-2 shrink-0" />
              </motion.button>
            ))}
                </div>
              </div>
            ))}
          </div>

          {/* Say plainly what is real and what is not. */}
          <div className="mt-4 flex items-start gap-2 rounded-ctl border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-muted">
            <Info size={14} className="text-kadi-blue shrink-0 mt-0.5" />
            <span>
              <b className="text-ink">What is real, and what is demo.</b> The role scoping is real:
              the API filters every query by the caller's unit, district or state and refuses
              out-of-scope reads. The <em>identity check</em> is not — Catalyst Authentication is
              provisioned on this project, but the API still trusts a role header instead of a
              verified JWT, so this screen is a role chooser rather than a password gate.
              In production the single function <code className="text-ink">userFromRequest</code>
              {' '}reads the Catalyst token and maps it to the officer's rank; nothing else changes.
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-muted">
            <Lock size={12} /> Insights use evidence &amp; behaviour only — never caste, religion, or occupation.
          </div>
        </div>
      </motion.div>
    </div>
  );
}
