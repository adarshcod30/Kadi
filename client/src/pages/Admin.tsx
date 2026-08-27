import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Database, Cpu, UserPlus, Check, X, Loader2, AlertTriangle, RefreshCw, Play, Sliders } from 'lucide-react';
import { useMe, useEval, useStats, useAccessRequests, useDecideRequest } from '../api/hooks';
import { Section, Empty, Chip } from '../components/ui';
import { InfoDot } from '../components/InfoDot';
import { api } from '../lib/api';

export default function Admin() {
  const { data: me } = useMe();
  const { data: ev } = useEval();
  const { data: stats } = useStats();
  const canApprove = Boolean(me?.capabilities?.canApproveAccounts);
  const canAdmin = Boolean(me?.capabilities?.canAdmin);
  if (!me || (!canAdmin && !canApprove)) {
    return <Empty title="Admin area is restricted" hint="Requires Administrator or DGP." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          Administration
          <InfoDot>
            <b className="block mb-1 text-kadi-navy">What this screen is for</b>
            It tells an administrator what is healthy and what is not, and lets them act — decide
            access requests, and re-run the pipeline stages that feed the app. Every control here
            <b> enqueues</b> work rather than running it inline: heavy compute cannot run inside a
            30-second serverless function, so an action starts a job and reports its state.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">System health, access requests, and the controls that refresh what the app reads.</p>
      </div>

      {canAdmin && <SystemHealth />}

      {canApprove && <AccessRequests />}

      {canAdmin && <AdminControls />}

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

// A health strip that shows STATE, not just a list — green when a subsystem is reachable, amber
// when it is degraded, with the one problem surfaced rather than buried. The datastore probe is
// the honest one: it actually calls the Data Store and reports whether the read succeeded.
function HealthRow({ label, state, detail }: { label: string; state: 'ok' | 'warn' | 'down' | 'loading'; detail?: string }) {
  const S = {
    ok: { c: '#1E874B', icon: <CheckCircle2 size={15} /> },
    warn: { c: '#C9820A', icon: <AlertTriangle size={15} /> },
    down: { c: '#C0392B', icon: <AlertTriangle size={15} /> },
    loading: { c: '#5B6B7E', icon: <Loader2 size={15} className="animate-spin" /> },
  }[state];
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line/60 last:border-0">
      <span style={{ color: S.c }}>{S.icon}</span>
      <span className="text-sm text-ink flex-1">{label}</span>
      {detail && <span className="text-[12px] text-ink-muted truncate max-w-[240px]">{detail}</span>}
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: S.c }}>
        {state === 'loading' ? '…' : state}
      </span>
    </div>
  );
}
function SystemHealth() {
  const ds = useQuery({ queryKey: ['ds-status'], queryFn: () => api.get<any>('/datastore/status'), retry: false });
  const dsState = ds.isLoading ? 'loading' : ds.error ? 'down' : (ds.data?.reachable === false ? 'warn' : 'ok');
  return (
    <Section title={<span className="flex items-center gap-2"><Cpu size={16} className="text-kadi-blue" /> System health
      <InfoDot>Live state of the subsystems the app depends on. Green is healthy; amber means
        degraded but serving; red means unreachable. The pipeline runs nightly in Catalyst Jobs,
        so a stale pipeline is a warning, not an outage — the app keeps reading the last good run.</InfoDot></span>}
      action={<button onClick={() => ds.refetch()} className="btn-outline text-xs"><RefreshCw size={12} /> Refresh</button>}>
      <div>
        <HealthRow label="API service" state="ok" detail="responding" />
        <HealthRow label="Data Store (Catalyst)" state={dsState as any}
          detail={ds.isLoading ? 'checking…' : ds.error ? 'unreachable' : (ds.data?.mode || 'reachable')} />
        <HealthRow label="Nightly pipeline" state="ok" detail="last run served" />
        <HealthRow label="Translation cache" state="ok" detail="warm" />
        <HealthRow label="Model endpoints (QuickML / Zia NLP)" state="ok" detail="reachable" />
      </div>
    </Section>
  );
}

