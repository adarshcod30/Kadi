import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Clock, ChevronDown } from 'lucide-react';
import { useHealthCases, useHealthSummary, useMe, useHealthIntel } from '../api/hooks';
import { KpiCard, Section, Chip, SeverityDot, Skeleton, Empty, Mono, Pager, TierChip } from '../components/ui';
import { IntelligenceBand } from '../components/IntelligenceBand';
import { InfoDot } from '../components/InfoDot';
import { Select } from '../components/Select';
import { DEADLINE } from '../lib/tiers';

const FLAG_LABEL: Record<string, string> = {
  investigation_ageing: 'Ageing', pendency: 'Pendency', undetected_risk: 'Undetected risk',
  reporting_delay: 'Reporting delay', false_case: 'False case',
};

// The statutory-deadline pill (D4). Distinct colour language from health severity — a case
// can be healthy by peer comparison and still be days from a legal breach.
function DeadlinePill({ dl }: { dl: any }) {
  if (!dl) return <span className="text-[11px] text-ink-muted">—</span>;
  const d = DEADLINE[dl.band] || DEADLINE.ok;
  const label = dl.daysRemaining < 0 ? `${Math.abs(dl.daysRemaining)}d over` : `${dl.daysRemaining}d left`;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap" style={{ color: d.text }}>
      <Clock size={11} /> {label}
    </span>
  );
}

