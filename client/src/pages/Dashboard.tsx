import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts';
import { Share2, ArrowRight, CheckCircle2, Activity, Layers, Users, MessageSquare, ShieldCheck } from 'lucide-react';
import { useStats, useAlerts, useMe, useEval, useDistricts, useNational, useSocio, useForecast, useCommand } from '../api/hooks';
import { KpiCard, SeverityDot, Skeleton } from '../components/ui';
import { StateCommand, DistrictCommand, CommandInsight } from '../components/CommandViews';
import { HeatMap, Donut, Legend, VizCard, Hint, stagger, rise } from '../components/viz';
import { HEAD_COLOR } from '../features/graph/GraphCanvas';
import {
  SiloToGraph, NetworkCluster, HealthPulse, MapHotspot, AssistantArt,
  FairnessShield, SheetToDashboard, PipelineFlow,
} from '../components/illustrations';
import HomeAnalytics from '../components/HomeAnalytics';
import { useT } from '../lib/i18n';

// All four Data Store statuses, so the bar always totals 100%. Deriving it from
// open/chargeSheeted/undetected alone silently dropped 'closed'.
const DISPOSAL = (s: any, t: (k: string) => string) => {
  const b = s.statusBreakdown || {};
  return [
    { k: t('chargesheeted'), v: b.chargeSheeted ?? s.chargeSheeted ?? 0, c: '#2FA8A0' },
    { k: t('underInvestigation'), v: b.open ?? s.openCases ?? 0, c: '#1A6FC4' },
    { k: t('undetected'), v: b.undetected ?? s.undetected ?? 0, c: '#C0392B' },
    { k: t('closed'), v: b.closed ?? 0, c: '#5B6B7E' },
  ].filter((x) => x.v > 0);
};

