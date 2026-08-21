import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { useHealthCases, useHealthSummary , useMe } from '../api/hooks';
import { KpiCard, Section, Chip, SeverityDot, Skeleton, Empty, Mono } from '../components/ui';

const FLAG_LABEL: Record<string, string> = {
  investigation_ageing: 'Ageing', pendency: 'Pendency', undetected_risk: 'Undetected risk',
  reporting_delay: 'Reporting delay', false_case: 'False case',
};

export default function Health() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const [severity, setSeverity] = useState('high');
  const [flag, setFlag] = useState('');
  const { data, isLoading } = useHealthCases({ severity, flag, pageSize: 40 });
  const { data: summary } = useHealthSummary();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy">Investigation-Health Cockpit</h1>
        <p className="text-sm text-ink-muted">{me?.capabilities?.effectiveScope === 'district'
            ? `Cases slipping past detection timelines in ${me.capabilities.districtId ? 'this district' : 'your district'} — deterministic, auditable, each with a recommended action. Ordered so the ones nearest failure surface first.`
            : 'Early warning across all 31 districts — deterministic, auditable, with recommended actions. Use the scope control to narrow to one district.'}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Flagged (high)" value={summary?.high?.toLocaleString() ?? '—'} accent="#C0392B" />
        <KpiCard label="Flagged (medium)" value={summary?.medium?.toLocaleString() ?? '—'} accent="#C9820A" />
        <KpiCard label="Avg investigation age" value={summary ? `${summary.avgInvestigationAge}d` : '—'} />
        <KpiCard label="Station anomalies" value={summary?.anomalies?.length ?? '—'} hint="false-case patterns" />
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        {['high', 'medium', ''].map((s) => (
          <button key={s} onClick={() => setSeverity(s)} className={`chip ${severity === s ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink-muted'}`}>{s || 'All'} severity</button>
        ))}
        <span className="w-px h-5 bg-line mx-1" />
        {['', 'investigation_ageing', 'pendency', 'undetected_risk', 'false_case'].map((f) => (
          <button key={f} onClick={() => setFlag(f)} className={`chip ${flag === f ? 'bg-kadi-blue text-white' : 'bg-surface-3 text-ink-muted'}`}>{f ? FLAG_LABEL[f] : 'Any flag'}</button>
        ))}
      </div>

      <Section title={data ? `Worklist (${data.total.toLocaleString()})` : 'Worklist'}>
        {isLoading ? <Skeleton rows={8} /> : !data?.items.length ? <Empty title="No flagged cases in scope" /> : (
          <div className="divide-y divide-line">
            {data.items.map((h) => (
              <div key={h.caseMasterId} className="px-4 py-3 hover:bg-surface-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SeverityDot severity={h.severity} />
                      <button onClick={() => nav(`/cases/${h.caseMasterId}`)} className="link"><Mono>{h.crimeNo}</Mono></button>
                      <span className="text-sm text-ink-muted">{h.crimeSubHead} · {h.unit}, {h.district}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {h.flagKeys.map((f) => <Chip key={f} color={f === 'undetected_risk' || f === 'pendency' ? 'red' : 'amber'}>{FLAG_LABEL[f] || f}</Chip>)}
                    </div>
                    <div className="text-sm mt-1.5 text-ink-muted">{h.flags[0]?.reason}</div>
                    <div className="mt-1.5 text-sm bg-kadi-blue50 text-kadi-navy700 rounded-ctl px-2.5 py-1.5 inline-block">
                      <b className="text-xs">Action:</b> {h.recommendationText}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-ink-muted">age</div>
                    <div className="font-num font-semibold">{h.investigationAgeDays}d</div>
                    <div className="text-[10px] text-ink-muted">peer {h.peerMedianAgeDays}d</div>
                    {h.clusterId && <button onClick={() => nav(`/graph?cluster=${h.clusterId}`)} className="btn-outline text-xs mt-2"><Share2 size={12} /> Network</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
