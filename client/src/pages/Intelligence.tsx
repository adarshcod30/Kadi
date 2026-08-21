// Intelligence — the sociological + predictive pillar of the problem statement.
// Answers "the WHY behind the WHERE" (per-capita rates + socio-economic correlation)
// and "forecast emerging risk" (3-month district projections with a measured backtest).
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart, Area, Line, ScatterChart, Scatter, BarChart, Bar, Cell,
  ResponsiveContainer, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, Legend as RLegend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Info, Target, Users2, Building2, MapPin, HelpCircle, CalendarDays, Sparkles } from 'lucide-react';
import { useSocio, useForecast, useOccasions, useZones } from '../api/hooks';
import { Section, Skeleton, Chip } from '../components/ui';
import { Hint, stagger, rise } from '../components/viz';

type TabKey = 'where' | 'why' | 'when' | 'next';
const TABS: { key: TabKey; label: string; icon: any; blurb: string }[] = [
  { key: 'where', label: 'Where', icon: MapPin,
    blurb: 'Which districts carry the burden once you divide by population — and which are currently above their own baseline.' },
  { key: 'why', label: 'Why', icon: HelpCircle,
    blurb: 'What area-level conditions the crime rate tracks with. Correlation, not causation, and the confounders are named.' },
  { key: 'when', label: 'When', icon: CalendarDays,
    blurb: 'How offending moves through the calendar — festivals, national holidays and ordinary days are not the same.' },
  { key: 'next', label: 'What next', icon: Sparkles,
    blurb: 'Three-month projections with a measured error, and the districts trending against their own history.' },
];

