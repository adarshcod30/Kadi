// GraphExplorer — the hero screen. Interactive ego-network around a case (or full
// cluster): switchable layout, edge-type filters, strength slider, draggable nodes,
// and a "Why linked" evidence panel. Everything animated + explained.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Map as MapIcon, FileText, Info, Sliders, Network, GitBranch } from 'lucide-react';
import { useGraphCase, useGraphCluster, useCases } from '../api/hooks';
import { GraphCanvas, EDGE_COLOR, HEAD_COLOR, GraphFilters } from '../features/graph/GraphCanvas';
import { WhyPanel } from '../features/graph/WhyPanel';
import { Empty, Mono, Chip } from '../components/ui';
import type { GraphNode, GraphEdge } from '../lib/types';

const EDGE_TYPES: [string, string][] = [
  ['shared_offender', 'Shared offender'], ['co_accused', 'Co-accused'], ['mo_similarity', 'Similar MO'],
  ['same_location', 'Same location'], ['same_timewindow', 'Same time window'], ['shared_section', 'Shared section'],
];
const LAYOUTS: [string, string][] = [
  ['fcose', 'Force'], ['concentric', 'Radial'], ['breadthfirst', 'Tree'], ['circle', 'Circle'], ['grid', 'Grid'],
];

export default function GraphExplorer() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const caseId = params.get('case') || undefined;
  const clusterId = params.get('cluster') || undefined;
  const [sel, setSel] = useState<{ node?: GraphNode; edge?: GraphEdge } | null>(null);
  const [edgeTypes, setEdgeTypes] = useState<Set<string>>(new Set(EDGE_TYPES.map((e) => e[0])));
  const [minStrength, setMinStrength] = useState(0.3);
  const [layout, setLayout] = useState('fcose');

  const caseQ = useGraphCase(clusterId ? undefined : caseId);
  const clusterQ = useGraphCluster(clusterId);
  const data = clusterId ? clusterQ.data : caseQ.data;
  const loading = clusterId ? clusterQ.isLoading : caseQ.isLoading;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => { setSel(null); }, [caseId, clusterId]);

  const edgeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data?.edges || []) if (e.edgeType !== 'appears_in') c[e.edgeType] = (c[e.edgeType] || 0) + 1;
    return c;
  }, [data]);
  const headsPresent = useMemo(() => {
    const s = new Set<string>();
    for (const n of data?.nodes || []) if (n.type === 'case' && n.crimeHead) s.add(n.crimeHead);
    return [...s];
  }, [data]);

  const filters: GraphFilters = { edgeTypes, minStrength, layout };
  const toggle = (t: string) => setEdgeTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });

  if (!caseId && !clusterId) return <GraphEntry />;

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-3 gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-kadi-navy flex items-center gap-2"><Network size={18} className="shrink-0" /> Case-Linkage Graph</h1>
          <p className="text-xs text-ink-muted max-w-2xl">{data?.explanation?.summary
            || 'Assembling the network…'} Each node is an FIR or an offender; each line is a proven link. Click a line to see <b>why two cases connect</b>. Drag nodes, switch layout, filter link types.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {caseId && <button onClick={() => nav(`/cases/${caseId}`)} className="btn-outline text-sm"><FileText size={14} /> Case</button>}
          <button onClick={() => nav('/map')} className="btn-outline text-sm"><MapIcon size={14} /> Map</button>
        </div>
      </div>

      {/* Responsive: stacks on small screens, 3-column workbench from xl up */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[210px_1fr_320px] xl:grid-rows-1 gap-3 min-h-0">
        {/* Controls */}
        <div className="card overflow-auto p-3 space-y-4 xl:max-h-none max-h-72">
          <Control title="Layout" icon={<GitBranch size={13} />}>
            <div className="grid grid-cols-2 gap-1">
              {LAYOUTS.map(([k, label]) => (
                <button key={k} onClick={() => setLayout(k)}
                  className={`text-xs px-2 py-1.5 rounded-ctl border transition-colors ${layout === k ? 'bg-kadi-navy text-white border-kadi-navy' : 'border-line text-ink-muted hover:bg-surface-3'}`}>{label}</button>
              ))}
            </div>
          </Control>

          <Control title="Link types" icon={<Sliders size={13} />}>
            <div className="space-y-1">
              {EDGE_TYPES.map(([k, label]) => (
                <label key={k} className={`flex items-center gap-2 text-xs cursor-pointer ${!edgeCounts[k] ? 'opacity-40' : ''}`}>
                  <input type="checkbox" checked={edgeTypes.has(k)} onChange={() => toggle(k)} className="accent-kadi-blue" />
                  <span className="w-4 h-0.5 rounded shrink-0" style={{ background: EDGE_COLOR[k] }} />
                  <span className="flex-1">{label}</span>
                  <span className="text-ink-muted font-num">{edgeCounts[k] || 0}</span>
                </label>
              ))}
            </div>
          </Control>

          <Control title={`Min link strength · ${minStrength.toFixed(2)}`}>
            <input type="range" min={0.3} max={0.95} step={0.05} value={minStrength}
              onChange={(e) => setMinStrength(Number(e.target.value))} className="w-full accent-kadi-blue" />
            <p className="text-[10px] text-ink-muted mt-1">Hide weaker links to focus on the strongest connections.</p>
          </Control>

          {headsPresent.length > 0 && (
            <Control title="Crime type">
              <div className="space-y-1">
                {headsPresent.map((h) => (
                  <div key={h} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: HEAD_COLOR[h] || '#5B6B7E' }} />{h}
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs pt-1 border-t border-line mt-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-danger shrink-0" /> Offender (circle)
                </div>
              </div>
            </Control>
          )}
        </div>

        {/* Canvas */}
        <div className="card relative overflow-hidden min-h-0 h-[60vh] xl:h-auto">
          <AnimatePresence>
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 grid place-items-center text-ink-muted text-sm z-10 bg-surface/60">
                <div className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-kadi-blue border-t-transparent rounded-full animate-spin" /> Assembling network…</div>
              </motion.div>
            )}
          </AnimatePresence>
          {data && <GraphCanvas data={data} filters={filters} reducedMotion={reducedMotion}
            onSelectNode={(n) => setSel({ node: n })} onSelectEdge={(e) => setSel({ edge: e })} />}
        </div>

        {/* Why panel */}
        <div className="card overflow-auto max-h-96 xl:max-h-none">
          <AnimatePresence mode="wait">
            <motion.div key={sel?.edge?.id || sel?.node?.id || 'empty'}
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
              <WhyPanel node={sel?.node} edge={sel?.edge} onClose={() => setSel(null)} fairness={data?.explanation?.fairness} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Control({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5 flex items-center gap-1.5">{icon}{title}</div>
      {children}
    </div>
  );
}

