// GraphExplorer — the hero screen. Interactive ego-network around a case (or full
// cluster): switchable layout, edge-type filters, strength slider, draggable nodes,
// and a "Why linked" evidence panel. Everything animated + explained.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Map as MapIcon, FileText, Info, Sliders, Network, GitBranch, Sparkles, MessageSquare, ChevronDown, ChevronUp, ArrowLeft, Maximize2, Minimize2 } from 'lucide-react';
import { useGraphCase, useGraphCluster, useFeaturedNetworks } from '../api/hooks';
import { GraphCanvas, EDGE_COLOR, HEAD_COLOR, GraphFilters } from '../features/graph/GraphCanvas';
import { WhyPanel } from '../features/graph/WhyPanel';
import { Empty, Mono, Chip } from '../components/ui';
import type { GraphNode, GraphEdge } from '../lib/types';
import { Select } from '../components/Select';
import { FairnessInfo, InfoDot } from '../components/InfoDot';

// The permanent symbol key. The canvas was legible only to whoever built it — a square, a
// circle and three kinds of line with nothing saying what they mean. This sits in the controls
// column so the reader can decode the graph without guessing.
function GraphLegend() {
  return (
    <div className="space-y-2 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="w-3.5 h-3.5 rounded-[3px] bg-kadi-blue shrink-0" />
        <span className="text-ink">FIR / case <span className="text-ink-muted">— coloured by crime type</span></span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-3.5 h-3.5 rounded-full bg-danger shrink-0" />
        <span className="text-ink">Offender <span className="text-ink-muted">— size = cases</span></span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-4 h-[3px] rounded bg-kadi-navy shrink-0" />
        <span className="text-ink">Confirmed link <span className="text-ink-muted">— shared evidence</span></span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-4 border-t-2 border-dashed border-saffron shrink-0" />
        <span className="text-ink">Offender membership <span className="text-ink-muted">— appears in</span></span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-3.5 h-3.5 rounded-[3px] border-2 border-dashed border-warning shrink-0" />
        <span className="text-ink">Outside your district <span className="text-ink-muted">— reaches in</span></span>
      </div>
    </div>
  );
}

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
  const [minEvidence, setMinEvidence] = useState(1);
  const [layout, setLayout] = useState('fcose');
  const [maximized, setMaximized] = useState(false);

  // Escape leaves full-screen — the standard exit, so the control is not the only way out.
  useEffect(() => {
    if (!maximized) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized]);

  const caseQ = useGraphCase(clusterId ? undefined : caseId);
  const clusterQ = useGraphCluster(clusterId);
  const data = clusterId ? clusterQ.data : caseQ.data;
  const loading = clusterId ? clusterQ.isLoading : caseQ.isLoading;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => { setSel(null); }, [caseId, clusterId]);

  // Count every signal an edge carries, not just its primary type. The pipeline only ever
  // sets edgeType to shared_offender or mo_similarity; the other four signals ride along in
  // allTypes as enrichments, so counting edgeType alone showed a permanent 0 for them.
  const edgeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data?.edges || []) {
      if (e.edgeType === 'appears_in') continue;
      const types = new Set<string>([e.edgeType, ...(e.allTypes || [])]);
      for (const t of types) c[t] = (c[t] || 0) + 1;
    }
    return c;
  }, [data]);
  const headsPresent = useMemo(() => {
    const s = new Set<string>();
    for (const n of data?.nodes || []) if (n.type === 'case' && n.crimeHead) s.add(n.crimeHead);
    return [...s];
  }, [data]);

  const filters: GraphFilters = { edgeTypes, minEvidence, layout };
  const toggle = (t: string) => setEdgeTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });

  if (!caseId && !clusterId) return <GraphEntry />;

  return (
    // NOT a fixed page height any more -- that forced the 3-column workbench to shrink and
    // fight the Intelligence panel for room inside one screen's worth of space. The
    // workbench below keeps its own original height instead, and the page scrolls (the
    // Shell's <main> is already overflow-auto) to reveal Intelligence underneath it.
    <div className="flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-3 gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-kadi-navy flex items-center gap-2"><Network size={18} className="shrink-0" /> Case-Linkage Graph</h1>
          <p className="text-xs text-ink-muted max-w-2xl">{data?.explanation?.summary
            || 'Assembling the network…'} Each node is an FIR or an offender; each line is a proven link. Click a line to see <b>why two cases connect</b>. Drag nodes, switch layout, filter link types.</p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          {/* A real Back. There was none — only a case switcher and two forward links — so a
              viewer who arrived here from an alert or a drill had no in-app way out and had to
              reach for the browser chrome. nav(-1) returns to wherever they came from, and
              falls back to Home when the graph was opened directly with no history behind it. */}
          <button onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}
            className="btn-outline text-sm" title="Back"><ArrowLeft size={14} /> Back</button>
          <CaseSwitcher current={caseId} />
          {caseId && <button onClick={() => nav(`/cases/${caseId}`)} className="btn-outline text-sm"><FileText size={14} /> Case</button>}
          <button onClick={() => {
            // Fly straight to and pin the case actually open here, not the state-wide view --
            // the center node carries its own coordinates for exactly this.
            const center = (data?.nodes || []).find((n: any) => n.type === 'case' && n.isCenter);
            nav(center?.latitude != null
              ? `/map?lat=${center.latitude}&lng=${center.longitude}&crimeNo=${encodeURIComponent(center.label)}`
              : '/map');
          }} className="btn-outline text-sm"><MapIcon size={14} /> Map</button>
        </div>
      </div>

      {/* What this tab is actually for. Without it the graph reads as a pretty diagram
          rather than the thing that replaces "independent silos" in the problem statement. */}
      <div className="mb-3 rounded-card border border-line bg-kadi-blue50/60 px-4 py-2.5 text-[12.5px] text-kadi-navy700">
        <b>What this is:</b> every FIR in Karnataka, joined to every other FIR it shares real
        evidence with — the same resolved offender, a co-accused, a near-identical modus
        operandi, the same place and time window, or the same act &amp; section.
        <b> Why it matters:</b> a station sees only its own register, so a serial offender working
        across districts is invisible. Here the connection is one hop away, and every line is
        clickable evidence rather than a hunch. Use the switcher above to move between cases.
      </div>

      {/* Responsive: stacks on small screens, 3-column workbench from xl up. Fixed height at
          90% of the viewport-minus-chrome figure (trimmed down from the full 100% -- the
          canvas read as too tall) -- the canvas does not shrink to make room for Intelligence
          below it; the PAGE scrolls instead (Shell's <main> is already overflow-auto). */}
      <div className="h-[calc((100vh-8.5rem)*0.9)] grid grid-cols-1 xl:grid-cols-[210px_1fr_320px] xl:grid-rows-1 gap-3 min-h-0">
        {/* Controls. The legend used to head this column; it moved to the foot of the Why panel
            on the right — a key is something you consult while reading the canvas, so it belongs
            beside the evidence you are reading, not above the controls you set once. */}
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
                  <span className="w-4 h-[3px] rounded shrink-0" style={{ background: EDGE_COLOR[k] }} />
                  <span className="flex-1">{label}</span>
                  <span className="text-ink-muted font-num">{edgeCounts[k] || 0}</span>
                </label>
              ))}
            </div>
          </Control>

          {/* The long explanation moved into the (i) on the title, as asked, so the control is a
              control and not a paragraph. The scale now names its stops: 1st / 2nd / 3rd. */}
          <Control title={<span className="flex items-center gap-1.5">Corroborating evidence
            <InfoDot>
              <b className="block mb-1 text-kadi-navy">How many independent kinds of evidence back each link</b>
              Two cases sharing an offender <em>and</em> a modus operandi is a stronger claim than
              either alone. Raw match scores cannot separate these — 86% of edges score exactly
              1.0 — so this filters on corroboration instead. Across the state 3,860 links carry
              two kinds or more; those are the ones that survive a defence lawyer.
              <span className="block mt-1.5 text-ink-muted">Max is 3: no edge carries four
              independent kinds once a shared section between same-sub-head cases stops counting.</span>
            </InfoDot></span>}>
            <input type="range" min={1} max={3} step={1} value={minEvidence}
              onChange={(e) => setMinEvidence(Number(e.target.value))}
              aria-label="Minimum corroborating kinds"
              className="w-full accent-kadi-blue" />
            <div className="flex justify-between text-[10.5px] text-ink-muted mt-0.5 px-0.5 font-medium">
              {['1st', '2nd', '3rd'].map((lab, i) => (
                <button key={lab} onClick={() => setMinEvidence(i + 1)}
                  className={minEvidence === i + 1 ? 'text-kadi-blue' : 'hover:text-ink'}>{lab}</button>
              ))}
            </div>
            <p className="text-[11px] text-ink-muted mt-1">
              Showing links with <b className="text-ink">{minEvidence}+</b> independent kind{minEvidence > 1 ? 's' : ''}.
            </p>
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

        {/* Canvas. Maximise lifts it out of the workbench grid to a full-screen overlay so the
            network gets the whole viewport — the "big view" the brief asked for — with the
            controls floating over it and Escape or the control to exit. */}
        <div className={maximized
          ? 'fixed inset-0 z-[9500] bg-surface p-3 flex flex-col'
          : 'card relative overflow-hidden min-h-0 h-[60vh] xl:h-auto'}>
          <div className="absolute top-2 right-2 z-20">
            <button onClick={() => setMaximized((m) => !m)}
              className="btn-outline text-xs bg-surface/90" title={maximized ? 'Exit full screen (Esc)' : 'Full screen'}>
              {maximized ? <><Minimize2 size={13} /> Exit</> : <><Maximize2 size={13} /> Full screen</>}
            </button>
          </div>
          <div className={maximized ? 'relative flex-1 min-h-0 rounded-card border border-line overflow-hidden' : 'contents'}>
            <AnimatePresence>
              {loading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 grid place-items-center text-ink-muted text-sm z-10 bg-surface/60">
                  <div className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-kadi-blue border-t-transparent rounded-full animate-spin" /> Assembling network…</div>
                </motion.div>
              )}
            </AnimatePresence>
            {data && <GraphCanvas key={maximized ? 'max' : 'inline'} data={data} filters={filters} reducedMotion={reducedMotion}
              onSelectNode={(n) => setSel({ node: n })} onSelectEdge={(e) => setSel({ edge: e })} />}
          </div>
          {maximized && (
            <div className="absolute bottom-3 left-3 card px-3 py-2 shadow-lg max-w-[260px]">
              <div className="text-[11px] font-semibold text-kadi-navy mb-1.5">Legend</div>
              <GraphLegend />
            </div>
          )}
        </div>

        {/* Why panel, with the legend at its foot. The panel scrolls as one column, so the key
            sits under whatever evidence is open and stays reachable without leaving the canvas. */}
        <div className="card overflow-auto max-h-96 xl:max-h-none flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div key={sel?.edge?.id || sel?.node?.id || 'empty'}
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
              <WhyPanel node={sel?.node} edge={sel?.edge} onClose={() => setSel(null)} fairness={data?.explanation?.fairness} />
            </motion.div>
          </AnimatePresence>
          <div className="mt-auto border-t border-line p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Info size={13} className="text-ink-muted" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Legend</span>
            </div>
            <GraphLegend />
          </div>
        </div>
      </div>

      <div className="mt-3">
        <GraphIntelligence data={data} />
      </div>
    </div>
  );
}

