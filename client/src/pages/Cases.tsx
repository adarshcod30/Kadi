import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCases, useLookups, useMe } from '../api/hooks';
import { StatusChip, GravityChip, SeverityDot, Skeleton, Empty, Mono, Chip } from '../components/ui';

export default function Cases() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { data: lookups } = useLookups();
  const { data: me } = useMe();
  const q = Object.fromEntries(params.entries());
  const page = Number(q.page || '1');
  const { data, isLoading } = useCases({ ...q, pageSize: 25 });

  // scope-aware district options: non-state roles only see their own district
  const scope = me?.capabilities.scope;
  const districtOptions = scope && scope !== 'state' && me?.user.districtId
    ? (lookups?.districts || []).filter((d) => d.id === String(me.user.districtId))
    : lookups?.districts || [];

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    p.delete('page');
    setParams(p);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Cases</h1>
          <p className="text-sm text-ink-muted">{data ? `${data.total.toLocaleString()} FIRs in your scope` : 'Loading…'} · filter by crime head, district, status or gravity. The <b>Links</b> column shows how many other cases each FIR connects to; open any row for its full detail + network.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input defaultValue={q.search || ''} onKeyDown={(e) => { if (e.key === 'Enter') set('search', (e.target as HTMLInputElement).value); }}
          placeholder="Search CrimeNo / MO…" className="input w-56" />
        <select value={q.head || ''} onChange={(e) => set('head', e.target.value)} className="input">
          <option value="">All crime heads</option>
          {lookups?.heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
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
        <label className="text-sm flex items-center gap-1.5 ml-2">
          <input type="checkbox" checked={q.flagged === 'true'} onChange={(e) => set('flagged', e.target.checked ? 'true' : '')} /> Flagged only
        </label>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? <Skeleton rows={10} /> : !data?.items.length ? <Empty title="No cases found" hint="Try adjusting the filters." /> : (
          <table className="w-full text-sm">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">CrimeNo</th>
                <th className="text-left px-4 py-2 font-medium">Crime</th>
                <th className="text-left px-4 py-2 font-medium">Station / District</th>
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
                  <td className="px-4 py-2.5 font-num text-ink-muted">{c.crimeRegisteredDate}</td>
                  <td className="px-4 py-2.5"><StatusChip status={c.status} /></td>
                  <td className="px-4 py-2.5"><GravityChip gravity={c.gravity} /></td>
                  <td className="px-4 py-2.5 text-center">{c.linkedCount > 0 ? <Chip color="blue">{c.linkedCount}</Chip> : <span className="text-ink-muted">—</span>}</td>
                  <td className="px-4 py-2.5 text-center"><SeverityDot severity={c.healthSeverity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">Page {page} · {data.total.toLocaleString()} total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => set('page', String(page - 1))} className="btn-outline disabled:opacity-40">Prev</button>
            <button disabled={page * data.pageSize >= data.total} onClick={() => set('page', String(page + 1))} className="btn-outline disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