function GraphEntry() {
  const nav = useNavigate();
  const { data } = useCases({ sort: 'linked_desc', pageSize: 8 });
  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h1 className="text-lg font-semibold text-kadi-navy flex items-center gap-2"><Network size={18} /> Case-Linkage Graph</h1>
      <p className="text-sm text-ink-muted mt-1">Open a case to watch its connected network assemble — related FIRs, shared offenders, and serial-crime chains across stations and districts, with a click-through evidence trail on every link.</p>
      <div className="card mt-4 divide-y divide-line">
        <div className="px-4 py-2 label">Most-connected cases (good starting points)</div>
        {(data?.items || []).map((c) => (
          <motion.button key={c.caseMasterId} whileHover={{ x: 3 }} onClick={() => nav(`/graph?case=${c.caseMasterId}`)}
            className="w-full text-left px-4 py-3 hover:bg-surface-3 flex items-center justify-between">
            <div><Mono>{c.crimeNo}</Mono><div className="text-sm">{c.crimeSubHead} · <span className="text-ink-muted">{c.unitName}, {c.districtName}</span></div></div>
            <Chip color="blue">{c.linkedCount} links</Chip>
          </motion.button>
        ))}
        {!data && <Empty title="Loading cases…" />}
      </div>
    </div>
  );
}