function RankShift() {
  const { data: socio } = useSocio();
  const rows = [...(socio?.districts || [])]
    .sort((a: any, b: any) => Math.abs(b.rankShift) - Math.abs(a.rankShift))
    .slice(0, 7);
  if (!rows.length) return <Skeleton rows={4} />;
  const max = Math.max(...rows.map((r: any) => Math.abs(r.rankShift)), 1);
  return (
    <div className="p-4 space-y-2">
      {rows.map((d: any) => {
        const pct = (Math.abs(d.rankShift) / max) * 50;
        const up = d.rankShift > 0;
        return (
          <div key={d.districtId} className="flex items-center gap-2 text-[12px]">
            <span className="w-28 shrink-0 truncate text-ink">{d.districtName}</span>
            <span className="flex-1 relative h-4 bg-surface-2 rounded">
              <span className="absolute top-0 bottom-0 left-1/2 w-px bg-line" />
              <span className="absolute top-0.5 bottom-0.5 rounded"
                style={{
                  background: up ? '#2FA8A0' : '#C0392B',
                  left: up ? '50%' : `${50 - pct}%`,
                  width: `${pct}%`,
                }} />
            </span>
            <span className="w-24 shrink-0 text-right text-ink-muted">
              #{d.rankByCount} → #{d.rankByRate}
            </span>
          </div>
        );
      })}
      <p className="text-[12px] text-ink-muted pt-1">
        Kodagu is 30th by raw count but 6th per 100,000 residents — invisible on a count map.
      </p>
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const t = useT();
  const { data: stats } = useStats();
  const { data: alerts } = useAlerts();
  const { data: me } = useMe();
  const { data: ev } = useEval();
  const { data: districts } = useDistricts();
  const { data: national } = useNational();
  const { data: fc } = useForecast();
  const { data: command } = useCommand();

  // The final month in `trend` is the month still in progress, so it carries a
  // fraction of a normal month's FIRs and renders as a cliff. The pipeline already
  // computes `lastCompleteMonth` and the forecast excludes partial months from its
  // fit for exactly this reason -- read the same value here so the two panels agree.
  const trend = (() => {
    const rows = stats?.trend || [];
    const last = fc?.lastCompleteMonth;
    return last ? rows.filter((r: any) => r.month <= last) : rows;
  })();

  const statusData = stats && [
    { name: 'Charge-sheeted', value: stats.statusBreakdown.chargeSheeted, color: '#1E874B' },
    { name: 'Under investigation', value: stats.statusBreakdown.open, color: '#1A6FC4' },
    { name: 'Undetected', value: stats.statusBreakdown.undetected, color: '#C9820A' },
    { name: 'Closed', value: stats.statusBreakdown.closed, color: '#8A94A3' },
  ];
  const headData = stats?.topCrimeHeads.slice(0, 6).map((h) => ({ name: h.name, value: h.count, color: HEAD_COLOR[h.name] || '#5B6B7E' }));

  return (
    <div className="space-y-5">
      {/* Illustrated welcome hero */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-kadi-navy via-kadi-navy700 to-[#0a2547] text-white p-6 md:p-7">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-25 pointer-events-none hidden sm:block"><SiloToGraph className="w-[420px]" /></div>
        <div className="relative max-w-xl">
          <div className="text-xs text-white/60 uppercase tracking-wider">{me?.capabilities.label} · {me?.capabilities.scope} scope</div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Command Dashboard</h1>
          <p className="text-white/80 text-sm mt-1.5">Thousands of siloed FIRs, connected into one living graph — with slipping investigations, offender networks and emerging hotspots surfaced up front. <button onClick={() => nav('/about')} className="underline underline-offset-2 hover:text-white">What is KADI?</button></p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => nav('/graph')} className="btn bg-white text-kadi-navy hover:bg-white/90 text-sm font-semibold"><Share2 size={16} /> Explore the graph</button>
            <button onClick={() => nav('/map')} className="btn bg-white/10 text-white hover:bg-white/20 text-sm"><Layers size={16} /> Map</button>
            <button onClick={() => nav('/health')} className="btn bg-white/10 text-white hover:bg-white/20 text-sm"><Activity size={16} /> Health cockpit</button>
          </div>
        </div>
      </motion.div>

      {/* KPIs — animated entrance */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: t('openCases'), value: stats?.openCases, hint: 'FIRs still under active investigation, state-wide.', to: '/cases?status=1' },
          { label: t('flagged'), value: stats?.seriousFlaggedCases, hint: 'Cases carrying a high-severity health flag — ageing, pendency or undetected-risk. The Health cockpit shows the subset within your rank scope.', accent: '#C9820A', to: '/health' },
          { label: t('networks'), value: stats?.activeNetworks, hint: 'Resolved offenders who operate with co-offenders — genuine groups, not just cases with a similar modus operandi.', accent: '#1A6FC4', to: '/offenders' },
          { label: 'Resolved offenders', value: stats?.resolvedOffenders, hint: 'Distinct repeat offenders after name-variant entity resolution.', to: '/offenders' },
          { label: 'Emerging hotspots', value: stats?.emergingHotspots, hint: 'Areas where recent activity far exceeds the historical baseline.', accent: '#C0392B', to: '/map' },
        ].map((k) => (
          <motion.div key={k.label} variants={rise}>
            <KpiCard label={<span className="flex items-center gap-1">{k.label}<Hint text={k.hint} /></span>}
              value={k.value?.toLocaleString() ?? '—'} accent={k.accent} onClick={() => nav(k.to)} />
          </motion.div>
        ))}
      </motion.div>

      <p className="text-xs text-ink-muted -mt-1">
        {command?.view === 'district'
          ? `Operational view — every figure below is ${command.districtName}. Use the scope control in the header to switch district.`
          : 'Command view — all 31 districts. Drill into any one from the table below, or from the header.'}
      </p>

      {/* The two tiers get different panels, not the same panels with smaller numbers. */}
      <CommandInsight text={command?.insight} view={command?.view || 'state'} />
      {command?.view === 'district'
        ? <DistrictCommand data={command} />
        : <StateCommand data={command} />}

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: trend + heatmap + districts */}
        <div className="lg:col-span-2 space-y-5">
          <VizCard title={t('firsPerMonth')} hint="Monthly FIR volume over the dataset window — watch for sustained rises that signal shifting crime patterns. The month still in progress is excluded, since a partial month reads as a false collapse.">
            <div className="h-52 p-3">
              {stats ? (
                <ResponsiveContainer width="100%" height="100%" key={trend.length}>
                  <AreaChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1A6FC4" stopOpacity={0.35} /><stop offset="100%" stopColor="#1A6FC4" stopOpacity={0.02} /></linearGradient></defs>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#5B6B7E' }} tickLine={false} axisLine={false} minTickGap={20} />
                    <YAxis tick={{ fontSize: 10, fill: '#5B6B7E' }} tickLine={false} axisLine={false} width={32} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
                    <Area type="monotone" dataKey="count" stroke="#1A6FC4" strokeWidth={2} fill="url(#trendGrad)" isAnimationActive={false} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Skeleton rows={4} />}
            </div>
          </VizCard>

          <VizCard title={t('whenCrime')} hint="Spatiotemporal signal: darker cells are hours with more incidents. Night-time and weekend spikes guide patrol deployment.">
            {stats ? <HeatMap data={stats.heat} /> : <Skeleton rows={4} />}
          </VizCard>

          <VizCard title={t('topDistricts')} hint="Case counts per district — click through to the district drill-down on the map." action={<button onClick={() => nav('/map')} className="text-xs link">Map</button>}>
            <div className="h-56 p-3">
              {districts ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={districts.districts.slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="district" width={110} tick={{ fontSize: 11, fill: '#1C2A3A' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]} animationDuration={800}>
                      {districts.districts.slice(0, 8).map((_: any, i: number) => <Cell key={i} fill={i === 0 ? '#0f2f44' : '#1A6FC4'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <Skeleton rows={4} />}
            </div>
          </VizCard>

          {/* Disposal funnel — the left column was a card shorter than the right, leaving a
              visible gap, and clearance rate is the metric a DGP actually asks for. */}
          <VizCard title={t('whereCasesEnd')} hint="Every registered FIR flows to one of three outcomes. The clearance rate is chargesheeted over total; a large undetected share is where investigative effort is being lost.">
            {stats ? (
              <div className="p-4">
                <div className="flex h-9 rounded-ctl overflow-hidden border border-line">
                  {DISPOSAL(stats, t).map((seg) => {
                    const pct = (seg.v / (stats.totalCases || 1)) * 100;
                    return (
                      <div key={seg.k} title={`${seg.k}: ${seg.v.toLocaleString()} (${pct.toFixed(1)}%)`}
                        style={{ width: `${pct}%`, background: seg.c }}
                        className="grid place-items-center text-[11px] font-medium text-white transition-all">
                        {pct > 11 ? `${pct.toFixed(0)}%` : ''}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DISPOSAL(stats, t).map((seg) => (
                    <div key={seg.k} className="rounded-ctl bg-surface-2 border border-line px-3 py-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                        <span className="w-2 h-2 rounded-full" style={{ background: seg.c }} />{seg.k}
                      </div>
                      <div className="text-lg font-semibold font-num text-ink">{seg.v.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-ink-muted">
                  Clearance rate <strong className="text-ink">
                    {((stats.chargeSheeted / (stats.totalCases || 1)) * 100).toFixed(1)}%
                  </strong> of {stats.totalCases.toLocaleString()} registered FIRs.
                </p>
              </div>
            ) : <Skeleton rows={4} />}
          </VizCard>

          {/* Headline finding, and it fills the column that was running short. */}
          <VizCard title={t('countsMislead')}
            hint="Bars show how far a district moves when you divide by population. Green means it is worse per-capita than raw counts suggest; red means it only looked bad because it is populous."
            action={<button onClick={() => nav('/intelligence')} className="text-xs link">Intelligence</button>}>
            <RankShift />
          </VizCard>
        </div>

        {/* Right: eval, donuts, alerts */}
        <div className="space-y-5">
          {ev?.passed && (
            <motion.div variants={rise} className="card p-4 border-l-4 border-success">
              <div className="flex items-center gap-2 text-success font-semibold text-sm"><CheckCircle2 size={16} /> Detection validated</div>
              <p className="text-xs text-ink-muted mt-1">On planted ground-truth, the pipeline recovers</p>
              <div className="text-3xl font-semibold font-num text-kadi-navy mt-1">{ev.overallRecoveryPct}%</div>
              <p className="text-xs text-ink-muted">of gangs / serial chains, at {ev.identityRecoveryPct}% offender-ER accuracy.</p>
            </motion.div>
          )}

          <VizCard title={t('caseStatusMix')} hint="Disposition of all FIRs. A high undetected share highlights where investigations stall.">
            {stats && statusData ? (<>
              <Donut data={statusData} centerLabel="cases" centerValue={stats.totalCases.toLocaleString()} />
              <Legend items={statusData.map((s) => ({ name: s.name, color: s.color, value: s.value.toLocaleString() }))} />
            </>) : <Skeleton rows={4} />}
          </VizCard>

          <VizCard title={t('crimeMix')} hint="Share of FIRs by major crime head — property and cyber crime dominate real volume.">
            {stats && headData ? (<>
              <Donut data={headData} centerLabel="heads" centerValue={String(stats.topCrimeHeads.length)} />
              <Legend items={headData.map((h) => ({ name: h.name, color: h.color }))} />
            </>) : <Skeleton rows={4} />}
          </VizCard>

          <VizCard title={t('alerts')} hint="Live signals: new cross-district networks, slipping cases, emerging hotspots, station anomalies." action={<button onClick={() => nav('/health')} className="text-xs link">All</button>}>
            <div className="divide-y divide-line max-h-[320px] overflow-auto">
              {(alerts || []).slice(0, 8).map((a) => (
                <motion.button key={a.alertId} whileHover={{ x: 3 }}
                  onClick={() => a.caseMasterId ? nav(`/graph?case=${a.caseMasterId}`) : a.offenderIdentityId ? nav(`/offenders/${a.offenderIdentityId}`) : a.clusterId ? nav(`/graph?cluster=${a.clusterId}`) : nav('/health')}
                  className="w-full text-left px-4 py-2.5 hover:bg-surface-3 flex gap-2">
                  <SeverityDot severity={a.severity} />
                  <div className="min-w-0"><div className="text-sm font-medium truncate">{a.title}</div><div className="text-xs text-ink-muted truncate">{a.reason}</div></div>
                  <ArrowRight size={14} className="ml-auto text-ink-muted mt-0.5 shrink-0" />
                </motion.button>
              ))}
              {!alerts && <Skeleton rows={5} />}
            </div>
          </VizCard>

          {national && (
            <VizCard title={t('indiaContext')} hint="Karnataka's position among Indian states by crime volume (realistic-magnitude context).">
              <div className="p-3 text-sm">
                <p className="text-xs text-ink-muted mb-2">Karnataka ranks <b className="text-kadi-navy">#{national.focusRank}</b> of {national.states.length} · {national.focusRatePerLakh}/lakh</p>
                {national.states.slice(0, 5).map((s: any) => (
                  <div key={s.state} className={`flex items-center gap-2 py-0.5 text-xs ${s.isFocus ? 'font-semibold text-kadi-navy' : ''}`}>
                    <span className="w-4 text-ink-muted">{s.rank}</span><span className="flex-1 truncate">{s.state}{s.isFocus ? ' ★' : ''}</span>
                    <div className="w-14 h-1.5 bg-surface-3 rounded overflow-hidden"><div className="h-full bg-kadi-blue" style={{ width: `${(s.crimesThousands / national.states[0].crimesThousands) * 100}%` }} /></div>
                    <span className="font-num w-9 text-right">{s.crimesThousands}k</span>
                  </div>
                ))}
              </div>
            </VizCard>
          )}
        </div>
      </motion.div>

      {/* ---- Analytical section: forecast, composition, correlation, volume ---- */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="mt-4">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-lg font-semibold text-kadi-navy">{t('pictureBehind')}</h2>
          <p className="text-sm text-ink-muted">— where it is heading, what kind, why there, and who carries it.</p>
        </div>
        <HomeAnalytics stats={stats} />
      </motion.div>

      {/* ---- Illustrated capabilities: what you can actually do from here ---- */}
      <motion.div variants={stagger} initial="hidden" animate="show">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-lg font-semibold text-kadi-navy">{t('exploreIntel')}</h2>
          <p className="text-sm text-ink-muted">— four ways KADI turns these records into action.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <CapCard onClick={() => nav('/graph')} icon={<Share2 size={16} />} title="Case-Linkage Graph"
            art={<NetworkCluster className="w-full h-32" />}
            desc="Open a case and its network assembles — related FIRs, shared offenders and serial chains across stations. Every link opens a 'Why linked' trail of matched attributes and source FIRs." />
          <CapCard onClick={() => nav('/health')} icon={<Activity size={16} />} title="Investigation Health"
            art={<HealthPulse className="w-full h-32" />}
            desc="Early warning for cases slipping past detection timelines — ageing vs peer median, pendency, undetected-risk — each with a reason and a recommended next action." />
          <CapCard onClick={() => nav('/map')} icon={<Layers size={16} />} title="Spatiotemporal Map"
            art={<MapHotspot className="w-full h-32" />}
            desc="District crime density, a live heatmap and incident points over satellite imagery. Layer time-of-day over location to find patrol windows; red zones pulse where trends emerge." />
          <CapCard onClick={() => nav('/assistant')} icon={<MessageSquare size={16} />} title="Ask KADI"
            art={<AssistantArt className="w-full h-32" />}
            desc="Ask in English or ಕನ್ನಡ, by text or voice. Answers are grounded in the records, always cite FIR numbers, deep-link into the graph, and export as a print-ready briefing." />
        </div>
      </motion.div>

      {/* ---- Fairness + how it works ---- */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <VizCard title="Fair by design" hint="Protected attributes are excluded from every model and the exclusion is enforced by a unit test that fails if any protected column reaches a feature set.">
          <div className="p-4 flex items-center gap-4">
            <FairnessShield className="w-24 shrink-0" />
            <p className="text-sm text-ink-muted">Links and risk scores use <b className="text-ink">evidence and behaviour only</b> — never caste, religion or occupation. Every offender profile states <b className="text-ink">"protected attributes used: none"</b>.</p>
          </div>
        </VizCard>
        <VizCard title="From Excel to live intelligence" hint="KADI replaces static per-station sheets with one continuously-recomputed relational picture of state-wide crime.">
          <div className="p-4"><SheetToDashboard className="w-full h-28" />
            <p className="text-sm text-ink-muted mt-2">Fragmented station sheets become one queryable graph — refreshed by a nightly pipeline, not manual collation.</p>
          </div>
        </VizCard>
        <VizCard title="How an insight is made" hint="Heavy compute (entity resolution, graph build, community detection, risk, health, spatial) runs asynchronously; the app only reads precomputed results, so every screen loads instantly.">
          <div className="p-4"><PipelineFlow className="w-full h-20" />
            <p className="text-sm text-ink-muted mt-2">FIR → offender identities resolved → graph + communities → ranked insight. Each stage writes its own explanation, so nothing is a black box.</p>
          </div>
        </VizCard>
      </motion.div>
    </div>
  );
}

function CapCard({ icon, title, desc, art, onClick }: {
  icon: React.ReactNode; title: string; desc: string; art: React.ReactNode; onClick: () => void;
}) {
  return (
    <motion.button variants={rise} whileHover={{ y: -4 }} onClick={onClick}
      className="card overflow-hidden text-left flex flex-col hover:shadow-hover transition-shadow">
      <div className="bg-surface-2 border-b border-line p-3">{art}</div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 font-semibold text-kadi-navy"><span className="text-kadi-blue">{icon}</span>{title}</div>
        <p className="text-xs text-ink-muted mt-1.5 flex-1">{desc}</p>
        <span className="text-xs link mt-2 flex items-center gap-1">Open <ArrowRight size={12} /></span>
      </div>
    </motion.button>
  );
}
