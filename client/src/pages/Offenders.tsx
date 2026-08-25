import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Download, Loader2, Share2 } from 'lucide-react';
import { useOffenders } from '../api/hooks';
import { RiskBadge, Chip, Skeleton, Empty, FilterChips, Pager } from '../components/ui';
import { api, qs, clampPage, clampPageSize } from '../lib/api';
import { toCsv, downloadCsv, stamp, collectForExport } from '../lib/csv';
import type { Offender, Paged } from '../lib/types';

const SORTS: [string, string][] = [
  ['risk_desc', 'Highest risk'],
  ['recent_desc', 'Most recently active'],
  ['cases_desc', 'Most cases'],
  ['districts_desc', 'Widest reach'],
  ['network_desc', 'Largest network'],
  ['arrests_desc', 'Most arrests'],
  ['name_asc', 'Name (A–Z)'],
];

const EXPORT_CAP = 1000;
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Offender', get: (o: Offender) => o.canonicalName },
  { key: 'aka', label: 'Known aliases', get: (o: Offender) => (o.nameVariants || []).filter((v) => v !== o.canonicalName).join('; ') },
  { key: 'risk', label: 'Risk score', get: (o: Offender) => o.riskScore },
  { key: 'band', label: 'Risk band', get: (o: Offender) => o.band },
  { key: 'cases', label: 'Cases', get: (o: Offender) => o.distinctCases },
  { key: 'districts', label: 'Districts', get: (o: Offender) => o.distinctDistricts },
  { key: 'network', label: 'Known co-offenders', get: (o: Offender) => (o.coOffenders || []).length },
  { key: 'arrests', label: 'Arrests', get: (o: Offender) => o.arrestCount },
  { key: 'first', label: 'First seen', get: (o: Offender) => o.firstSeen || '' },
  { key: 'last', label: 'Last active', get: (o: Offender) => o.lastSeen || '' },
  { key: 'confidence', label: 'ER confidence', get: (o: Offender) => `${Math.round((o.confidence || 0) * 100)}%` },
];

