// HomeAnalytics — the analytical centrepiece of the landing page.
//
// These are not decorative. Each one answers a question an SCRB officer actually asks,
// using data that already exists in the read-model but had no visual representation:
//   1. Where is this heading?        state forecast + 95% band
//   2. What kind of crime is it?     radial composition by crime group
//   3. Why is it there?              urbanisation vs per-capita rate, bubble = population
//   4. Who carries the volume?       treemap of district share
//
// Every chart is fed real figures and every one carries the caveat it needs. Charts are
// isAnimationActive={false} because Recharts measures width during layout and animating
// from a zero-width container renders an empty chart.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart, Area, Line, RadialBarChart, RadialBar, ScatterChart, Scatter,
  Treemap, ResponsiveContainer, XAxis, YAxis, ZAxis, Tooltip, Legend as RLegend, Cell,
} from 'recharts';
import { TrendingUp, PieChart, Building2, LayoutGrid } from 'lucide-react';
import { useSocio, useForecast } from '../api/hooks';
import { Hint, rise } from './viz';

const AXIS = { fontSize: 10, fill: '#5B6B7E' };
const BAND: Record<string, string> = { Urban: '#1A6FC4', Mixed: '#2FA8A0', Rural: '#E8871E' };
const RADIAL = ['#0f2f44', '#1A6FC4', '#2FA8A0', '#E8871E', '#C0392B', '#7C5CBF', '#5B6B7E', '#9AA8B8'];

function Card({ title, icon, hint, children }: any) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">{icon}{title}</h3>
        {hint && <Hint text={hint} />}
      </div>
      {children}
    </div>
  );
}

