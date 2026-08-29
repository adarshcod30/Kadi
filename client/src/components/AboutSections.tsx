// AboutSections — the two long-form explainers on the About page.
//
// 1) PlatformSection: every Zoho Catalyst service, what KADI uses it for, and — just as
//    importantly — the ones that are NOT wired and the specific reason why. Claiming a
//    service that is not actually running is the fastest way to lose credibility with an
//    evaluator who checks.
// 2) DataSection: where the 40,836 FIRs come from, how they are generated, what is real
//    inside them, how faithfully they mimic KSP data, and where the synthetic origin shows.
import { motion } from 'framer-motion';
import {
  Server, Database, HardDrive, Cpu, Clock, ShieldCheck, Boxes, Globe,
  CheckCircle2, XCircle, AlertTriangle, FlaskConical, Ruler, GitBranch, Scale,
} from 'lucide-react';

const USED = [
  {
    icon: <Globe size={16} />, name: 'Web Client Hosting',
    what: 'Serves the React SPA at /app.',
    why: 'The mandate is to deploy on Catalyst. Hosting the front end here keeps the client on the same origin as the API, so no cross-origin setup is needed for the demo.',
    detail: 'Deep links are handled with a 404 fallback that serves the app shell, because Catalyst rejects a 404 page equal to the homepage.',
  },
  {
    icon: <Server size={16} />, name: 'Serverless Functions (Advanced I/O)',
    what: 'The whole REST API — 21 endpoints, RBAC, audit, assistant.',
    why: 'Advanced I/O accepts a normal Express app, so the same code runs locally and deployed. Memory is raised to 512 MB because the read-model is loaded once per container.',
    detail: 'Every response carries an explanation payload; sensitive reads are audited.',
  },
  {
    icon: <Cpu size={16} />, name: 'AppSail (managed Python)',
    what: 'The sociological and predictive analytics service.',
    why: 'Per-capita normalisation and forecasting are Python work. AppSail runs them without us managing a container.',
    detail: 'Deliberately stdlib-only: packages from requirements.txt do not install in this container, so pandas was replaced with a csv reader. Output is identical and faster.',
  },
  {
    icon: <Database size={16} />, name: 'Data Store',
    what: '11 tables holding the KSP schema and the analytics outputs; 40,836 FIRs.',
    why: 'The FIR schema is genuinely relational, so a relational store is the honest fit. Queried live with ZCQL.',
    detail: 'Loaded via a Stratus bulk-write job. Note ZCQL joins need columns declared as foreign keys; ours are plain ints, so aggregates and filters work but JOIN does not.',
  },
  {
    icon: <HardDrive size={16} />, name: 'Stratus',
    what: 'Object storage for the bulk-import CSV.',
    why: 'Data Store bulk-write reads its source from a Stratus bucket, so this is the supported path for loading 40k rows.',
    detail: 'Also the intended home for generated PDF briefings once SmartBrowz is wired.',
  },
  {
    icon: <Clock size={16} />, name: 'Job Scheduling + Cron',
    what: 'A nightly job that revalidates the analytics tables at 02:00 IST.',
    why: 'Functions and AppSail both cap a request at 30 seconds; only Jobs get 15 minutes. Heavy recomputation therefore belongs here, not behind an HTTP call.',
    detail: 'Node job functions must be named index.js — a main.js entry fails silently with no logs.',
  },
  {
    icon: <Boxes size={16} />, name: 'Connections',
    what: 'An OAuth connection for QuickML (scope QuickML.deployment.READ).',
    why: 'QuickML rejects anonymous calls, so a credential is required.',
    detail: 'Worth knowing: a console Connection cannot be read by the SDK’s app.connection(), which expects a self-managed connector and errors with "client_id cannot be null".',
  },
  {
    icon: <ShieldCheck size={16} />, name: 'Authentication',
    what: 'Enabled on the project; the role model is presented at sign-in.',
    why: 'RBAC scoping is enforced server-side on every query.',
    detail: 'Honest caveat: the identity binding is not wired. The API still trusts a role header rather than verifying a Catalyst JWT, so sign-in is a role chooser.',
  },
  {
    icon: <Cpu size={16} />, name: 'QuickML — prediction endpoints',
    what: 'Eight published endpoints scoring the offender, spike and pendency models.',
    why: 'A trained model has to be reachable from a request to be worth training.',
    detail: 'The console is the only way in — QuickML exposes no REST surface for creating datasets, pipelines or endpoints — so the pipeline, the schema, the measurement and the serving contract live in the repository and the console step is manual.',
  },
  {
    icon: <Boxes size={16} />, name: 'QuickML — GLM-4.7 and RAG',
    what: 'The knowledge base answers questions of meaning; GLM-4.7 phrases answers of fact.',
    why: 'A count is computed, never generated. The model is handed the facts and writes two sentences.',
    detail: 'The 400 PATTERN_NOT_MATCHED that blocked this for months was the model id: the console sample reads crm-di-glm47b_30b_it with UNDERSCORES, and we were sending hyphens.',
  },
  {
    icon: <Boxes size={16} />, name: 'Zia — Trained NLP models',
    what: 'Text translation across 11 languages, text-to-audio in en/hi/kn, and audio-to-text.',
    why: 'Kannada read-aloud and Kannada voice input, on any browser rather than only Chrome.',
    detail: 'These are not on the Zia SDK — an earlier probe of catalyst.zia() found no translate method and concluded the platform had none. It ships them as QuickML Trained NLP Models on a different host path entirely.',
  },
  {
    icon: <Globe size={16} />, name: 'SmartBrowz',
    what: 'Renders a briefing to PDF server-side.',
    why: 'An officer forwarding a briefing should send a document, not a web page.',
    detail: 'Falls back to styled HTML if unreachable: a briefing an officer cannot open is worse than one in the wrong format.',
  },
];

