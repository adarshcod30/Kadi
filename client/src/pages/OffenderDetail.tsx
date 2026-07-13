import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Share2, ShieldCheck, Users } from 'lucide-react';
import { useOffender } from '../api/hooks';
import { Section, Chip, StatusChip, Skeleton, Mono } from '../components/ui';

export default function OffenderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: o, isLoading } = useOffender(id);
  if (isLoading || !o) return <Skeleton rows={10} />;

  const bandColor = o.band === 'High' ? '#C0392B' : o.band === 'Medium' ? '#C9820A' : '#1E874B';

  return (
    <div className="space-y-4">
      <button onClick={() => nav(-1)} className="text-sm link flex items-center gap-1"><ArrowLeft size={14} /> Back</button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">{o.canonicalName}</h1>
          <div className="text-sm text-ink-muted mt-1">
            {o.distinctCases} cases · {o.distinctDistricts} districts · first seen {o.firstSeen} · last seen {o.lastSeen}
          </div>
          {o.nameVariants.length > 1 && <div className="text-xs text-ink-muted mt-1">Resolved variants: {o.nameVariants.join(' · ')}</div>}
        </div>
        {o.caseIds[0] && <button onClick={() => nav(`/graph?case=${o.caseIds[0]}`)} className="btn-primary text-sm"><Share2 size={16} /> View network</button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk gauge + factors */}
        <Section title="Behaviour-based risk">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <RiskGauge score={o.riskScore} color={bandColor} />
              <div>
                <div className="text-2xl font-semibold font-num" style={{ color: bandColor }}>{o.riskScore}</div>
                <Chip color={o.band === 'High' ? 'red' : o.band === 'Medium' ? 'amber' : 'green'}>{o.band} risk</Chip>
              </div>
            </div>
            <div className="mt-4">
              <div className="label mb-2">Why this score?</div>
              <div className="space-y-1.5">
                {o.factors.map((f) => (
                  <div key={f.factor}>
                    <div className="flex justify-between text-xs"><span>{f.label}</span><span className="font-num text-ink-muted">+{f.contribution}</span></div>
                    <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden"><div className="h-full bg-kadi-blue" style={{ width: `${Math.min(100, f.contribution / 26 * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex gap-2 text-xs bg-kadi-blue50 text-kadi-navy700 rounded-ctl p-2">
              <ShieldCheck size={14} className="shrink-0 mt-0.5" /> Protected attributes used: <b>none</b> (caste/religion/occupation excluded).
            </div>
          </div>
        </Section>

        {/* Cases */}
        <Section title={`Cases (${o.cases?.length || 0})`} className="lg:col-span-2">
          <div className="divide-y divide-line max-h-[360px] overflow-auto">
            {(o.cases || []).map((c) => (
              <Link key={c.caseMasterId} to={`/cases/${c.caseMasterId}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-3">
                <div><Mono>{c.crimeNo}</Mono><div className="text-xs text-ink-muted">{c.crimeSubHead} · {c.unit}, {c.district} · {c.date}</div></div>
                <StatusChip status={c.status} />
              </Link>
            ))}
          </div>
        </Section>
      </div>

      {o.coOffenders.length > 0 && (
        <Section title="Co-offenders">
          <div className="p-4 flex flex-wrap gap-2">
            {o.coOffenders.map((co) => (
              <Link key={co.offenderIdentityId} to={`/offenders/${co.offenderIdentityId}`} className="chip bg-surface-3 text-ink hover:bg-kadi-blue50">
                <Users size={12} /> {co.canonicalName} <span className="text-ink-muted">· {co.sharedCases} shared</span>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function RiskGauge({ score, color }: { score: number; color: string }) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <svg width="86" height="86" viewBox="0 0 86 86">
      <circle cx="43" cy="43" r={r} fill="none" stroke="#EDF1F6" strokeWidth="8" />
      <circle cx="43" cy="43" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 43 43)" />
      <text x="43" y="48" textAnchor="middle" fontSize="18" fontWeight="600" fill={color}>{Math.round(score)}</text>
    </svg>
  );
}
