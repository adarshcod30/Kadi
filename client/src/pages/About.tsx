
import { motion } from 'framer-motion';
import {
  Share2, Activity, Users, Layers, MessageSquare, ShieldCheck, ScrollText, Database,
  ArrowRight, CheckCircle2, AlertTriangle, Cpu, Lock, Globe,
} from 'lucide-react';
import { SiloToGraph, FairnessShield, PipelineFlow, MapHotspot, RiskArt, AssistantArt } from '../components/illustrations';
import { PlatformSection, DataSection } from '../components/AboutSections';
import { useStats, useEval } from '../api/hooks';
import { useNav } from '../lib/useNav';

const rise = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

export default function About() {
  const nav = useNav();
  const { data: stats } = useStats();
  const { data: ev } = useEval();

  return (
    <div className="max-w-6xl mx-auto space-y-16 pb-10">
      {/* HERO */}
      <motion.section initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12 } } }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-kadi-navy via-kadi-navy700 to-[#0a2547] text-white p-8 md:p-12">
        <div className="absolute -right-10 -top-10 opacity-20 pointer-events-none"><SiloToGraph className="w-[520px]" /></div>
        <motion.div variants={rise} className="flex items-center gap-3 mb-4">
          <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} className="h-12 w-12 rounded-full bg-white/95 p-1" alt="Government of Karnataka" />
          <div className="text-sm text-white/70 leading-tight">Karnataka State Police<br />Government of Karnataka</div>
        </motion.div>
        <motion.h1 variants={rise} className="text-3xl md:text-4xl font-bold flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg bg-white/15 grid place-items-center text-kadi-gold kn">ಕ</span>
          KADI
        </motion.h1>
        <motion.p variants={rise} className="text-lg text-white/90 mt-2 max-w-2xl">Karnataka Analytics &amp; Detection Intelligence — an AI-driven crime analytics &amp; visualization platform.</motion.p>
        <motion.p variants={rise} className="text-white/70 mt-3 max-w-2xl">
          <span className="kn">कड़ी</span> means "a link in a chain." KADI turns thousands of siloed FIRs into a single living graph —
          instantly revealing a new case's connected past, serial-crime chains and repeat-offender networks, and which live
          investigations are silently slipping — all with an <b className="text-white">explainable, fair, evidence-backed</b> trail.
        </motion.p>
        <motion.div variants={rise} className="flex flex-wrap gap-3 mt-6">
          <button onClick={() => nav('/')} className="btn bg-white text-kadi-navy hover:bg-white/90 font-semibold">Open the dashboard <ArrowRight size={16} /></button>
          <button onClick={() => nav('/graph')} className="btn bg-white/10 text-white hover:bg-white/20"><Share2 size={16} /> Explore the graph</button>
        </motion.div>
        {stats && (
          <motion.div variants={rise} className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 max-w-2xl">
            {[[stats.totalCases.toLocaleString(), 'FIRs analysed'], [stats.resolvedOffenders.toLocaleString(), 'Repeat offenders'],
              [stats.activeNetworks, 'Offender networks'], [ev ? `${ev.overallRecoveryPct}%` : '—', 'Detection recall']].map(([v, l], i) => (
              <div key={i}><div className="text-2xl font-bold font-num">{v}</div><div className="text-xs text-white/60">{l}</div></div>
            ))}
          </motion.div>
        )}
      </motion.section>

      {/* PROBLEM → SOLUTION */}
      <Section title="Why KADI exists" kicker="The problem">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div className="space-y-3">
            {[
              ['Data silos', 'FIRs are registered per station and live in isolation. A gang operating across stations shows up as many unrelated petty crimes — cross-jurisdiction connections are invisible.'],
              ['Reactive policing', 'No systematic early warning: cases drift past detection timelines, pile up as "undetected", or close as "false" with no supervisory signal.'],
              ['Analytics gap', 'Where analytics exist they are static Excel sheets and dashboards; deeper behavioural, relational and network patterns go undiscovered.'],
              ['Fairness risk', 'Naive predictive policing is criticised for discriminating on caste/religion. A credible solution must refuse to use them — and prove it.'],
            ].map(([t, d]) => (
              <div key={t} className="flex gap-3">
                <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
                <div><div className="font-semibold text-ink">{t}</div><div className="text-sm text-ink-muted">{d}</div></div>
              </div>
            ))}
          </div>
          <div className="card p-6 bg-surface-2"><SiloToGraph className="w-full" />
            <p className="text-sm text-ink-muted mt-3 text-center">KADI connects fragmented data points into one relational picture, moving KSP from reactive reporting to <b className="text-kadi-navy">proactive, evidence-based policing</b>.</p>
          </div>
        </div>
      </Section>

      {/* FEATURES */}
      <Section title="What KADI does" kicker="Every capability, explained">
        <div className="grid md:grid-cols-2 gap-6">
          <Feature icon={<Share2 />} art={<SiloToGraph className="w-full h-36" />} title="Case-Linkage Graph" to="/graph" onNav={nav}
            desc="Open any FIR and watch its connected network assemble — related cases, shared and co-accused offenders, serial chains and gang clusters across stations and districts. Every link is click-through to a 'Why linked' panel showing the exact matching attributes and source FIR numbers." />
          <Feature icon={<Users />} art={<RiskArt className="w-full h-36" />} title="Repeat-Offender Networks & Risk" to="/offenders" onNav={nav}
            desc="Name variants ('Ravi Kumar' / 'Ravikumar R') are resolved into one identity via entity resolution. Each offender gets a transparent, behaviour-based risk score (0–100) with a full factor breakdown — priors, recency, re-offending after arrest, network centrality — and never any protected attribute." />
          <Feature icon={<Activity />} art={<PipelineFlow className="w-full h-24" />} title="Investigation-Health Early Warning" to="/health" onNav={nav}
            desc="A cockpit that flags cases slipping past detection timelines — reporting delay, ageing vs peer median, pendency, undetected-risk, false-case patterns — each with a plain-language reason and a recommended next action, deterministic and auditable." />
          <Feature icon={<Layers />} art={<MapHotspot className="w-full h-36" />} title="Spatiotemporal Intelligence" to="/map" onNav={nav}
            desc="District-level crime density on a satellite map, live incident points, and DBSCAN hotspots. Time-of-day × weekday layering surfaces patrol windows, and pulsing red-zones flag emerging trends where recent activity far exceeds the historical baseline." />
          <Feature icon={<MessageSquare />} art={<AssistantArt className="w-full h-36" />} title="Conversational + Kannada Assistant" to="/assistant" onNav={nav}
            desc="Ask questions over the case records in English or Kannada, by text or voice. Answers are grounded in the data, always cite FIR numbers, deep-link into the graph/cockpit, and export as a print-ready briefing — never using protected attributes for any judgment." />
          <Feature icon={<ShieldCheck />} art={<FairnessShield className="w-full h-36" />} title="Explainability, Fairness & Audit" to="/audit" onNav={nav}
            desc="Every edge, score and answer carries an explanation. Caste, religion and occupation are excluded from every model by design — enforced by a unit test that fails if any protected column appears in a feature set — and every sensitive read is written to an audit log." />
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <Section title="How it works" kicker="Architecture">
        <div className="card p-6">
          <PipelineFlow className="w-full max-w-lg mx-auto h-24" />
          <p className="text-sm text-ink-muted mt-4 max-w-3xl mx-auto text-center">
            Heavy compute — entity resolution, graph build, community detection, risk, health, anomaly and spatial analysis —
            runs asynchronously in a Python pipeline (Catalyst AppSail / Jobs on a nightly Cron). The web app and API only
            <b className="text-kadi-navy"> read precomputed results</b>, so every graph and dashboard loads instantly.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 mt-6">
            {[[<Cpu size={18} />, 'Entity resolution + graph', 'rapidfuzz name matching, networkx multigraph, Louvain communities'],
              [<Database size={18} />, 'Precomputed read-model', 'Catalyst Data Store (40,836 FIRs, live ZCQL) \u00b7 Stratus object store'],
              [<Lock size={18} />, 'Fair by construction', 'protected attributes excluded + asserted in tests']].map(([ic, t, d], i) => (
              <div key={i} className="bg-surface-2 rounded-card p-4"><div className="text-kadi-blue mb-1">{ic}</div><div className="font-semibold text-sm">{t}</div><div className="text-xs text-ink-muted mt-0.5">{d}</div></div>
            ))}
          </div>
        </div>
      </Section>

      {/* THE ML PROGRAMME. The strongest material in the project and it was not on this page.
          Judges reading About learned what KADI does and nothing about whether any of it was
          measured -- while the repository holds twenty measured tasks, twelve of them rejected
          with the specific test that killed each. The rejections are the more useful half. */}
      <Section title="Twenty tasks measured. Eight ship." kicker="The models">
        <div className="card p-6 space-y-5">
          <p className="text-sm text-ink-muted max-w-3xl">
            Every candidate model was scored on a <b className="text-kadi-navy">time-ordered hold-out</b> against
            the <b className="text-kadi-navy">best simple rule</b> available on the same information — not the
            first baseline that came to mind. That single choice decided most of the results:
            against an obvious baseline nearly all of them win, and against the best one nearly
            all of them lose. A model that cannot beat a one-line rule is worse than no model,
            because it reads as capability while adding a serving dependency and a failure mode.
          </p>

          <div className="grid sm:grid-cols-3 gap-4">
            {[['8', 'models serving', 'each beating its own baseline on AUC and average precision'],
              ['12', 'rejected', 'three of them score higher than models that ship'],
              ['+0.169', 'widest margin', 'station pendency — 0.870 against the load rule\u2019s 0.701']].map(([v, l, d], i) => (
                <div key={i} className="bg-surface-2 rounded-card p-4">
                  <div className="text-2xl font-bold font-num text-kadi-navy">{v}</div>
                  <div className="text-sm font-semibold text-ink">{l}</div>
                  <div className="text-xs text-ink-muted mt-0.5">{d}</div>
                </div>
              ))}
          </div>

          <div>
            <div className="text-sm font-semibold text-kadi-navy mb-2">The five tests a candidate has to survive</div>
            <div className="space-y-2">
              {[['Time-ordered hold-out', 'A random split puts test rows between training rows of the same series and flatters everything.'],
                ['Best-available baseline', 'Re-scored the spike model from a claimed +0.168 to a real +0.058.'],
                ['Scale-free re-run', 'Strip every absolute volume. Station surge fell 0.738 → 0.583, below its rule — it was learning station size, not risk. Rejected.'],
                ['Conditional test', '“Comes back AND it is property” inherits the predictability of “comes back”. Scored only on those who returned, property, body and economic crime all collapsed.'],
                ['Degeneracy guard, at serving time', 'An endpoint returning one identical value for every candidate has not ranked anything. It caught the original spike classifier, which answered 0 for everyone.']].map(([t, d], i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <CheckCircle2 size={15} className="text-kadi-teal shrink-0 mt-0.5" />
                    <div><b className="text-ink">{t}</b> <span className="text-ink-muted">{d}</span></div>
                  </div>
                ))}
            </div>
          </div>

          <div className="rounded-ctl border border-line bg-surface-2 p-4">
            <div className="text-sm font-semibold text-kadi-navy mb-1">Why station pendency, and not hotspot prediction</div>
            <p className="text-sm text-ink-muted">
              Place-based forecasting was ruled out arithmetically, not by preference: at a 1 km
              cell and a week this register averages one case, so the Poisson floor puts the best
              possible predictor <b className="text-kadi-navy">78% out</b>. The Indian econometric
              literature points somewhere else entirely — Hazra (2020) across 32 states and
              Dutta &amp; Husain (2009) both find that charge-sheeting rate, conviction rate and
              pendency are the deterrence variables that move crime rates here. That is a lever
              about <b className="text-kadi-navy">disposal</b>, and a FIR register can speak to
              disposal. A backlog stock averages 46 per station-month and is worth modelling.
            </p>
          </div>

          <button onClick={() => nav('/forecast')} className="text-sm link flex items-center gap-1">
            See every measurement on the Forecast page <ArrowRight size={14} />
          </button>
        </div>
      </Section>

      {/* THE ASSISTANT. Its architecture is the anti-hallucination argument and belongs here. */}
      <Section title="An assistant that cannot invent an FIR number" kicker="Grounding">
        <div className="card p-6 space-y-4">
          <p className="text-sm text-ink-muted max-w-3xl">
            The assistant is built on one rule, and everything else follows from it:
            <b className="text-kadi-navy"> the model never retrieves, it only phrases.</b> Counts,
            citations, intents and actions are computed by deterministic code against the register
            before any language model is called. The model is handed those facts and asked to
            write two sentences. It cannot invent an FIR number because it is never in a position
            to look one up.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[['The register', 'Counts and lists, computed live and cited by FIR number.', 'teal'],
              ['The knowledge base', 'What a thing means — how risk is built, what a flag asks you to do.', 'purple'],
              ['A document', 'A photograph the officer is holding, read by a vision model. Never merged with the register.', 'gold'],
              ['Speech', 'Questions asked and answers read aloud in English, Hindi or Kannada.', 'blue']].map(([t, d], i) => (
                <div key={i} className="bg-surface-2 rounded-card p-4">
                  <div className="font-semibold text-sm text-kadi-navy">{t}</div>
                  <div className="text-xs text-ink-muted mt-1">{d}</div>
                </div>
              ))}
          </div>
          <p className="text-xs text-ink-subtle max-w-3xl">
            Every answer carries a badge naming which of these it came from. A count from the
            register and a definition from the handbook are different kinds of claim, and an
            officer about to act on one needs to know which they are reading. Where an answer’s
            exact wording <i>is</i> the content — “this case is not visible in your scope, which is
            not the same as it not existing” — the model is bypassed entirely.
          </p>
        </div>
      </Section>

      {/* SCOPE. Judges ask about this and officers live inside it. */}
      <Section title="Who sees what" kicker="Scope">
        <div className="card p-6">
          <p className="text-sm text-ink-muted max-w-3xl mb-4">
            Scope is enforced on the server before any query runs, and re-derived from the request
            every time — there is no session holding it. A signed-in account is pinned to the
            district and station in its token; <code className="font-mono text-xs">?district=</code>
            in the URL is ignored for anything below state tier.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            {[['State', 'DGP · SCRB Analyst · Administrator', 'All 31 districts. May drill into any one and back out — the whole point of holding the state view.'],
              ['District', 'SP · DySP / ACP', 'One district’s registers and offenders. Never more than one at a time.'],
              ['Station', 'SHO · Sub-Inspector', 'One register. The tier this product argues from: stand in it and see how little is visible.']].map(([t, who, d], i) => (
                <div key={i} className="bg-surface-2 rounded-card p-4">
                  <div className="font-semibold text-kadi-navy">{t}</div>
                  <div className="text-xs text-kadi-blue mt-0.5">{who}</div>
                  <div className="text-xs text-ink-muted mt-1.5">{d}</div>
                </div>
              ))}
          </div>
        </div>
      </Section>

      {/* WHAT IT REFUSES. A capability list without this reads as marketing. */}
      <Section title="What KADI deliberately will not do" kicker="Limits">
        <div className="card p-6 space-y-3">
          {[['It does not predict individual criminality.', 'The offender models rank a watchlist of people who already carry two or more resolved cases, on behaviour and evidence only. They are a prompt to look, not a finding.'],
            ['It does not identify people from photographs.', 'The document reader refuses face matching and any question about caste, religion or community — rejected before the request is made, not by prompt alone.'],
            ['It does not forecast where crime will happen.', 'Measured and rejected: at the grain an officer could act on, the arrival noise is larger than any signal a model could find.'],
            ['It does not use caste, religion or occupation.', 'Not by convention — a check runs over the feature list before any training file is written, and a unit test fails the build if a protected column reaches a feature set.'],
            ['It does not let a model answer from nothing.', 'Every serving path falls back to the rule it was measured against, and says so on the screen rather than presenting an arbitrary order as a model’s.']].map(([t, d], i) => (
              <div key={i} className="flex gap-3 text-sm">
                <AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" />
                <div><b className="text-ink">{t}</b> <span className="text-ink-muted">{d}</span></div>
              </div>
            ))}
        </div>
      </Section>

      {/* FAIRNESS + eval */}
      <Section title="Fair by design — and proven" kicker="Trust">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div className="card p-6 bg-surface-2 flex justify-center"><FairnessShield className="w-52" /></div>
          <div className="space-y-3">
            <p className="text-ink-muted">KADI links cases and scores offenders using <b className="text-ink">evidence and behaviour only</b> — never caste, religion or occupation. In the synthetic data these fields are distributed independently of outcomes, so excluding them costs no accuracy, and we can prove it.</p>
            {ev && (
              <div className="grid grid-cols-2 gap-3">
                {[['Gang recovery', `${ev.gangRecoveryPct}%`], ['Chain / ring recovery', `${ev.chainRecoveryPct}%`], ['Offender ER accuracy', `${ev.identityRecoveryPct}%`], ['Overall recall', `${ev.overallRecoveryPct}%`]].map(([l, v]) => (
                  <div key={l} className="border border-line rounded-ctl p-3"><div className="text-xs text-ink-muted">{l}</div><div className="text-xl font-semibold font-num text-success flex items-center gap-1"><CheckCircle2 size={16} /> {v}</div></div>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-muted">Measured on planted ground-truth patterns in the synthetic dataset (target ≥ 90%).</p>
          </div>
        </div>
      </Section>

      <Section title="The data behind every number" kicker="Dataset">
        <DataSection />
      </Section>

      <Section title="Built on Zoho Catalyst" kicker="Platform">
        <PlatformSection />
      </Section>

      {/* footer note */}
      <div className="text-center text-xs text-ink-muted">
        <Globe size={14} className="inline mr-1" /> Built for Datathon 2026 · Challenge 02 · deploys on Zoho Catalyst · Demo dataset (synthetic).
      </div>
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      {kicker && <div className="text-xs font-semibold uppercase tracking-wider text-kadi-blue mb-1">{kicker}</div>}
      <h2 className="text-2xl font-bold text-kadi-navy mb-6">{title}</h2>
      {children}
    </motion.section>
  );
}

function Feature({ icon, art, title, desc, to, onNav }: { icon: React.ReactNode; art: React.ReactNode; title: string; desc: string; to: string; onNav: (t: string) => void }) {
  return (
    <motion.div whileHover={{ y: -4 }} className="card overflow-hidden flex flex-col">
      <div className="bg-surface-2 border-b border-line p-4">{art}</div>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-kadi-navy font-semibold"><span className="text-kadi-blue">{icon}</span>{title}</div>
        <p className="text-sm text-ink-muted mt-2 flex-1">{desc}</p>
        <button onClick={() => onNav(to)} className="text-sm link mt-3 flex items-center gap-1 self-start">Open <ArrowRight size={14} /></button>
      </div>
    </motion.div>
  );
}