// The narrative sits above the charts, not instead of them. Every number in it was computed
// by the pipeline and handed to the model; the model only chose the wording.
function AiNote({ text, kind }: { text?: string; kind: string }) {
  if (!text) return null;
  return (
    <div className="rounded-card border border-kadi-blue/25 bg-kadi-blue50/40 px-4 py-3 flex items-start gap-2.5">
      <Sparkles size={15} className="text-kadi-blue shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-blue mb-0.5">
          Reading the {kind} picture
        </div>
        <p className="text-[13px] text-ink leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

const ZONE_STYLE: Record<string, { dot: string; label: string; ring?: string }> = {
  red_pulsing: { dot: '#C0392B', label: 'Pulsing red', ring: 'animate-pulse' },
  red: { dot: '#C0392B', label: 'Red' },
  yellow: { dot: '#C9820A', label: 'Yellow' },
  normal: { dot: '#3AA76D', label: 'Normal' },
};

// The brief asks for "visual indicators when a crime category spikes in a region compared to
// historical averages". Every area is measured against its OWN trailing baseline, so a
// consistently busy district does not sit permanently red -- which is what would happen if
// this ranked by volume, and is exactly the failure per-capita analysis exists to correct.
function ZoneBoard({ zones }: { zones: any }) {
  if (!zones) return <div className="card"><Skeleton rows={4} /></div>;
  const s = zones.summary || {};
  const districts = zones.districts || [];
  const pulsing = (zones.stations || []).filter((x: any) => x.zone === 'red_pulsing');
  const counts: [string, number][] = [
    ['red_pulsing', s.red_pulsing || 0], ['red', s.red || 0],
    ['yellow', s.yellow || 0], ['normal', s.normal || 0],
  ];
  return (
    <Section
      title={<span className="flex items-center gap-2"><Target size={15} className="text-danger" />
        Zone status — {s.month} vs its own {s.baselineMonths}-month baseline</span>}
      action={<Hint text="Zones compare each area with its own history, not with other areas. A rise must also be materially large in absolute terms — a station going from 3 cases to 7 is +133% and four extra cases, which is noise wearing a big percentage." />}>
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {counts.map(([z, n]) => (
            <div key={z} className="flex items-center gap-2 rounded-ctl border border-line px-3 py-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${ZONE_STYLE[z].ring || ''}`}
                style={{ background: ZONE_STYLE[z].dot }} />
              <span className="text-[12.5px] text-ink-muted">{ZONE_STYLE[z].label}</span>
              <span className="font-num text-sm text-ink font-medium">{n}</span>
            </div>
          ))}
        </div>

        {pulsing.length > 0 && (
          <div className="rounded-card border border-danger/30 bg-danger/5 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />
              <b className="text-[13px] text-ink">Pulsing — above baseline and still rising</b>
            </div>
            {pulsing.slice(0, 4).map((x: any) => (
              <div key={x.unitId} className="text-[12.5px] text-ink-muted">
                Station {x.unitId}: <b className="text-ink">{x.current}</b> this month against a
                baseline of {x.baseline} — <b className="text-danger">{x.changePct > 0 ? '+' : ''}{x.changePct}%</b>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="label mb-1">Districts, furthest from their own baseline first</div>
          {districts.slice(0, 8).map((d: any) => (
            <div key={d.districtId} className="flex items-center gap-3 px-1 py-1.5 border-b border-line/60 last:border-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${ZONE_STYLE[d.zone]?.ring || ''}`}
                style={{ background: ZONE_STYLE[d.zone]?.dot || '#3AA76D' }} />
              <span className="text-[13px] text-ink flex-1 truncate">{d.districtName}</span>
              <span className="text-[11.5px] text-ink-muted w-40 truncate hidden sm:block">{d.driverHead || ''}</span>
              <span className="font-num text-[12.5px] text-ink-muted w-24 text-right">{d.current} vs {d.baseline}</span>
              <span className={`font-num text-[12.5px] w-16 text-right font-medium ${
                d.changePct > 10 ? 'text-danger' : d.changePct < -5 ? 'text-kadi-teal' : 'text-ink-muted'}`}>
                {d.changePct > 0 ? '+' : ''}{d.changePct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function OccasionPanels({ occ }: { occ: any }) {
  if (!occ) return <div className="card"><Skeleton rows={6} /></div>;
  const classes = occ.classes || [];
  const occasions = occ.occasions || [];
  const tone = (v: number) => (v > 10 ? 'text-danger' : v < -5 ? 'text-kadi-teal' : 'text-ink-muted');
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={rise}>
        <Section title="Crime by kind of day"
          action={<Hint text="Rates are cases per day, so classes with very different day counts stay comparable. Baseline is an ordinary weekday." />}>
          <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {classes.map((c: any) => (
              <div key={c.dayClass} className="rounded-card border border-line p-3">
                <div className="text-sm font-semibold text-ink">{c.dayClass}</div>
                <div className="text-2xl font-num text-kadi-navy mt-1">{c.casesPerDay}</div>
                <div className="text-[11px] text-ink-muted">cases per day · {c.days} days</div>
                <div className={`text-[12px] font-medium mt-1 ${tone(c.vsNormalPct)}`}>
                  {c.vsNormalPct > 0 ? '+' : ''}{c.vsNormalPct}% vs ordinary day
                </div>
                {c.peakHour !== null && c.peakHour !== undefined && (
                  <div className="text-[11px] text-ink-muted mt-1">peaks {String(c.peakHour).padStart(2, '0')}:00</div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </motion.div>

      <motion.div variants={rise}>
        <Section title="By occasion"
          action={<Hint text="Lunar-calendar dates shift year to year, so each festival is windowed by a day either side. That also picks up eve-of-festival activity." />}>
          <div className="p-2">
            {occasions.map((o: any) => (
              <div key={o.occasion} className="flex items-center gap-3 px-2 py-2 border-b border-line/60 last:border-0">
                <span className="text-sm text-ink flex-1 truncate">{o.occasion}</span>
                <span className="text-[11.5px] text-ink-muted w-28 truncate">{o.topHead}</span>
                <span className="font-num text-sm text-ink-muted w-20 text-right">{o.casesPerDay}/day</span>
                <span className={`font-num text-sm w-16 text-right font-medium ${tone(o.vsNormalPct)}`}>
                  {o.vsNormalPct > 0 ? '+' : ''}{o.vsNormalPct}%
                </span>
              </div>
            ))}
          </div>
        </Section>
      </motion.div>

      <div className="text-[11.5px] text-ink-muted px-1">{occ.method}</div>
    </motion.div>
  );
}

const BAND_COLOR: Record<string, string> = {
  Urban: '#1A6FC4', Mixed: '#2FA8A0', Rural: '#E8871E',
};
const AXIS = { fontSize: 10, fill: '#5B6B7E' };

export default function Intelligence() {
  const [tab, setTab] = useState<TabKey>('where');
  const { data: zones } = useZones();
  const { data: occ } = useOccasions();
  const { data: socio, isLoading: sLoad } = useSocio();
  const { data: fc, isLoading: fLoad } = useForecast();
  const [indicator, setIndicator] = useState(0);

  // NOTE: every hook must run before the loading early-return, or the hook order changes
  // between renders and React throws.
  const districts = socio?.districts || [];
  const shifts = useMemo(
    () => [...districts].sort((a: any, b: any) => Math.abs(b.rankShift) - Math.abs(a.rankShift)).slice(0, 10),
    [districts],
  );

  // History and forecast share one series so the confidence band joins the actual line.
  const stateSeries = useMemo(() => {
    const hist = (fc?.state?.history || []).map((h: any) => ({
      month: h.month, actual: h.count, band: null as any,
    }));
    const last = hist[hist.length - 1];
    const proj = (fc?.state?.forecast || []).map((p: any) => ({
      month: p.month, predicted: p.predicted, band: [p.lower, p.upper],
    }));
    // stitch: repeat the last actual as the forecast's first anchor so the line connects
    if (last) proj.unshift({ month: last.month, predicted: last.actual, band: [last.actual, last.actual] });
    return [...hist, ...proj.slice(1)].map((r: any) => {
      const anchor = last && r.month === last.month;
      return anchor ? { ...r, predicted: last.actual, band: [last.actual, last.actual] } : r;
    });
  }, [fc]);

  if (sLoad || fLoad) return <PageSkeleton />;

  const corr = socio?.correlations?.[indicator];
  const rising = (fc?.districts || []).filter((d: any) => d.direction === 'rising');

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Hero */}
      <motion.div variants={rise} className="card p-5 bg-gradient-to-br from-kadi-navy to-kadi-navy700 text-white">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Sociological &amp; Predictive Intelligence</h1>
            <p className="text-white/75 text-sm mt-1 max-w-2xl">
              Raw FIR counts mostly measure population — the biggest district always “looks worst”.
              Normalising to incidents per 100,000 residents and correlating against socio-economic
              indicators is what turns a count map into an explanation.
            </p>
          </div>
          <div className="flex gap-3">
            <HeroStat label="Districts analysed" value={districts.length} />
            <HeroStat label="Forecast horizon" value={`${fc?.horizonMonths || 3} mo`} />
            <HeroStat label="Backtest MAPE" value={fc?.accuracy ? `${fc.accuracy.mape}%` : '—'} good />
          </div>
        </div>
      </motion.div>

      {/* Four themes rather than one long scroll. The brief asks for storytelling, and a
          single stacked page makes every panel feel equally important -- which means none of
          them lead. Each tab answers one question. */}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              tab === t.key ? 'border-kadi-blue text-kadi-blue' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-ink-muted -mt-2">{TABS.find((t) => t.key === tab)?.blurb}</p>

      {tab === 'where' && <AiNote kind="where" text={zones?.insight} />}
      {tab === 'when' && <AiNote kind="when" text={occ?.insight} />}

      {tab === 'where' && <>
      <motion.div variants={rise}>
        <ZoneBoard zones={zones} />
      </motion.div>
      {/* ---- The headline finding: counts vs rates ---- */}
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Users2 size={15} className="text-kadi-blue" />Counts mislead — the same districts ranked per 100,000 residents</span>}
          action={<Hint text="Bars show how far a district moves when you divide by population. Green = it is worse per-capita than raw counts suggest; red = it only looked bad because it is populous." />}
        >
          <div className="p-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" key={shifts.length}>
                <BarChart data={shifts} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false}
                    label={{ value: 'Rank places moved', position: 'insideBottom', offset: -2, style: AXIS }} />
                  <YAxis type="category" dataKey="districtName" width={118} tick={AXIS} tickLine={false} axisLine={false} />
                  <ReferenceLine x={0} stroke="#9AA8B8" />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
                    formatter={(v: any, _n: any, p: any) => [
                      `#${p.payload.rankByCount} by count → #${p.payload.rankByRate} by rate`, 'Rank',
                    ]}
                  />
                  <Bar dataKey="rankShift" isAnimationActive={false} radius={[0, 3, 3, 0]}>
                    {shifts.map((d: any) => (
                      <Cell key={d.districtId} fill={d.rankShift > 0 ? '#2FA8A0' : '#C0392B'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid sm:grid-cols-3 gap-2 text-[13px]">
              {shifts.slice(0, 3).map((d: any) => (
                <div key={d.districtId} className="rounded-ctl bg-surface-2 border border-line px-3 py-2">
                  <div className="font-medium text-ink">{d.districtName}</div>
                  <div className="text-ink-muted">
                    {d.total.toLocaleString()} FIRs · <span className="font-num">{d.ratePer100k}</span>/100k
                  </div>
                  <div className={d.rankShift > 0 ? 'text-kadi-teal' : 'text-danger'}>
                    #{d.rankByCount} → #{d.rankByRate} by rate
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </motion.div>
      </>}

      {tab === 'why' && <>
      {/* ---- Correlation ---- */}
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Building2 size={15} className="text-kadi-blue" />Socio-economic correlation</span>}
          action={
            <div className="flex gap-1">
              {(socio?.correlations || []).map((c: any, i: number) => (
                <button key={c.field} onClick={() => setIndicator(i)}
                  className={`text-xs px-2 py-1 rounded-ctl border transition-colors ${
                    i === indicator ? 'bg-kadi-blue50 border-kadi-blue text-kadi-blue font-medium'
                      : 'border-line text-ink-muted hover:bg-surface-3'}`}>
                  {c.indicator}
                </button>
              ))}
            </div>
          }
        >
          {corr && (
            <div className="p-4 grid lg:grid-cols-[1fr_260px] gap-4">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%" key={corr.field}>
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 0 }}>
                    <XAxis type="number" dataKey="x" name={corr.indicator} tick={AXIS} tickLine={false} axisLine={false}
                      label={{ value: corr.indicator, position: 'insideBottom', offset: -12, style: AXIS }} />
                    <YAxis type="number" dataKey="y" name="Rate" tick={AXIS} tickLine={false} axisLine={false} width={42}
                      label={{ value: 'per 100k', angle: -90, position: 'insideLeft', style: AXIS }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
                      formatter={(v: any, n: any) => [typeof v === 'number' ? v.toFixed(1) : v, n === 'y' ? 'per 100k' : corr.indicator]}
                      labelFormatter={() => ''}
                      content={({ payload }: any) => {
                        const p = payload?.[0]?.payload;
                        if (!p) return null;
                        return (
                          <div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                            <div className="font-medium">{p.district}</div>
                            <div className="text-ink-muted">{corr.indicator}: {p.x}</div>
                            <div className="text-ink-muted">Rate: {p.y}/100k</div>
                          </div>
                        );
                      }}
                    />
                    {['Urban', 'Mixed', 'Rural'].map((b) => (
                      <Scatter key={b} name={b} data={(corr.points || []).filter((p: any) => p.band === b)}
                        fill={BAND_COLOR[b]} isAnimationActive={false} />
                    ))}
                    {/* Top-aligned: the default bottom legend overlapped the x-axis
                        label, which sits at insideBottom offset -12. */}
                    <RLegend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 11 }} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3">
                <div className="rounded-ctl border border-line bg-surface-2 p-3">
                  <div className="label mb-1">Correlation</div>
                  <div className="text-2xl font-semibold font-num text-ink">
                    {corr.pearson > 0 ? '+' : ''}{corr.pearson}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    Pearson r · Spearman ρ {corr.spearman > 0 ? '+' : ''}{corr.spearman}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Chip className={corr.strength === 'not significant'
                      ? 'bg-surface-3 text-ink-muted' : 'bg-kadi-blue50 text-kadi-blue'}>
                      {corr.strength}
                    </Chip>
                    <Chip className="bg-surface-3 text-ink-muted">p {corr.pValue < 0.0001 ? '< 0.0001' : `= ${corr.pValue}`}</Chip>
                    <Chip className="bg-surface-3 text-ink-muted">n = {corr.n}</Chip>
                  </div>
                </div>
                <p className="text-[13px] text-ink-muted leading-relaxed">{corr.why}</p>
                <div className="flex items-start gap-2 text-[12px] text-ink-muted bg-surface-2 border border-line rounded-ctl p-2.5">
                  <Info size={13} className="shrink-0 mt-0.5 text-kadi-blue" />
                  <span>Correlation is not causation — higher urban crime rates also reflect
                    higher <em>reporting</em> rates, better station access and denser opportunity.</span>
                </div>
              </div>
            </div>
          )}
        </Section>
      </motion.div>

      {/* ---- Composition by urbanisation band ---- */}
      <motion.div variants={rise}>
        <Section title="Crime mix by urbanisation band"
          action={<Hint text="Districts grouped by their urban population share. Compares not just how much crime, but what kind — the composition differs even where the rate is similar." />}>
          <div className="p-4 grid sm:grid-cols-3 gap-3">
            {(socio?.composition || []).map((c: any) => (
              <div key={c.band} className="rounded-card border border-line p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: BAND_COLOR[c.band] }} />
                    {c.band}
                  </span>
                  <span className="text-xs text-ink-muted">{c.districts} districts</span>
                </div>
                <div className="text-2xl font-semibold font-num text-ink">{c.ratePer100k}</div>
                <div className="text-xs text-ink-muted mb-2">per 100k residents</div>
                <div className="space-y-1">
                  {c.mix.slice(0, 4).map((m: any) => (
                    <div key={m.head}>
                      <div className="flex justify-between text-[11px] text-ink-muted">
                        <span className="truncate pr-2">{m.head}</span><span className="font-num">{m.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: BAND_COLOR[c.band] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </motion.div>

      </>}

      {tab === 'when' && <OccasionPanels occ={occ} />}

      {tab === 'next' && <>
      {/* ---- Forecast ---- */}
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Target size={15} className="text-kadi-blue" />State-wide forecast — next {fc?.horizonMonths || 3} months</span>}
          action={<Hint text="Linear trend plus month-of-year seasonality. The shaded band is the 95% interval. Accuracy is a hold-out backtest: the last 3 months were hidden from the model, then predicted and scored." />}
        >
          <div className="p-4">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%" key={stateSeries.length}>
                <ComposedChart data={stateSeries} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="fcBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E8871E" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#E8871E" stopOpacity={0.06} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
                  <Area dataKey="band" stroke="none" fill="url(#fcBand)" isAnimationActive={false}
                    name="95% interval" connectNulls />
                  <Line type="monotone" dataKey="actual" stroke="#1A6FC4" strokeWidth={2} dot={false}
                    isAnimationActive={false} name="Actual" connectNulls />
                  <Line type="monotone" dataKey="predicted" stroke="#E8871E" strokeWidth={2}
                    strokeDasharray="5 4" dot={{ r: 2.5, fill: '#E8871E' }} isAnimationActive={false}
                    name="Forecast" connectNulls />
                  <RLegend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {fc?.accuracy && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Chip className="bg-kadi-blue50 text-kadi-blue">MAPE {fc.accuracy.mape}%</Chip>
                <Chip className="bg-surface-3 text-ink-muted">MAE {fc.accuracy.mae}</Chip>
                <span className="text-ink-muted">
                  measured on {fc.accuracy.holdoutMonths} withheld months —
                  {fc.accuracy.detail.map((d: any) => ` ${d.month}: predicted ${d.predicted} vs actual ${d.actual}`).join(' ·')}
                </span>
              </div>
            )}
            <p className="mt-2 text-[12px] text-ink-muted">
              Last complete month of data: <strong>{fc?.lastCompleteMonth}</strong>. Partial months are
              excluded from the fit — including them would invent a false downward trend.
            </p>
          </div>
        </Section>
      </motion.div>

      {/* ---- District projections ---- */}
      <motion.div variants={rise}>
        <Section title={`District projections — ${rising.length} district${rising.length === 1 ? '' : 's'} trending up`}
          action={<Hint text="Next-month projection against each district's own recent 12-month average. Districts are ranked by projected change, so emerging pressure surfaces before it becomes a spike." />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-ink-muted">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">District</th>
                  <th className="px-3 py-2 font-medium text-right">12-mo avg</th>
                  <th className="px-3 py-2 font-medium text-right">Next month</th>
                  <th className="px-3 py-2 font-medium text-right">Change</th>
                  <th className="px-3 py-2 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {(fc?.districts || []).slice(0, 12).map((d: any) => (
                  <tr key={d.districtId} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-medium text-ink">{d.districtName}</td>
                    <td className="px-3 py-2 text-right font-num text-ink-muted">{d.recentAvg}</td>
                    <td className="px-3 py-2 text-right font-num">{d.nextMonth}</td>
                    <td className={`px-3 py-2 text-right font-num font-medium ${
                      d.changePct > 5 ? 'text-danger' : d.changePct < -5 ? 'text-kadi-teal' : 'text-ink-muted'}`}>
                      {d.changePct > 0 ? '+' : ''}{d.changePct}%
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs ${
                        d.direction === 'rising' ? 'text-danger'
                          : d.direction === 'falling' ? 'text-kadi-teal' : 'text-ink-muted'}`}>
                        {d.direction === 'rising' ? <TrendingUp size={13} />
                          : d.direction === 'falling' ? <TrendingDown size={13} /> : <Minus size={13} />}
                        {d.direction}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </motion.div>

      {/* Method + fairness */}
      <motion.div variants={rise} className="card p-4 text-[12px] text-ink-muted leading-relaxed">
        <strong className="text-ink">Method &amp; limits.</strong> Denominator: {socio?.method?.denominator}.
        Forecast: {fc?.method?.model}, {fc?.method?.interval}, {fc?.method?.trendWindowMonths}-month trend window.
        {' '}Every indicator here is an <strong>area-level aggregate</strong> — population, literacy and
        urbanisation are never joined to an individual and never used as a feature in any person-level
        score. Caste, religion and occupation are excluded from every model by construction.
      </motion.div>
      </>}

    </motion.div>
  );
}

function HeroStat({ label, value, good }: { label: string; value: any; good?: boolean }) {
  return (
    <div className="rounded-ctl bg-white/10 px-3 py-2 min-w-[104px]">
      <div className="text-[11px] text-white/70">{label}</div>
      <div className={`text-lg font-semibold font-num ${good ? 'text-kadi-gold' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card"><Skeleton rows={2} /></div>
      <div className="card"><Skeleton rows={6} /></div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card"><Skeleton rows={6} /></div>
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    </div>
  );
}