// Quick, AI-grounded read of the currently open network -- not a replacement for reading
// the graph, a way in: what is this network telling me, and who is worth a closer look.
// "Ask the Assistant" hands the same case off to a full conversation rather than trying to
// cram every possible follow-up into this panel.
function GraphIntelligence({ data }: { data: any }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(true);
  if (!data) return null;

  const caseNodes = (data.nodes || []).filter((n: any) => n.type === 'case');
  const offNodes = (data.nodes || []).filter((n: any) => n.type === 'offender');
  const highRisk = offNodes.filter((o: any) => o.band === 'High');
  const districts = new Set(caseNodes.map((n: any) => n.district).filter(Boolean));
  const center = caseNodes.find((n: any) => n.isCenter);

  const askAssistant = () => {
    const qtext = center
      ? `Tell me more about case ${center.label} and the network around it.`
      : 'Tell me more about the case I was just looking at.';
    nav(`/assistant?q=${encodeURIComponent(qtext)}`);
  };

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-3 transition-colors">
        <span className="flex items-center gap-2 font-medium text-sm text-kadi-navy">
          <Sparkles size={16} className="text-kadi-blue" /> Intelligence
        </span>
        {open ? <ChevronUp size={16} className="text-ink-muted" /> : <ChevronDown size={16} className="text-ink-muted" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
          {data.insight ? (
            <p className="text-[13px] text-ink leading-relaxed">{data.insight}</p>
          ) : (
            <p className="text-[13px] text-ink-muted">Reading the network…</p>
          )}

          <div className="flex flex-wrap gap-2">
            <StatPill label="Linked cases" value={Math.max(0, caseNodes.length - 1)} />
            <StatPill label="Districts spanned" value={districts.size} />
            <StatPill label="Offenders in network" value={offNodes.length} />
            {highRisk.length > 0 && (
              <StatPill label="High-risk offenders" value={highRisk.length} tone="danger" />
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11.5px] text-ink-subtle flex items-center gap-1">
              Grounded in this network&rsquo;s own evidence <FairnessInfo />
            </span>
            <button onClick={askAssistant}
              className="btn-outline text-[12.5px] shrink-0 whitespace-nowrap">
              <MessageSquare size={13} /> Ask the Assistant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className={`rounded-ctl border px-2.5 py-1.5 text-center min-w-[86px] ${
      tone === 'danger' ? 'border-danger/30 bg-danger/5' : 'border-line bg-surface-2'}`}>
      <div className={`font-num text-base font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{value}</div>
      <div className="text-[10.5px] text-ink-muted leading-tight">{label}</div>
    </div>
  );
}

function Control({ title, icon, children }: { title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5 flex items-center gap-1.5">{icon}{title}</div>
      {children}
    </div>
  );
}

// Lets an investigator move between networks without going back to the Cases list.
// Previously the tab opened one case and offered no way to reach another.
function CaseSwitcher({ current }: { current?: string }) {
  const nav = useNavigate();
  // Was sort:'linked_desc'. Raw link count ranks by how templated a crime's paperwork is,
  // not by how informative its network is -- three sub-heads filled the entire top 200 and
  // every option in this list read "Identity Theft / Phishing". /graph/featured round-robins
  // across crime head and evidence mix, so the list offers genuinely different networks.
  const { data } = useFeaturedNetworks();
  const items = data?.items || [];
  if (!items.length) return null;
  return (
    <Select
      value={current || ''}
      onChange={(v) => nav(`/graph?case=${v}`)}
      className="max-w-[240px]"
      title="Switch to another case network"
      options={[
        ...(!items.some((c: any) => String(c.caseMasterId) === String(current)) && current
          ? [{ value: String(current), label: 'Current case' }] : []),
        ...items.map((c: any) => ({
          value: String(c.caseMasterId),
          label: `${c.crimeNo} · ${c.crimeSubHead} · ${c.links} links · ${c.districtName}`,
        })),
      ]} />
  );
}

function GraphEntry() {
  const nav = useNavigate();
  const { data: featured } = useFeaturedNetworks();

  // Open a network that actually demonstrates linkage. Sorting by raw link count lands on
  // a pure modus-operandi cluster - fourteen identical nodes, every filter reading zero -
  // which looks broken. /graph/featured returns cases with several shared-offender links
  // and more than one kind of evidence. Falls back to most-linked if none qualify.
  useEffect(() => {
    const pick = featured?.items?.[0];
    if (pick) nav(`/graph?case=${pick.caseMasterId}`, { replace: true });
  }, [featured, nav]);

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h1 className="text-lg font-semibold text-kadi-navy flex items-center gap-2"><Network size={18} /> Case-Linkage Graph</h1>
      <p className="text-sm text-ink-muted mt-1">Opening the most-connected case — related FIRs, shared offenders, and serial-crime chains across stations and districts, with a click-through evidence trail on every link.</p>
      <div className="card mt-4 divide-y divide-line">
        <div className="px-4 py-2 label">Networks worth opening — varied by crime type and evidence</div>
        {(featured?.items || []).map((c: any) => (
          <motion.button key={c.caseMasterId} whileHover={{ x: 3 }} onClick={() => nav(`/graph?case=${c.caseMasterId}`)}
            className="w-full text-left px-4 py-3 hover:bg-surface-3 flex items-center justify-between">
            <div>
              <Mono>{c.crimeNo}</Mono>
              <div className="text-sm">{c.crimeSubHead} · <span className="text-ink-muted">{c.districtName}</span></div>
              {/* The evidence mix is the reason this network is worth opening, so name it. */}
              <div className="text-[11.5px] text-ink-subtle mt-0.5">
                {(c.signalTypes || []).map((t: string) => t.replace(/_/g, ' ')).join(' · ')}
              </div>
            </div>
            <Chip color="blue">{c.links} links</Chip>
          </motion.button>
        ))}
        {!featured && <Empty title="Loading networks…" />}
      </div>
    </div>
  );
}
