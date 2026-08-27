// The intelligence band — one surface, four pages.
//
// A signal that only tells you something is a report. A signal that hands you the filtered
// view it describes is a lead, so every finding here carries the query that reproduces it and
// renders as a link. "63% sit in three stations" is interesting; one click into those three
// stations is the thing an officer can act on before the meeting ends.
//
// Provenance is stated rather than implied. The prose is AI-written; the numbers are not, and
// the footer says so plainly. In a policing tool the question "did the model make this up?"
// gets asked immediately, and the honest answer has to be visible on the surface itself.
import { ReactNode, useState } from 'react';
import { Sparkles, ChevronDown, ArrowRight } from 'lucide-react';
import { AiProvenanceInfo } from './InfoDot';
import type { Intel, Signal } from '../api/hooks';

const SEV: Record<string, { dot: string; ring: string; label: string }> = {
  high: { dot: 'bg-danger', ring: 'border-l-danger', label: 'Act now' },
  medium: { dot: 'bg-warning', ring: 'border-l-warning', label: 'Worth attention' },
  info: { dot: 'bg-kadi-blue', ring: 'border-l-kadi-blue', label: 'Context' },
};

export function IntelligenceBand({ data, isLoading, onApply, title = 'Intelligence', subtitle, extra, defaultOpen = false }: {
  data?: Intel;
  isLoading?: boolean;
  // Applies a signal's query to the page's own filter state. Left to the caller because each
  // page owns its URL contract; the band only knows what the finding was.
  onApply?: (query: Record<string, string>) => void;
  title?: string;
  subtitle?: string;
  extra?: ReactNode;
  defaultOpen?: boolean;
}) {
  // Collapsed by default. The header already carries the headline count and how many need
  // acting on -- the part worth seeing without asking. The detail opens on demand rather than
  // pushing the page's actual content below the fold on arrival.
  const [open, setOpen] = useState(defaultOpen);

  if (isLoading) {
    return (
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-kadi-gold" />
          <span className="text-sm font-semibold text-kadi-navy">{title}</span>
          <span className="text-xs text-ink-muted">reading the current view…</span>
        </div>
        <div className="space-y-2">
          <div className="skeleton h-4 w-3/4" /><div className="skeleton h-4 w-2/3" />
        </div>
      </div>
    );
  }
  if (!data || !data.total || !data.signals?.length) return null;

  const signals = data.signals;
  const highCount = signals.filter((s) => s.severity === 'high').length;

  return (
    <div className="card overflow-hidden">
      {/* The (i) is a SIBLING of the disclosure button, not a child of it. It used to be nested
          inside, which is invalid -- a button may not contain another button -- and needed a
          stopPropagation wrapper to stop asking what the panel is from also collapsing it.
          Two buttons in a row need neither. */}
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-surface-3/60 transition-colors">
        <button onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left min-w-0 flex-1">
          <Sparkles size={15} className="text-kadi-gold shrink-0" />
          <span className="text-sm font-semibold text-kadi-navy shrink-0">{title}</span>
          <span className="text-[12px] text-ink-muted truncate">
            {subtitle || `${signals.length} finding${signals.length === 1 ? '' : 's'} in this view`}
          </span>
        </button>
        <AiProvenanceInfo source={data.insightSource} />
        {highCount > 0 && (
          <span className="text-[11px] font-medium bg-red-50 text-danger rounded-full px-2 py-0.5 shrink-0">
            {highCount} to act on
          </span>
        )}
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'} className="shrink-0">
          <ChevronDown size={15} className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-line">
          {data.insight && (
            <p className="px-4 py-3 text-[13px] leading-relaxed text-ink bg-kadi-blue50/40 border-b border-line">
              {data.insight}
            </p>
          )}

          <div className="divide-y divide-line/70">
            {signals.map((s) => <SignalRow key={s.key} s={s} onApply={onApply} />)}
          </div>

          {extra}

        </div>
      )}
    </div>
  );
}

function SignalRow({ s, onApply }: { s: Signal; onApply?: (q: Record<string, string>) => void }) {
  const sev = SEV[s.severity] || SEV.info;
  return (
    <div className={`px-4 py-2.5 border-l-[3px] ${sev.ring}`}>
      <div className="flex items-start gap-2">
        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${sev.dot}`} title={sev.label} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink">{s.title}</div>
          <div className="text-[12.5px] text-ink-muted leading-relaxed mt-0.5">{s.detail}</div>
        </div>
        {s.query && s.queryLabel && onApply && (
          <button onClick={() => onApply(s.query!)}
            className="shrink-0 flex items-center gap-1 text-[12px] font-medium text-kadi-blue hover:text-white hover:bg-kadi-blue border border-kadi-blue/30 hover:border-kadi-blue rounded-full px-2.5 py-1 transition-colors whitespace-nowrap">
            {s.queryLabel} <ArrowRight size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
