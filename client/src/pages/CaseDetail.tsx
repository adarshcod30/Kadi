import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Share2, MessageSquare, MapPin, ArrowLeft, AlertTriangle, Sparkles, Clock, Hourglass, Check,
} from 'lucide-react';
import {
  useCase, useCaseEntities, useMe, useCaseUpdates, useRequestUpdate,
} from '../api/hooks';
import { StatusChip, GravityChip, Chip, Section, Skeleton, Mono, RiskBadge } from '../components/ui';
import { Select } from '../components/Select';
import { InfoDot } from '../components/InfoDot';


// Zia reads the FIR's own narrative and returns the entities and phrases in it. This is the
// only place in KADI where a model touches raw case text, so the boundary is stated on the
// panel itself: it reads the account of the offence, never caste, religion or occupation.
function NarrativeEntities({ id }: { id: string }) {
  const { data, isLoading } = useCaseEntities(id);
  if (isLoading) return null;
  if (!data?.available) return null;
  const groups = Object.entries(data.entities || {}).filter(([, v]) => v.length);
  const phrases = data.keyphrases || [];
  if (!groups.length && !phrases.length) return null;
  return (
    <Section title={<span className="flex items-center gap-1.5">
      <Sparkles size={14} className="text-kadi-blue" />Read from the narrative
      <InfoDot label="How the narrative is read" align="left">
        <b className="block mb-1 text-kadi-navy">Zia text analytics</b>
        Named entities and key phrases pulled from this FIR's own account of the offence —
        the free text that no structured column indexes.
        <b className="block mt-1.5 text-kadi-navy">Why it matters</b>
        A sub-head says a case is Online Financial Fraud. Only the narrative says whether the
        method was a fake KYC call or a QR-code scam, and a series shares the method.
        <b className="block mt-1.5 text-kadi-navy">What it never reads</b>
        Caste, religion and occupation. It reads the account of the offence only.
      </InfoDot>
    </span>}>
      <div className="p-4 space-y-3">
        {phrases.length > 0 && (
          <div>
            <div className="label mb-1.5">Key phrases</div>
            <div className="flex flex-wrap gap-1.5">
              {phrases.map((k) => (
                <span key={k} className="rounded-full bg-kadi-blue50 text-kadi-blue px-2.5 py-1 text-[12px]">{k}</span>
              ))}
            </div>
          </div>
        )}
        {groups.map(([label, vals]) => (
          <div key={label}>
            <div className="label mb-1.5">{label}</div>
            <div className="flex flex-wrap gap-1.5">
              {vals.map((v) => (
                <span key={v} className="rounded-full bg-surface-3 text-ink px-2.5 py-1 text-[12px]">{v}</span>
              ))}
            </div>
          </div>
        ))}

      </div>
    </Section>
  );
}

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
          <div className="text-xs text-ink-muted mt-1">
            {c.unitName}, {c.districtName} · IO: {c.ioName || '—'}
            {c.ioRank && <span> ({c.ioRank})</span>}
            {c.courtName && <span> · Court: {c.courtName}</span>}
          </div>
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

      {/* The one caveat that must never be silent. A case approved since the last pipeline run
          is in the register and genuinely unanalysed -- reading "0 linked cases" as a finding
          would invert the whole claim the product rests on. */}
      {(c as any).awaitingAnalysis && (
        <div className="rounded-card border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
          <Hourglass size={16} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-amber-900">Registered, awaiting overnight analysis</div>
            <p className="text-[12.5px] text-amber-900/85 leading-relaxed mt-0.5">
              {(c as any).analysisNote
                || 'Linkage, entity resolution and investigation health are computed by the overnight pipeline over the whole corpus. Nothing has looked at this case yet, so an empty link list here means "not yet analysed", not "unconnected".'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Brief facts (MO)"><p className="p-4 text-sm leading-relaxed">{c.briefFacts}</p></Section>
          <CaseLifecycle caseId={String(c.caseMasterId)} crimeNo={c.crimeNo} statusName={c.status} />
          <NarrativeEntities id={String(c.caseMasterId)} />

          <Section title="Parties">
            <div className="grid sm:grid-cols-3 gap-4 p-4">
              <PartyList title="Accused" items={c.parties.accused.map((a) => `${a.personId ? a.personId + ' · ' : ''}${a.name}`)} />
              <PartyList title="Victims" items={c.parties.victims.map((v) =>
                `${v.name} (${v.age})${v.isPolice ? ' \u00b7 Police' : ''}`)} />
              <PartyList title="Complainant" items={c.parties.complainants.map((v) => `${v.name} (${v.age})`)} />
            </div>
          </Section>

          <Section title="Acts & sections">
            <div className="p-4 flex flex-wrap gap-2">
              {c.acts.map((a, i) => <Chip key={i} color="navy" className="!bg-surface-3 !text-ink">{a.act} {a.section}<span className="text-ink-muted ml-1 hidden md:inline">· {a.description}</span></Chip>)}
              {!c.acts.length && <span className="text-sm text-ink-muted">—</span>}
            </div>
          </Section>

          {c.arrests.length > 0 && (
            <Section title="Arrests & surrenders">
              <div className="divide-y divide-line">
                {c.arrests.map((a, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <span className="font-medium">{a.typeLabel || 'Event'}</span>
                      {a.accusedName && <span className="text-ink-muted"> · {a.accusedName}</span>}
                      {a.isComplainantAccused && (
                        <Chip color="amber" className="ml-2 !text-[11px]">Complainant also accused</Chip>
                      )}
                    </div>
                    <div className="text-xs text-ink-muted font-num text-right shrink-0">
                      {a.date}{a.districtName ? ` · ${a.districtName}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

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
            <Section title="Location" action={<button
              onClick={() => nav(`/map?lat=${c.latitude}&lng=${c.longitude}&crimeNo=${encodeURIComponent(c.crimeNo)}`)}
              className="text-xs link">Open map</button>}>
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

// ---- lifecycle -------------------------------------------------------------------------------
// What has happened to this case since it was registered, and how to record the next thing.
//
// A change goes through the same gate a new case does. That is the point: an arrest or a closure
// recorded by whoever happened to be at the terminal, with no supervisor and no record of the
// prior state, is exactly the practice the approval chain exists to replace.
function CaseLifecycle({ caseId, crimeNo, statusName }: { caseId: string; crimeNo: string; statusName: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const { data } = useCaseUpdates({ case: caseId });
  const request = useRequestUpdate();
  const [type, setType] = useState('arrest');
  const [after, setAfter] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const tier = me?.capabilities.tier;
  const canRequest = tier === 'station' || me?.user.role === 'DSP';
  const items = data?.items || [];
  const approved = items.filter((u) => u.status === 'approved');
  const pending = items.filter((u) => u.status === 'pending');
  if (!canRequest && !items.length) return null;

  const go = async () => {
    setError(''); setSent(false);
    try {
      await request.mutateAsync({
        caseMasterId: caseId, crimeNo, updateType: type, afterValue: after, reason,
        // The prior state, captured from what is on screen. Sending it with the request is
        // what makes the trail readable later -- "closed" alone does not say closed from what.
        beforeValue: type === 'closure' || type === 'status' ? statusName : '',
      });
      setSent(true); setAfter(''); setReason('');
      qc.invalidateQueries({ queryKey: ['case-updates'] });
    } catch (e: any) {
      setError(e?.message || 'Could not record the request.');
    }
  };

  return (
    <Section title={<span className="flex items-center gap-2">
      <Clock size={15} className="text-kadi-teal" /> Case lifecycle
      <InfoDot label="How a case changes">
        <b className="block mb-1 text-kadi-navy">The same gate as a new case</b>
        An arrest, a chargesheet or a closure is a request, approved by an SP for their own
        district or by the DGP or Administrator anywhere.
        <b className="block mt-1.5 text-kadi-navy">Before and after, not just after</b>
        Each request records the prior state alongside the new one, so the trail says what
        changed. A log that only records that something changed is not an audit trail.
      </InfoDot>
    </span>}>
      <div className="p-4 space-y-3">
        {approved.length > 0 && (
          <ol className="space-y-2">
            {approved.map((u) => (
              <li key={u.id} className="flex items-start gap-2.5 text-[12.5px]">
                <Check size={14} className="text-success shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-medium text-ink">{u.updateLabel}</span>
                  <span className="text-ink-muted"> · {u.afterValue}</span>
                  <div className="text-[11.5px] text-ink-subtle">
                    Requested by {u.requestedBy} ({u.requesterRole}), approved by {u.reviewedBy} on {String(u.reviewedAt || '').slice(0, 10)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {pending.map((u) => (
          <div key={u.id} className="flex items-start gap-2.5 text-[12.5px] text-ink-muted">
            <Hourglass size={14} className="text-warning shrink-0 mt-0.5" />
            <span><b className="text-ink">{u.updateLabel}</b> · {u.afterValue} — awaiting approval</span>
          </div>
        ))}
        {!approved.length && !pending.length && (
          <p className="text-[12.5px] text-ink-subtle">Nothing recorded on this case since registration.</p>
        )}

        {canRequest && (
          <div className="pt-2 border-t border-line space-y-2">
            {sent && <div className="text-[12.5px] text-success">Sent for approval.</div>}
            {error && <div className="text-[12.5px] text-danger">{error}</div>}
            <div className="flex flex-wrap gap-2">
              <Select value={type} onChange={setType} className="min-w-[160px]"
                options={[
                  { value: 'arrest', label: 'Arrest recorded' },
                  { value: 'chargesheet', label: 'Chargesheet filed' },
                  { value: 'closure', label: 'Case closure' },
                  { value: 'status', label: 'Status change' },
                  { value: 'party', label: 'Party added' },
                ]} />
              <input className="input flex-1 min-w-[180px]" value={after} onChange={(e) => setAfter(e.target.value)}
                placeholder="What changed" />
              <input className="input flex-1 min-w-[180px]" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Grounds for the change" />
              <button onClick={go} disabled={request.isPending} className="btn-primary disabled:opacity-50">
                {request.isPending ? 'Sending…' : 'Send for approval'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
