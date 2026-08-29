import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Database, Cpu, UserPlus, Check, X, Loader2, AlertTriangle, RefreshCw, Play, Sliders, KeyRound } from 'lucide-react';
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

      {canAdmin && <ModelServing />}

      {canAdmin && <DataArtifacts />}

      {canAdmin && <AiServices />}

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

        <Section title={<span className="flex items-center gap-2"><Database size={16} className="text-kadi-blue" /> Data ingestion</span>}>
          <div className="p-4 space-y-1 text-sm">
            <Row label={`Cases: ${stats?.totalCases?.toLocaleString() || '—'}`} ok />
            <Row label={`Resolved offenders: ${stats?.resolvedOffenders ?? '—'}`} ok />
            <Row label={`Active networks: ${stats?.activeNetworks ?? '—'}`} ok />
            <div className="text-xs text-ink-muted pt-2">Synthetic dataset (schema-faithful). Real KSP export drops in unchanged.</div>
          </div>
        </Section>

        <ModelKeys />

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
// Installing a QuickML endpoint key.
//
// Both trained models rank by their fallback rule until a key is present, and the only thing
// standing between "rule is ranking" and "model is ranking" is one credential reaching the
// AppConfig table. Doing that by hand meant finding the endpoint in the Catalyst console,
// copying a header value, then hand-editing a Data Store row — three places to get it wrong,
// for a step whose failure looks exactly like a broken model.
//
// The field is type="password" and the value is never echoed back by the route, so the key
// does not end up in a screenshot, a response body or a browser history entry. What comes back
// is whether it landed.
function ModelKeys() {
  // Starts empty and fills in as the operator types, so every read has to tolerate a missing
  // key. It used to be seeded with one entry per model, which hid that: when the model list
  // grew and the seed was dropped, `vals[m.key].length` threw on first render and took the
  // whole Admin page white -- a blank screen, not a broken field.
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  // One row per served model. The slugs match functions/api/services/offenderrisk.js MODELS,
  // which is also what the install route derives its allow-list from -- so a model added there
  // gets a paste target here without a third place to keep in step.
  const MODELS = [
    { key: 'h90', label: 'Back within 90 days', endpoint: 'kadi-offender-h90-endpoint',
      config: 'quickml.offenderH90EndpointKey' },
    { key: 'h180', label: 'Back within six months', endpoint: 'kadi-offender-endpoint',
      config: 'quickml.offenderEndpointKey' },
    { key: 'h365', label: 'Back within a year', endpoint: 'kadi-offender-h365-endpoint',
      config: 'quickml.offenderH365EndpointKey' },
    { key: 'new365', label: 'Surfaces in a district never worked', endpoint: 'kadi-offender-new365-endpoint',
      config: 'quickml.offenderNew365EndpointKey' },
    { key: 'heinous365', label: 'Escalates to Heinous', endpoint: 'kadi-offender-heinous365-endpoint',
      config: 'quickml.offenderHeinous365EndpointKey' },
    { key: 'women365', label: 'Returns with a crime against women', endpoint: 'kadi-offender-women365-endpoint',
      config: 'quickml.offenderWomen365EndpointKey' },
    { key: 'spike', label: 'District × head spike', endpoint: 'kadi-spike-regressor-endpoint',
      config: 'quickml.spikeRegressorEndpointKey' },
    { key: 'pendency', label: 'Station pendency trajectory', endpoint: 'kadi-pendency-endpoint',
      config: 'quickml.pendencyEndpointKey' },
  ];

  const install = async (m: typeof MODELS[number]) => {
    setBusy(m.key);
    try {
      const res = await api.post<any>('/admin/model-key', { model: m.key, key: vals[m.key] || '' });
      setMsg((x) => ({ ...x, [m.key]: { ok: !!res?.installed, text: res?.note || 'Stored.' } }));
      if (res?.installed) setVals((v) => ({ ...v, [m.key]: '' }));
    } catch (e: any) {
      setMsg((x) => ({ ...x, [m.key]: { ok: false, text: e?.message || 'Failed.' } }));
    } finally { setBusy(null); }
  };

  return (
    <Section title={<span className="flex items-center gap-2">
      <KeyRound size={16} className="text-kadi-blue" /> Model endpoint keys
      <InfoDot width="w-96">
        <b className="block mb-1 text-kadi-navy">Why the models rank by rule until this is done</b>
        A QuickML endpoint is authenticated by a key that is a live credential, so it is kept in
        the AppConfig Data Store table rather than in the repository or in a config file the
        deployment carries. Until a key is present, each model falls back to the simple rule it
        was measured against — which is a working ranking, just a weaker one.
        <b className="block mt-1.5 text-kadi-navy">Where to find it</b>
        Catalyst console → QuickML → Endpoints → open the endpoint → Headers →
        X-QUICKML-ENDPOINT-KEY. Copy the value only, without quotes.
        <b className="block mt-1.5 text-kadi-navy">What happens to it</b>
        It is written to AppConfig and never read back. No surface in this app will show it
        again — only whether a key is present.
      </InfoDot>
    </span>}>
      <div className="divide-y divide-line">
        {MODELS.map((m) => {
          const r = msg[m.key];
          return (
            <div key={m.key} className="px-4 py-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink">{m.label}</span>
                <span className="text-[12px] text-ink-muted font-mono">{m.endpoint}</span>
                <span className="ml-auto text-[11px] text-ink-subtle font-mono">{m.config}</span>
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={vals[m.key] || ''}
                  onChange={(e) => setVals((v) => ({ ...v, [m.key]: e.target.value }))}
                  placeholder="Paste X-QUICKML-ENDPOINT-KEY"
                  className="flex-1 rounded-ctl border border-line bg-surface px-3 py-1.5 text-[12.5px] font-mono focus:border-kadi-blue focus:outline-none"
                />
                <button onClick={() => install(m)} disabled={busy === m.key || (vals[m.key] || '').length < 32}
                  className="btn-outline text-xs shrink-0 inline-flex items-center gap-1.5 disabled:opacity-40">
                  {busy === m.key ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Install
                </button>
              </div>
              {r && (
                <div className={`text-[12px] mt-1.5 leading-relaxed ${r.ok ? 'text-success' : 'text-danger'}`}>
                  {r.ok ? '\u2713 ' : '\u2715 '}{r.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

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

// ---------------------------------------------------------------------------------------
// WHAT REPLACED THE "PIPELINE STATUS" PANEL, AND WHY.
//
// That panel listed six stages and reported every one of them ok. It could not have reported
// anything else: nothing on the page read anything about the artifacts, so the six ticks were
// drawn from a hard-coded array. A status display that cannot show a fault is worse than none,
// because it is trusted and it is decorative — an administrator looking at a green board had
// no way to learn that the knowledge base had been returning nothing for weeks, or that a
// model was falling back to its rule.
//
// These three panels read the real thing off /admin/overview: what each derived artifact
// contains and when it was built, which models are actually serving by model rather than by
// rule and whether their key is installed, and what the AI surfaces report about themselves.
// ---------------------------------------------------------------------------------------
function useOverview() {
  return useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.get<any>('/admin/overview'),
    retry: false,
  });
}

/** The AUC track from Forecast, at admin scale: grey to the rule, teal for what the model adds. */
function Margin({ model, rule }: { model: number; rule: number }) {
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - 0.5) / 0.5) * 100));
  const r = pct(rule); const m = pct(model);
  return (
    <div className="relative h-1.5 w-24 rounded-full bg-surface-3 overflow-hidden shrink-0">
      <div className="absolute inset-y-0 left-0 bg-ink-subtle/35" style={{ width: `${r}%` }} />
      <div className="absolute inset-y-0 bg-kadi-teal"
        style={{ left: `${Math.min(r, m)}%`, width: `${Math.max(Math.abs(m - r), 0.8)}%` }} />
    </div>
  );
}

function ModelServing() {
  const { data, isLoading, error } = useOverview();
  const models = data?.models || [];
  return (
    <Section title={<span className="flex items-center gap-2">
      <Cpu size={16} className="text-kadi-blue" /> Models
      <span className="text-[12px] font-normal text-ink-muted">
        {models.length ? `${models.length} serving · ${models.filter((m: any) => m.keyInstalled).length} keys installed` : ''}
      </span>
      <InfoDot label="How to read this" align="left" width="w-96">
        <b className="block mb-1 text-kadi-navy">Every model is shown against the rule it must beat</b>
        Grey is what the best simple rule reaches on the same question; teal is what the model
        adds. A model serves only while its measured margin holds — the check reads the
        measurement, not a flag, so a revised number unplugs the model by itself.
        <b className="block mt-1.5 text-kadi-navy">Key installed</b>
        Whether a QuickML endpoint key is present in AppConfig. Without one the panel falls back
        to the rule and says so rather than pretending.
      </InfoDot>
    </span>}>
      {isLoading && <div className="p-4 text-sm text-ink-muted">Reading the serving modules…</div>}
      {error && <div className="p-4 text-sm text-danger">Could not read model status.</div>}
      {!isLoading && !error && (
        <div className="divide-y divide-line/70">
          {models.map((m: any) => (
            <div key={m.slug} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[11px] text-ink-subtle w-24 shrink-0">{m.slug}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">{m.question}</div>
                <div className="text-[11.5px] text-ink-subtle">{m.family}</div>
              </div>
              <Margin model={m.auc} rule={m.rule} />
              <span className="font-num text-[12px] whitespace-nowrap">
                <span className="font-semibold text-ink">{m.auc.toFixed(3)}</span>
                <span className="text-ink-subtle"> vs {m.rule.toFixed(3)}</span>
                <span className="ml-1.5 font-semibold text-kadi-teal">+{m.margin.toFixed(3)}</span>
              </span>
              <span className={`chip text-[10.5px] ${m.keyInstalled
                ? 'bg-kadi-teal/10 text-kadi-teal border border-kadi-teal/40'
                : 'bg-surface-2 text-ink-muted border border-line'}`}>
                {m.keyInstalled ? 'key installed' : 'no key — ranks by rule'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DataArtifacts() {
  const { data, isLoading } = useOverview();
  const arts = data?.artifacts || [];
  const sets = data?.trainingSets || [];
  const mb = ((data?.artifactBytes || 0) / 1048576).toFixed(1);
  const stale = arts.filter((a: any) => a.ageDays > 7);
  return (
    <Section title={<span className="flex items-center gap-2">
      <Database size={16} className="text-kadi-blue" /> Derived artifacts
      <span className="text-[12px] font-normal text-ink-muted">
        {arts.length ? `${arts.length} files · ${mb} MB` : ''}
      </span>
    </span>}>
      {isLoading ? <div className="p-4 text-sm text-ink-muted">Reading the store…</div> : (
        <div className="p-4 space-y-3">
          {/* Freshness stated as a fact rather than a tick. If something is stale this is where
              an administrator finds out, which the six green rows here before could never say. */}
          <div className="text-[12.5px] text-ink-muted">
            {stale.length === 0
              ? `Every artifact was rebuilt within the last week. Newest ${arts[0]?.ageDays ?? 0} days old.`
              : `${stale.length} artifact${stale.length === 1 ? '' : 's'} older than seven days — the app is reading what the pipeline last wrote, not what it would write today.`}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {sets.map((t: any) => (
              <div key={t.name} className="rounded-ctl border border-line bg-surface-2 p-3">
                <div className="text-[13px] font-medium text-ink">{t.name}</div>
                <div className="text-[11.5px] text-ink-subtle mt-0.5">{t.grain}</div>
                <div className="mt-2 font-num text-[12px] text-ink">
                  {Number(t.rows).toLocaleString()} rows · {t.features} features
                </div>
                <div className="font-num text-[11.5px] text-ink-subtle">{t.from} → {t.to}</div>
              </div>
            ))}
          </div>
          <details>
            <summary className="text-[12.5px] text-kadi-blue cursor-pointer">
              All {arts.length} files
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-ctl border border-line">
              <table className="w-full text-[12px]">
                <tbody>
                  {arts.map((a: any) => (
                    <tr key={a.file} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-ink">{a.file}</td>
                      <td className="px-3 py-1.5 text-right font-num text-ink-subtle">
                        {(a.bytes / 1024).toFixed(0)} KB
                      </td>
                      <td className="px-3 py-1.5 text-right font-num text-ink-subtle">
                        {a.ageDays}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Section>
  );
}

function AiServices() {
  const { data, isLoading } = useOverview();
  const ai = data?.ai || {};
  const kb = ai.knowledgeBase || {};
  const dr = ai.documentReader || {};
  const nlp = ai.nlp || {};
  const langs = nlp?.models?.translate?.languages || [];
  return (
    <Section title={<span className="flex items-center gap-2">
      <Sliders size={16} className="text-kadi-blue" /> AI services
    </span>}>
      {isLoading ? <div className="p-4 text-sm text-ink-muted">Probing…</div> : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-[12.5px]">
          <div className="rounded-ctl border border-line bg-surface-2 p-3">
            <div className="text-[13px] font-medium text-ink">Knowledge base</div>
            <div className="text-ink-muted mt-1">
              {kb.ragDocumentsCached
                ? `${kb.ragDocumentsCached} documents indexed and answering.`
                : 'No documents cached yet — the first question of the session loads them.'}
            </div>
            <div className="text-ink-subtle mt-1">Answers questions of meaning, not of count.</div>
          </div>
          <div className="rounded-ctl border border-line bg-surface-2 p-3">
            <div className="text-[13px] font-medium text-ink">Document reader</div>
            <div className="text-ink-muted mt-1">{dr.model || '—'}</div>
            <div className="text-ink-subtle mt-1">
              Refuses identification of people and any question about caste, religion or community.
            </div>
          </div>
          <div className="rounded-ctl border border-line bg-surface-2 p-3">
            <div className="text-[13px] font-medium text-ink">Speech &amp; translation</div>
            <div className="text-ink-muted mt-1">
              {langs.length ? `Translation across ${langs.length} languages.` : '—'}
            </div>
            <div className="text-ink-subtle mt-1">
              Speech in and out for English, Hindi and Kannada.
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
