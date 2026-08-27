// HomeAnalytics — the analytical centrepiece of the landing page.
//
// Four questions an officer actually asks, and the brief rebuilt three of them:
//   1. Where is this heading?   a properly outlined trend + projection with a stated backtest
//   2. What kind of crime?      an INTERACTIVE pie — hover isolates, click filters (was a
//                               radial-bar chart, which reads as a gauge, not a share)
//   3. Why is it there?         urbanisation vs per-capita rate, with a fitted trend line and
//                               its correlation stated
//   4. Who carries the volume?  district-share treemap
//
// AND IT IS TIER-AWARE (D5 / P2-6 / P2-7). A district officer does not want the state's
// forecast, the state's crime mix or a treemap of all 31 districts. So at district scope the
// panels re-point at that district's own numbers: its trend, its crime mix, where it ranks,
// and which of ITS stations carries the load — the last replacing "who carries the volume",
// which is a state question. The station tier collapses to the two panels that still mean
// something for one register.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ComposedChart, Area, Line, CartesianGrid, PieChart, Pie, ScatterChart, Scatter,
  Treemap, ResponsiveContainer, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, Legend as RLegend, Cell,
} from 'recharts';
import { TrendingUp, PieChart as PieIcon, Building2, LayoutGrid, MapPin, Award } from 'lucide-react';
import { useSocio, useForecast } from '../api/hooks';
import { HEAD_COLOR } from '../features/graph/GraphCanvas';
import { Hint, rise } from './viz';

const AXIS = { fontSize: 10, fill: '#5B6B7E' };
const BAND: Record<string, string> = { Urban: '#1A6FC4', Mixed: '#2FA8A0', Rural: '#E8871E' };
const SLICE = ['#0f2f44', '#1A6FC4', '#2FA8A0', '#E8871E', '#C0392B', '#7C5CBF', '#5B6B7E', '#9AA8B8'];

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

// Least-squares fit over (x, y) points, so the "why" scatter carries a trend line rather than
// asking the eye to guess the slope.
function fitLine(pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return null;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const d = n * sxx - sx * sx;
  if (!d) return null;
  const m = (n * sxy - sx * sy) / d;
  const b = (sy - m * sx) / n;
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  return [{ x: x0, y: m * x0 + b }, { x: x1, y: m * x1 + b }];
}

