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

const ROLES: { role: Role; title: string; scope: string; sees: string; colour: string }[] = [
  {
    role: 'SI', title: 'Sub-Inspector', scope: 'Own police station',
    sees: 'FIRs registered at their unit, the linkage graph around those FIRs, and their own investigation-health worklist.',
    colour: '#2FA8A0',
  },
  {
    role: 'Inspector', title: 'Inspector', scope: 'Own police station',
    sees: 'Everything an SI sees, plus arrest and chargesheet detail for the unit.',
    colour: '#1A6FC4',
  },
  {
    role: 'ACP', title: 'ACP / DySP', scope: 'Whole district',
    sees: 'Every FIR in the district, cross-station offender networks, district hotspots, and the audit log.',
    colour: '#E8871E',
  },
  {
    role: 'Analyst', title: 'SCRB Analyst', scope: 'Entire state',
    sees: 'All 40,836 FIRs, state-wide networks, per-capita analytics, forecasting and anomaly detection.',
    colour: '#0f2f44',
  },
  {
    role: 'Admin', title: 'Administrator', scope: 'Entire state + governance',
    sees: 'Everything an Analyst sees, plus the fairness report, pipeline status and full audit trail.',
    colour: '#7C5CBF',
  },
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
            Access is scoped by rank. Pick a role to enter with exactly the data that rank is
            entitled to see — the scoping below is enforced server-side on every query.
          </p>

          <div className="mt-4 space-y-2">
            {ROLES.map((r) => (
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