export default function HomeAnalytics({ stats }: { stats?: any }) {
  const { data: socio } = useSocio();
  const { data: fc } = useForecast();
  const [band, setBand] = useState<string | null>(null);

  // History and projection in one series so the band joins the actual line.
  const forecastSeries = useMemo(() => {
    const hist = (fc?.state?.history || []).map((h: any) => ({ month: h.month, actual: h.count }));
    const last = hist[hist.length - 1];
    const proj = (fc?.state?.forecast || []).map((p: any) => ({
      month: p.month, predicted: p.predicted, band: [p.lower, p.upper],
    }));
    if (last) proj.unshift({ month: last.month, predicted: last.actual, band: [last.actual, last.actual] });
    return [...hist, ...proj.slice(1)];
  }, [fc]);

  const composition = useMemo(() => {
    const heads = stats?.topCrimeHeads || [];
    const total = heads.reduce((s: number, h: any) => s + (h.count || 0), 0) || 1;
    return heads.slice(0, 8).map((h: any, i: number) => ({
      name: h.name, count: h.count, pct: +(100 * h.count / total).toFixed(1), fill: RADIAL[i % RADIAL.length],
    }));
  }, [stats]);

  const bubbles = useMemo(
    () => (socio?.districts || [])
      .filter((d: any) => !band || d.band === band)
      .map((d: any) => ({
        x: d.urbanPct, y: d.ratePer100k, z: d.population,
        name: d.districtName, band: d.band, total: d.total,
      })),
    [socio, band],
  );

  const treemap = useMemo(
    () => (socio?.districts || [])
      .map((d: any) => ({ name: d.districtName, size: d.total, band: d.band, rate: d.ratePer100k }))
      .sort((a: any, b: any) => b.size - a.size),
    [socio],
  );

  const corr = socio?.correlations?.[0];

  return (
    <motion.div variants={rise} className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 1. Where is this heading */}
        <Card title="Where this is heading" icon={<TrendingUp size={15} className="text-kadi-blue" />}
          hint="Registered FIRs per month across Karnataka, with a 3-month projection. The shaded band is the 95% interval. Accuracy is a hold-out backtest: the last months were hidden from the model, then predicted and scored.">
          <div className="p-4">
            <div className="h-[236px]">
              <ResponsiveContainer width="100%" height="100%" key={forecastSeries.length}>
                <ComposedChart data={forecastSeries} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="homeBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E8871E" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#E8871E" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={38} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
                  <Area dataKey="band" stroke="none" fill="url(#homeBand)" isAnimationActive={false} name="95% interval" connectNulls />
                  <Line type="monotone" dataKey="actual" stroke="#1A6FC4" strokeWidth={2.2} dot={false} isAnimationActive={false} name="Actual" connectNulls />
                  <Line type="monotone" dataKey="predicted" stroke="#E8871E" strokeWidth={2.2} strokeDasharray="5 4" dot={{ r: 2.5, fill: '#E8871E' }} isAnimationActive={false} name="Forecast" connectNulls />
                  <RLegend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {fc?.accuracy && (
              <p className="mt-1 text-[12px] text-ink-muted">
                Backtest <strong>MAPE {fc.accuracy.mape}%</strong> over {fc.accuracy.holdoutMonths} withheld months ·
                last complete month {fc.lastCompleteMonth}
              </p>
            )}
          </div>
        </Card>

        {/* 2. What kind of crime */}
        <Card title="What kind of crime" icon={<PieChart size={15} className="text-kadi-blue" />}
          hint="Share of all registered FIRs by crime group. Hover a ring for the exact count.">
          <div className="p-4">
            <div className="h-[236px]">
              <ResponsiveContainer width="100%" height="100%" key={composition.length}>
                <RadialBarChart data={composition} innerRadius="26%" outerRadius="98%" startAngle={90} endAngle={-270}>
                  <RadialBar dataKey="pct" background={{ fill: '#F0F4F9' }} cornerRadius={4} isAnimationActive={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
                    formatter={(v: any, _n: any, p: any) => [`${p.payload.count.toLocaleString()} FIRs (${v}%)`, p.payload.name]}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {composition.map((c: any) => (
                <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.fill }} />
                  {c.name} <span className="font-num text-ink">{c.pct}%</span>
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 3. Why is it there */}
        <Card title="Why it is there" icon={<Building2 size={15} className="text-kadi-blue" />}
          hint="Each bubble is a district: horizontal = share of population living in urban areas, vertical = FIRs per 100,000 residents, bubble size = population. Click a band to filter. Correlation is not causation — urban rates also reflect higher reporting and better station access.">
          <div className="p-4">
            <div className="flex gap-1.5 mb-2">
              {['Urban', 'Mixed', 'Rural'].map((b) => (
                <button key={b} onClick={() => setBand(band === b ? null : b)}
                  className={`text-[11px] px-2 py-1 rounded-ctl border transition-colors ${
                    band === b ? 'border-transparent text-white' : 'border-line text-ink-muted hover:bg-surface-3'}`}
                  style={band === b ? { background: BAND[b] } : undefined}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: band === b ? '#fff' : BAND[b] }} />{b}
                  </span>
                </button>
              ))}
              {band && <button onClick={() => setBand(null)} className="text-[11px] px-2 py-1 text-ink-muted hover:underline">clear</button>}
            </div>
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%" key={`${bubbles.length}-${band}`}>
                <ScatterChart margin={{ top: 6, right: 14, bottom: 18, left: 0 }}>
                  <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} axisLine={false} unit="%"
                    label={{ value: 'urbanisation', position: 'insideBottom', offset: -10, style: AXIS }} />
                  <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} axisLine={false} width={40}
                    label={{ value: 'per 100k', angle: -90, position: 'insideLeft', style: AXIS }} />
                  <ZAxis type="number" dataKey="z" range={[40, 520]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ payload }: any) => {
                      const p = payload?.[0]?.payload;
                      if (!p) return null;
                      return (
                        <div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-ink-muted">{p.total.toLocaleString()} FIRs · {p.y}/100k</div>
                          <div className="text-ink-muted">{p.x}% urban · {(p.z / 1e6).toFixed(2)}M people</div>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={bubbles} isAnimationActive={false}>
                    {bubbles.map((b: any) => <Cell key={b.name} fill={BAND[b.band]} fillOpacity={0.72} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            {corr && (
              <p className="mt-1 text-[12px] text-ink-muted">
                {corr.indicator}: <strong>r = {corr.pearson > 0 ? '+' : ''}{corr.pearson}</strong>
                {' '}({corr.strength}, p {corr.pValue < 0.0001 ? '< 0.0001' : `= ${corr.pValue}`}, n = {corr.n})
              </p>
            )}
          </div>
        </Card>

        {/* 4. Who carries the volume */}
        <Card title="Who carries the volume" icon={<LayoutGrid size={15} className="text-kadi-blue" />}
          hint="Area is proportional to the district's share of all registered FIRs, coloured by urbanisation band. Volume is not the same as rate — a large tile can still have a low per-capita rate.">
          <div className="p-4">
            <div className="h-[236px]">
              <ResponsiveContainer width="100%" height="100%" key={treemap.length}>
                <Treemap data={treemap} dataKey="size" stroke="#fff" isAnimationActive={false}
                  content={<TreeCell />}>
                  <Tooltip
                    content={({ payload }: any) => {
                      const p = payload?.[0]?.payload;
                      if (!p) return null;
                      return (
                        <div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-ink-muted">{p.size?.toLocaleString()} FIRs · {p.rate}/100k</div>
                        </div>
                      );
                    }}
                  />
                </Treemap>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">
              Bengaluru City alone accounts for a large share of raw volume — which is exactly why
              the platform ranks by rate, not count.
            </p>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

// Treemap cell: label only when the tile is big enough to hold text legibly.
function TreeCell(props: any) {
  const { x, y, width, height, name, band } = props;
  if (width == null) return null;
  const showLabel = width > 62 && height > 26;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3}
        fill={BAND[band] || '#5B6B7E'} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />
      {showLabel && (
        <text x={x + 6} y={y + 16} fontSize={10} fill="#fff" fontWeight={500}>
          {String(name).length > Math.floor(width / 6.2) ? `${String(name).slice(0, Math.floor(width / 6.2))}…` : name}
        </text>
      )}
    </g>
  );
}
