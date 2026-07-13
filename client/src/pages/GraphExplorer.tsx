// GraphExplorer — the hero screen. Ego-network around a case (or full cluster),
// animated assembly, "Why linked" panel, edge-type legend, deep-links.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Map as MapIcon, FileText, Info } from 'lucide-react';
import { useGraphCase, useGraphCluster, useCases } from '../api/hooks';
import { GraphCanvas, EDGE_COLOR } from '../features/graph/GraphCanvas';
import { WhyPanel } from '../features/graph/WhyPanel';
import { Empty, Mono, Chip } from '../components/ui';
import type { GraphNode, GraphEdge } from '../lib/types';

const LEGEND = [
  ['shared_offender', 'Shared offender'], ['co_accused', 'Co-accused'], ['mo_similarity', 'Similar MO'],
  ['same_location', 'Same location'], ['same_timewindow', 'Same time'], ['appears_in', 'Appears in'],
];

export default function GraphExplorer() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const caseId = params.get('case') || undefined;
  const clusterId = params.get('cluster') || undefined;
  const [sel, setSel] = useState<{ node?: GraphNode; edge?: GraphEdge } | null>(null);

  const caseQ = useGraphCase(clusterId ? undefined : caseId);
  const clusterQ = useGraphCluster(clusterId);
  const data = clusterId ? clusterQ.data : caseQ.data;
  const loading = clusterId ? clusterQ.isLoading : caseQ.isLoading;

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => { setSel(null); }, [caseId, clusterId]);

  if (!caseId && !clusterId) return <GraphEntry />;

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold text-kadi-navy">Case-Linkage Graph</h1>
          <p className="text-xs text-ink-muted">{data?.explanation?.summary || 'Assembling the network…'}</p>
        </div>
        <div className="flex gap-2">
          {caseId && <button onClick={() => nav(`/cases/${caseId}`)} className="btn-outline text-sm"><FileText size={14} /> Open case</button>}
          <button onClick={() => nav('/map')} className="btn-outline text-sm"><MapIcon size={14} /> Map</button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[1fr_320px] gap-3 min-h-0">
        <div className="card relative overflow-hidden min-h-0">
          {loading && <div className="absolute inset-0 grid place-items-center text-ink-muted text-sm z-10">Assembling network…</div>}
          {data && <GraphCanvas data={data} reducedMotion={reducedMotion}
            onSelectNode={(n) => setSel({ node: n })} onSelectEdge={(e) => setSel({ edge: e })} />}
          {/* Legend */}
          <div className="absolute top-3 left-3 card px-3 py-2 text-xs space-y-1 bg-white/95">
            <div className="font-medium text-ink-muted mb-1">Edge types</div>
            {LEGEND.map(([k, label]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-4 h-0.5 rounded" style={{ background: EDGE_COLOR[k] }} />{label}
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-auto">
          <WhyPanel node={sel?.node} edge={sel?.edge} onClose={() => setSel(null)} fairness={data?.explanation?.fairness} />
        </div>
      </div>
    </div>
  );
}

function GraphEntry() {
  const nav = useNavigate();
  // suggest cases that have many links (good demo starting points)
  const { data } = useCases({ sort: 'linked_desc', pageSize: 8 });
  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h1 className="text-lg font-semibold text-kadi-navy">Case-Linkage Graph</h1>
      <p className="text-sm text-ink-muted mt-1">Open a case to watch its connected network assemble — related FIRs, shared offenders, serial-crime chains across stations and districts.</p>
      <div className="card mt-4 divide-y divide-line">
        <div className="px-4 py-2 label">Most-connected cases</div>
        {(data?.items || []).map((c) => (
          <button key={c.caseMasterId} onClick={() => nav(`/graph?case=${c.caseMasterId}`)}
            className="w-full text-left px-4 py-3 hover:bg-surface-3 flex items-center justify-between">
            <div>
              <Mono>{c.crimeNo}</Mono>
              <div className="text-sm">{c.crimeSubHead} · <span className="text-ink-muted">{c.unitName}, {c.districtName}</span></div>
            </div>
            <Chip color="blue">{c.linkedCount} links</Chip>
          </button>
        ))}
        {!data && <Empty title="Loading cases…" />}
      </div>
    </div>
  );
}
