// GraphCanvas — the hero Cytoscape node-link canvas (interactive + customizable).
// Case nodes are coloured by crime head and labelled with the crime type; offender nodes
// are circles coloured by risk band. Edges are filterable by type + strength, the layout
// is switchable, nodes are freely draggable, and hovering isolates a node's neighbourhood.
import { useEffect, useRef } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { GraphData, GraphNode, GraphEdge } from '../../lib/types';

cytoscape.use(fcose);

export const EDGE_COLOR: Record<string, string> = {
  shared_offender: '#0f2f44',
  co_accused: '#1A6FC4',
  mo_similarity: '#2FA8A0',
  same_location: '#8A94A3',
  same_timewindow: '#B7A5D6',
  shared_section: '#C9D3E0',
  appears_in: '#E8871E',
};

export const HEAD_COLOR: Record<string, string> = {
  'Crimes Against Body': '#C0392B',
  'Crimes Against Property': '#1A6FC4',
  'Crimes Against Women': '#D6457F',
  'Cyber Crime': '#2FA8A0',
  'Economic Offences': '#7E57C2',
  NDPS: '#5C6BC0',
  'Missing / UDR': '#8A94A3',
  'Traffic / PAR': '#3AA76D',
};
const headColor = (h?: string) => (h && HEAD_COLOR[h]) || '#5B6B7E';

export interface GraphFilters {
  edgeTypes: Set<string>;
  minStrength: number;
  layout: string;
}

