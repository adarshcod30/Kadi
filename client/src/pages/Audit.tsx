import { useMemo, useState } from 'react';
import { useMe, useAudit } from '../api/hooks';
import { Section, Chip, Skeleton, Empty, Mono, KpiCard } from '../components/ui';
import { Select } from '../components/Select';

const ACTION_LABELS: Record<string, string> = {
  view_case: 'Case viewed',
  view_graph: 'Case-linkage graph viewed',
  view_offender: 'Offender profile viewed',
  assistant_query: 'Assistant query (text)',
  assistant_voice: 'Assistant query (voice)',
};
const actionLabel = (a: string) => ACTION_LABELS[a] || a;

export default function Audit() {
  const { data: me } = useMe();
  const allowed = me?.capabilities.canViewAudit;
  const [actionFilter, setActionFilter] = useState('');
  const { data, isLoading } = useAudit(!!allowed, actionFilter || undefined);

  const items = data?.items || [];
  // Every hook must run before the permission check below. Placing this useMemo after the
  // early return crashed the page outright: /me resolves a beat after first paint, so the
  // first render bailed out early with one fewer hook than the second, and React threw
  // "rendered more hooks than during the previous render" (#310) rather than degrading.
  const stats = useMemo(() => {
    const byAction: Record<string, number> = {};
    const users = new Set<string>();
    for (const a of items) {
      byAction[a.action] = (byAction[a.action] || 0) + 1;
      users.add(a.appUserId);
    }
    const assistantQueries = (byAction.assistant_query || 0) + (byAction.assistant_voice || 0);
    return {
      total: items.length,
      caseViews: (byAction.view_case || 0) + (byAction.view_graph || 0),
      offenderViews: byAction.view_offender || 0,
      assistantQueries,
      distinctUsers: users.size,
    };
  }, [items]);

  if (!allowed) return <Empty title="Audit log is restricted" hint="Requires state-tier access (SCRB Analyst, DGP, Admin) or SP." />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Audit Log</h1>
          <p className="text-sm text-ink-muted">Every sensitive read and AI query is recorded — who, what, when.</p>
        </div>
        {data?.source && (
          <span className="text-xs text-ink-muted bg-surface-3 rounded-full px-3 py-1 shrink-0" title={
            data.source === 'datastore'
              ? 'This container has no session history yet, so entries are read live from the AuditLog Data Store table.'
              : 'Entries recorded by this running instance since it last started.'
          }>
            {data.source === 'datastore' ? 'Full persisted history · Data Store' : 'This session’s live activity'}
          </span>
        )}
      </div>

      {!isLoading && items.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Events shown" value={stats.total.toLocaleString()} />
          <KpiCard label="Case / graph views" value={stats.caseViews.toLocaleString()} accent="#1A6FC4" />
          <KpiCard label="Offender lookups" value={stats.offenderViews.toLocaleString()} />
          <KpiCard label="Assistant queries" value={stats.assistantQueries.toLocaleString()} accent="#C9820A" />
        </div>
      )}

      <Section title="Recent activity" action={
        <Select value={actionFilter} onChange={setActionFilter} className="w-56"
          options={[{ value: '', label: 'All actions' }, ...Object.entries(ACTION_LABELS).map(([k, label]) => ({ value: k, label }))]} />
      }>
        {isLoading ? <Skeleton rows={10} /> : !items.length ? <Empty title="No audit entries yet" hint="Browse cases / offenders to generate activity." /> : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr><th className="text-left px-4 py-2 font-medium">Time</th><th className="text-left px-4 py-2 font-medium">User</th><th className="text-left px-4 py-2 font-medium">Action</th><th className="text-left px-4 py-2 font-medium">Target</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((a: any) => (
                <tr key={a.auditId}>
                  <td className="px-4 py-2 font-num text-ink-muted">{new Date(a.ts).toLocaleString()}</td>
                  <td className="px-4 py-2">{a.userName} <Chip>{a.role}</Chip></td>
                  <td className="px-4 py-2"><Chip color="blue">{actionLabel(a.action)}</Chip></td>
                  <td className="px-4 py-2">{a.queryText ? <span className="italic">“{a.queryText}”</span> : a.targetId ? <Mono>{a.targetType}:{a.targetId}</Mono> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>
    </div>
  );
}
