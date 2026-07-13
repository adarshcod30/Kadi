import { useMe, useAudit } from '../api/hooks';
import { Section, Chip, Skeleton, Empty, Mono } from '../components/ui';

export default function Audit() {
  const { data: me } = useMe();
  const allowed = me?.capabilities.canViewAudit;
  const { data, isLoading } = useAudit(!!allowed);

  if (!allowed) return <Empty title="Audit log is restricted" hint="Requires ACP or Admin role." />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy">Audit Log</h1>
        <p className="text-sm text-ink-muted">Every sensitive read and AI query is recorded — who, what, when.</p>
      </div>
      <Section title="Recent activity">
        {isLoading ? <Skeleton rows={10} /> : !data?.items.length ? <Empty title="No audit entries yet" hint="Browse cases / offenders to generate activity." /> : (
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr><th className="text-left px-4 py-2 font-medium">Time</th><th className="text-left px-4 py-2 font-medium">User</th><th className="text-left px-4 py-2 font-medium">Action</th><th className="text-left px-4 py-2 font-medium">Target</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((a: any) => (
                <tr key={a.auditId}>
                  <td className="px-4 py-2 font-num text-ink-muted">{new Date(a.ts).toLocaleString()}</td>
                  <td className="px-4 py-2">{a.userName} <Chip>{a.role}</Chip></td>
                  <td className="px-4 py-2"><Chip color="blue">{a.action}</Chip></td>
                  <td className="px-4 py-2">{a.queryText ? <span className="italic">“{a.queryText}”</span> : a.targetId ? <Mono>{a.targetType}:{a.targetId}</Mono> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
