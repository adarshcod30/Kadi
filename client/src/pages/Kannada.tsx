// Kannada — reviewing the machine's Kannada, one string at a time.
//
// WHY THIS SCREEN EXISTS. Every Kannada string in KADI was written by a model. There are 1,100
// of them and not one had been read by a Kannada speaker before it shipped. That was listed as
// a known limitation, which is honest and does exactly nothing about it: a limitation only
// fixable by an offline review nobody has scheduled is a limitation that stays.
//
// A review that requires somebody to sit down with a spreadsheet of 1,100 rows never happens.
// A review that lets the officer who just saw a wrong word fix that one word, in ten seconds,
// while they are already looking at it — that happens. So this screen is built for the second
// kind: search, correct, done, live immediately, attributed.
//
// NO APPROVAL QUEUE, DELIBERATELY. A queue for interface wording becomes the bottleneck the
// review dies in, and unlike a case record a label is not a claim about a person. What replaces
// approval is history: every correction supersedes rather than overwrites, every one carries
// its author, and any string can be put back to the machine wording.
//
// WHO CAN DO THIS: anyone signed in. The people reading the Kannada interface all day are
// station officers, and they are the ones who know that a word is a technically correct
// translation and not what anybody in a police station actually calls that thing. Restricting
// this to administrators would restrict it to the people least likely to use the Kannada UI.
import { useMemo, useState } from 'react';
import {
  Languages, Search, Check, Loader2, Undo2, History as HistoryIcon, PencilLine, X, Info,
} from 'lucide-react';
import { Section, Empty, Chip } from '../components/ui';
import { InfoDot } from '../components/InfoDot';
import { api } from '../lib/api';
import { useTx, builtDictionary, currentFixes, loadFixes, useLang } from '../lib/i18n';
import { useMe } from '../api/hooks';

type Row = { source: string; machine: string; fixed: string | null };

const PAGE = 40;

