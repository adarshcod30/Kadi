import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts';
import { Share2, ArrowRight, CheckCircle2, Activity, Layers, Users, MessageSquare, ShieldCheck, Info } from 'lucide-react';
import { useStats, useAlerts, useMe, useEval, useDistricts, useNational, useSocio, useForecast, useCommand, useMix } from '../api/hooks';
import { KpiCard, SeverityDot, Skeleton } from '../components/ui';
import { StateCommand, DistrictCommand, StationCommand, CommandInsight } from '../components/CommandViews';
import { HeatMap, Donut, Legend, VizCard, Hint, DoublePie, stagger, rise } from '../components/viz';
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
  // All 31 districts now (P2-5), sorted by how far they move, scrollable — not the top 7.
  const rows = [...(socio?.districts || [])]
    .sort((a: any, b: any) => Math.abs(b.rankShift) - Math.abs(a.rankShift));
  if (!rows.length) return <Skeleton rows={4} />;
  const max = Math.max(...rows.map((r: any) => Math.abs(r.rankShift)), 1);
  return (
    <div className="p-4 space-y-2 max-h-[360px] overflow-auto">
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
  const { data: mix } = useMix();

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
  // Tier drives the KPI rule colour; the last 12 months of the trend gives the headline a spark.
  const homeTier: 'state' | 'district' | 'station' = command?.view === 'station' ? 'station'
    : command?.view === 'district' ? 'district' : 'state';
  const trendSpark = (trend || []).slice(-12).map((r: any) => r.count);

  return (
    <div className="space-y-5">
      {/* Illustrated welcome hero */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-kadi-navy via-kadi-navy700 to-[#0a2547] text-white p-6 md:p-7">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-25 pointer-events-none hidden sm:block"><SiloToGraph className="w-[420px]" /></div>
        <div className="relative max-w-xl">
          {/* capabilities.scope is the role's static scope, so a state user drilled into a
              district still read "STATE SCOPE" over district numbers. effectiveScope
              reflects the drill. */}
          <div className="text-xs text-white/60 uppercase tracking-wider">
            {me?.capabilities.label} · {stats?.scope === 'district' && stats?.districtName
              ? stats.districtName : `${me?.capabilities.effectiveScope || me?.capabilities.scope} scope`}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Command Dashboard</h1>
          <p className="text-white/80 text-sm mt-1.5">Thousands of siloed FIRs, connected into one living graph — with slipping investigations, offender networks and emerging hotspots surfaced up front. <button onClick={() => nav('/about')} className="underline underline-offset-2 hover:text-white">What is KADI?</button></p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => nav('/graph')} className="btn bg-white text-kadi-navy hover:bg-white/90 text-sm font-semibold"><Share2 size={16} /> Explore the graph</button>
            <button onClick={() => nav('/map')} className="btn bg-white/10 text-white hover:bg-white/20 text-sm"><Layers size={16} /> Map</button>
            <button onClick={() => nav('/health')} className="btn bg-white/10 text-white hover:bg-white/20 text-sm"><Activity size={16} /> Health cockpit</button>
          </div>
        </div>
      </motion.div>

      {/* KPIs — auto-fit so the row reflows 2/3/5 without a stranded middle card (the uneven
          spacing the brief flagged), each with a tier-coloured rule. The headline card carries
          a sparkline of the last 12 months so the number shows its own recent shape. */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {[
          { label: t('openCases'), value: stats?.openCases, hint: 'FIRs still under active investigation.', to: '/cases?status=1', spark: trendSpark },
          { label: t('flagged'), value: stats?.seriousFlaggedCases, hint: 'Cases carrying a high-severity health flag — ageing, pendency or undetected-risk. The Health cockpit shows the subset within your rank scope.', accent: '#C9820A', to: '/health' },
          { label: t('networks'), value: stats?.activeNetworks, hint: 'Resolved offenders who operate with co-offenders — genuine groups, not just cases with a similar modus operandi.', accent: '#1A6FC4', to: '/offenders' },
          { label: 'Resolved offenders', value: stats?.resolvedOffenders, hint: 'Distinct repeat offenders after name-variant entity resolution.', to: '/offenders' },
          { label: 'Emerging hotspots', value: stats?.emergingHotspots, hint: 'Areas where recent activity far exceeds the historical baseline.', accent: '#C0392B', to: '/map' },
        ].map((k) => (
          <motion.div key={k.label} variants={rise}>
            <KpiCard label={<span className="flex items-center gap-1">{k.label}<Hint text={k.hint} /></span>}
              value={k.value?.toLocaleString() ?? '—'} accent={k.accent} tier={homeTier} spark={k.spark}
              onClick={() => nav(k.to)} />
          </motion.div>
        ))}
      </motion.div>

      <p className="text-xs text-ink-muted -mt-1">
        {command?.view === 'station'
          ? `Station view — every figure below is ${command.unitName} only. This is the whole of what this desk can read.`
          : command?.view === 'district'
            ? `Operational view — every figure below is ${command.districtName}. Use the scope control in the header to switch district.`
            : 'Command view — all 31 districts. Drill into any one from the table below, or from the header.'}
      </p>

      {/* The two tiers get different panels, not the same panels with smaller numbers. */}
      <CommandInsight text={command?.insight} view={command?.view || 'state'} />
      {command?.view === 'station'
        ? <StationCommand data={command} />
        : command?.view === 'district'
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

          {/* One linked pair, not two separate donuts (P2-2): status outside, crime type inside,
              each cross-filtering the other from a true crosstab. */}
          <VizCard title="Status × crime mix" hint="Two rings that read each other. Click a status to see the crime types driving it — for example, which heads make up the undetected pile — or click a crime type to see how its cases are disposed. Computed from a true status-by-head crosstab, not a proportional estimate.">
            {mix ? <DoublePie mix={mix} headColor={(n: string) => HEAD_COLOR[n] || '#5B6B7E'} /> : <Skeleton rows={4} />}
          </VizCard>

          {/* Combined across kinds (P2-3): the highest-severity alert from each signal type, up
              to five, so the panel is not filled by whichever kind happens to be loudest. Each
              row names its kind and how many more of that kind wait behind it. */}
          <VizCard title={t('alerts')} hint="The most urgent alert from each live signal — new cross-district networks, slipping cases, emerging hotspots, station anomalies — combined, so every kind is represented rather than just the loudest." action={<button onClick={() => nav('/health')} className="text-xs link">All</button>}>
            <div className="divide-y divide-line max-h-[340px] overflow-auto">
              {(() => {
                if (!alerts) return <Skeleton rows={5} />;
                const SEV = { high: 0, medium: 1, low: 2, info: 3 } as any;
                const byKind = new Map<string, any[]>();
                for (const a of alerts) {
                  const k = a.kind || 'other';
                  if (!byKind.has(k)) byKind.set(k, []);
                  byKind.get(k)!.push(a);
                }
                // One representative per kind (highest severity), the five kinds themselves
                // ranked by their top severity.
                const reps = [...byKind.entries()].map(([kind, list]) => {
                  const sorted = [...list].sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));
                  return { kind, top: sorted[0], more: list.length - 1 };
                }).sort((a, b) => (SEV[a.top.severity] ?? 3) - (SEV[b.top.severity] ?? 3)).slice(0, 5);
                if (!reps.length) return <div className="p-4 text-sm text-ink-muted">No live alerts.</div>;
                return reps.map(({ kind, top: a, more }) => (
                  <motion.button key={a.alertId} whileHover={{ x: 3 }}
                    onClick={() => a.caseMasterId ? nav(`/graph?case=${a.caseMasterId}`) : a.offenderIdentityId ? nav(`/offenders/${a.offenderIdentityId}`) : a.clusterId ? nav(`/graph?cluster=${a.clusterId}`) : nav('/health')}
                    className="w-full text-left px-4 py-2.5 hover:bg-surface-3 flex gap-2">
                    <SeverityDot severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">{kind.replace(/_/g, ' ')}</span>
                        {more > 0 && <span className="text-[10px] text-ink-muted">+{more} more</span>}
                      </div>
                      <div className="text-sm font-medium truncate">{a.title}</div>
                      <div className="text-xs text-ink-muted truncate">{a.reason}</div>
                    </div>
                    <ArrowRight size={14} className="text-ink-muted mt-0.5 shrink-0" />
                  </motion.button>
                ));
              })()}
            </div>
          </VizCard>

          {national && (
            <VizCard title={t('indiaContext')} hint="Karnataka's position among Indian states by crime volume (realistic-magnitude context). Karnataka stays pinned in view even when its rank falls outside the top 15.">
              <div className="p-3 text-sm">
                <p className="text-xs text-ink-muted mb-2">Karnataka ranks <b className="text-kadi-navy">#{national.focusRank}</b> of {national.states.length} · {national.focusRatePerLakh}/lakh</p>
                {(() => {
                  // Top 15, and if Karnataka sits below the cut, pin it to the foot so it is
                  // always visible (P1-4).
                  const top = national.states.slice(0, 15);
                  const rows = top.some((s: any) => s.isFocus)
                    ? top
                    : [...top, national.states.find((s: any) => s.isFocus)].filter(Boolean);
                  return rows.map((s: any, i: number) => (
                    <div key={s.state} className={`flex items-center gap-2 py-0.5 text-xs ${s.isFocus ? 'font-semibold text-kadi-navy' : ''} ${!top.includes(s) ? 'border-t border-line mt-0.5 pt-1' : ''}`}>
                      <span className="w-5 text-ink-muted font-num">{s.rank}</span><span className="flex-1 truncate">{s.state}{s.isFocus ? ' ★' : ''}</span>
                      <div className="w-14 h-1.5 bg-surface-3 rounded overflow-hidden"><div className="h-full" style={{ width: `${(s.crimesThousands / national.states[0].crimesThousands) * 100}%`, background: s.isFocus ? '#E8871E' : '#1A6FC4' }} /></div>
                      <span className="font-num w-9 text-right">{s.crimesThousands}k</span>
                    </div>
                  ));
                })()}
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

      {/* The capability tour, the fairness panel and the how-it-works trio all moved to About
          (P1-5 / P2-9). They are orientation material — what the product is — not part of the
          screen an officer opens every morning. A single quiet link points there for anyone
          who wants the tour, so nothing became unreachable. */}
      <div className="pt-1">
        <button onClick={() => nav('/about')}
          className="text-sm link inline-flex items-center gap-1.5">
          <Info size={14} /> New here? See everything KADI can do, how it works, and how fairness is enforced
          <ArrowRight size={14} />
        </button>
      </div>
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
