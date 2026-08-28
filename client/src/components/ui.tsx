// Reusable presentational components — chips, KPI cards, states.
import { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, X } from 'lucide-react';
import { Select } from './Select';

export function Chip({ children, color = 'default', className = '' }: { children: ReactNode; color?: string; className?: string }) {
  const map: Record<string, string> = {
    default: 'bg-surface-3 text-ink-muted',
    blue: 'bg-kadi-blue50 text-kadi-blue',
    navy: 'bg-kadi-navy text-white',
    green: 'bg-green-50 text-success',
    amber: 'bg-amber-50 text-warning',
    red: 'bg-red-50 text-danger',
    teal: 'bg-teal-50 text-kadi-teal',
    saffron: 'bg-orange-50 text-kadi-saffron',
  };
  return <span className={`chip ${map[color] || map.default} ${className}`}>{children}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const color = s.includes('charge') ? 'green' : s.includes('undetected') ? 'amber' : s.includes('closed') ? 'default' : 'blue';
  return <Chip color={color}>{status || '—'}</Chip>;
}
export function GravityChip({ gravity }: { gravity: string }) {
  const heinous = (gravity || '').toLowerCase().includes('heinous') && !(gravity || '').toLowerCase().includes('non');
  return <Chip color={heinous ? 'red' : 'default'}>{gravity || '—'}</Chip>;
}
export function SeverityDot({ severity }: { severity?: string | null }) {
  const color = severity === 'high' ? 'bg-danger' : severity === 'medium' ? 'bg-warning' : 'bg-line';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={severity || 'ok'} />;
}
export function RiskBadge({ score, band }: { score?: number; band?: string }) {
  const color = band === 'High' ? 'red' : band === 'Medium' ? 'amber' : 'green';
  return <Chip color={color} className="font-num">{score != null ? `${score}` : '—'} · {band || '—'}</Chip>;
}

// A tier badge: blue = state, saffron = district, teal = station. The one visual grammar for
// "who is this panel for", used wherever a surface is scope-differentiated (D1).
export function TierChip({ tier, label }: { tier: 'state' | 'district' | 'station'; label?: string }) {
  const T = { state: { c: '#1A6FC4', t: 'State' }, district: { c: '#E8871E', t: 'District' }, station: { c: '#2FA8A0', t: 'Station' } }[tier];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color: T.c, borderColor: T.c, background: `${T.c}14` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: T.c }} />{label || T.t}
    </span>
  );
}

// A minimal inline sparkline for the KPI row — an area over the last N points with an
// emphasised endpoint, so a number carries its own recent shape without a full chart.
export function MiniSpark({ data, color = '#1A6FC4', width = 96, height = 26 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const end = pts[pts.length - 1];
  const gid = `sp${Math.round(color.charCodeAt(1) + width + data.length)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={end[0]} cy={end[1]} r="2" fill={color} />
    </svg>
  );
}

export function KpiCard({ label, value, delta, hint, accent, onClick, spark, tier, sub }: {
  label: ReactNode; value: ReactNode; delta?: number; hint?: string; accent?: string; onClick?: () => void;
  spark?: number[]; tier?: 'state' | 'district' | 'station';
  // What the figure is measured against. A label over a bare number leaves the reader to supply
  // the context, and for most of these they cannot — "127 networks" means nothing until you know
  // how many of them cross a district line.
  sub?: string;
}) {
  // A tier-coloured top rule ties the card to whose view it belongs in; the sparkline gives
  // the number a shape. Both optional, so existing call sites render unchanged.
  const rule = accent || (tier ? { state: '#1A6FC4', district: '#E8871E', station: '#2FA8A0' }[tier] : '#1A6FC4');
  return (
    <button onClick={onClick} className={`card p-4 text-left relative overflow-hidden transition-shadow hover:shadow-hover ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: rule }} />
      <div className="label">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex items-end gap-2 min-w-0">
          <div className="text-2xl font-semibold font-num text-kadi-navy" style={accent ? { color: accent } : undefined}>{value}</div>
          {delta != null && (
            <span className={`text-xs font-medium flex items-center ${delta >= 0 ? 'text-success' : 'text-danger'}`}>
              {delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(delta)}%
            </span>
          )}
        </div>
        {spark && spark.length > 1 && <MiniSpark data={spark} color={rule} />}
      </div>
      {sub && <div className="text-[12px] text-ink-muted mt-1.5 leading-snug">{sub}</div>}
      {hint && <div className="text-xs text-ink-muted mt-1">{hint}</div>}
    </button>
  );
}

export function Section({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-16 text-ink-muted">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs mt-1">{hint}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}
    </div>
  );
}