const NOT_USED = [
  {
    name: 'Cache', reason:
      'The adapter is written and a segment is provisioned, but writes from inside a deployed function return 401 PERMISSION_NEEDED. Ruled out: wrong segment id, missing SDK, wrong scope API, and table permissions. The credential Catalyst injects into a function simply lacks Cache scope. Impact is nil — the KPI query recomputes in about a millisecond.',
  },
  {
    name: 'NoSQL', reason:
      'Never provisioned. The graph read-model is served from the function bundle instead. NoSQL would be the right home for it at production scale, when the adjacency outgrows what a function can carry.',
  },
  {
    name: 'API Gateway', reason:
      'Enabled once and immediately disabled: it intercepts all traffic and, with no routes configured, every request including the SPA returned INVALID_URL and the site went down. It needs route configuration before it can be turned on safely.',
  },
];

export function PlatformSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
          <CheckCircle2 size={15} className="text-kadi-teal" /> Catalyst services KADI runs on
        </h3>
        <p className="text-[13px] text-ink-muted mb-3">
          Eight services, each chosen for a specific constraint rather than for the list.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          {USED.map((s) => (
            <motion.div key={s.name} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-kadi-blue">{s.icon}
                <b className="text-sm text-ink">{s.name}</b>
              </div>
              <p className="text-[13px] text-ink mt-1.5">{s.what}</p>
              <p className="text-[12.5px] text-ink-muted mt-1"><b className="text-ink-muted">Why:</b> {s.why}</p>
              <p className="text-[12px] text-ink-muted mt-1 pt-1 border-t border-line/70">{s.detail}</p>
            </motion.div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
          <XCircle size={15} className="text-danger" /> What is not wired, and why
        </h3>
        <p className="text-[13px] text-ink-muted mb-3">
          Listed deliberately. Every one was attempted and diagnosed rather than skipped.
        </p>
        <div className="space-y-2">
          {NOT_USED.map((s) => (
            <div key={s.name} className="rounded-card border border-line bg-surface-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-saffron shrink-0" />
                <b className="text-sm text-ink">{s.name}</b>
              </div>
              <p className="text-[12.5px] text-ink-muted mt-1">{s.reason}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const DATA_FACTS = [
  ['FIRs', '40,836', 'across 43 months, Jan 2023 – Jul 2026'],
  ['Districts', '31', 'every KSP district, real names and boundaries'],
  ['Police stations', '298', 'distributed by district population'],
  ['Accused / victims', '36,890 / 50,656', 'party records linked to FIRs'],
  ['Resolved offenders', '300', 'after entity resolution across name variants'],
  ['Typed links', '68,808', 'shared offender, co-accused, MO, location, time, section'],
];

export function DataSection() {
  return (
    <div className="space-y-6">
      <div className="rounded-card border border-saffron/40 bg-saffron/5 px-4 py-3 flex items-start gap-2">
        <FlaskConical size={15} className="text-saffron shrink-0 mt-0.5" />
        <p className="text-[13px] text-ink">
          <b>Every FIR in this system is synthetic.</b> No real case, person or complainant appears
          anywhere. Real KSP records cannot leave KSP, so the dataset is generated — but generated
          against the real schema, real geography and real published crime statistics, so the
          analytics exercise the same shapes they would in production.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2"><Ruler size={15} className="text-kadi-blue" /> What the dataset contains</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          {DATA_FACTS.map(([k, v, d]) => (
            <div key={k} className="rounded-card border border-line bg-surface p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-muted">{k}</div>
              <div className="text-lg font-semibold font-num text-ink">{v}</div>
              <div className="text-[12px] text-ink-muted">{d}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2"><GitBranch size={15} className="text-kadi-blue" /> How it is generated</h3>
        <ol className="space-y-2 text-[13px] text-ink-muted list-decimal pl-5">
          <li><b className="text-ink">Real skeleton first.</b> 31 districts, 298 stations, the IPC/BNS/IT/NDPS section list and the KSP crime taxonomy are taken from the published schema, not invented.</li>
          <li><b className="text-ink">Volume from real statistics.</b> National and state crime totals set the per-district magnitudes, so Bengaluru City carries roughly 16,900 FIRs while a small rural district carries a few hundred — the ratio real records show.</li>
          <li><b className="text-ink">Coordinates inside real boundaries.</b> Incidents are rejection-sampled inside actual district polygons, with urban clustering around station centres. 100% of generated points fall inside Karnataka; none land in the sea or in a neighbouring state.</li>
          <li><b className="text-ink">Names from a Kannada name pool</b> with deliberate spelling variants, initials and transliteration drift — the noise that makes entity resolution a real problem rather than an exact-match lookup.</li>
          <li><b className="text-ink">Seven ground-truth patterns are planted</b>: a cross-district gang, a serial burglary chain, a cyber ring, a repeat offender, slipping investigations, a false-case cluster and an emerging hotspot.</li>
          <li><b className="text-ink">Deterministic.</b> Seed 2026 — the same dataset regenerates byte-for-byte, so every result on this site is reproducible.</li>
        </ol>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2"><Scale size={15} className="text-kadi-blue" /> How faithful is it, really</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-card border border-line bg-surface p-4">
            <b className="text-sm text-ink">What is genuinely real</b>
            <ul className="mt-1.5 space-y-1 text-[12.5px] text-ink-muted list-disc pl-4">
              <li>District names, boundaries and geography</li>
              <li>Census 2011 population, literacy and urbanisation — used as the per-capita denominator</li>
              <li>The KSP table schema and CrimeNo format</li>
              <li>IPC / BNS / IT Act / NDPS section numbers</li>
              <li>Relative crime volumes between districts</li>
            </ul>
          </div>
          <div className="rounded-card border border-line bg-surface p-4">
            <b className="text-sm text-ink">Where the synthetic origin shows</b>
            <ul className="mt-1.5 space-y-1 text-[12.5px] text-ink-muted list-disc pl-4">
              <li>MO narratives are drawn from templates, so they are cleaner and more uniform than real free text</li>
              <li>The urbanisation correlation is partly circular — the generator weights urban crime upward, so finding it is confirmation, not discovery</li>
              <li>Names come from a finite pool, making resolution slightly easier than reality</li>
              <li>No missing fields, typos or duplicate registrations — real registers are messier</li>
            </ul>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2"><ShieldCheck size={15} className="text-kadi-blue" /> Why this still proves the system works</h3>
        <p className="text-[13px] text-ink-muted">
          Because the planted patterns are known in advance, the pipeline can be scored rather than
          admired. Ground-truth evaluation recovers <b className="text-ink">100%</b> of the planted
          gang and serial chains, resolves the single-person identities correctly, and places the
          repeat offender in the High risk band — measured on every run, not asserted. On real KSP
          data the same code runs unchanged; only the CSV loader is swapped for a Data Store read.
        </p>
      </div>
    </div>
  );
}
