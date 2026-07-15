// Reusable presentational components — chips, KPI cards, states.
import { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

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