export default function Kannada() {
  const tx = useTx();
  const { lang } = useLang();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unreviewed' | 'corrected'>('all');
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);          // bumped after a write, to re-read currentFixes
  const [editing, setEditing] = useState<string | null>(null);

  const built = builtDictionary();
  const fixes = useMemo(() => currentFixes(), [tick]);

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all: Row[] = Object.entries(built).map(([source, machine]) => ({
      source, machine, fixed: fixes[source] ?? null,
    }));
    return all.filter((r) => {
      if (filter === 'corrected' && !r.fixed) return false;
      if (filter === 'unreviewed' && r.fixed) return false;
      if (!term) return true;
      return r.source.toLowerCase().includes(term)
        || r.machine.includes(q.trim())
        || (r.fixed || '').includes(q.trim());
    });
  }, [built, fixes, q, filter, tick]);

  const correctedCount = Object.keys(fixes).length;
  const total = Object.keys(built).length;
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  const afterWrite = async () => { await loadFixes(); setTick((t) => t + 1); setEditing(null); };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          {tx('Kannada review')}
          <InfoDot width="w-[26rem]">
            <b className="block mb-1 text-kadi-navy">Why this screen exists</b>
            Every Kannada string in KADI was written by a model, and none of them had been read
            by a Kannada speaker. This is where that gets fixed — one string at a time, by the
            officers actually reading the Kannada interface.
            <b className="block mt-1.5 text-kadi-navy">A correction is live immediately</b>
            There is no approval queue. A queue for interface wording becomes the bottleneck the
            review dies in, and a label is not a claim about a person. What replaces approval is
            history: every correction carries its author, nothing is overwritten, and any string
            can be put back to the machine wording.
            <b className="block mt-1.5 text-kadi-navy">This does not touch case data</b>
            Only the words the interface uses. Crime numbers, names and every value that comes
            out of the register are never translated at all.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">
          {tx('The Kannada interface was written by a model. Correct anything that is wrong — it takes effect for everyone straight away.')}
        </p>
      </div>

      {/* Progress, stated as a fraction rather than a bar. 1,100 strings and a handful reviewed
          is the honest picture, and a bar at 2% invites nobody. A count invites somebody to
          make it one higher. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{tx('Strings in the interface')}</div>
          <div className="text-2xl font-semibold text-ink font-num mt-1">{total.toLocaleString('en-IN')}</div>
          <div className="text-[11.5px] text-ink-muted mt-0.5">{tx('all machine-written')}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{tx('Corrected by a person')}</div>
          <div className="text-2xl font-semibold text-kadi-navy font-num mt-1">{correctedCount.toLocaleString('en-IN')}</div>
          <div className="text-[11.5px] text-ink-muted mt-0.5">
            {total ? `${((correctedCount / total) * 100).toFixed(1)}%` : '—'} {tx('of the interface')}
          </div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{tx('You are signed in as')}</div>
          <div className="text-[15px] font-semibold text-ink mt-1.5">{(me as any)?.user?.role || '—'}</div>
          <div className="text-[11.5px] text-ink-muted mt-0.5">{tx('every correction is recorded against your account')}</div>
        </div>
      </div>

      {lang !== 'kn' && (
        <div className="rounded-card border border-kadi-blue/30 bg-kadi-blue/5 p-3 text-[12.5px] text-ink-muted flex items-start gap-2">
          <Info size={14} className="text-kadi-blue shrink-0 mt-0.5" />
          <span>{tx('The interface is in English right now. You can still correct the Kannada here — switch to ಕನ್ನಡ in the top bar to see your corrections in place.')}</span>
        </div>
      )}

      <Section title={<span className="flex items-center gap-2">
        <Languages size={15} className="text-kadi-blue" /> {tx('The dictionary')}
        <span className="text-[12px] font-normal text-ink-subtle font-num">
          {rows.length.toLocaleString('en-IN')} {tx('shown')}
        </span>
      </span>}>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[14rem]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input className="input w-full pl-8 text-[13px]" value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
                placeholder={tx('Search the English or the Kannada')} />
            </div>
            {(['all', 'unreviewed', 'corrected'] as const).map((f) => (
              <button key={f} onClick={() => { setFilter(f); setPage(0); }}
                className={`chip border text-[11.5px] ${filter === f
                  ? 'bg-kadi-navy text-white border-kadi-navy'
                  : 'bg-surface-2 border-line text-ink-muted hover:bg-surface-3'}`}>
                {tx(f === 'all' ? 'All' : f === 'unreviewed' ? 'Not yet reviewed' : 'Corrected')}
              </button>
            ))}
          </div>

          {!shown.length && (
            <Empty title={tx('Nothing matches')} hint={tx('Try a different word, or clear the filter.')} />
          )}

          <div className="divide-y divide-line">
            {shown.map((r) => (
              <Entry key={r.source} row={r} open={editing === r.source}
                onOpen={() => setEditing(editing === r.source ? null : r.source)}
                onDone={afterWrite} />
            ))}
          </div>

          {rows.length > PAGE && (
            <div className="flex items-center justify-between pt-1">
              <button className="btn-outline text-[12px] py-1 disabled:opacity-40"
                disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{tx('Previous')}</button>
              <span className="text-[12px] text-ink-subtle font-num">
                {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} {tx('of')} {rows.length.toLocaleString('en-IN')}
              </span>
              <button className="btn-outline text-[12px] py-1 disabled:opacity-40"
                disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage((p) => p + 1)}>{tx('Next')}</button>
            </div>
          )}
        </div>
      </Section>

      <RecentCorrections tick={tick} />
    </div>
  );
}

// ---- one string --------------------------------------------------------------------------
// English, the machine's Kannada, and the correction if there is one — stacked rather than in
// columns. Kannada and English have very different line lengths and a two-column layout leaves
// one side ragged and the other overflowing at every width worth supporting.
function Entry({ row, open, onOpen, onDone }: {
  row: Row; open: boolean; onOpen: () => void; onDone: () => void;
}) {
  const tx = useTx();
  const [draft, setDraft] = useState(row.fixed || row.machine);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[] | null>(null);

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/translations', {
        source: row.source, kannada: draft, machineText: row.machine, note,
      });
      setNote('');
      await onDone();
    } catch (e: any) {
      setError(e?.message || tx('Could not save the correction.'));
    } finally { setBusy(false); }
  };

  const revert = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/translations/revert', { source: row.source });
      setDraft(row.machine);
      await onDone();
    } catch (e: any) {
      setError(e?.message || tx('Could not revert.'));
    } finally { setBusy(false); }
  };

  const showHistory = async () => {
    if (history) return setHistory(null);
    const out = await api.get<{ items: any[] }>(
      `/translations/history?source=${encodeURIComponent(row.source)}`).catch(() => null);
    setHistory(out?.items || []);
  };

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        {/* data-notranslate on all three, and it is essential rather than tidy. These are
            SPECIMENS UNDER REVIEW, not interface copy: without it the page translator renders
            the English source into Kannada and the reviewer is shown Kannada above Kannada with
            nothing to compare — which is the one thing this screen exists to let them do. */}
        <div className="min-w-0 flex-1" data-notranslate>
          <p className="text-[13px] text-ink leading-snug">{row.source}</p>
          <p className={`text-[13px] leading-snug mt-1 ${row.fixed ? 'text-ink-subtle line-through' : 'text-ink-muted'}`}>
            {row.machine}
          </p>
          {row.fixed && (
            <p className="text-[13px] leading-snug mt-1 text-kadi-navy font-medium">{row.fixed}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {row.fixed
            ? <Chip color="good">{tx('corrected')}</Chip>
            : <span className="text-[10.5px] text-ink-subtle">{tx('machine')}</span>}
          <button onClick={onOpen} className="text-ink-subtle hover:text-kadi-navy" aria-label={tx('Correct this')}>
            {open ? <X size={14} /> : <PencilLine size={14} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2.5 rounded-ctl border border-line bg-surface-2 p-3 space-y-2">
          <textarea data-notranslate className="input w-full text-[13px] min-h-[3.5rem] resize-y" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tx('The Kannada as it should read')}
            aria-label={tx('The Kannada as it should read')} />
          <input className="input w-full text-[12px]" value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tx('Optional — why the machine wording was wrong')} />
          {error && <p className="text-[12px] text-bad">{error}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={save} disabled={busy || !draft.trim() || draft === row.machine}
              className="btn-primary text-[12.5px] disabled:opacity-40">
              {busy ? <><Loader2 size={13} className="animate-spin" /> {tx('Saving…')}</>
                : <><Check size={13} /> {tx('Save the correction')}</>}
            </button>
            {row.fixed && (
              <button onClick={revert} disabled={busy} className="btn-outline text-[12px] py-1">
                <Undo2 size={13} /> {tx('Back to the machine wording')}
              </button>
            )}
            <button onClick={showHistory} className="text-[12px] text-ink-subtle hover:text-ink inline-flex items-center gap-1">
              <HistoryIcon size={12} /> {tx('History')}
            </button>
            <span className="text-[11px] text-ink-subtle ml-auto">
              {tx('Live for everyone as soon as you save.')}
            </span>
          </div>
          {history && (
            <div className="pt-1 border-t border-line space-y-1.5" data-notranslate>
              {!history.length && <p className="text-[11.5px] text-ink-subtle">{tx('No corrections yet.')}</p>}
              {history.map((h) => (
                <div key={h.id} className="text-[11.5px]">
                  <span className={h.status === 'active' ? 'text-ink' : 'text-ink-subtle'}>{h.kannada}</span>
                  <span className="text-ink-subtle"> — {h.fixedBy} ({h.fixerRole}), {String(h.fixedAt).slice(0, 10)}
                    {h.status !== 'active' && ` · ${tx('superseded')}`}</span>
                  {h.note && <div className="text-ink-subtle italic">{h.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- what other people have fixed ----------------------------------------------------------
// A review nobody can see the progress of is a review nobody joins.
function RecentCorrections({ tick }: { tick: number }) {
  const tx = useTx();
  const [items, setItems] = useState<any[] | null>(null);
  useMemo(() => {
    api.get<{ items: any[] }>('/translations/recent?limit=12')
      .then((o) => setItems(o.items || [])).catch(() => setItems([]));
  }, [tick]);
  if (!items || !items.length) return null;
  return (
    <Section title={<span className="flex items-center gap-2">
      <HistoryIcon size={15} className="text-kadi-blue" /> {tx('Recent corrections')}
    </span>}>
      <div className="divide-y divide-line">
        {items.map((h) => (
          <div key={h.id} className="px-4 py-2.5 text-[12.5px]" data-notranslate>
            <p className="text-ink-muted">{h.source}</p>
            <p className="text-ink mt-0.5">{h.kannada}</p>
            <p className="text-[11px] text-ink-subtle mt-0.5">
              {h.fixedBy} ({h.fixerRole}) · {String(h.fixedAt).slice(0, 10)}
              {h.status !== 'active' && ` · ${tx('superseded')}`}
              {h.note && ` · ${h.note}`}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
