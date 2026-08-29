import { useMemo, useState } from 'react';
import { useMe, useAudit, AUDIT_LIMIT } from '../api/hooks';
import { Section, Chip, Skeleton, Empty, Mono, KpiCard } from '../components/ui';
import { Select } from '../components/Select';
import { useTx } from '../lib/i18n';

// EVERY action the server can record, not the five somebody happened to name.
//
// The map covered five of twelve, so an officer reading the trail saw "install_model_key" and
// "assistant_document_refused" printed raw — a machine token where a sentence belongs. The
// missing seven were all recent: each new audited action added a row here that nobody added a
// label for, which is the failure mode of any hand-kept list that is not asserted anywhere.
// The test below fails the build if the server records an action this map does not name.
//
// These are also the strings that kept the Audit page in English while the rest of the
// interface turned over: the extractor reads JSX text and known props, not object-literal
// values, so none of them ever reached the Kannada dictionary. They go through tx() now.
export const ACTION_LABELS: Record<string, string> = {
  view_case: 'Case viewed',
  view_graph: 'Case-linkage graph viewed',
  view_offender: 'Offender profile viewed',
  assistant_query: 'Assistant query (text)',
  assistant_voice: 'Assistant query (voice)',
  assistant_transcribe: 'Assistant question spoken aloud',
  assistant_document: 'Document read by the assistant',
  assistant_document_refused: 'Document request refused',
  install_model_key: 'Model endpoint key installed',
  request_case_update: 'Case update requested',
  submit_case: 'Case submitted for approval',
  sign_in: 'Signed in',
  evidence_image: 'Evidence image read',
  file_evidence_note: 'Reading filed against a case',
  withdraw_evidence_note: 'Reading withdrawn',
  retain_evidence_page: 'Page image kept with a reading',
  view_evidence_page: 'Kept page viewed',
  reread_evidence_page: 'Kept page read again',
};

export default function Audit() {
  const tx = useTx();
  // Translated through tx() rather than rendered raw: these are sentences, and they are the
  // ones that kept this page in English.
  const actionLabel = (a: string) => tx(ACTION_LABELS[a] || a);
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
          <p className="text-sm text-ink-muted">Every sensitive read and AI query is recorded — who, what, when. Showing the {AUDIT_LIMIT} most recent.</p>
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
          <KpiCard label="Events shown" value={stats.total.toLocaleString()}
            hint={stats.total >= AUDIT_LIMIT ? `Most recent ${AUDIT_LIMIT} · older entries retained` : 'All recorded activity'} />
          <KpiCard label="Case / graph views" value={stats.caseViews.toLocaleString()} accent="#1A6FC4" hint="Within these events" />
          <KpiCard label="Offender lookups" value={stats.offenderViews.toLocaleString()} hint="Within these events" />
          <KpiCard label="Assistant queries" value={stats.assistantQueries.toLocaleString()} accent="#C9820A" hint="Within these events" />
        </div>
      )}

      <Section title={`Recent activity · latest ${Math.min(items.length, AUDIT_LIMIT)}`} action={
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
