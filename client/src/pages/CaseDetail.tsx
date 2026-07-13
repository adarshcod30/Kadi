import { useParams, useNavigate, Link } from 'react-router-dom';
import { Share2, MessageSquare, MapPin, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useCase } from '../api/hooks';
import { StatusChip, GravityChip, Chip, Section, Skeleton, Mono, RiskBadge } from '../components/ui';

export default function CaseDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: c, isLoading } = useCase(id);

  if (isLoading || !c) return <Skeleton rows={12} />;

  const timeline = [
    ['Incident', c.incidentFromDate], ['Info received', c.infoReceivedPSDate],
    ['Registered', c.crimeRegisteredDate], ...(c.chargesheets.map((cs) => [cs.typeLabel, cs.date]) as [string, string][]),
  ].filter(([, d]) => d);

  return (
    <div className="space-y-4">
      <button onClick={() => nav(-1)} className="text-sm link flex items-center gap-1"><ArrowLeft size={14} /> Back</button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy"><Mono>{c.crimeNo}</Mono></h1>
          <div className="flex items-center gap-2 mt-1 text-sm">
            <span className="font-medium">{c.crimeSubHead}</span>
            <span className="text-ink-muted">· {c.crimeHead}</span>
            <StatusChip status={c.status} /><GravityChip gravity={c.gravity} /><Chip>{c.category}</Chip>
          </div>
          <div className="text-xs text-ink-muted mt-1">{c.unitName}, {c.districtName} · IO: {c.ioName || '—'}</div>
        </div>
        <div className="flex gap-2">
          {c.linkedCount > 0 && (
            <button onClick={() => nav(`/graph?case=${c.caseMasterId}`)} className="btn-primary text-sm">
              <Share2 size={16} /> {c.linkedCount} linked cases
            </button>
          )}
          <button onClick={() => nav(`/assistant?about=${c.caseMasterId}`)} className="btn-outline text-sm"><MessageSquare size={16} /> Ask</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Brief facts (MO)"><p className="p-4 text-sm leading-relaxed">{c.briefFacts}</p></Section>

          <Section title="Parties">
            <div className="grid sm:grid-cols-3 gap-4 p-4">
              <PartyList title="Accused" items={c.parties.accused.map((a) => `${a.personId ? a.personId + ' · ' : ''}${a.name}`)} />
              <PartyList title="Victims" items={c.parties.victims.map((v) => `${v.name} (${v.age})`)} />
              <PartyList title="Complainant" items={c.parties.complainants.map((v) => `${v.name} (${v.age})`)} />
            </div>
          </Section>

          <Section title="Acts & sections">
            <div className="p-4 flex flex-wrap gap-2">
              {c.acts.map((a, i) => <Chip key={i} color="navy" className="!bg-surface-3 !text-ink">{a.act} {a.section}<span className="text-ink-muted ml-1 hidden md:inline">· {a.description}</span></Chip>)}
              {!c.acts.length && <span className="text-sm text-ink-muted">—</span>}
            </div>
          </Section>

          {c.offenders.length > 0 && (
            <Section title="Resolved offenders in this FIR">
              <div className="divide-y divide-line">
                {c.offenders.map((o) => (
                  <Link key={o.offenderIdentityId} to={`/offenders/${o.offenderIdentityId}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-3">
                    <span className="text-sm font-medium">{o.canonicalName}</span>
                    <RiskBadge score={o.riskScore} band={o.band} />
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title="Timeline">
            <div className="p-4 space-y-3">
              {timeline.map(([label, d], i) => (
                <div key={i} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-kadi-blue mt-1.5 shrink-0" />
                  <div><div className="font-medium">{label}</div><div className="text-xs text-ink-muted font-num">{d}</div></div>
                </div>
              ))}
            </div>
          </Section>

          {c.health && (
            <Section title="Investigation health">
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-warning"><AlertTriangle size={16} /> {c.health.severity === 'high' ? 'High priority' : 'Attention'}</div>
                {c.health.flags.map((f, i) => <div key={i} className="text-sm"><span className="font-medium">{f.flag.replace(/_/g, ' ')}:</span> <span className="text-ink-muted">{f.reason}</span></div>)}
                <div className="mt-2 bg-kadi-blue50 text-kadi-navy700 rounded-ctl p-2.5 text-sm">
                  <div className="text-xs font-medium mb-0.5">Recommended action</div>{c.health.recommendationText}
                </div>
              </div>
            </Section>
          )}

          {c.latitude && (
            <Section title="Location" action={<button onClick={() => nav('/map')} className="text-xs link">Open map</button>}>
              <div className="p-4 text-sm text-ink-muted flex items-center gap-2"><MapPin size={16} className="text-kadi-blue" /> {c.latitude.toFixed(4)}, {c.longitude?.toFixed(4)}</div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function PartyList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      {items.length ? <ul className="text-sm space-y-0.5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="text-sm text-ink-muted">—</div>}
    </div>
  );
}
