import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts';
import { Share2, ArrowRight, CheckCircle2, Activity, Layers, Users, MessageSquare, ShieldCheck, Info } from 'lucide-react';
import { useStats, useAlerts, useMe, useEval, useDistricts, useNational, useSocio, useForecast, useCommand, useMix, useStations, useHotspots } from '../api/hooks';
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
  const { data: socio } = useSocio();
  const { data: hotspots } = useHotspots(true);

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

      {/* KPIs. Each carries a SUBTITLE that says what the figure is measured against, the same
          treatment the Health cockpit got: a label over a bare number leaves the reader to
          supply the context, and most of them cannot. Auto-fit so the row reflows 2/3/5 without
          a stranded middle card, tier-coloured rule, and a sparkline on the headline. */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {[
          {
            label: t('openCases'), value: stats?.openCases, to: '/cases?status=1', spark: trendSpark,
            sub: stats?.totalCases
              ? `of ${stats.totalCases.toLocaleString()} registered — ${Math.round((stats.openCases / stats.totalCases) * 100)}% still under investigation`
              : 'FIRs still under active investigation',
            hint: 'FIRs still under active investigation. The sparkline is the last 12 complete months of registrations in this scope.',
          },
          {
            label: t('flagged'), value: stats?.seriousFlaggedCases, accent: '#C9820A', to: '/health',
            sub: stats?.openCases
              ? `${Math.round((stats.seriousFlaggedCases / Math.max(1, stats.openCases)) * 100)}% of the open register needs supervision`
              : 'high-severity health flags',
            hint: 'Cases carrying a high-severity health flag — ageing past the peer median, pendency or undetected-risk. Open the Health cockpit for the worklist and each case\u2019s recommended action.',
          },
          {
            label: t('networks'), value: stats?.activeNetworks, accent: '#1A6FC4', to: '/offenders',
            // NOT "of them": the two figures count different populations — networks are
            // offenders with a co-offender, cross-district is offenders active in 2+ districts,
            // and the second is not a subset of the first. Saying "of them" produced the
            // nonsense "57 networks, 262 of them cross district lines".
            sub: stats?.crossDistrictNetworks != null
              ? `${stats.crossDistrictNetworks.toLocaleString()} offenders here also work across district lines`
              : 'offenders who work with co-offenders',
            hint: 'Resolved offenders who operate with co-offenders — genuine groups, not merely cases with a similar modus operandi. The cross-district count is the part no single station register can see.',
          },
          {
            label: 'Resolved offenders', value: stats?.resolvedOffenders, to: '/offenders',
            sub: stats?.highRiskOffenders != null
              ? `${stats.highRiskOffenders.toLocaleString()} scored high risk on behaviour alone`
              : 'distinct repeat offenders after entity resolution',
            hint: 'Distinct repeat offenders after name-variant entity resolution — spelling variants, initials and transliteration drift merged into one identity. Risk is scored from behaviour and evidence only, never caste, religion or occupation.',
          },
          {
            label: 'Emerging hotspots', value: stats?.emergingHotspots, accent: '#C0392B', to: '/map',
            sub: 'places where recent activity far exceeds their own baseline',
            hint: 'Clusters whose recent incident count sits far above what that location normally records. Judged against each area\u2019s own history, never a shared cut-off, so a consistently busy area does not sit permanently red.',
          },
        ].map((k) => (
          <motion.div key={k.label} variants={rise}>
            <KpiCard label={<span className="flex items-center gap-1">{k.label}<Hint text={k.hint} /></span>}
              value={k.value?.toLocaleString() ?? '—'} accent={k.accent} tier={homeTier} spark={k.spark}
              sub={k.sub} onClick={() => nav(k.to)} />
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
      {/* When someone has drilled into a station (?unit= in the URL), give them the way out. A
          real station account never carries ?unit= — its scope comes from the token, not the
          query — so the presence of the param is itself the signal that this is a drill. */}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('unit') && (
        <button onClick={() => { const u = new URL(window.location.href); u.searchParams.delete('unit'); window.location.href = u.toString(); }}
          className="btn-outline text-sm inline-flex items-center gap-1.5">
          <ArrowRight size={14} className="rotate-180" /> Leave station view
        </button>
      )}
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
            {stats ? (<>
              <HeatMap data={stats.heat} />
              {/* A derived reading under the grid (P2-1), so the panel states its own finding
                  rather than leaving the eye to hunt the darkest cell. */}
              <HeatPeak heat={stats.heat} />
            </>) : <Skeleton rows={4} />}
          </VizCard>

          {/* WHERE crime happens (P1-6): the spatial companion to the temporal heatmap above.
              The home had a "when" panel and no "where" — this fills that, and the empty space
              the brief flagged, with the emerging clusters (a spatial signal, distinct from the
              volume ladder below it). */}
          <VizCard title="Where crime happens" hint="Emerging clusters — places where recent activity far exceeds the local baseline. This is the spatial half of the pattern the heatmap shows in time; the two together say where to be, and when." action={<button onClick={() => nav('/map')} className="text-xs link">Map</button>}>
            <WhereCrime hotspots={hotspots} tier={homeTier} onOpen={() => nav('/map')} />
          </VizCard>

          {/* Hidden at station tier: a ladder of 31 districts is not this desk's business.
              A station officer's home carries only what their own register can act on. */}
          {homeTier !== 'station' && (<>
          {/* District standings (P2-4): all 31 ranked, not a top-8 bar chart, with the viewer's
              own district highlighted and pulled into view — so it answers "where does my
              district stand" for every district, which the old chart could not. */}
          <VizCard title="District standings" hint="Every district ranked by case volume, with its rate per 100k alongside. Your own district is highlighted — the answer to 'where do I stand' is different for each district, so the whole ladder is shown rather than the top few." action={<button onClick={() => nav('/map')} className="text-xs link">Map</button>}>
            <DistrictStandings districts={districts} socio={socio} focusId={(stats as any)?.districtId} onOpen={(id: string) => nav(`/map?district=${id}`)} />
          </VizCard>
          </>)}

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

          {national && homeTier !== 'station' && (
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

      {/* Full width, not the left column (P2). The right column runs out above it, so inside the
          grid this card left a block of empty space beside itself. At full width the slope bars
          also have the room the comparison actually needs. */}
      {/* Both of these compare DISTRICTS, so neither belongs on a station's home — an SHO
          cannot act on where Kodagu ranks per capita. Hidden at station tier. */}
      {homeTier !== 'station' && (
      <VizCard title={t('countsMislead')}
        hint="Bars show how far a district moves when you divide by population. Green means it is worse per-capita than raw counts suggest; red means it only looked bad because it is populous."
        action={<button onClick={() => nav('/intelligence')} className="text-xs link">Intelligence</button>}>
        <RankShift />
      </VizCard>
      )}

      {/* The drill sits AFTER the state picture, not above it: you read the state, then step
          down a level. State drills into a district; a district drills into one of its
          stations — the chain of command, one rung at a time. */}
      {command?.view !== 'station' && <ScopeDrill me={me} view={command?.view} districts={districts} />}

      {/* ---- Analytical section: forecast, composition, correlation, volume ---- */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="mt-4">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-lg font-semibold text-kadi-navy">{t('pictureBehind')}</h2>
          <p className="text-sm text-ink-muted">— where it is heading, what kind, why there, and who carries it.</p>
        </div>
        <HomeAnalytics stats={stats} tier={homeTier} command={command} />
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

// The full district ladder. Merges volume (districts) with rate per 100k (socio), ranks by
// volume, and highlights the viewer's own district — scrolling it into view so a district
// officer lands on their own row. Replaces the top-8 bar chart (P2-4).
// Step down one level (P2-10). The chain of command has rungs, and the control names the next
// one down rather than skipping it: at STATE you step into a district, at DISTRICT you step into
// one of its stations. Offering "view a police station" to a DGP jumped two levels and implied
// the state view was about stations, which it is not.
function ScopeDrill({ me, view, districts }: { me: any; view?: string; districts?: any }) {
  const [open, setOpen] = useState(false);
  const stateView = view === 'state';
  const districtId = me?.capabilities?.districtId || '1';
  // Stations only fetched when they are what is being offered.
  const { data: stationData } = useStations(stateView ? {} : { district: districtId });
  const districtRows = (districts?.districts || []).slice(0, 12);
  const stationRows = stateView ? [] : (stationData?.items || []).slice(0, 10);
  const rows: { id: string; name: string; count: number; zone?: string }[] = stateView
    ? districtRows.map((d: any) => ({ id: String(d.districtId), name: d.district, count: d.total }))
    : stationRows.map((s: any) => ({ id: String(s.unitId), name: s.unitName, count: s.cases, zone: s.zone }));

  const go = (id: string) => {
    const u = new URL(window.location.href);
    if (stateView) { u.searchParams.set('district', id); u.searchParams.delete('unit'); }
    else {
      u.searchParams.set('unit', id);
      if (!u.searchParams.get('district')) u.searchParams.set('district', String(districtId));
    }
    window.location.href = u.toString();
  };

  if (!rows.length) return null;
  const title = stateView ? 'View a district' : 'View a police station';
  const sub = stateView
    ? '— step down to one of the 31 districts'
    : `— step inside one register, ${stationData?.items?.[0]?.districtName || 'this district'}`;
  const tone = stateView ? '#E8871E' : '#2FA8A0';

  return (
    <div className="card p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <Layers size={15} className="shrink-0" style={{ color: tone }} />
        <span className="text-sm font-semibold text-kadi-navy">{title}</span>
        <span className="text-[12px] text-ink-muted">{sub}</span>
        <ArrowRight size={14} className={`ml-auto text-ink-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {rows.map((r) => (
            <button key={r.id} onClick={() => go(r.id)}
              className="flex items-center gap-2 px-2.5 py-2 rounded-ctl border border-line text-left hover:bg-surface-3"
              style={{ borderLeftWidth: 3, borderLeftColor: tone }}>
              {r.zone && (
                <span className={`w-2 h-2 rounded-full shrink-0 ${r.zone === 'red_pulsing' ? 'animate-pulse' : ''}`}
                  style={{ background: r.zone === 'red_pulsing' ? '#C0392B' : r.zone === 'yellow' ? '#C9820A' : '#3AA76D' }} />
              )}
              <span className="text-[13px] text-ink flex-1 truncate">{r.name}</span>
              <span className="font-num text-[12px] text-ink-muted">{r.count?.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The spatial companion to the "when" heatmap (P1-6). Emerging clusters, grouped by district,
// with how far each sits above its local baseline — a "where to be" to the heatmap's "when".
function WhereCrime({ hotspots, tier, onOpen }: { hotspots: any; tier?: string; onOpen: () => void }) {
  if (!hotspots) return <Skeleton rows={4} />;
  const emerging = (hotspots.hotspots || []).filter((h: any) => h.emergingFlag);
  if (!emerging.length) {
    return <div className="p-4 text-sm text-ink-muted">No emerging clusters in scope right now — recent activity is within the local baseline everywhere.</div>;
  }
  // Group emerging clusters by district and total their recent count.
  const byDistrict: Record<string, { name: string; count: number; cells: number }> = {};
  const dName = (id: string) => (hotspots.districtCounts && hotspots.districtNames?.[id]) || `District ${id}`;
  for (const h of emerging) {
    const k = String(h.districtId);
    if (!byDistrict[k]) byDistrict[k] = { name: h.districtName || dName(k), count: 0, cells: 0 };
    byDistrict[k].count += h.recentCount || h.count || 0;
    byDistrict[k].cells += 1;
  }
  const rows = Object.values(byDistrict).sort((a, b) => b.count - a.count).slice(0, 6);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="p-3 space-y-1.5">
      <div className="px-1 text-[12px] text-ink-muted">
        {emerging.length} emerging cluster{emerging.length === 1 ? '' : 's'}
        {tier === 'station' ? ' on this register' : ` across ${rows.length} district${rows.length === 1 ? '' : 's'}`}
        {' '}— recent activity far above the local baseline.
      </div>
      {rows.map((r) => (
        <button key={r.name} onClick={onOpen} className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-kadi-blue50 text-sm text-left">
          <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse shrink-0" />
          <span className="flex-1 truncate text-ink">{r.name}</span>
          <span className="flex-1 h-2 bg-surface-3 rounded overflow-hidden max-w-[120px]"><span className="block h-full bg-danger" style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <span className="font-num text-xs text-ink-muted w-16 text-right">{r.count} recent</span>
          <span className="font-num text-[11px] text-ink-subtle w-14 text-right">{r.cells} spot{r.cells === 1 ? '' : 's'}</span>
        </button>
      ))}
    </div>
  );
}

// The one sentence the heatmap is trying to say: which day and which window carry the most.
function HeatPeak({ heat }: { heat: { dow: number; hour: number; count: number }[] }) {
  if (!heat?.length) return null;
  const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const byHour = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  let total = 0;
  for (const c of heat) { byHour[c.hour] += c.count; byDow[c.dow] += c.count; total += c.count; }
  // Busiest 4-hour window.
  let best = 0, bestSum = -1;
  for (let h = 0; h < 24; h += 1) { let s = 0; for (let k = 0; k < 4; k += 1) s += byHour[(h + k) % 24]; if (s > bestSum) { bestSum = s; best = h; } }
  const topDow = byDow.indexOf(Math.max(...byDow));
  const share = total ? Math.round((bestSum / total) * 100) : 0;
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <p className="px-4 pb-3 text-[12px] text-ink-muted">
      Busiest on <b className="text-ink">{DOW[topDow]}</b>, and the <b className="text-ink">{fmt(best)}–{fmt((best + 4) % 24)}</b> window
      carries <b className="text-ink">{share}%</b> of all incidents — the block to weight patrol cover toward.
    </p>
  );
}

function DistrictStandings({ districts, socio, focusId, onOpen }: {
  districts: any; socio: any; focusId?: string; onOpen: (id: string) => void;
}) {
  if (!districts) return <Skeleton rows={6} />;
  const rateById = new Map<string, any>((socio?.districts || []).map((d: any) => [String(d.districtId), d.ratePer100k]));
  const rows = [...(districts.districts || [])];
  const max = districts.maxCount || Math.max(1, ...rows.map((r: any) => r.total));
  return (
    <div className="max-h-[340px] overflow-auto p-2">
      {rows.map((d: any, i: number) => {
        const isFocus = focusId && String(d.districtId) === String(focusId);
        return (
          <button key={d.districtId} onClick={() => onOpen(String(d.districtId))}
            ref={isFocus ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${isFocus ? 'bg-kadi-saffron/15 ring-1 ring-kadi-saffron/40' : 'hover:bg-kadi-blue50'}`}>
            <span className="w-5 text-ink-muted font-num text-xs shrink-0">{i + 1}</span>
            <span className={`flex-1 truncate ${isFocus ? 'font-semibold text-kadi-navy' : ''}`}>{d.district}{isFocus ? ' ★' : ''}</span>
            <span className="w-16 h-1.5 bg-surface-3 rounded overflow-hidden shrink-0"><span className="block h-full" style={{ width: `${(d.total / max) * 100}%`, background: isFocus ? '#E8871E' : '#1A6FC4' }} /></span>
            <span className="font-num text-xs w-14 text-right text-ink">{d.total.toLocaleString()}</span>
            <span className="font-num text-[11px] w-16 text-right text-ink-muted" title="per 100k">{rateById.get(String(d.districtId)) ?? '—'}/100k</span>
          </button>
        );
      })}
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
