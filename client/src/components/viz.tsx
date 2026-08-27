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