// Days between an ISO date and the corpus's own latest activity date.
function daysSince(asOf: string | null | undefined, date: string | null | undefined): number | null {
  if (!asOf || !date) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

export default function Offenders() {
  const nav = useNavigate();
  // Filters live in the URL, not component state. A watchlist view is something a supervisor
  // shares with the officer who has to act on it -- "the cross-district high-risk group,
  // sorted by reach" has to survive being pasted into a message.
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const q = Object.fromEntries(params.entries());
  const page = clampPage(q.page);
  const pageSize = clampPageSize(q.pageSize, 50);
  const { data, isLoading } = useOffenders({ ...q, pageSize });
  // A district list mixes two very different people: those based here, and those based
  // elsewhere who reach in. The second group is why a district needs a state-linked system
  // at all, so it gets its own filter rather than being buried among the locals.
  const districtView = data?.scope === 'district';
  const summary = data?.summary;
  const asOf = data?.asOf;

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    p.delete('page');
    setParams(p);
  };
  const goPage = (n: number) => {
    const p = new URLSearchParams(params);
    if (n <= 1) p.delete('page'); else p.set('page', String(n));
    setParams(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const clearAll = () => {
    const p = new URLSearchParams();
    if (q.sort) p.set('sort', q.sort);
    setParams(p);
  };

  const active = [
    q.search && { k: 'search', label: `“${q.search}”` },
    q.band && { k: 'band', label: `${q.band} risk` },
    q.origin === 'local' && { k: 'origin', label: 'Based here' },
    q.origin === 'visiting' && { k: 'origin', label: 'Reaching in' },
    q.crossDistrict === 'true' && { k: 'crossDistrict', label: 'Cross-district' },
    q.networked === 'true' && { k: 'networked', label: 'Operates in a group' },
    q.lowConfidence === 'true' && { k: 'lowConfidence', label: 'Needs ER review' },
    q.activeDays && { k: 'activeDays', label: `Active in last ${q.activeDays}d` },
  ].filter(Boolean) as { k: string; label: string }[];

  const doExport = async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const { rows, total, truncated } = await collectForExport<Offender>(
        (page, size) => api.get<Paged<Offender>>(`/offenders${qs({ ...q, page, pageSize: size })}`),
        EXPORT_CAP,
      );
      downloadCsv(`KADI_watchlist_${stamp()}.csv`, toCsv(rows, EXPORT_COLUMNS));
      // Say so when the file is not the whole filtered set. A CSV named after the filter that
      // silently holds only its first slice is worse than no export at all.
      setExportNote(truncated
        ? `Exported the first ${rows.length.toLocaleString()} of ${total.toLocaleString()} matching offenders. Narrow the filter to export the rest.`
        : `Exported all ${rows.length.toLocaleString()} matching offenders.`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Offender watchlist</h1>
          <p className="text-sm text-ink-muted flex items-center gap-1.5"><ShieldCheck size={14} className="text-kadi-blue" /> Behaviour-based risk only — no caste, religion, or occupation.</p>
        </div>
        <button onClick={doExport} disabled={exporting || !data?.total} className="btn-outline flex items-center gap-1.5 disabled:opacity-40">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export CSV
        </button>
      </div>
      {exportNote && (
        <p className="text-[12.5px] text-ink-muted bg-surface-3 border border-line rounded-ctl px-3 py-1.5">{exportNote}</p>
      )}

      <p className="text-[12.5px] text-ink-muted -mt-1">
        Every person here has <b>two or more</b> cases resolved to one identity — this is the
        repeat-offender register, not the full accused list.
      </p>

      {/* Counts over the whole filtered set, each one a filter in its own right. */}
      {summary && data && data.total > 0 && (
        <div className="flex flex-wrap gap-2 text-[12.5px]">
          {([
            ['band', `${summary.high.toLocaleString()} high risk`, q.band === 'High', 'High'],
            ['crossDistrict', `${summary.crossDistrict.toLocaleString()} work across districts`, q.crossDistrict === 'true', 'true'],
            ['networked', `${summary.networked.toLocaleString()} operate in a group`, q.networked === 'true', 'true'],
            ['lowConfidence', `${summary.needsReview.toLocaleString()} need ER review`, q.lowConfidence === 'true', 'true'],
          ] as const).map(([k, label, on, val]) => (
            <button key={k} onClick={() => set(k, on ? '' : val)}
              className={`px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'bg-kadi-navy text-white border-kadi-navy' : 'bg-surface-3 text-ink-muted border-line hover:bg-kadi-blue50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="card p-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input defaultValue={q.search || ''} onKeyDown={(e) => { if (e.key === 'Enter') set('search', (e.target as HTMLInputElement).value); }}
            placeholder="Search name or alias…" className="input w-56" />
          {['', 'High', 'Medium', 'Low'].map((b) => (
            <button key={b} onClick={() => set('band', b)} className={`chip ${(q.band || '') === b ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink-muted hover:bg-kadi-blue50'}`}>{b || 'All'}</button>
          ))}
          {/* Recency is what separates a live lead from a historical record, and the risk
              score deliberately does not encode it on its own. */}
          <select value={q.activeDays || ''} onChange={(e) => set('activeDays', e.target.value)} className="input ml-1">
            <option value="">Active any time</option>
            <option value="90">Active in last 90 days</option>
            <option value="180">Active in last 6 months</option>
            <option value="365">Active in last year</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[12px] text-ink-muted">Sort</label>
            <select value={q.sort || 'risk_desc'} onChange={(e) => set('sort', e.target.value)} className="input">
              {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
        </div>

        {districtView && (
          <div className="flex gap-1 items-center border-t border-line pt-2">
            <span className="text-[11px] uppercase tracking-wide text-ink-muted mr-1">Based</span>
            {([['', `All ${data?.total ?? ''}`],
               ['local', `Here ${data?.basedHere ?? 0}`],
               ['visiting', `Reaching in ${data?.reachingIn ?? 0}`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => set('origin', k)}
                className={`chip ${(q.origin || '') === k ? 'bg-kadi-teal text-white' : 'bg-surface-3 text-ink-muted hover:bg-kadi-blue50'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {active.length > 0 && <FilterChips items={active} onRemove={(k) => set(k, '')} onClear={clearAll} />}
      </div>

      {districtView && q.origin === 'visiting' && (
        <p className="text-[12.5px] text-ink-muted -mt-2 px-1">
          Offenders based outside this district who have at least one case inside it. Their
          reach across jurisdictions is the finding a single station register cannot produce.
        </p>
      )}

      <div className="card overflow-x-auto">
        {isLoading ? <Skeleton rows={10} /> : !data?.items.length ? (
          <Empty title="No offenders match" hint={active.length ? 'No identity matches every filter applied. Try removing one.' : undefined} />
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Offender</th>
                <th className="text-left px-4 py-2 font-medium">Risk</th>
                <th className="text-center px-4 py-2 font-medium">Cases</th>
                <th className="text-center px-4 py-2 font-medium">Districts</th>
                <th className="text-center px-4 py-2 font-medium">Network</th>
                <th className="text-center px-4 py-2 font-medium">Arrests</th>
                <th className="text-left px-4 py-2 font-medium">Last active</th>
                <th className="text-left px-4 py-2 font-medium">ER confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((o) => {
                const gap = daysSince(asOf, o.lastSeen);
                const co = (o.coOffenders || []).length;
                return (
                  <tr key={o.offenderIdentityId} onClick={() => nav(`/offenders/${o.offenderIdentityId}`)} className="hover:bg-kadi-blue50 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{o.canonicalName}</div>
                      {o.nameVariants.length > 1 && <div className="text-xs text-ink-muted">aka {o.nameVariants.slice(0, 3).filter((v) => v !== o.canonicalName).join(', ')}</div>}
                    </td>
                    <td className="px-4 py-2.5"><RiskBadge score={o.riskScore} band={o.band} /></td>
                    <td className="px-4 py-2.5 text-center font-num">{o.distinctCases}</td>
                    <td className="px-4 py-2.5 text-center font-num">
                      {o.distinctDistricts > 1
                        ? <span className="inline-flex items-center gap-1 text-kadi-teal font-medium" title="Operates across district lines"><Share2 size={12} />{o.distinctDistricts}</span>
                        : o.distinctDistricts}
                    </td>
                    <td className="px-4 py-2.5 text-center font-num" title={co ? `Known to offend with ${co} other resolved identities` : 'No co-offenders on record'}>
                      {co || <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center font-num">{o.arrestCount}</td>
                    {/* Recency in plain words. "2026-03-14" makes a supervisor do date
                        arithmetic; "3 months ago" is the answer they were computing. */}
                    <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                      {o.lastSeen ? (
                        <>
                          <span className="font-num">{o.lastSeen}</span>
                          {gap !== null && (
                            <div className={`text-xs ${gap <= 90 ? 'text-danger font-medium' : ''}`}>
                              {gap <= 30 ? 'within a month' : gap <= 90 ? `${Math.round(gap / 30)} months ago` : gap <= 400 ? `${Math.round(gap / 30)} months ago` : `${(gap / 365).toFixed(1)} years ago`}
                            </div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {o.lowConfidence ? <Chip color="amber">{Math.round(o.confidence * 100)}% · review</Chip> : <Chip color="green">{Math.round(o.confidence * 100)}%</Chip>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <Pager page={page} pageSize={pageSize} total={data.total}
          onPage={goPage} onPageSize={(n) => set('pageSize', n === 50 ? '' : String(n))} />
      )}
      {asOf && (
        <p className="text-[11.5px] text-ink-muted">
          “Last active” is measured against the corpus’s latest recorded offence ({asOf}).
        </p>
      )}
    </div>
  );
}