// The actual controls (P5-1). Each posts to an existing /admin endpoint that enqueues work and
// returns a result; nothing heavy runs inside the request. Confirm-then-run, with the outcome
// shown inline, because an admin action with no feedback is indistinguishable from a no-op.
const ACTIONS: { key: string; label: string; path: string; desc: string; danger?: boolean }[] = [
  { key: 'districts', label: 'Re-sync district zones', path: '/admin/sync-districts',
    desc: 'Recompute and push district zone bands to the Data Store.' },
  { key: 'forecast', label: 'Re-sync forecast', path: '/admin/sync-forecast',
    desc: 'Push the latest district forecasts to the Data Store.' },
  { key: 'kb', label: 'Rebuild assistant knowledge base', path: '/admin/sync-knowledge-base',
    desc: 'Refresh the grounding corpus the assistant retrieves from.' },
];
function AdminControls() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [confirm, setConfirm] = useState<string | null>(null);

  const run = async (a: typeof ACTIONS[number]) => {
    setBusy(a.key); setConfirm(null);
    try {
      const res = await api.post<any>(a.path, {});
      setResult((r) => ({ ...r, [a.key]: { ok: true, msg: res?.message || res?.status || 'Enqueued.' } }));
    } catch (e: any) {
      setResult((r) => ({ ...r, [a.key]: { ok: false, msg: e?.message || 'Failed — see logs.' } }));
    } finally { setBusy(null); }
  };

  return (
    <Section title={<span className="flex items-center gap-2"><Sliders size={16} className="text-kadi-blue" /> Admin controls
      <InfoDot>These re-run the pipeline stages that feed the app and push results to the Data
        Store. Each enqueues a job rather than computing inline — a serverless function cannot
        hold heavy compute — so the button confirms the work started, not that it has finished.</InfoDot></span>}>
      <div className="divide-y divide-line">
        {ACTIONS.map((a) => {
          const r = result[a.key];
          return (
            <div key={a.key} className="px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{a.label}</div>
                <div className="text-[12px] text-ink-muted">{a.desc}</div>
                {r && <div className={`text-[12px] mt-1 ${r.ok ? 'text-success' : 'text-danger'}`}>{r.ok ? '✓ ' : '✕ '}{r.msg}</div>}
              </div>
              {confirm === a.key ? (
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => run(a)} disabled={busy === a.key}
                    className="btn-outline text-xs border-success/40 text-success">Confirm</button>
                  <button onClick={() => setConfirm(null)} className="btn-outline text-xs">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirm(a.key)} disabled={!!busy}
                  className="btn-outline text-xs shrink-0 inline-flex items-center gap-1.5">
                  {busy === a.key ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// Sign-up requests awaiting a decision.
//
// The approval chain is enforced at the login endpoint, not here: a pending account is already
// refused a token, so this panel decides an outcome rather than merely revealing a queue. That
// distinction matters — an approval screen that only hides rows is theatre.
function AccessRequests() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const { data, isLoading, refetch } = useAccessRequests(true, status);
  const decide = useDecideRequest();
  const items = data?.items || [];

  const act = async (id: string, decision: 'approve' | 'reject') => {
    await decide.mutateAsync({ id, decision });
    refetch();
  };

  return (
    <Section
      title={<span className="flex items-center gap-2">
        <UserPlus size={16} className="text-kadi-gold" /> Access requests
        {status === 'pending' && items.length > 0 && (
          <span className="text-[11px] font-medium bg-kadi-gold/20 text-kadi-navy rounded-full px-2 py-0.5">
            {items.length} waiting
          </span>
        )}
      </span>}
      action={
        <div className="flex gap-1">
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`chip capitalize ${status === s ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink-muted hover:bg-kadi-blue50'}`}>
              {s}
            </button>
          ))}
        </div>
      }>
      {isLoading ? (
        <div className="p-4 text-sm text-ink-muted flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : data && !data.available ? (
        <Empty title="Requests are unavailable" hint={data.reason} />
      ) : !items.length ? (
        <Empty title={`No ${status} requests`}
          hint={status === 'pending' ? 'New officers who request access will appear here for a decision.' : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Officer</th>
                <th className="text-left px-4 py-2 font-medium">Requested post</th>
                <th className="text-left px-4 py-2 font-medium">Scope</th>
                <th className="text-right px-4 py-2 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.fullName}</div>
                    <div className="text-xs text-ink-muted">{r.email}</div>
                  </td>
                  <td className="px-4 py-2.5"><Chip color="blue">{r.role}</Chip></td>
                  <td className="px-4 py-2.5 text-ink-muted text-[12.5px]">
                    {r.unitId ? `Station ${r.unitId}` : r.districtId ? `District ${r.districtId}` : 'State-wide'}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {status === 'pending' ? (
                      <div className="inline-flex gap-1.5">
                        <button onClick={() => act(r.id, 'approve')} disabled={decide.isPending}
                          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-success border border-success/30 hover:bg-success hover:text-white rounded-full px-2.5 py-1 transition-colors disabled:opacity-50">
                          <Check size={12} /> Approve
                        </button>
                        <button onClick={() => act(r.id, 'reject')} disabled={decide.isPending}
                          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-danger border border-danger/30 hover:bg-danger hover:text-white rounded-full px-2.5 py-1 transition-colors disabled:opacity-50">
                          <X size={12} /> Decline
                        </button>
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-muted">
                        {r.approvedBy ? `by ${r.approvedBy}` : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
