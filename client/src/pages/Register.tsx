// Register — the write path, and the approval chain that guards it.
//
// One page, two faces, chosen by what the account may do rather than by a tab the user has to
// find: a station officer files cases, a supervisor decides them. An SP who cannot register a
// case never sees the form; an SI who cannot approve one never sees the queue.
//
// The rule the page exists to make visible: a case is registered by the station and stands only
// once a supervisor says so. And an approved case is IN THE REGISTER BUT NOT YET ANALYSED —
// linkage, entity resolution and health come from the overnight pipeline, so the interface says
// that plainly rather than letting a reader take "0 links" for a finding.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FilePlus2, Inbox, Check, X, CornerUpLeft, Clock, ChevronDown, Plus, Trash2, AlertTriangle,
} from 'lucide-react';
import {
  useMe, useLookups, useSubmissions, useSubmitCase, useDecideSubmission, useSubmission,
  useCaseUpdates, useDecideUpdate, type Submission,
} from '../api/hooks';
import { Select } from '../components/Select';
import { Skeleton, Empty, Section } from '../components/ui';
import { InfoDot } from '../components/InfoDot';

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  returned: 'bg-blue-100 text-blue-800',
};

type Party = { partyRole: string; fullName: string; age: string; gender: string; address: string; contact: string };
const EMPTY_PARTY: Party = { partyRole: 'accused', fullName: '', age: '', gender: '', address: '', contact: '' };

export default function Register() {
  const { data: me } = useMe();
  const canSubmit = Boolean(me?.capabilities.canSubmitCase);
  const canApprove = Boolean(me?.capabilities.canApproveCases);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          {canSubmit ? <FilePlus2 size={19} className="text-kadi-gold" /> : <Inbox size={19} className="text-kadi-gold" />}
          {canSubmit ? 'Register a case' : 'Approval queue'}
          <InfoDot label="How the write path works" align="left" width="w-80">
            <b className="block mb-1 text-kadi-navy">The chain of command, not a new one</b>
            The station that registers a case files it here. It stands only once a supervisor
            approves it: an SP for their own district, the DGP or the Administrator anywhere.
            <b className="block mt-1.5 text-kadi-navy">Scope comes from the account</b>
            A submission's district and station are taken from the signed-in officer, never
            from the form. Otherwise a hidden field would be enough to file a case into someone
            else's district, and every scoped view downstream would honour it.
            <b className="block mt-1.5 text-kadi-navy">Approved is not analysed</b>
            Linkage, entity resolution, risk and health are computed by the overnight pipeline
            over the whole corpus, not per request. An approved case appears in the register
            immediately and is marked as awaiting analysis until that runs.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">
          {canSubmit
            ? `Filed from ${me?.capabilities.unitName || 'your station'} and sent to your SP for approval.`
            : canApprove
              ? `Cases awaiting your decision${me?.capabilities.tier === 'district'
                ? ` in ${me?.capabilities.districtName || 'your district'}` : ' across the state'}.`
              : 'Cases filed by stations, and what became of them.'}
        </p>
      </div>

      {canSubmit && <SubmitForm />}
      {canApprove && <ApprovalQueue />}
      {!canSubmit && !canApprove && (
        <Empty title="Nothing to file or decide"
          hint="Cases are registered by station officers and approved by an SP, the DGP or the Administrator." />
      )}
      <MySubmissions canApprove={canApprove} />
    </div>
  );
}

