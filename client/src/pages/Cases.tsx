import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCases, useLookups, useMe, useCommand, useCaseIntel } from '../api/hooks';
import { StatusChip, GravityChip, SeverityDot, Skeleton, Empty, Mono, Chip, FilterChips, Pager, QuickFilters } from '../components/ui';
import { Share2 } from 'lucide-react';
import { Select } from '../components/Select';
import { IntelligenceBand } from '../components/IntelligenceBand';
import { clampPage, clampPageSize } from '../lib/api';

const SORTS: [string, string][] = [
  ['date_desc', 'Newest first'],
  ['date_asc', 'Oldest first'],
  ['linked_desc', 'Most linked'],
  ['severity_desc', 'Most at risk'],
  ['gravity_desc', 'Heinous first'],
  ['crimeno_asc', 'CrimeNo'],
];

export default function Cases() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { data: lookups } = useLookups();
  const { data: me } = useMe();
  const q = Object.fromEntries(params.entries());
  const page = clampPage(q.page);
  const pageSize = clampPageSize(q.pageSize, 25);
  const { data, isLoading } = useCases({ ...q, pageSize });
  const { data: command } = useCommand(false);
  // Same query as the table, so the analysis always describes exactly what is on screen.
  const { data: intel, isLoading: intelLoading } = useCaseIntel({ ...q, page: undefined, pageSize: undefined });
  // District tier gets a second view of the register: not "my cases filtered", but the cases
  // registered ELSEWHERE that share evidence with one of mine. That is the silo-breaking
  // answer, and a plain filtered list can never surface it.
  const districtView = command?.view === 'district';
  const linkedIn = districtView ? (command.linkedInFromOtherDistricts || []) : [];
  const tab = q.view === 'linked' ? 'linked' : 'mine';

  // scope-aware district options: non-state roles only see their own district
  const scope = me?.capabilities.scope;
  const districtOptions = scope && scope !== 'state' && me?.user.districtId
    ? (lookups?.districts || []).filter((d) => d.id === String(me.user.districtId))
    : lookups?.districts || [];
  // Sub-head is only meaningful under a chosen head; offering all 27 at once is a worse
  // control than offering the 3-4 that belong to the head already selected.
  const subheadOptions = (lookups?.subheads || []).filter((s) => !q.head || s.headId === q.head);

  // Any filter change returns to page 1 -- staying on page 40 of a result set that just shrank
  // to 12 rows shows an empty table and reads as "no results".
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    // Changing the head invalidates a sub-head chosen under the previous one.
    if (k === 'head') p.delete('subhead');
    p.delete('page');
    setParams(p);
  };
  // Paging must NOT reset the page it just set. This was the bug behind "Next does nothing":
  // both paths went through set(), which deletes `page` unconditionally, so every Next click
  // wrote page=2 and then immediately removed it -- leaving the URL, and the table, on page 1.
  const goPage = (n: number) => {
    const p = new URLSearchParams(params);
    if (n <= 1) p.delete('page'); else p.set('page', String(n));
    setParams(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const nameOf = (list: { id: string; name: string }[] | undefined, id: string) =>
    (list || []).find((x) => x.id === id)?.name || id;
  const active = [
    q.search && { k: 'search', label: `“${q.search}”` },
    q.head && { k: 'head', label: nameOf(lookups?.heads, q.head) },
    q.subhead && { k: 'subhead', label: nameOf(lookups?.subheads, q.subhead) },
    q.district && { k: 'district', label: nameOf(lookups?.districts, q.district) },
    q.status && { k: 'status', label: nameOf(lookups?.statuses, q.status) },
    q.gravity && { k: 'gravity', label: nameOf(lookups?.gravities, q.gravity) },
    q.severity && { k: 'severity', label: `${q.severity} risk` },
    q.flagged === 'true' && { k: 'flagged', label: 'Flagged only' },
    q.linked === 'true' && { k: 'linked', label: 'Linked only' },
    q.dateFrom && { k: 'dateFrom', label: `from ${q.dateFrom}` },
    q.dateTo && { k: 'dateTo', label: `to ${q.dateTo}` },
  ].filter(Boolean) as { k: string; label: string }[];

  const clearAll = () => {
    const p = new URLSearchParams();
    if (q.sort) p.set('sort', q.sort);
    if (q.view) p.set('view', q.view);
    setParams(p);
  };

  const summary = data?.summary;

  // A finding's query REPLACES the page filter rather than merging into it: the signal
  // described a slice of the current view, so stacking it on top of the filters that produced
  // that view would narrow twice and show fewer cases than the finding claims.
  const applySignal = (query: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(query)) p.set(k, v);
    p.delete('page');
    setParams(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Cases</h1>
          <p className="text-sm text-ink-muted">{data ? `${data.total.toLocaleString()} FIRs in your scope` : 'Loading…'} · filter by crime head, district, status or gravity. The <b>Links</b> column shows how many other cases each FIR connects to; open any row for its full detail + network.</p>
        </div>
      </div>

      <IntelligenceBand data={intel} isLoading={intelLoading} onApply={applySignal}
        title="What stands out in this view"
        subtitle={intel ? `Read from ${intel.total.toLocaleString()} case${intel.total === 1 ? '' : 's'} matching your filter` : undefined} />

      {/* These read as passive statistics, so they are labelled as the controls they are.
          Each count is computed over the whole filtered set, and clicking it narrows the
          register to exactly the cases it counts. */}
      {summary && data && data.total > 0 && (
        <QuickFilters
          hint="One click narrows the register to just those cases."
          items={[
            { k: 'linked', on: q.linked === 'true', value: 'true',
              n: summary.linked, label: 'connect to another case',
              title: 'FIRs sharing an offender, co-accused, MO, location, time window or act & section with at least one other case' },
            { k: 'flagged', on: q.flagged === 'true', value: 'true',
              n: summary.flagged, label: 'carry a health flag',
              title: 'Cases flagged for reporting delay, investigation ageing, pendency, undetected risk or a false-case pattern' },
            { k: 'severity', on: q.severity === 'high', value: 'high',
              n: summary.highSeverity, label: 'need attention now',
              title: 'Cases carrying a high-severity health flag — the subset a supervisor should act on first' },
            { k: 'gravity', on: q.gravity === '1', value: '1',
              n: summary.heinous, label: 'are heinous offences',
              title: 'Offences classified Heinous under the KSP gravity scale' },
          ]}
          onToggle={(k, on, value) => set(k, on ? '' : value)}
        />
      )}

      {/* Filters — a grid, not a wrap. Wrapping left "Any gravity" stranded alone on a second
          row whenever the viewport landed between breakpoints; fixed tracks keep the six
          controls in one band and reflow them together. */}
      <div className="card p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <input defaultValue={q.search || ''} onKeyDown={(e) => { if (e.key === 'Enter') set('search', (e.target as HTMLInputElement).value); }}
            placeholder="Search CrimeNo / MO / IO…" className="input w-full min-w-0" />
          <Select value={q.head || ''} onChange={(v) => set('head', v)} className="min-w-0"
            options={[{ value: '', label: 'All crime heads' }, ...(lookups?.heads || []).map((h) => ({ value: h.id, label: h.name }))]} />
          <Select value={q.subhead || ''} onChange={(v) => set('subhead', v)} className="min-w-0"
            options={[{ value: '', label: q.head ? 'All in this head' : 'All crime types' }, ...subheadOptions.map((s) => ({ value: s.id, label: s.name }))]} />
          <Select value={q.district || ''} onChange={(v) => set('district', v)} className="min-w-0"
            options={[{ value: '', label: scope && scope !== 'state' ? 'My district' : 'All districts' }, ...districtOptions.map((d) => ({ value: d.id, label: d.name }))]} />
          <Select value={q.status || ''} onChange={(v) => set('status', v)} className="min-w-0"
            options={[{ value: '', label: 'Any status' }, ...(lookups?.statuses || []).map((s) => ({ value: s.id, label: s.name }))]} />
          <Select value={q.gravity || ''} onChange={(v) => set('gravity', v)} className="min-w-0"
            options={[{ value: '', label: 'Any gravity' }, ...(lookups?.gravities || []).map((g) => ({ value: g.id, label: g.name }))]} />
        </div>
        <div className="flex flex-wrap gap-2 items-center border-t border-line pt-2">
          <label className="text-[12px] text-ink-muted">Registered</label>
          <input type="date" value={q.dateFrom || ''} onChange={(e) => set('dateFrom', e.target.value)} className="input" />
          <span className="text-ink-muted text-sm">→</span>
          <input type="date" value={q.dateTo || ''} onChange={(e) => set('dateTo', e.target.value)} className="input" />
          <Select value={q.severity || ''} onChange={(v) => set('severity', v)} className="w-44"
            options={[{ value: '', label: 'Any health flag' }, { value: 'high', label: 'High risk only' }, { value: 'medium', label: 'Medium risk only' }]} />
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[12px] text-ink-muted">Sort</label>
            <Select value={q.sort || 'date_desc'} onChange={(v) => set('sort', v)} className="w-40"
              options={SORTS.map(([v, label]) => ({ value: v, label }))} />
          </div>
        </div>
        {active.length > 0 && <FilterChips items={active} onRemove={(k) => set(k, '')} onClear={clearAll} />}
      </div>

      {/* Table — scrolls horizontally on small screens instead of breaking the layout */}
      <div className="card overflow-x-auto">
        {districtView && (
          <div className="flex gap-1 border-b border-line mb-3">
            {([['mine', `Registered in ${command.districtName}`], ['linked', `Linked in from elsewhere (${(command.linkedInTotal || 0).toLocaleString()})`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => set('view', k === 'mine' ? '' : 'linked')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                  tab === k ? 'border-kadi-blue text-kadi-blue' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {districtView && tab === 'linked' ? (
          <div>
            <p className="text-[12.5px] text-ink-muted mb-2 flex items-start gap-1.5">
              <Share2 size={14} className="text-kadi-teal shrink-0 mt-0.5" />
              Cases registered in other districts that share proven evidence with a case in
              {' '}{command.districtName}. None of these appear in this district's own register.
            </p>
            {!linkedIn.length ? <Empty title="No inbound links" hint="No case outside this district currently links to one inside it." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">CrimeNo</th>
                      <th className="text-left px-4 py-2 font-medium">Crime</th>
                      <th className="text-left px-4 py-2 font-medium">Registered in</th>
                      <th className="text-left px-4 py-2 font-medium">Station</th>
                      <th className="text-left px-4 py-2 font-medium">Linked by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedIn.map((c: any) => (
                      <tr key={c.caseMasterId} onClick={() => nav(`/graph?case=${c.caseMasterId}`)}
                        className="border-b border-line/60 hover:bg-kadi-blue50/50 cursor-pointer">
                        <td className="px-4 py-2"><Mono>{c.crimeNo}</Mono></td>
                        <td className="px-4 py-2 text-ink">{c.crimeSubHead}</td>
                        <td className="px-4 py-2 text-ink-muted">{c.districtName}</td>
                        <td className="px-4 py-2 text-ink-muted">{c.unitName}</td>
                        <td className="px-4 py-2">
                          <Chip>{String(c.edgeType).replace(/_/g, ' ')}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : isLoading ? <Skeleton rows={10} /> : !data?.items.length ? (
          <Empty title="No cases found" hint={active.length ? 'No FIR matches every filter applied. Try removing one.' : 'Try adjusting the filters.'} />
        ) : (
          <table className="w-full text-sm min-w-[940px]">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">CrimeNo</th>
                <th className="text-left px-4 py-2 font-medium">Crime</th>
                <th className="text-left px-4 py-2 font-medium">Station / District</th>
                <th className="text-left px-4 py-2 font-medium">Investigating officer</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Registered</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Gravity</th>
                <th className="text-center px-3 py-2 font-medium">Links</th>
                <th className="text-center px-3 py-2 font-medium">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((c) => (
                <tr key={c.caseMasterId} onClick={() => nav(`/cases/${c.caseMasterId}`)} className="hover:bg-kadi-blue50 cursor-pointer">
                  <td className="px-4 py-2.5"><Mono>{c.crimeNo}</Mono></td>
                  <td className="px-4 py-2.5">{c.crimeSubHead}<div className="text-xs text-ink-muted">{c.crimeHead}</div></td>
                  <td className="px-4 py-2.5">{c.unitName}<div className="text-xs text-ink-muted">{c.districtName}</div></td>
                  <td className="px-4 py-2.5">{c.ioName || '—'}{c.ioRank && <div className="text-xs text-ink-muted">{c.ioRank}</div>}</td>
                  {/* An ISO date is one token, not two -- without this the column broke it
                      across lines as "2026-07-" / "13" and made every row two lines tall. */}
                  <td className="px-3 py-2.5 font-num text-ink-muted whitespace-nowrap">{c.crimeRegisteredDate}</td>
                  <td className="px-3 py-2.5 text-center"><StatusChip status={c.status} /></td>
                  <td className="px-3 py-2.5 text-center"><GravityChip gravity={c.gravity} /></td>
                  <td className="px-3 py-2.5 text-center">{c.linkedCount > 0 ? <Chip color="blue">{c.linkedCount}</Chip> : <span className="text-ink-muted">—</span>}</td>
                  <td className="px-3 py-2.5 text-center" title={(c.healthFlags || []).join(', ')}><SeverityDot severity={c.healthSeverity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!(districtView && tab === 'linked') && data && (
        <Pager page={page} pageSize={pageSize} total={data.total}
          onPage={goPage} onPageSize={(n) => set('pageSize', n === 25 ? '' : String(n))} />
      )}
    </div>
  );
}
