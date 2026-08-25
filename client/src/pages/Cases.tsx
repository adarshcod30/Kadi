import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCases, useLookups, useMe, useCommand } from '../api/hooks';
import { StatusChip, GravityChip, SeverityDot, Skeleton, Empty, Mono, Chip, FilterChips, Pager } from '../components/ui';
import { Share2, Download, Loader2 } from 'lucide-react';
import { api, qs, clampPage, clampPageSize } from '../lib/api';
import { toCsv, downloadCsv, stamp, collectForExport } from '../lib/csv';
import type { CaseRow, Paged } from '../lib/types';

const SORTS: [string, string][] = [
  ['date_desc', 'Newest first'],
  ['date_asc', 'Oldest first'],
  ['linked_desc', 'Most linked'],
  ['severity_desc', 'Most at risk'],
  ['gravity_desc', 'Heinous first'],
  ['crimeno_asc', 'CrimeNo'],
];

const EXPORT_CAP = 2000;
const EXPORT_COLUMNS = [
  { key: 'crimeNo', label: 'CrimeNo', get: (c: CaseRow) => c.crimeNo },
  { key: 'registered', label: 'Registered', get: (c: CaseRow) => c.crimeRegisteredDate },
  { key: 'head', label: 'Crime head', get: (c: CaseRow) => c.crimeHead },
  { key: 'subhead', label: 'Crime', get: (c: CaseRow) => c.crimeSubHead },
  { key: 'station', label: 'Station', get: (c: CaseRow) => c.unitName },
  { key: 'district', label: 'District', get: (c: CaseRow) => c.districtName },
  { key: 'io', label: 'Investigating officer', get: (c: CaseRow) => c.ioName },
  { key: 'status', label: 'Status', get: (c: CaseRow) => c.status },
  { key: 'gravity', label: 'Gravity', get: (c: CaseRow) => c.gravity },
  { key: 'links', label: 'Linked cases', get: (c: CaseRow) => c.linkedCount },
  { key: 'health', label: 'Health flag', get: (c: CaseRow) => c.healthSeverity || '' },
  { key: 'flags', label: 'Flag reasons', get: (c: CaseRow) => (c.healthFlags || []).join('; ') },
];

