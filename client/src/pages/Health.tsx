import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Clock, ChevronDown, FileText, AlertTriangle } from 'lucide-react';
import { useHealthCases, useHealthSummary, useMe, useHealthIntel } from '../api/hooks';
import { Section, Chip, Skeleton, Empty, Mono, Pager, TierChip, MiniSpark } from '../components/ui';
import { IntelligenceBand } from '../components/IntelligenceBand';
import { InfoDot } from '../components/InfoDot';
import { Select } from '../components/Select';
import { DEADLINE } from '../lib/tiers';

const FLAG_LABEL: Record<string, string> = {
  investigation_ageing: 'Ageing', pendency: 'Pendency', undetected_risk: 'Undetected risk',
  reporting_delay: 'Reporting delay', false_case: 'False case',
};

// A KPI that carries its own meaning. The four cards were a label and a number over a lot of
// white space; each now states what the figure is measured against, so the number lands with
// the context that makes it actionable rather than merely large.
function HealthStat({ label, value, sub, tone, info, bar }: {
  label: string; value: string; sub: string; tone: string; info?: React.ReactNode;
  bar?: { pct: number; caption: string };
}) {
  return (
    <div className="card p-4 relative overflow-hidden flex flex-col">
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: tone }} />
      <div className="text-[11px] uppercase tracking-wide text-ink-muted flex items-center gap-1">
        {label}{info && <InfoDot>{info}</InfoDot>}
      </div>
      <div className="text-3xl font-semibold font-num mt-1 leading-none" style={{ color: tone }}>{value}</div>
      <p className="text-[12px] text-ink-muted mt-1.5 flex-1">{sub}</p>
      {bar && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, bar.pct)}%`, background: tone }} />
          </div>
          <div className="text-[11px] text-ink-subtle mt-1">{bar.caption}</div>
        </div>
      )}
    </div>
  );
}

// The statutory clock (D4), as a pill. Distinct colour language from health severity: a case can
// be healthy against its peers and still be days from a legal breach.
function DeadlinePill({ dl }: { dl: any }) {
  if (!dl) return <span className="text-[11px] text-ink-subtle">—</span>;
  const d = DEADLINE[dl.band] || DEADLINE.ok;
  const label = dl.daysRemaining < 0 ? `${Math.abs(dl.daysRemaining)}d over` : `${dl.daysRemaining}d left`;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium whitespace-nowrap px-1.5 py-0.5 rounded-full"
      style={{ color: d.text, background: `${d.dot}14` }}>
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
  const [pageSize, setPageSize] = useState(25);
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
  const running = dl?.running || 0;
  const breachedPct = running ? Math.round((dl.breached / running) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* The scope badge sits at the far right of the header row, where the page's other
          controls live — beside the title it read as part of the title. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-kadi-navy">Investigation-Health Cockpit</h1>
          <p className="text-sm text-ink-muted max-w-2xl">{tier === 'station'
            ? 'Cases in your register slipping past detection timelines — and, first, those nearing a statutory chargesheet deadline. Each is deterministic and auditable, with a recommended action.'
            : tier === 'district'
              ? 'Cases slipping in your district, ordered so the nearest to a statutory or peer-median breach surface first. Use the scope control to narrow to one station.'
              : 'Early warning across all 31 districts — deterministic, auditable, with recommended actions. Use the scope control to drill in.'}</p>
        </div>
        <TierChip tier={tier as any} />
      </div>

      <IntelligenceBand data={intel} isLoading={intelLoading} onApply={applySignal}
        title="Where supervision should intervene"
        subtitle="What is driving the flags in this worklist, and where it concentrates" />

      {/* Deadline first: the statutory clock outranks peer comparison. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <HealthStat label="Deadline breached" tone="#C0392B"
          value={dl?.breached?.toLocaleString() ?? '—'}
          sub={running ? `of ${running.toLocaleString()} open cases with a running clock` : 'no open case has a running clock'}
          bar={running ? { pct: breachedPct, caption: `${breachedPct}% of the open register is past its date` } : undefined}
          info={<><b className="block mb-1 text-kadi-navy">Statutory chargesheet clock</b>
            Open cases whose inferred chargesheet deadline has passed. Taken as 90 days for
            Heinous offences and 60 otherwise, counted from arrest where one is recorded,
            otherwise from registration. A proxy for the BNSS custody test — an indicator, not
            legal advice.</>} />
        <HealthStat label="Due ≤ 7 days" tone="#C9820A"
          value={dl?.critical?.toLocaleString() ?? '—'}
          sub={`${(dl?.soon ?? 0).toLocaleString()} more fall due within 21 days — this week's filing queue`}
          info="Cases whose chargesheet date lands inside the next seven days. These are the ones a supervisor can still act on before the date passes." />
        <HealthStat label="Flagged (high)" tone="#C0392B"
          value={summary?.high?.toLocaleString() ?? '—'}
          sub={`${(summary?.medium ?? 0).toLocaleString()} more carry a medium flag`}
          info="Cases carrying a high-severity health flag from the pipeline — ageing past the peer median, pendency, or undetected-risk. Separate from the deadline clock: a case can be flagged without being near its date, and vice versa." />
        <HealthStat label="Avg investigation age" tone="#1A6FC4"
          value={summary ? `${summary.avgInvestigationAge}d` : '—'}
          sub="mean age of every flagged case in this scope, measured from registration"
          info="The average is a scope-level health signal, not a per-case one. Each row below states its own age against the peer median for that crime type, which is the comparison that matters for an individual file." />
      </div>

      {/* Controls */}
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
          <Select value={sort} onChange={(v) => reset(() => setSort(v))} className="w-44"
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
            {/* A header row, so the two right-hand figures say what they are. */}
            <div className="hidden md:grid grid-cols-[10px_minmax(0,1fr)_auto_96px_74px_84px_22px] items-center gap-3 px-4 py-1.5
              border-b border-line bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
              <span /><span>Case</span><span>Flags</span>
              <span className="text-right">Deadline</span>
              <span className="text-right">Age</span>
              <span className="text-right">Network</span>
              <span />
            </div>

            <div className="divide-y divide-line">
              {data.items.map((h: any) => {
                const open = expanded === h.caseMasterId;
                const overPeer = h.peerMedianAgeDays
                  ? (h.investigationAgeDays / h.peerMedianAgeDays) : null;
                return (
                  <div key={h.caseMasterId} className={open ? 'bg-surface-2/60' : 'hover:bg-surface-3/50'}>
                    <div className="grid grid-cols-[10px_minmax(0,1fr)_auto_96px_74px_84px_22px] items-center gap-3 px-4 py-2.5">
                      <span className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: h.severity === 'high' ? '#C0392B' : h.severity === 'medium' ? '#C9820A' : '#8A94A3' }}
                        title={`${h.severity} severity`} />
                      {/* Identifier over context, so the FIR number is the anchor of the row and
                          the crime type and station read as its subtitle rather than competing. */}
                      <div className="min-w-0">
                        <button onClick={() => nav(`/cases/${h.caseMasterId}`)} className="link block truncate text-left">
                          <Mono>{h.crimeNo}</Mono>
                        </button>
                        <div className="text-[12px] text-ink-muted truncate">{h.crimeSubHead} · {h.unit}, {h.district}</div>
                      </div>
                      <div className="hidden lg:flex flex-wrap gap-1 justify-end max-w-[230px]">
                        {h.flagKeys.slice(0, 3).map((f: string) => (
                          <Chip key={f} color={f === 'undetected_risk' || f === 'pendency' ? 'red' : 'amber'}>{FLAG_LABEL[f] || f}</Chip>
                        ))}
                      </div>
                      <span className="text-right"><DeadlinePill dl={h.deadline} /></span>
                      <span className="text-right">
                        <span className="font-num text-[12.5px] text-ink">{h.investigationAgeDays}d</span>
                        {overPeer && overPeer >= 1.2 && (
                          <span className="block text-[10.5px] text-danger font-num">{overPeer.toFixed(1)}× peer</span>
                        )}
                      </span>
                      {/* The network button on the row itself (not hidden behind expand), so the
                          jump into the graph is one click from the queue. */}
                      <span className="text-right">
                        {h.clusterId ? (
                          <button onClick={() => nav(`/graph?cluster=${h.clusterId}`)}
                            className="btn-outline text-[11.5px] px-2 py-1 inline-flex items-center gap-1"
                            title="Open this case's network in the graph">
                            <Share2 size={11} /> Network
                          </button>
                        ) : <span className="text-[11px] text-ink-subtle">—</span>}
                      </span>
                      <button onClick={() => setExpanded(open ? null : h.caseMasterId)}
                        className="text-ink-muted justify-self-end" aria-label={open ? 'Collapse' : 'Expand'}>
                        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                    </div>

                    {open && (
                      <div className="px-4 pb-3 pl-9 grid md:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <div className="flex items-start gap-2 text-[12.5px] text-ink">
                            <AlertTriangle size={13} className="text-warning shrink-0 mt-0.5" />
                            <span>{h.flags?.[0]?.reason}</span>
                          </div>
                          {h.deadline && (
                            <div className="flex items-start gap-2 text-[12.5px] text-ink-muted">
                              <Clock size={13} className="shrink-0 mt-0.5" />
                              <span>Chargesheet due <b className="text-ink">{h.deadline.dueDate}</b> · {h.deadline.allowedDays}-day
                                window ({h.deadline.gravity}), {h.deadline.basis === 'custody' ? 'from arrest' : 'from registration'}.</span>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1 lg:hidden">
                            {h.flagKeys.map((f: string) => (
                              <Chip key={f} color={f === 'undetected_risk' || f === 'pendency' ? 'red' : 'amber'}>{FLAG_LABEL[f] || f}</Chip>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="text-[13px] bg-kadi-blue50 text-kadi-navy700 rounded-ctl px-3 py-2">
                            <b className="text-xs uppercase tracking-wide">Recommended action</b>
                            <div className="mt-0.5">{h.recommendationText}</div>
                          </div>
                          {/* Right-aligned: left-aligned inside the right-hand column they
                              landed mid-row and read as centred, which is nowhere. At the
                              panel's right edge they line up under the row's own Network
                              button, so the actions for a case sit in one vertical lane. */}
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => nav(`/cases/${h.caseMasterId}`)} className="btn-outline text-xs inline-flex items-center gap-1.5">
                              <FileText size={12} /> Open case
                            </button>
                            {h.clusterId && (
                              <button onClick={() => nav(`/graph?cluster=${h.clusterId}`)} className="btn-outline text-xs inline-flex items-center gap-1.5">
                                <Share2 size={12} /> Network
                              </button>
                            )}
                          </div>
                        </div>
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
