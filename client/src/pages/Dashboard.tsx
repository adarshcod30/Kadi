import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts';
import { Share2, Activity, Users, ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useStats, useAlerts, useMe, useEval } from '../api/hooks';
import { KpiCard, Section, SeverityDot, Skeleton, Mono } from '../components/ui';
import { useT } from '../lib/i18n';

export default function Dashboard() {
  const nav = useNavigate();
  const t = useT();
  const { data: stats } = useStats();
  const { data: alerts } = useAlerts();
  const { data: me } = useMe();
  const { data: ev } = useEval();

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Command Dashboard</h1>
          <p className="text-sm text-ink-muted">{me?.capabilities.label} · scope: {me?.capabilities.scope} · <span className="text-ink-muted">Demo dataset (synthetic)</span></p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => nav('/graph')} className="btn-primary text-sm"><Share2 size={16} /> Explore the graph</button>
          <button onClick={() => nav('/cases')} className="btn-outline text-sm">Open a case</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t('openCases')} value={stats?.openCases?.toLocaleString() ?? '—'} hint="under investigation" onClick={() => nav('/cases?status=1')} />
        <KpiCard label={t('flagged')} value={stats?.seriousFlaggedCases?.toLocaleString() ?? '—'} hint="high-severity health flags" accent="#C9820A" onClick={() => nav('/health')} />
        <KpiCard label={t('networks')} value={stats?.activeNetworks ?? '—'} hint={`${stats?.crossDistrictNetworks ?? 0} cross-district`} accent="#1A6FC4" onClick={() => nav('/graph')} />
        <KpiCard label="Resolved offenders" value={stats?.resolvedOffenders ?? '—'} hint={`${stats?.highRiskOffenders ?? 0} high risk`} onClick={() => nav('/offenders')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Section title="FIRs registered per month">
            <div className="h-56 p-3">
              {stats ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.trend}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1A6FC4" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#1A6FC4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#5B6B7E' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#5B6B7E' }} tickLine={false} axisLine={false} width={30} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
                    <Area type="monotone" dataKey="count" stroke="#1A6FC4" strokeWidth={2} fill="url(#g)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Skeleton rows={4} />}
            </div>
          </Section>

          <Section title="Top crime heads">
            <div className="h-52 p-3">
              {stats ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.topCrimeHeads} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#1C2A3A' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {stats.topCrimeHeads.map((_, i) => <Cell key={i} fill={['#0B3D75', '#1A6FC4', '#2FA8A0', '#E8871E', '#5C6BC0', '#26A69A', '#8A94A3', '#7E57C2'][i % 8]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <Skeleton rows={4} />}
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          {/* Eval highlight — the proof slide */}
          {ev?.passed && (
            <div className="card p-4 border-l-4 border-success">
              <div className="flex items-center gap-2 text-success font-semibold text-sm"><CheckCircle2 size={16} /> Detection validated</div>
              <p className="text-xs text-ink-muted mt-1">On planted ground-truth, the pipeline recovers</p>
              <div className="text-2xl font-semibold font-num text-kadi-navy mt-1">{ev.overallRecoveryPct}%</div>
              <p className="text-xs text-ink-muted">of gangs / serial chains, with {ev.identityRecoveryPct}% offender ER accuracy.</p>
            </div>
          )}

          <Section title="Alerts" action={<button onClick={() => nav('/health')} className="text-xs link">View all</button>}>
            <div className="divide-y divide-line max-h-[420px] overflow-auto">
              {(alerts || []).slice(0, 10).map((a) => (
                <button key={a.alertId} onClick={() => a.caseMasterId ? nav(`/graph?case=${a.caseMasterId}`) : a.offenderIdentityId ? nav(`/offenders/${a.offenderIdentityId}`) : a.clusterId ? nav(`/graph?cluster=${a.clusterId}`) : nav('/health')}
                  className="w-full text-left px-4 py-2.5 hover:bg-surface-3 flex gap-2">
                  <SeverityDot severity={a.severity} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.title}</div>
                    <div className="text-xs text-ink-muted truncate">{a.reason}</div>
                  </div>
                  <ArrowRight size={14} className="ml-auto text-ink-muted mt-0.5 shrink-0" />
                </button>
              ))}
              {!alerts && <Skeleton rows={5} />}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