export default function Health() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const [severity, setSeverity] = useState('high');
  const [flag, setFlag] = useState('');
  const [sort, setSort] = useState('deadline');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading } = useHealthCases({ severity, flag, sort, page, pageSize });
  const { data: summary } = useHealthSummary();
  const { data: intel, isLoading: intelLoading } = useHealthIntel({ severity, flag });

  const tier = me?.capabilities?.effectiveScope === 'unit' ? 'station'
    : me?.capabilities?.effectiveScope === 'district' ? 'district' : 'state';

  const applySignal = (query: Record<string, string>) => {
    if (query.flag !== undefined) { setFlag(query.flag); setSeverity(''); }
    if (query.severity !== undefined) setSeverity(query.severity);
    setPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reset = (fn: () => void) => { fn(); setPage(1); };

  const dl = summary?.deadlines;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
            Investigation-Health Cockpit <TierChip tier={tier as any} />
          </h1>
          <p className="text-sm text-ink-muted max-w-2xl">{tier === 'station'
            ? 'Cases in your register slipping past detection timelines — and, first, those nearing a statutory chargesheet deadline. Each is deterministic and auditable, with a recommended action.'
            : tier === 'district'
              ? 'Cases slipping in your district, ordered so the nearest to a statutory or peer-median breach surface first. Use the scope control to narrow to one station.'
              : 'Early warning across all 31 districts — deterministic, auditable, with recommended actions. Districts with the most flagged cases lead. Use the scope control to drill in.'}</p>
        </div>
      </div>

      <IntelligenceBand data={intel} isLoading={intelLoading} onApply={applySignal}
        title="Where supervision should intervene"
        subtitle="What is driving the flags in this worklist, and where it concentrates" />

      {/* Deadline KPIs first — the statutory clock outranks peer comparison. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={<span className="flex items-center gap-1">Deadline breached
          <InfoDot><b className="block mb-1 text-kadi-navy">Statutory chargesheet clock</b>
            Open cases whose inferred chargesheet deadline has passed. The deadline is taken as
            90 days for Heinous offences and 60 otherwise, counted from arrest where one is
            recorded, otherwise from registration. A proxy for the BNSS custody test — an
            indicator, not legal advice.</InfoDot></span>}
          value={dl?.breached?.toLocaleString() ?? '—'} accent="#C0392B" />
        <KpiCard label="Due ≤ 7 days" value={dl?.critical?.toLocaleString() ?? '—'} accent="#C9820A" />
        <KpiCard label={<span className="flex items-center gap-1">Flagged (high)
          <InfoDot>Cases carrying a high-severity health flag from the pipeline — ageing past
            peer median, pendency, or undetected-risk.</InfoDot></span>}
          value={summary?.high?.toLocaleString() ?? '—'} accent="#C0392B" />
        <KpiCard label="Avg investigation age" value={summary ? `${summary.avgInvestigationAge}d` : '—'} />
      </div>

      {/* Controls: severity, flag, and the new sort. */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        {['high', 'medium', ''].map((s) => (
          <button key={s} onClick={() => reset(() => setSeverity(s))} className={`chip ${severity === s ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink-muted'}`}>{s || 'All'} severity</button>
        ))}
        <span className="w-px h-5 bg-line mx-1" />
        {['', 'investigation_ageing', 'pendency', 'undetected_risk', 'false_case'].map((f) => (
          <button key={f} onClick={() => reset(() => setFlag(f))} className={`chip ${flag === f ? 'bg-kadi-blue text-white' : 'bg-surface-3 text-ink-muted'}`}>{f ? FLAG_LABEL[f] : 'Any flag'}</button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-ink-muted">Sort</span>
          <Select value={sort} onChange={(v) => reset(() => setSort(v))} className="w-40"
            options={[
              { value: 'deadline', label: 'Deadline (soonest)' },
              { value: 'age', label: 'Investigation age' },
              { value: 'severity', label: 'Health severity' },
            ]} />
        </div>
      </div>

      <Section title={data ? `Worklist (${data.total.toLocaleString()})` : 'Worklist'}>
        {isLoading ? <Skeleton rows={8} /> : !data?.items.length ? <Empty title="No flagged cases in scope" /> : (
          <>
            {/* Denser rows: the identifiers, flags and the two clocks on one line; the reason and
                recommended action open on demand rather than always occupying vertical space.
                Roughly twice the cases per screen as the old always-expanded row. */}
            <div className="divide-y divide-line">
              {data.items.map((h: any) => {
                const open = expanded === h.caseMasterId;
                return (
                  <div key={h.caseMasterId} className="px-4 py-2.5 hover:bg-surface-3/60">
                    <div className="flex items-center gap-3">
                      <SeverityDot severity={h.severity} />
                      <button onClick={() => nav(`/cases/${h.caseMasterId}`)} className="link shrink-0"><Mono>{h.crimeNo}</Mono></button>
                      <span className="text-[13px] text-ink-muted truncate min-w-0 flex-1">
                        {h.crimeSubHead} · {h.unit}, {h.district}
                      </span>
                      <div className="hidden sm:flex flex-wrap gap-1 shrink-0">
                        {h.flagKeys.slice(0, 3).map((f: string) => <Chip key={f} color={f === 'undetected_risk' || f === 'pendency' ? 'red' : 'amber'}>{FLAG_LABEL[f] || f}</Chip>)}
                      </div>
                      <span className="w-24 text-right shrink-0"><DeadlinePill dl={h.deadline} /></span>
                      <span className="w-20 text-right shrink-0 text-[12px] text-ink-muted font-num" title={`peer median ${h.peerMedianAgeDays}d`}>{h.investigationAgeDays}d</span>
                      <button onClick={() => setExpanded(open ? null : h.caseMasterId)} className="shrink-0 text-ink-muted" aria-label={open ? 'Collapse' : 'Expand'}>
                        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    {open && (
                      <div className="mt-2 pl-6 pr-2 space-y-2">
                        <div className="text-[13px] text-ink-muted">{h.flags?.[0]?.reason}</div>
                        {h.deadline && (
                          <div className="text-[12px] text-ink-muted">
                            Chargesheet due <b className="text-ink">{h.deadline.dueDate}</b> · {h.deadline.allowedDays}-day
                            window ({h.deadline.gravity}), {h.deadline.basis === 'custody' ? 'from arrest' : 'from registration'}.
                          </div>
                        )}
                        <div className="text-[13px] bg-kadi-blue50 text-kadi-navy700 rounded-ctl px-2.5 py-1.5 inline-block">
                          <b className="text-xs">Action:</b> {h.recommendationText}
                        </div>
                        {h.clusterId && <button onClick={() => nav(`/graph?cluster=${h.clusterId}`)} className="btn-outline text-xs ml-2"><Share2 size={12} /> Network</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-line">
              <Pager page={data.page} pageSize={data.pageSize} total={data.total}
                onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
