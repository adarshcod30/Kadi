// Reusable visualization components — heatmap, donut, animated number, info hint.
import { ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { InfoDot } from './InfoDot';

// Info hint: a small (i) that reveals a description on hover — used to explain each viz.
//
// A second implementation of InfoDot, and it carried the same two faults InfoDot had: an
// absolutely positioned panel that any overflow-hidden card could clip, and a close on the
// first pixel of mouse-out. Delegating means charts inherit the pinning and the portal for
// free, and there is one of these to fix next time rather than two.
export function Hint({ text }: { text: string }) {
  return <InfoDot width="w-56">{text}</InfoDot>;
}

// Staggered entrance for a grid of children.
export const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
export const rise = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

// Time-of-day (0-23) x weekday (Mon-Sun) heatmap.
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function HeatMap({ data }: { data: { dow: number; hour: number; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const grid: Record<string, number> = {};
  for (const d of data) grid[`${d.dow}-${d.hour}`] = d.count;
  const color = (v: number) => {
    if (!v) return '#F0F4F9';
    const t = v / max;
    // light blue -> navy
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${lerp(200, 11)},${lerp(220, 61)},${lerp(240, 117)})`;
  };
  return (
    <div className="p-3 overflow-x-auto">
      <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `26px repeat(24, 1fr)` }}>
        <div />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="text-[8px] text-ink-muted text-center">{h % 6 === 0 ? h : ''}</div>
        ))}
        {DOW.flatMap((label, wd) => [
          <div key={`l${wd}`} className="text-[9px] text-ink-muted pr-1 flex items-center justify-end">{label}</div>,
          ...Array.from({ length: 24 }).map((_, h) => {
            const v = grid[`${wd}-${h}`] || 0;
            return <div key={`${wd}-${h}`} title={`${label} ${h}:00 — ${v} cases`}
              className="aspect-square rounded-[2px] transition-transform hover:scale-125 hover:ring-1 hover:ring-kadi-navy"
              style={{ background: color(v), minWidth: 10 }} />;
          }),
        ])}
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-ink-muted">
        Fewer <span className="h-2 w-24 rounded" style={{ background: 'linear-gradient(90deg,#F0F4F9,#C8DCF0,#4A90D9,#0f2f44)' }} /> More · darker = more incidents at that hour
      </div>
    </div>
  );
}

// Donut chart with center label.
export function Donut({ data, centerLabel, centerValue }: {
  data: { name: string; value: number; color: string }[]; centerLabel?: string; centerValue?: string;
}) {
  return (
    <div className="relative h-48">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-xl font-semibold font-num text-kadi-navy">{centerValue}</div>
            <div className="text-[10px] text-ink-muted uppercase">{centerLabel}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// The linked double pie (P2-2). Two rings that read each other: the outer is case status, the
// inner is crime mix. Select a status and the inner ring re-renders to the crime mix WITHIN
// that status; select a crime head and the outer ring re-renders to the status mix within that
// head. It answers a real question the two independent donuts could not — "which crime types
// are driving the undetected pile?" — from a true crosstab, not a proportional guess.
const STATUS_COLOR: Record<string, string> = {
  'Under Investigation': '#1A6FC4', 'Charge-sheeted': '#1E874B', Undetected: '#C9820A', Closed: '#8A94A3',
};
export function DoublePie({ mix, headColor }: { mix: any; headColor: (name: string) => string }) {
  const [selStatus, setSelStatus] = useState<string | null>(null);
  const [selHead, setSelHead] = useState<string | null>(null);
  // Hover readout. Recharts' floating tooltip lands on top of the donut and covers the centre
  // figure, so the hovered slice is reported in a fixed strip ABOVE the chart instead — outside
  // the ring, where nothing can overlap it.
  const [hover, setHover] = useState<{ name: string; value: number; pct: number; color: string } | null>(null);
  if (!mix) return null;

  const statuses = mix.statuses as { id: string; name: string; count: number }[];
  const heads = (mix.heads as { name: string; count: number }[]).slice(0, 7);

  // Outer ring: status counts, filtered to the selected head if one is picked.
  const outer = statuses.map((s) => {
    const v = selHead
      ? (mix.matrix[s.id]?.[selHead] || 0)
      : s.count;
    return { name: s.name, value: v, color: STATUS_COLOR[s.name] || '#8A94A3' };
  }).filter((d) => d.value > 0);

  // Inner ring: crime-head counts, filtered to the selected status if one is picked.
  const inner = heads.map((h) => {
    const v = selStatus
      ? (mix.matrix[selStatus]?.[h.name] || 0)
      : h.count;
    return { name: h.name, value: v, color: headColor(h.name) };
  }).filter((d) => d.value > 0);

  const total = selHead ? outer.reduce((a, b) => a + b.value, 0)
    : selStatus ? inner.reduce((a, b) => a + b.value, 0) : mix.total;

  const grand = (selHead || selStatus) ? total : mix.total;
  const enter = (d: any, ring: 'outer' | 'inner') => {
    const base = ring === 'outer' ? outer : inner;
    const hit = base.find((x) => x.name === d.name);
    if (!hit) return;
    const sum = base.reduce((a, b) => a + b.value, 0) || 1;
    setHover({ name: hit.name, value: hit.value, pct: +(100 * hit.value / sum).toFixed(1), color: hit.color });
  };

  return (
    <div className="p-3">
      {/* The hover readout, ABOVE the ring. Fixed height so the chart never shifts as it
          appears and disappears. */}
      <div className="h-6 flex items-center justify-center px-2">
        {hover ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] max-w-full">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: hover.color }} />
            <span className="text-ink font-medium truncate">{hover.name}</span>
            <span className="font-num text-ink-muted whitespace-nowrap">{hover.value.toLocaleString()} · {hover.pct}%</span>
          </span>
        ) : (
          <span className="text-[11.5px] text-ink-subtle">Hover a slice for its figure</span>
        )}
      </div>
      <div className="relative h-56" onMouseLeave={() => setHover(null)}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={inner} dataKey="value" nameKey="name" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none"
              onMouseEnter={(d: any) => enter(d, 'inner')}
              onClick={(d: any) => setSelHead((cur) => (cur === d.name ? null : d.name))}>
              {inner.map((d, i) => <Cell key={i} fill={d.color} cursor="pointer" opacity={selHead && selHead !== d.name ? 0.35 : 1} />)}
            </Pie>
            <Pie data={outer} dataKey="value" nameKey="name" innerRadius={70} outerRadius={92} paddingAngle={2} stroke="none"
              onMouseEnter={(d: any) => enter(d, 'outer')}
              onClick={(d: any) => setSelStatus((cur) => { const id = statuses.find((s) => s.name === d.name)?.id || null; return cur === id ? null : id; })}>
              {outer.map((d, i) => <Cell key={i} fill={d.color} cursor="pointer" opacity={selStatus && statuses.find((s) => s.id === selStatus)?.name !== d.name ? 0.35 : 1} />)}
            </Pie>
            {/* No <Tooltip>: it renders over the donut and covers the centre figure. The strip
                above carries the same information where nothing overlaps it. */}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-lg font-semibold font-num text-kadi-navy">{grand?.toLocaleString()}</div>
            <div className="text-[10px] text-ink-muted uppercase">
              {selStatus ? statuses.find((s) => s.id === selStatus)?.name : selHead || 'all cases'}
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11.5px] text-ink-muted text-center mt-1">
        Outer ring: status. Inner ring: crime type. {selStatus || selHead
          ? <button onClick={() => { setSelStatus(null); setSelHead(null); }} className="link">Reset</button>
          : 'Click a slice to cross-filter the other ring.'}
      </p>
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-3 text-xs">
      {items.map((it) => (
        <span key={it.name} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
          {it.name}{it.value != null && <span className="text-ink-muted font-num">· {it.value}</span>}
        </span>
      ))}
    </div>
  );
}

// Section with an info hint in the header.
export function VizCard({ title, hint, action, children, delay = 0 }: {
  title: string; hint?: string; action?: ReactNode; children: ReactNode; delay?: number;
}) {
  return (
    <motion.div variants={rise} className="card">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">{title}{hint && <Hint text={hint} />}</h2>
        {action}
      </div>
      {children}
    </motion.div>
  );
}
