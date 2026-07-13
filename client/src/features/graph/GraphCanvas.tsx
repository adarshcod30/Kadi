// GraphCanvas — the hero Cytoscape node-link canvas.
// Node shapes by type (case=rounded rect, offender=ellipse), color by cluster, edge
// thickness by strength, edge color by type. Animated fcose layout ("snap-together").
import { useEffect, useRef } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { GraphData, GraphNode, GraphEdge } from '../../lib/types';

cytoscape.use(fcose);

const EDGE_COLOR: Record<string, string> = {
  shared_offender: '#0B3D75',
  co_accused: '#1A6FC4',
  mo_similarity: '#2FA8A0',
  same_location: '#8A94A3',
  same_timewindow: '#B0B8C4',
  shared_section: '#C9D3E0',
  appears_in: '#E8871E',
};
const CLUSTER_PALETTE = ['#1A6FC4', '#2FA8A0', '#E8871E', '#7E57C2', '#26A69A', '#EC407A', '#5C6BC0', '#66BB6A'];

function colorForCluster(id?: string | null) {
  if (!id) return '#94A3B8';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % CLUSTER_PALETTE.length;
  return CLUSTER_PALETTE[h];
}

export function GraphCanvas({ data, onSelectNode, onSelectEdge, reducedMotion }: {
  data: GraphData;
  onSelectNode?: (n: GraphNode) => void;
  onSelectEdge?: (e: GraphEdge) => void;
  reducedMotion?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const elements: ElementDefinition[] = [];
    for (const n of data.nodes) {
      elements.push({
        data: {
          id: n.id, label: n.label, type: n.type,
          cluster: n.clusterId, isCenter: n.isCenter ? 1 : 0,
          band: n.band, risk: n.riskScore,
          bg: n.type === 'offender'
            ? (n.band === 'High' ? '#C0392B' : n.band === 'Medium' ? '#C9820A' : '#5B6B7E')
            : colorForCluster(n.clusterId),
          raw: n,
        },
      });
    }
    for (const e of data.edges) {
      elements.push({
        data: {
          id: e.id, source: e.source, target: e.target, etype: e.edgeType,
          color: EDGE_COLOR[e.edgeType] || '#94A3B8',
          width: 1 + (e.strength || 0.3) * 5, raw: e,
        },
      });
    }

    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        {
          selector: 'node[type="case"]',
          style: {
            shape: 'round-rectangle', 'background-color': 'data(bg)',
            width: 34, height: 24, label: 'data(label)', 'font-size': 7,
            color: '#1C2A3A', 'text-valign': 'bottom', 'text-margin-y': 3,
            'text-max-width': '70px', 'text-wrap': 'ellipsis', 'border-width': 1,
            'border-color': '#FFFFFF', 'text-background-color': '#FFFFFF',
            'text-background-opacity': 0.7, 'text-background-padding': '1px',
          },
        },
        {
          selector: 'node[type="offender"]',
          style: {
            shape: 'ellipse', 'background-color': 'data(bg)', width: 30, height: 30,
            label: 'data(label)', 'font-size': 8, 'font-weight': 600, color: '#12305C',
            'text-valign': 'bottom', 'text-margin-y': 3, 'text-max-width': '90px',
            'text-wrap': 'ellipsis', 'border-width': 2, 'border-color': '#FFFFFF',
          },
        },
        { selector: 'node[isCenter=1]', style: { 'border-width': 3, 'border-color': '#0B3D75', width: 44, height: 30 } },
        {
          selector: 'edge',
          style: {
            width: 'data(width)', 'line-color': 'data(color)', 'curve-style': 'bezier',
            opacity: 0.7, 'target-arrow-shape': 'none',
          },
        },
        { selector: 'edge[etype="appears_in"]', style: { 'line-style': 'dashed', opacity: 0.5 } },
        { selector: ':selected', style: { 'border-width': 3, 'border-color': '#E8871E', 'line-color': '#E8871E', opacity: 1 } },
        { selector: '.faded', style: { opacity: 0.12 } },
      ],
      minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    const runLayout = () => {
      cy.resize();
      const layout = cy.layout({ name: 'fcose', animate: !reducedMotion, animationDuration: 700,
        randomize: true, nodeSeparation: 90, idealEdgeLength: 90, padding: 40 } as any);
      layout.one('layoutstop', () => cy.fit(cy.elements(), 40));
      layout.run();
    };
    // wait until the container has real dimensions before laying out
    let tries = 0;
    const waitAndLayout = () => {
      if (!ref.current) return;
      if (ref.current.clientWidth > 0 && ref.current.clientHeight > 0) runLayout();
      else if (tries++ < 30) requestAnimationFrame(waitAndLayout);
    };
    requestAnimationFrame(waitAndLayout);
    const ro = new ResizeObserver(() => { cy.resize(); });
    if (ref.current) ro.observe(ref.current);

    cy.on('tap', 'node', (evt) => onSelectNode?.(evt.target.data('raw')));
    cy.on('tap', 'edge', (evt) => onSelectEdge?.(evt.target.data('raw')));
    cy.on('mouseover', 'node', (evt) => {
      const n = evt.target;
      cy.elements().addClass('faded');
      n.removeClass('faded'); n.neighborhood().removeClass('faded'); n.connectedEdges().removeClass('faded');
    });
    cy.on('mouseout', 'node', () => cy.elements().removeClass('faded'));

    return () => { ro.disconnect(); cy.destroy(); };
  }, [data]);

  const fit = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 40 } }, { duration: 300 });
  const zoom = (f: number) => cyRef.current?.zoom({ level: (cyRef.current.zoom() || 1) * f, renderedPosition: { x: (ref.current?.clientWidth || 0) / 2, y: (ref.current?.clientHeight || 0) / 2 } });

  return (
    <div className="relative w-full h-full">
      <div ref={ref} className="w-full h-full graph-canvas rounded-card" />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button onClick={() => zoom(1.25)} className="w-8 h-8 card grid place-items-center text-ink-muted hover:text-ink">+</button>
        <button onClick={() => zoom(0.8)} className="w-8 h-8 card grid place-items-center text-ink-muted hover:text-ink">−</button>
        <button onClick={fit} className="w-8 h-8 card grid place-items-center text-ink-muted hover:text-ink" title="Fit">⤢</button>
      </div>
    </div>
  );
}

export { EDGE_COLOR };