export function GraphCanvas({ data, filters, onSelectNode, onSelectEdge, reducedMotion }: {
  data: GraphData;
  filters: GraphFilters;
  onSelectNode?: (n: GraphNode) => void;
  onSelectEdge?: (e: GraphEdge) => void;
  reducedMotion?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // build graph once per data change
  useEffect(() => {
    if (!ref.current) return;
    const degree: Record<string, number> = {};
    for (const e of data.edges) { degree[e.source] = (degree[e.source] || 0) + 1; degree[e.target] = (degree[e.target] || 0) + 1; }

    const elements: ElementDefinition[] = [];
    for (const n of data.nodes) {
      const deg = degree[n.id] || 1;
      elements.push({
        data: {
          id: n.id, type: n.type, isCenter: n.isCenter ? 1 : 0,
          label: n.type === 'offender' ? n.label : (n.crimeSubHead || n.label),
          sub: n.type === 'case' ? n.district : `${n.cases} cases`,
          bg: n.type === 'offender'
            ? (n.band === 'High' ? '#C0392B' : n.band === 'Medium' ? '#C9820A' : '#3A7' )
            : headColor(n.crimeHead),
          size: n.type === 'offender' ? 30 + Math.min(deg, 8) * 2 : 26 + Math.min(deg, 8) * 3,
          raw: n,
        },
      });
    }
    for (const e of data.edges) {
      elements.push({
        data: {
          id: e.id, source: e.source, target: e.target, etype: e.edgeType,
          color: EDGE_COLOR[e.edgeType] || '#94A3B8', width: 0.8 + (e.strength || 0.3) * 2.2,
          strength: e.strength, raw: e,
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
            width: 'data(size)', height: (ele: any) => ele.data('size') * 0.7,
            label: 'data(label)', 'font-size': 9, 'font-weight': 500, color: '#1C2A3A',
            'text-valign': 'bottom', 'text-margin-y': 4, 'text-max-width': '96px',
            'text-wrap': 'wrap', 'border-width': 2, 'border-color': '#FFFFFF',
            'text-background-color': '#FFFFFF', 'text-background-opacity': 0.82,
            'text-background-shape': 'round-rectangle', 'text-background-padding': '2px',
            'transition-property': 'opacity', 'transition-duration': 180,
          } as any,
        },
        {
          selector: 'node[type="offender"]',
          style: {
            shape: 'ellipse', 'background-color': 'data(bg)', width: 'data(size)', height: 'data(size)',
            label: 'data(label)', 'font-size': 10, 'font-weight': 700, color: '#0a2231',
            'text-valign': 'bottom', 'text-margin-y': 4, 'text-max-width': '110px',
            'text-wrap': 'wrap', 'border-width': 3, 'border-color': '#FFFFFF',
          } as any,
        },
        { selector: 'node[isCenter=1]', style: { 'border-width': 4, 'border-color': '#E8871E' } },
        {
          selector: 'edge',
          style: {
            width: 'data(width)', 'line-color': 'data(color)', 'curve-style': 'bezier',
            opacity: 0.55, 'target-arrow-shape': 'none', 'line-cap': 'round',
            'transition-property': 'opacity, width', 'transition-duration': 180,
          } as any,
        },
        { selector: 'edge[etype="appears_in"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 3], opacity: 0.4, width: 1 } as any },
        { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#E8871E' } },
        { selector: 'edge:selected', style: { 'line-color': '#E8871E', opacity: 1, width: 3 } },
        { selector: 'edge.hl', style: { opacity: 0.95 } },
        { selector: '.dim', style: { opacity: 0.08 } },
        { selector: '.hidden', style: { display: 'none' } },
      ],
      minZoom: 0.15, maxZoom: 3.5, wheelSensitivity: 0.25, boxSelectionEnabled: false,
    });
    cyRef.current = cy;

    cy.on('tap', 'node', (evt) => onSelectNode?.(evt.target.data('raw')));
    cy.on('tap', 'edge', (evt) => onSelectEdge?.(evt.target.data('raw')));
    cy.on('tap', (evt) => { if (evt.target === cy) { cy.$(':selected').unselect(); } });
    cy.on('mouseover', 'node', (evt) => {
      const n = evt.target;
      cy.elements().addClass('dim');
      n.removeClass('dim'); n.neighborhood().removeClass('dim'); n.connectedEdges().removeClass('dim');
      n.connectedEdges().connectedNodes().removeClass('dim');
    });
    cy.on('mouseout', 'node', () => cy.elements().removeClass('dim'));

    return () => cy.destroy();
  }, [data]);

  // apply filters + layout on change (operate on the existing instance)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ref.current) return;
    cy.batch(() => {
      cy.edges().forEach((e) => {
        const t = e.data('etype');
        const strong = (e.data('strength') || 1) >= filters.minStrength || t === 'appears_in';
        const on = (filters.edgeTypes.has(t) || t === 'appears_in') && strong;
        e.toggleClass('hidden', !on);
      });
      cy.nodes().forEach((n) => {
        if (n.data('isCenter') === 1) { n.removeClass('hidden'); return; }
        const visibleEdges = n.connectedEdges().filter((e) => !e.hasClass('hidden'));
        n.toggleClass('hidden', visibleEdges.length === 0);
      });
    });
    const vis = cy.elements(':visible');
    let tries = 0;
    const run = () => {
      if (!ref.current) return;
      if (ref.current.clientWidth > 0 && ref.current.clientHeight > 0) {
        cy.resize();
        const l = vis.layout(layoutOpts(filters.layout, reducedMotion));
        l.one('layoutstop', () => cy.animate({ fit: { eles: vis, padding: 45 } }, { duration: reducedMotion ? 0 : 250 }));
        l.run();
      } else if (tries++ < 30) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
    const ro = new ResizeObserver(() => cy.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.edgeTypes, filters.minStrength, filters.layout, data]);

  const zoom = (f: number) => cyRef.current?.zoom({ level: (cyRef.current.zoom() || 1) * f, renderedPosition: { x: (ref.current?.clientWidth || 0) / 2, y: (ref.current?.clientHeight || 0) / 2 } });
  const fit = () => { const cy = cyRef.current; if (cy) cy.animate({ fit: { eles: cy.elements(':visible'), padding: 45 } }, { duration: 250 }); };

  return (
    <div className="relative w-full h-full">
      <div ref={ref} className="w-full h-full graph-canvas rounded-card" />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button onClick={() => zoom(1.25)} className="w-8 h-8 card grid place-items-center text-ink-muted hover:text-kadi-navy hover:shadow-hover">+</button>
        <button onClick={() => zoom(0.8)} className="w-8 h-8 card grid place-items-center text-ink-muted hover:text-kadi-navy hover:shadow-hover">−</button>
        <button onClick={fit} className="w-8 h-8 card grid place-items-center text-ink-muted hover:text-kadi-navy hover:shadow-hover" title="Fit to view">⤢</button>
      </div>
    </div>
  );
}

function layoutOpts(name: string, reduced?: boolean): any {
  const animate = !reduced;
  switch (name) {
    case 'concentric':
      return { name: 'concentric', animate, animationDuration: 500, minNodeSpacing: 55,
        concentric: (n: any) => (n.data('isCenter') ? 100 : n.degree()), levelWidth: () => 2, padding: 40 };
    case 'circle':
      return { name: 'circle', animate, animationDuration: 500, padding: 40 };
    case 'grid':
      return { name: 'grid', animate, animationDuration: 400, padding: 40 };
    case 'breadthfirst':
      return { name: 'breadthfirst', animate, animationDuration: 500, spacingFactor: 1.3, padding: 40 };
    default:
      return { name: 'fcose', animate, animationDuration: 650, randomize: true,
        nodeSeparation: 110, idealEdgeLength: 95, nodeRepulsion: 8000, padding: 40, quality: 'proof' };
  }
}