// ---- filing --------------------------------------------------------------------------------
function SubmitForm() {
  const { data: lookups } = useLookups();
  const qc = useQueryClient();
  const submit = useSubmitCase();
  const [open, setOpen] = useState(true);
  const [f, setF] = useState({
    crimeNo: '', caseNo: '', crimeHeadId: '', crimeSubHeadId: '', gravityId: '', categoryId: '',
    crimeRegisteredDate: new Date().toISOString().slice(0, 10), incidentFromDate: '',
    latitude: '', longitude: '', briefFacts: '', actsSections: '', ioName: '',
  });
  const [parties, setParties] = useState<Party[]>([]);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ crimeNo: string } | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Sub-heads are filtered to the chosen head, so the two can never disagree. Picking a
  // sub-head from another head is the commonest way a register ends up mis-classified.
  const subheads = (lookups?.subheads || []).filter((s: any) => !f.crimeHeadId || s.headId === f.crimeHeadId);

  const go = async () => {
    setError('');
    try {
      const out = await submit.mutateAsync({ ...f, parties: parties.filter((p) => p.fullName.trim()) });
      setDone({ crimeNo: out.crimeNo });
      setF((p) => ({ ...p, crimeNo: '', caseNo: '', briefFacts: '', actsSections: '', latitude: '', longitude: '' }));
      setParties([]);
      qc.invalidateQueries({ queryKey: ['submissions'] });
    } catch (e: any) {
      setError(e?.message || 'Could not file the case.');
    }
  };

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 border-b border-line hover:bg-surface-3/50 transition-colors">
        <FilePlus2 size={15} className="text-kadi-blue" />
        <span className="text-sm font-medium text-ink">New FIR</span>
        <ChevronDown size={15} className={`ml-auto text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="p-4 space-y-4">
              {done && (
                <div className="rounded-ctl border border-green-300 bg-green-50 px-3 py-2 text-[13px] text-green-900 flex items-center gap-2">
                  <Check size={15} />
                  <span>Crime no. <b className="font-mono">{done.crimeNo}</b> filed and sent for approval.</span>
                </div>
              )}
              {error && (
                <div className="rounded-ctl border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900 flex items-center gap-2">
                  <AlertTriangle size={15} /> {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <Field label="Crime number" hint="As written on the FIR">
                  <input className="input w-full font-mono" value={f.crimeNo} inputMode="numeric"
                    onChange={(e) => set('crimeNo', e.target.value)} placeholder="100010064202600099" />
                </Field>
                <Field label="Case number" hint="Optional">
                  <input className="input w-full" value={f.caseNo} onChange={(e) => set('caseNo', e.target.value)} />
                </Field>
                <Field label="Registered on">
                  <input type="date" className="input w-full" value={f.crimeRegisteredDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => set('crimeRegisteredDate', e.target.value)} />
                </Field>

                <Field label="Crime head">
                  <Select value={f.crimeHeadId} placeholder="Select head"
                    onChange={(v) => { set('crimeHeadId', v); set('crimeSubHeadId', ''); }}
                    options={(lookups?.heads || []).map((h: any) => ({ value: h.id, label: h.name }))} />
                </Field>
                <Field label="Sub-head">
                  <Select value={f.crimeSubHeadId} placeholder={f.crimeHeadId ? 'Select sub-head' : 'Choose a head first'}
                    disabled={!f.crimeHeadId} onChange={(v) => set('crimeSubHeadId', v)}
                    options={subheads.map((sh: any) => ({ value: sh.id, label: sh.name }))} />
                </Field>
                <Field label="Gravity">
                  <Select value={f.gravityId} placeholder="Select gravity" onChange={(v) => set('gravityId', v)}
                    options={(lookups?.gravities || []).map((g: any) => ({ value: g.id, label: g.name }))} />
                </Field>

                <Field label="Incident began" hint="Date and time, if known">
                  <input type="datetime-local" className="input w-full" value={f.incidentFromDate}
                    onChange={(e) => set('incidentFromDate', e.target.value)} />
                </Field>
                <Field label="Investigating officer">
                  <input className="input w-full" value={f.ioName} onChange={(e) => set('ioName', e.target.value)}
                    placeholder="Defaults to you" />
                </Field>
                <Field label="Category">
                  <Select value={f.categoryId} placeholder="Select category" onChange={(v) => set('categoryId', v)}
                    options={(lookups?.categories || []).map((c: any) => ({ value: c.id, label: c.name }))} />
                </Field>

                <Field label="Latitude" hint="Where it happened, if plotted">
                  <input className="input w-full font-num" value={f.latitude} onChange={(e) => set('latitude', e.target.value)}
                    placeholder="12.9716" />
                </Field>
                <Field label="Longitude">
                  <input className="input w-full font-num" value={f.longitude} onChange={(e) => set('longitude', e.target.value)}
                    placeholder="77.5946" />
                </Field>
                <Field label="Acts and sections">
                  <input className="input w-full" value={f.actsSections} onChange={(e) => set('actsSections', e.target.value)}
                    placeholder="IPC 379, 411" />
                </Field>
              </div>

              <Field label="Brief facts" hint="What happened, in the officer's own words">
                <textarea className="input w-full min-h-[88px]" value={f.briefFacts}
                  onChange={(e) => set('briefFacts', e.target.value)}
                  placeholder="A chain snatching was reported near the market at about 8pm…" />
              </Field>

              {/* Parties. Optional at filing, because a supervisor can see an FIR with no
                  accused named and send it back — which is more useful than a form that
                  refuses to accept what the station actually knows tonight. */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="label">Parties</span>
                  <InfoDot label="Why parties are optional here">
                    An FIR is often filed before anyone is named. Refusing the submission would
                    push the officer to invent a placeholder, which is worse than an honest
                    blank that a supervisor can send back.
                  </InfoDot>
                  <button onClick={() => setParties([...parties, { ...EMPTY_PARTY }])}
                    className="ml-auto btn-outline text-[12.5px] py-1">
                    <Plus size={13} /> Add
                  </button>
                </div>
                {parties.map((p, i) => (
                  <div key={i} className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2">
                    <Select value={p.partyRole} className="col-span-1"
                      onChange={(v) => setParties(parties.map((x, j) => (i === j ? { ...x, partyRole: v } : x)))}
                      options={[{ value: 'accused', label: 'Accused' }, { value: 'victim', label: 'Victim' },
                        { value: 'complainant', label: 'Complainant' }]} />
                    <input className="input col-span-2" placeholder="Full name" value={p.fullName}
                      onChange={(e) => setParties(parties.map((x, j) => (i === j ? { ...x, fullName: e.target.value } : x)))} />
                    <input className="input" placeholder="Age" value={p.age}
                      onChange={(e) => setParties(parties.map((x, j) => (i === j ? { ...x, age: e.target.value } : x)))} />
                    <input className="input" placeholder="Gender" value={p.gender}
                      onChange={(e) => setParties(parties.map((x, j) => (i === j ? { ...x, gender: e.target.value } : x)))} />
                    <button onClick={() => setParties(parties.filter((_, j) => j !== i))}
                      className="btn-ghost justify-center text-danger" title="Remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button onClick={go} disabled={submit.isPending} className="btn-primary disabled:opacity-50">
                  {submit.isPending ? 'Filing…' : 'File for approval'}
                </button>
                <span className="text-[12px] text-ink-subtle">
                  Goes to your SP. Nothing enters the register until it is approved.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label block mb-1">
        {label}{hint && <span className="normal-case font-normal text-ink-subtle tracking-normal"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

// ---- deciding -------------------------------------------------------------------------------
function ApprovalQueue() {
  const { data, isLoading } = useSubmissions('pending');
  const { data: updates } = useCaseUpdates({ status: 'pending' });
  const [openId, setOpenId] = useState<string | null>(null);

  const pending = data?.items || [];
  const pendingUpdates = updates?.items || [];

  return (
    <>
      <Section title={<span className="flex items-center gap-2">
        <Inbox size={15} className="text-kadi-gold" /> Awaiting your decision
        <span className="text-[12px] font-normal text-ink-muted">
          {pending.length} case{pending.length === 1 ? '' : 's'}
          {data?.approvalScope === 'district' ? ' in your district' : ' state-wide'}
        </span>
      </span>}>
        {isLoading ? <div className="p-4"><Skeleton rows={4} /></div>
          : !pending.length ? <Empty title="Nothing pending" hint="No station in your scope is waiting on you." />
            : (
              <div className="divide-y divide-line">
                {pending.map((s) => (
                  <SubmissionRow key={s.id} s={s} open={openId === s.id}
                    onToggle={() => setOpenId(openId === s.id ? null : s.id)} />
                ))}
              </div>
            )}
      </Section>

      {pendingUpdates.length > 0 && (
        <Section title={<span className="flex items-center gap-2">
          <Clock size={15} className="text-kadi-teal" /> Case updates awaiting decision
          <span className="text-[12px] font-normal text-ink-muted">{pendingUpdates.length}</span>
          <InfoDot label="What a case update is">
            A change to a case that already exists: closure, an arrest, a chargesheet, a status
            change, a party added later. Each request carries the state BEFORE and AFTER, so
            the trail records what changed rather than merely that something did.
          </InfoDot>
        </span>}>
          <div className="divide-y divide-line">
            {pendingUpdates.map((u) => <UpdateRow key={u.id} u={u} />)}
          </div>
        </Section>
      )}
    </>
  );
}

function SubmissionRow({ s, open, onToggle }: { s: Submission; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const decide = useDecideSubmission();
  const { data: full } = useSubmission(open ? s.id : undefined);
  const { data: lookups } = useLookups();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const subHead = (lookups?.subheads || []).find((x: any) => x.id === s.crimeSubHeadId)?.name || s.crimeSubHeadId;

  const act = async (decision: 'approve' | 'reject' | 'return') => {
    setError('');
    try {
      const out = await decide.mutateAsync({ id: s.id, decision, note });
      // The register changes the moment a case is approved, so invalidate it alongside the
      // queue. A queue that empties while /cases still shows yesterday's rows reads as a bug.
      qc.invalidateQueries({ queryKey: ['submissions'] });
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (out.caseMasterId) nav(`/cases/${out.caseMasterId}`);
    } catch (e: any) {
      setError(e?.message || 'Could not record the decision.');
    }
  };

  return (
    <div className="px-4 py-3">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[13px] text-ink">{s.crimeNo}</span>
          <span className="text-[13px] text-ink-muted">{subHead}</span>
          <span className={`chip ${STATUS_CHIP[s.status]}`}>{s.status}</span>
          <span className="ml-auto text-[11.5px] text-ink-subtle">
            {s.submitterRole} · {String(s.submittedAt).slice(0, 10)}
          </span>
          <ChevronDown size={15} className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
        <p className="text-[12.5px] text-ink-muted mt-1 line-clamp-2">{s.briefFacts}</p>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pt-3 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12.5px]">
                <Detail k="Registered" v={s.crimeRegisteredDate} />
                <Detail k="Incident" v={s.incidentFromDate || 'not recorded'} />
                <Detail k="Acts & sections" v={s.actsSections || 'not recorded'} />
                <Detail k="Filed by" v={s.submittedBy} />
              </div>
              {full?.parties?.length ? (
                <div>
                  <div className="label mb-1">Parties</div>
                  <div className="flex flex-wrap gap-1.5">
                    {full.parties.map((p) => (
                      <span key={p.id} className="chip bg-surface-3 text-ink-muted">
                        {p.partyRole}: {p.fullName}{p.age ? `, ${p.age}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[12.5px] text-warning flex items-center gap-1.5">
                  <AlertTriangle size={13} /> No parties named. Consider returning it for correction.
                </div>
              )}

              {error && <div className="text-[12.5px] text-danger">{error}</div>}
              <div className="flex flex-wrap items-center gap-2">
                <input className="input flex-1 min-w-[220px]" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Reason (required to return or reject)" />
                <button onClick={() => act('approve')} disabled={decide.isPending}
                  className="btn bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                  <Check size={14} /> Approve
                </button>
                <button onClick={() => act('return')} disabled={decide.isPending} className="btn-outline">
                  <CornerUpLeft size={14} /> Return
                </button>
                <button onClick={() => act('reject')} disabled={decide.isPending}
                  className="btn text-danger border border-red-200 hover:bg-red-50">
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UpdateRow({ u }: { u: any }) {
  const qc = useQueryClient();
  const decide = useDecideUpdate();
  const [note, setNote] = useState('');
  const act = async (decision: 'approve' | 'reject') => {
    await decide.mutateAsync({ id: u.id, decision, note }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['case-updates'] });
  };
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip bg-kadi-blue50 text-kadi-blue">{u.updateLabel}</span>
        <span className="font-mono text-[12.5px] text-ink">{u.crimeNo || u.caseMasterId}</span>
        <span className="ml-auto text-[11.5px] text-ink-subtle">{u.requesterRole} · {String(u.requestedAt).slice(0, 10)}</span>
      </div>
      {/* Before and after, side by side. This is the difference between an audit trail and
          a log that says something changed. */}
      <div className="flex items-center gap-2 text-[12.5px] mt-1.5">
        <span className="text-ink-subtle line-through">{u.beforeValue || 'not recorded'}</span>
        <span className="text-ink-subtle">→</span>
        <span className="text-ink font-medium">{u.afterValue}</span>
      </div>
      <p className="text-[12.5px] text-ink-muted mt-1">{u.reason}</p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input className="input flex-1 min-w-[200px]" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (required to reject)" />
        <button onClick={() => act('approve')} className="btn bg-green-600 text-white hover:bg-green-700">
          <Check size={14} /> Approve
        </button>
        <button onClick={() => act('reject')} className="btn text-danger border border-red-200 hover:bg-red-50">
          <X size={14} /> Reject
        </button>
      </div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label">{k}</div>
      <div className="text-ink">{v}</div>
    </div>
  );
}

