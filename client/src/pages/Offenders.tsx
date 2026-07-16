import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useOffenders } from '../api/hooks';
import { RiskBadge, Chip, Skeleton, Empty } from '../components/ui';

export default function Offenders() {
  const nav = useNavigate();
  const [band, setBand] = useState('');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useOffenders({ band, search, pageSize: 100 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy">Offender watchlist</h1>
        <p className="text-sm text-ink-muted flex items-center gap-1.5"><ShieldCheck size={14} className="text-kadi-blue" /> Behaviour-based risk only — no caste, religion, or occupation.</p>
      </div>

      <div className="card p-3 flex gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name…" className="input w-56" />
        {['', 'High', 'Medium', 'Low'].map((b) => (
          <button key={b} onClick={() => setBand(b)} className={`chip ${band === b ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink-muted'}`}>{b || 'All'}</button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? <Skeleton rows={10} /> : !data?.items.length ? <Empty title="No offenders" /> : (
          <table className="w-full text-sm min-w-[740px]">
            <thead className="bg-surface-3 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Offender</th>
                <th className="text-left px-4 py-2 font-medium">Risk</th>
                <th className="text-center px-4 py-2 font-medium">Cases</th>
                <th className="text-center px-4 py-2 font-medium">Districts</th>
                <th className="text-center px-4 py-2 font-medium">Arrests</th>
                <th className="text-left px-4 py-2 font-medium">ER confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((o) => (
                <tr key={o.offenderIdentityId} onClick={() => nav(`/offenders/${o.offenderIdentityId}`)} className="hover:bg-kadi-blue50 cursor-pointer">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{o.canonicalName}</div>
                    {o.nameVariants.length > 1 && <div className="text-xs text-ink-muted">aka {o.nameVariants.slice(0, 3).filter((v) => v !== o.canonicalName).join(', ')}</div>}
                  </td>
                  <td className="px-4 py-2.5"><RiskBadge score={o.riskScore} band={o.band} /></td>
                  <td className="px-4 py-2.5 text-center font-num">{o.distinctCases}</td>
                  <td className="px-4 py-2.5 text-center font-num">{o.distinctDistricts}</td>
                  <td className="px-4 py-2.5 text-center font-num">{o.arrestCount}</td>
                  <td className="px-4 py-2.5">
                    {o.lowConfidence ? <Chip color="amber">{Math.round(o.confidence * 100)}% · review</Chip> : <Chip color="green">{Math.round(o.confidence * 100)}%</Chip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