export function Spinner() {
  return <div className="inline-block w-4 h-4 border-2 border-kadi-blue border-t-transparent rounded-full animate-spin" />;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

// Applied filters, shown as removable chips.
//
// A filter you cannot see is a filter you cannot undo. Multi-select registers fail the same
// way every time: someone narrows to nearly nothing, cannot tell which of six controls did
// it, and concludes the data is missing rather than that the filter is wrong.
export function FilterChips({ items, onRemove, onClear }: {
  items: { k: string; label: string }[]; onRemove: (k: string) => void; onClear: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 items-center border-t border-line pt-2">
      <span className="text-[11px] uppercase tracking-wide text-ink-muted">Filtered by</span>
      {items.map((f) => (
        <button key={f.k} onClick={() => onRemove(f.k)} title="Remove this filter"
          className="flex items-center gap-1 bg-kadi-blue50 text-kadi-blue rounded-full pl-2.5 pr-1.5 py-0.5 text-[12px] hover:bg-kadi-blue hover:text-white transition-colors">
          {f.label} <X size={11} />
        </button>
      ))}
      <button onClick={onClear} className="text-[12px] text-ink-muted hover:text-ink underline ml-1">Clear all</button>
    </div>
  );
}

// Pagination with an honest position readout.
//
// "Page 4" alone does not tell you how much is left; "76-100 of 59,985" does, and it is the
// difference between a list that feels navigable and one that feels bottomless.
// A caller may pass a page size that is not on this list (Health defaults to 30), and a Select
// whose value matches no option renders BLANK -- which is what the empty dropdown in the pager
// was. The current size is folded into the options below so the control always shows its own
// value, whatever the caller chose.
const PAGE_SIZES = [25, 30, 50, 100, 200];
export function Pager({ page, pageSize, total, onPage, onPageSize }: {
  page: number; pageSize: number; total: number;
  onPage: (n: number) => void; onPageSize?: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = 'btn-outline px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center justify-between gap-3 text-sm flex-wrap">
      <span className="text-ink-muted">
        <span className="font-num">{from.toLocaleString()}–{to.toLocaleString()}</span> of{' '}
        <span className="font-num">{total.toLocaleString()}</span>
        {onPageSize && (
          <>
            {' · '}
            <Select value={String(pageSize)} onChange={(v) => onPageSize(Number(v))}
              className="inline-block w-32 align-middle ml-0.5"
              options={[...new Set([...PAGE_SIZES, pageSize])].sort((a, b) => a - b)
                .map((n) => ({ value: String(n), label: `${n} per page` }))} />
          </>
        )}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <button disabled={page <= 1} onClick={() => onPage(1)} className={btn} title="First page">«</button>
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className={btn}>Prev</button>
          <span className="px-2 text-ink-muted font-num whitespace-nowrap">{page} / {pages.toLocaleString()}</span>
          <button disabled={page >= pages} onClick={() => onPage(page + 1)} className={btn}>Next</button>
          <button disabled={page >= pages} onClick={() => onPage(pages)} className={btn} title="Last page">»</button>
        </div>
      )}
    </div>
  );
}

// Headline counts that are also filters.
//
// Rendered as bare pills these read as passive statistics -- people saw "60 high risk" as a
// label and never discovered it was the fastest way to isolate those 60. So the row states
// what it is, the number is given visual weight over its wording, and the active one is
// filled rather than merely tinted. Each count is computed over the whole filtered set, not
// the current page, so clicking one always yields exactly the number it shows.
export function QuickFilters({ items, hint, onToggle }: {
  items: { k: string; n: number; label: string; on: boolean; value: string; title?: string }[];
  hint?: string;
  onToggle: (k: string, on: boolean, value: string) => void;
}) {
  const anyOn = items.some((i) => i.on);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-ink-muted font-medium">Quick filters</span>
        {hint && <span className="text-[12px] text-ink-muted">{hint}</span>}
        {anyOn && <span className="text-[11.5px] text-kadi-blue font-medium">· click again to clear</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <button key={i.k} onClick={() => onToggle(i.k, i.on, i.value)} title={i.title}
            aria-pressed={i.on}
            className={`group flex items-baseline gap-1.5 rounded-full border px-3 py-1.5 transition-all ${
              i.on
                ? 'bg-kadi-navy text-white border-kadi-navy shadow-sm'
                : 'bg-surface border-line text-ink-muted hover:border-kadi-blue hover:bg-kadi-blue50 hover:text-kadi-navy700'}`}>
            <span className={`font-num font-semibold text-[13.5px] ${i.on ? 'text-white' : 'text-kadi-navy'}`}>
              {i.n.toLocaleString()}
            </span>
            <span className="text-[12.5px]">{i.label}</span>
            {i.on && <X size={11} className="ml-0.5 self-center" />}
          </button>
        ))}
      </div>
    </div>
  );
}