// ---- what became of them ---------------------------------------------------------------------
// The half of the loop that makes rejection useful. An officer who files a case and never learns
// what happened to it will file the next one the same way.
function MySubmissions({ canApprove }: { canApprove: boolean }) {
  const { data } = useSubmissions('');
  const { data: lookups } = useLookups();
  const nav = useNavigate();
  const decided = (data?.items || []).filter((s) => s.status !== 'pending');
  if (!data?.visible) {
    return data?.reason ? <Empty title="Not your queue" hint={data.reason} /> : null;
  }
  if (!decided.length) return null;
  return (
    <Section title={<span className="flex items-center gap-2">
      {canApprove ? 'Recently decided' : 'Your filings'}
      <span className="text-[12px] font-normal text-ink-muted">{decided.length}</span>
    </span>}>
      <div className="divide-y divide-line">
        {decided.slice(0, 30).map((s) => {
          const subHead = (lookups?.subheads || []).find((x: any) => x.id === s.crimeSubHeadId)?.name || '';
          return (
            <button key={s.id} disabled={!s.caseMasterId}
              onClick={() => s.caseMasterId && nav(`/cases/${s.caseMasterId}`)}
              className="w-full text-left px-4 py-2.5 hover:bg-surface-3/60 transition-colors disabled:hover:bg-transparent">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[12.5px] text-ink">{s.crimeNo}</span>
                <span className="text-[12.5px] text-ink-muted">{subHead}</span>
                <span className={`chip ${STATUS_CHIP[s.status]}`}>{s.status}</span>
                <span className="ml-auto text-[11.5px] text-ink-subtle">
                  {s.reviewedBy} · {String(s.reviewedAt || '').slice(0, 10)}
                </span>
              </div>
              {s.reviewNote && <p className="text-[12.5px] text-ink-muted mt-0.5">{s.reviewNote}</p>}
            </button>
          );
        })}
      </div>
    </Section>
  );
}