export default function Cases() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { data: lookups } = useLookups();
  const { data: me } = useMe();
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const q = Object.fromEntries(params.entries());
  const page = clampPage(q.page);
  const pageSize = clampPageSize(q.pageSize, 25);
  const { data, isLoading } = useCases({ ...q, pageSize });
  const { data: command } = useCommand(false);
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

  // Export follows the filter, not the page -- a supervisor exporting "ageing heinous cases
  // at my station" wants all of them, not the 25 that happen to be on screen.
  const doExport = async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const { rows, total, truncated } = await collectForExport<CaseRow>(
        (page, size) => api.get<Paged<CaseRow>>(`/cases${qs({ ...q, page, pageSize: size })}`),
        EXPORT_CAP,
      );
      downloadCsv(`KADI_cases_${stamp()}.csv`, toCsv(rows, EXPORT_COLUMNS));
      // Say so when the file is not the whole filtered set. A CSV named after the filter that
      // silently holds only its first slice is worse than no export at all.
      setExportNote(truncated
        ? `Exported the first ${rows.length.toLocaleString()} of ${total.toLocaleString()} matching cases. Narrow the filter to export the rest.`
        : `Exported all ${rows.length.toLocaleString()} matching cases.`);
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Cases</h1>
          <p className="text-sm text-ink-muted">{data ? `${data.total.toLocaleString()} FIRs in your scope` : 'Loading…'} · filter by crime head, district, status or gravity. The <b>Links</b> column shows how many other cases each FIR connects to; open any row for its full detail + network.</p>
        </div>
        <button onClick={doExport} disabled={exporting || !data?.total} className="btn-outline flex items-center gap-1.5 disabled:opacity-40">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export CSV
        </button>
      </div>
      {exportNote && (
        <p className="text-[12.5px] text-ink-muted bg-surface-3 border border-line rounded-ctl px-3 py-1.5">{exportNote}</p>
      )}

      {/* What the current filter actually selected, over the whole result set rather than the
          page. Each one is a filter in its own right, so they are clickable. */}
      {summary && data && data.total > 0 && (
        <div className="flex flex-wrap gap-2 text-[12.5px]">
          {([
            ['linked', `${summary.linked.toLocaleString()} connect to another case`, q.linked === 'true'],
            ['flagged', `${summary.flagged.toLocaleString()} carry a health flag`, q.flagged === 'true'],
            ['severity', `${summary.highSeverity.toLocaleString()} high risk`, q.severity === 'high'],
            ['gravity', `${summary.heinous.toLocaleString()} heinous`, q.gravity === '1'],
          ] as const).map(([k, label, on]) => (
            <button key={k}
              onClick={() => set(k, on ? '' : k === 'severity' ? 'high' : k === 'gravity' ? '1' : 'true')}
              className={`px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'bg-kadi-navy text-white border-kadi-navy' : 'bg-surface-3 text-ink-muted border-line hover:bg-kadi-blue50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input defaultValue={q.search || ''} onKeyDown={(e) => { if (e.key === 'Enter') set('search', (e.target as HTMLInputElement).value); }}
            placeholder="Search CrimeNo / MO / IO…" className="input w-56" />
          <select value={q.head || ''} onChange={(e) => set('head', e.target.value)} className="input">
            <option value="">All crime heads</option>
            {lookups?.heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select value={q.subhead || ''} onChange={(e) => set('subhead', e.target.value)} className="input">
            <option value="">{q.head ? 'All in this head' : 'All crime types'}</option>
            {subheadOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={q.district || ''} onChange={(e) => set('district', e.target.value)} className="input">
            <option value="">{scope && scope !== 'state' ? 'My district' : 'All districts'}</option>
            {districtOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={q.status || ''} onChange={(e) => set('status', e.target.value)} className="input">
            <option value="">Any status</option>
            {lookups?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={q.gravity || ''} onChange={(e) => set('gravity', e.target.value)} className="input">
            <option value="">Any gravity</option>
            {lookups?.gravities.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center border-t border-line pt-2">
          <label className="text-[12px] text-ink-muted">Registered</label>
          <input type="date" value={q.dateFrom || ''} onChange={(e) => set('dateFrom', e.target.value)} className="input" />
          <span className="text-ink-muted text-sm">→</span>
          <input type="date" value={q.dateTo || ''} onChange={(e) => set('dateTo', e.target.value)} className="input" />
          <select value={q.severity || ''} onChange={(e) => set('severity', e.target.value)} className="input">
            <option value="">Any health flag</option>
            <option value="high">High risk only</option>
            <option value="medium">Medium risk only</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[12px] text-ink-muted">Sort</label>
            <select value={q.sort || 'date_desc'} onChange={(e) => set('sort', e.target.value)} className="input">
              {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
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
                <th className="text-left px-4 py-2 font-medium">Registered</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Gravity</th>
                <th className="text-center px-4 py-2 font-medium">Links</th>
                <th className="text-center px-4 py-2 font-medium">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((c) => (
                <tr key={c.caseMasterId} onClick={() => nav(`/cases/${c.caseMasterId}`)} className="hover:bg-kadi-blue50 cursor-pointer">
                  <td className="px-4 py-2.5"><Mono>{c.crimeNo}</Mono></td>
                  <td className="px-4 py-2.5">{c.crimeSubHead}<div className="text-xs text-ink-muted">{c.crimeHead}</div></td>
                  <td className="px-4 py-2.5">{c.unitName}<div className="text-xs text-ink-muted">{c.districtName}</div></td>
                  <td className="px-4 py-2.5">{c.ioName || '—'}{c.ioRank && <div className="text-xs text-ink-muted">{c.ioRank}</div>}</td>
                  <td className="px-4 py-2.5 font-num text-ink-muted">{c.crimeRegisteredDate}</td>
                  <td className="px-4 py-2.5"><StatusChip status={c.status} /></td>
                  <td className="px-4 py-2.5"><GravityChip gravity={c.gravity} /></td>
                  <td className="px-4 py-2.5 text-center">{c.linkedCount > 0 ? <Chip color="blue">{c.linkedCount}</Chip> : <span className="text-ink-muted">—</span>}</td>
                  <td className="px-4 py-2.5 text-center" title={(c.healthFlags || []).join(', ')}><SeverityDot severity={c.healthSeverity} /></td>
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
