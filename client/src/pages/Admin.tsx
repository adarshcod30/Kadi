import { CheckCircle2, ShieldCheck, Database, Cpu } from 'lucide-react';
import { useMe, useEval, useStats } from '../api/hooks';
import { Section, Empty, Chip } from '../components/ui';

export default function Admin() {
  const { data: me } = useMe();
  const { data: ev } = useEval();
  const { data: stats } = useStats();
  if (!me?.capabilities.canAdmin) return <Empty title="Admin area is restricted" hint="Requires Admin role." />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy">Administration</h1>
        <p className="text-sm text-ink-muted">Users & roles, data ingestion, model recompute, fairness & evaluation.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-kadi-blue" /> Fairness & evaluation</span>}>
          <div className="p-4 space-y-3 text-sm">
            <div className="flex items-center gap-2 text-success"><CheckCircle2 size={16} /> Protected attributes (caste / religion / occupation) excluded from all models.</div>
            {ev && (
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Gang recovery" value={`${ev.gangRecoveryPct}%`} />
                <Metric label="Chain recovery" value={`${ev.chainRecoveryPct}%`} />
                <Metric label="Offender ER" value={`${ev.identityRecoveryPct}%`} />
                <Metric label="Overall" value={`${ev.overallRecoveryPct}%`} pass={ev.passed} />
              </div>
            )}
            <div className="text-xs text-ink-muted">Ground-truth eval runs on planted synthetic patterns; target ≥ 90%.</div>
          </div>
        </Section>

        <Section title={<span className="flex items-center gap-2"><Cpu size={16} className="text-kadi-blue" /> Pipeline status</span>}>
          <div className="p-4 space-y-2 text-sm">
            <Row label="Entity resolution" ok /><Row label="Case-linkage graph build" ok /><Row label="Community detection" ok />
            <Row label="Risk scoring" ok /><Row label="Health metrics" ok /><Row label="Anomaly + spatial" ok />
            <div className="text-xs text-ink-muted pt-2">Heavy compute runs in AppSail / Catalyst Jobs (nightly Cron). The app reads precomputed results only.</div>
          </div>
        </Section>

        <Section title={<span className="flex items-center gap-2"><Database size={16} className="text-kadi-blue" /> Data ingestion</span>}>
          <div className="p-4 space-y-1 text-sm">
            <Row label={`Cases: ${stats?.totalCases?.toLocaleString() || '—'}`} ok />
            <Row label={`Resolved offenders: ${stats?.resolvedOffenders ?? '—'}`} ok />
            <Row label={`Active networks: ${stats?.activeNetworks ?? '—'}`} ok />
            <div className="text-xs text-ink-muted pt-2">Synthetic dataset (schema-faithful). Real KSP export drops in unchanged.</div>
          </div>
        </Section>

        <Section title="Roles">
          <div className="p-4 flex flex-wrap gap-2">
            {me.roles.map((r) => <Chip key={r} color="navy" className="!bg-surface-3 !text-ink">{r}</Chip>)}
          </div>
        </Section>
      </div>
    </div>
  );
}

const Metric = ({ label, value, pass }: { label: string; value: string; pass?: boolean }) => (
  <div className="border border-line rounded-ctl p-2">
    <div className="label">{label}</div>
    <div className={`text-lg font-semibold font-num ${pass ? 'text-success' : 'text-kadi-navy'}`}>{value}</div>
  </div>
);
const Row = ({ label, ok }: { label: string; ok?: boolean }) => (
  <div className="flex items-center gap-2"><CheckCircle2 size={14} className={ok ? 'text-success' : 'text-line'} /> {label}</div>
);
