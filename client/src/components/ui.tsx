// Reusable presentational components — chips, KPI cards, states.
import { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, X } from 'lucide-react';

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

export function KpiCard({ label, value, delta, hint, accent, onClick }: {
  label: ReactNode; value: ReactNode; delta?: number; hint?: string; accent?: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className={`card p-4 text-left transition-shadow hover:shadow-hover ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className="label">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <div className="text-2xl font-semibold font-num text-kadi-navy" style={accent ? { color: accent } : undefined}>{value}</div>
        {delta != null && (
          <span className={`text-xs font-medium flex items-center ${delta >= 0 ? 'text-success' : 'text-danger'}`}>
            {delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(delta)}%
          </span>
        )}
      </div>
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
const PAGE_SIZES = [25, 50, 100, 200];
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
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
              className="bg-transparent border border-line rounded px-1 py-0.5 text-[12px] ml-0.5">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
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