// The interactive pie (P1-2). Hover dims the rest; click pins a slice and shows its count and
// share in the middle; click again to clear. Responsive to the container.
function CrimePie({ data, centerLabel }: { data: { name: string; count: number }[]; centerLabel: string }) {
  const [sel, setSel] = useState<string | null>(null);
  // Hover reported ABOVE the ring rather than in a floating tooltip, which would sit on top of
  // the donut and cover the centre figure.
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const slices = data.map((d, i) => ({ ...d, color: HEAD_COLOR[d.name] || SLICE[i % SLICE.length], pct: +(100 * d.count / total).toFixed(1) }));
  const active = sel ? slices.find((s) => s.name === sel) : null;
  const hovered = hover ? slices.find((s) => s.name === hover) : null;
  return (
    <div className="p-4">
      <div className="h-6 flex items-center justify-center px-2">
        {hovered ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] max-w-full">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: hovered.color }} />
            <span className="text-ink font-medium truncate">{hovered.name}</span>
            <span className="font-num text-ink-muted whitespace-nowrap">{hovered.count.toLocaleString()} FIRs · {hovered.pct}%</span>
          </span>
        ) : (
          <span className="text-[11.5px] text-ink-subtle">Hover a slice for its figure</span>
        )}
      </div>
      <div className="relative h-[210px]" onMouseLeave={() => setHover(null)}>
        <ResponsiveContainer width="100%" height="100%" key={slices.length}>
          <PieChart>
            <Pie data={slices} dataKey="count" nameKey="name" innerRadius="52%" outerRadius="92%" paddingAngle={2} stroke="none"
              onMouseEnter={(d: any) => setHover(d?.name ?? null)}
              onClick={(d: any) => setSel((c) => (c === d.name ? null : d.name))}>
              {slices.map((s) => <Cell key={s.name} fill={s.color} cursor="pointer" opacity={sel && sel !== s.name ? 0.32 : 1} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-xl font-semibold font-num text-kadi-navy">
              {active ? `${active.pct}%` : total.toLocaleString()}
            </div>
            <div className="text-[10px] text-ink-muted uppercase max-w-[110px] truncate">{active ? active.name : centerLabel}</div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {slices.map((c) => (
          <button key={c.name} onClick={() => setSel((s) => (s === c.name ? null : c.name))}
            className={`inline-flex items-center gap-1.5 text-[11px] transition-opacity ${sel && sel !== c.name ? 'opacity-40' : ''}`}>
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />
            <span className="text-ink-muted">{c.name}</span> <span className="font-num text-ink">{c.pct}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HomeAnalytics({ stats, tier = 'state', command }: { stats?: any; tier?: 'state' | 'district' | 'station'; command?: any }) {
  const nav = useNavigate();
  const { data: socio } = useSocio();
  const { data: fc } = useForecast();
  const [band, setBand] = useState<string | null>(null);
  const district = tier === 'district';
  const rank = stats?.rankContext;

  // Heading series. State uses the fitted forecast with its 95% band; a district uses its own
  // monthly trend (already scoped in stats.trend) so the line is the district's, not the state's.
  const forecastSeries = useMemo(() => {
    if (district) return (stats?.trend || []).map((t: any) => ({ month: t.month, actual: t.count }));
    const hist = (fc?.state?.history || []).map((h: any) => ({ month: h.month, actual: h.count }));
    const last = hist[hist.length - 1];
    const proj = (fc?.state?.forecast || []).map((p: any) => ({ month: p.month, predicted: p.predicted, band: [p.lower, p.upper] }));
    if (last) proj.unshift({ month: last.month, predicted: last.actual, band: [last.actual, last.actual] });
    return [...hist, ...proj.slice(1)];
  }, [fc, stats, district]);

  const crimeMix = useMemo(() => (stats?.topCrimeHeads || []).slice(0, 8).map((h: any) => ({ name: h.name, count: h.count })), [stats]);

  const bubbles = useMemo(
    () => (socio?.districts || [])
      .filter((d: any) => !band || d.band === band)
      .map((d: any) => ({ x: d.urbanPct, y: d.ratePer100k, z: d.population, name: d.districtName, band: d.band, total: d.total, isFocus: district && String(d.districtId) === String(stats?.districtId) })),
    [socio, band, district, stats],
  );
  const trend = useMemo(() => fitLine(bubbles.map((b: any) => ({ x: b.x, y: b.y }))), [bubbles]);

  const treemap = useMemo(
    () => (socio?.districts || [])
      .map((d: any) => ({ name: d.districtName, size: d.total, band: d.band, rate: d.ratePer100k }))
      .sort((a: any, b: any) => b.size - a.size),
    [socio],
  );
  const corr = socio?.correlations?.[0];

  // Stations in this district, for the panel that replaces "who carries the volume" (P2-7).
  const stations = (command?.stations || []).slice(0, 8);
  const maxStation = Math.max(1, ...stations.map((s: any) => s.total || 0));

  return (
    <motion.div variants={rise} className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 1. Where is this heading (P1-1) */}
        <Card title={district ? `Where ${stats?.districtName || 'this district'} is heading` : 'Where this is heading'}
          icon={<TrendingUp size={15} className="text-kadi-blue" />}
          hint={district
            ? 'Registered FIRs per month in this district. The line is the district’s own history, so a rise here is the district’s rise, not the state’s.'
            : 'Registered FIRs per month across Karnataka, with a 3-month projection. The shaded band is the 95% interval. Accuracy is a hold-out backtest: the last months were hidden from the model, then predicted and scored.'}>
          <div className="p-4">
            <div className="h-[236px]">
              <ResponsiveContainer width="100%" height="100%" key={forecastSeries.length}>
                <ComposedChart data={forecastSeries} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="homeBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E8871E" stopOpacity={0.3} /><stop offset="100%" stopColor="#E8871E" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }} minTickGap={28} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={38} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
                  {!district && <Area dataKey="band" stroke="none" fill="url(#homeBand)" isAnimationActive={false} name="95% interval" connectNulls />}
                  <Line type="monotone" dataKey="actual" stroke="#1A6FC4" strokeWidth={2.2} dot={false} isAnimationActive={false} name="Actual" connectNulls />
                  {!district && <Line type="monotone" dataKey="predicted" stroke="#E8871E" strokeWidth={2.2} strokeDasharray="5 4" dot={{ r: 2.5, fill: '#E8871E' }} isAnimationActive={false} name="Forecast" connectNulls />}
                  <RLegend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {!district && fc?.accuracy && (
              <p className="mt-1 text-[12px] text-ink-muted">Backtest <strong>MAPE {fc.accuracy.mape}%</strong> over {fc.accuracy.holdoutMonths} withheld months · last complete month {fc.lastCompleteMonth}</p>
            )}
            {district && rank && (
              <p className="mt-1 text-[12px] text-ink-muted">This district is <strong>#{rank.rankByCount}</strong> of {rank.ofDistricts} by volume, <strong>#{rank.rankByRate}</strong> per 100k — a link to Forecast for the projection.</p>
            )}
          </div>
        </Card>

        {/* 2. What kind of crime — now an interactive pie (P1-2) */}
        <Card title={district ? 'What kind of crime here' : 'What kind of crime'} icon={<PieIcon size={15} className="text-kadi-blue" />}
          hint="Share of registered FIRs by crime group. Hover to isolate a slice, click to pin it — the centre shows that group’s share and the legend cross-highlights.">
          {crimeMix.length ? <CrimePie data={crimeMix} centerLabel={district ? 'in district' : 'all cases'} /> : <div className="p-8 text-center text-sm text-ink-muted">No data.</div>}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 3. Why is it there (P1-3) — with a fitted trend line and the district highlighted */}
        <Card title={district ? `Why ${stats?.districtName || 'here'} — against comparable districts` : 'Why it is there'} icon={<Building2 size={15} className="text-kadi-blue" />}
          hint="Each bubble is a district: horizontal = urbanisation, vertical = FIRs per 100,000 residents, size = population. The line is a least-squares fit — the trend crime rate follows. Correlation is not causation; urban rates also reflect higher reporting and better station access.">
          <div className="p-4">
            <div className="flex gap-1.5 mb-2">
              {['Urban', 'Mixed', 'Rural'].map((b) => (
                <button key={b} onClick={() => setBand(band === b ? null : b)}
                  className={`text-[11px] px-2 py-1 rounded-ctl border transition-colors ${band === b ? 'border-transparent text-white' : 'border-line text-ink-muted hover:bg-surface-3'}`}
                  style={band === b ? { background: BAND[b] } : undefined}>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: band === b ? '#fff' : BAND[b] }} />{b}</span>
                </button>
              ))}
              {band && <button onClick={() => setBand(null)} className="text-[11px] px-2 py-1 text-ink-muted hover:underline">clear</button>}
            </div>
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%" key={`${bubbles.length}-${band}`}>
                <ScatterChart margin={{ top: 6, right: 14, bottom: 18, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" />
                  <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }} unit="%"
                    label={{ value: 'urbanisation', position: 'insideBottom', offset: -10, style: AXIS }} />
                  <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} axisLine={false} width={40}
                    label={{ value: 'per 100k', angle: -90, position: 'insideLeft', style: AXIS }} />
                  <ZAxis type="number" dataKey="z" range={[40, 520]} />
                  {trend && <ReferenceLine ifOverflow="extendDomain" stroke="#C0392B" strokeDasharray="4 4"
                    segment={trend as any} />}
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }: any) => {
                    const p = payload?.[0]?.payload; if (!p) return null;
                    return (<div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                      <div className="font-medium">{p.name}{p.isFocus ? ' ★' : ''}</div>
                      <div className="text-ink-muted">{p.total.toLocaleString()} FIRs · {p.y}/100k</div>
                      <div className="text-ink-muted">{p.x}% urban · {(p.z / 1e6).toFixed(2)}M people</div>
                    </div>);
                  }} />
                  <Scatter data={bubbles} isAnimationActive={false}>
                    {bubbles.map((b: any) => <Cell key={b.name} fill={b.isFocus ? '#0f2f44' : BAND[b.band]} fillOpacity={b.isFocus ? 1 : 0.72} stroke={b.isFocus ? '#E8871E' : 'none'} strokeWidth={b.isFocus ? 2 : 0} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            {corr && (
              <p className="mt-1 text-[12px] text-ink-muted">{corr.indicator}: <strong>r = {corr.pearson > 0 ? '+' : ''}{corr.pearson}</strong> ({corr.strength}, p {corr.pValue < 0.0001 ? '< 0.0001' : `= ${corr.pValue}`}, n = {corr.n})</p>
            )}
          </div>
        </Card>

        {/* 4. State: who carries the volume (treemap). District: which of MY stations carries it (P2-7). */}
        {district ? (
          <Card title="Which of my stations carries this" icon={<MapPin size={15} className="text-kadi-blue" />}
            hint="The stations inside this district, by caseload. This replaces the state treemap — at district scope, the question is which of my stations, not which district.">
            <div className="p-4 space-y-1.5">
              {stations.length ? stations.map((s: any) => (
                <button key={s.unitId} onClick={() => nav(`/cases?unit=${s.unitId}`)}
                  className="w-full flex items-center gap-2 text-[13px] hover:bg-kadi-blue50/50 rounded px-1.5 py-1">
                  <span className="flex-1 text-left truncate text-ink">{s.unitName}</span>
                  <span className="flex-1 h-2 bg-surface-3 rounded overflow-hidden max-w-[140px]"><span className="block h-full bg-kadi-blue" style={{ width: `${(s.total / maxStation) * 100}%` }} /></span>
                  <span className="font-num text-ink-muted w-12 text-right">{s.total?.toLocaleString()}</span>
                </button>
              )) : <div className="text-sm text-ink-muted">No station breakdown available.</div>}
            </div>
          </Card>
        ) : (
          <Card title="Who carries the volume" icon={<LayoutGrid size={15} className="text-kadi-blue" />}
            hint="Area is proportional to the district's share of all registered FIRs, coloured by urbanisation band. Volume is not the same as rate — a large tile can still have a low per-capita rate.">
            <div className="p-4">
              <div className="h-[236px]">
                <ResponsiveContainer width="100%" height="100%" key={treemap.length}>
                  <Treemap data={treemap} dataKey="size" stroke="#fff" isAnimationActive={false} content={<TreeCell />}>
                    <Tooltip content={({ payload }: any) => {
                      const p = payload?.[0]?.payload; if (!p) return null;
                      return (<div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                        <div className="font-medium">{p.name}</div><div className="text-ink-muted">{p.size?.toLocaleString()} FIRs · {p.rate}/100k</div></div>);
                    }} />
                  </Treemap>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">Bengaluru City alone accounts for a large share of raw volume — which is exactly why the platform ranks by rate, not count.</p>
            </div>
          </Card>
        )}
      </div>

      {district && rank && (
        <div className="card p-4 flex items-center gap-4">
          <Award size={22} className="text-kadi-saffron shrink-0" />
          <p className="text-[13px] text-ink">
            <b>{stats?.districtName}</b> stands <b>#{rank.rankByCount}</b> of {rank.ofDistricts} districts by raw volume, but
            <b> #{rank.rankByRate}</b> once you divide by population ({rank.ratePer100k}/100k). Where those two ranks disagree
            is where a count map misleads — the gap is the whole reason this platform ranks by rate.
          </p>
        </div>
      )}
    </motion.div>
  );
}

function TreeCell(props: any) {
  const { x, y, width, height, name, band } = props;
  if (width == null) return null;
  const showLabel = width > 62 && height > 26;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3} fill={BAND[band] || '#5B6B7E'} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />
      {showLabel && (
        <text x={x + 6} y={y + 16} fontSize={10} fill="#fff" fontWeight={500}>
          {String(name).length > Math.floor(width / 6.2) ? `${String(name).slice(0, Math.floor(width / 6.2))}…` : name}
        </text>
      )}
    </g>
  );
}
