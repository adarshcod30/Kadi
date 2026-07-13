import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGeoPoints, useHotspots, useLookups } from '../api/hooks';
import { Section, Chip } from '../components/ui';

const HEAD_COLOR: Record<string, string> = {
  '1': '#C0392B', '2': '#1A6FC4', '3': '#EC407A', '4': '#2FA8A0',
  '5': '#7E57C2', '6': '#5C6BC0', '7': '#8A94A3', '8': '#26A69A',
};

const STYLE: any = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#EDF1F6' } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.6 } },
  ],
};

export default function MapPage() {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [head, setHead] = useState('');
  const [emergingOnly, setEmergingOnly] = useState(false);
  const { data: points } = useGeoPoints({ head, limit: 5000 });
  const { data: hotspots } = useHotspots();
  const { data: lookups } = useLookups();

  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({ container: ref.current, style: STYLE, center: [77.0, 14.5], zoom: 6.2, attributionControl: false });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !points) return;
    const apply = () => {
      const fc = { type: 'FeatureCollection', features: (points.items || []).map((p: any) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { color: HEAD_COLOR[String(headOf(p.head, lookups))] || '#1A6FC4', caseId: p.caseId, crimeNo: p.crimeNo, sub: p.subHead },
      })) };
      if (m.getSource('pts')) (m.getSource('pts') as any).setData(fc);
      else {
        m.addSource('pts', { type: 'geojson', data: fc as any });
        m.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': 3, 'circle-color': ['get', 'color'], 'circle-opacity': 0.7, 'circle-stroke-width': 0.3, 'circle-stroke-color': '#fff' } });
        m.on('click', 'pts', (e: any) => { const f = e.features[0]; if (f) nav(`/graph?case=${f.properties.caseId}`); });
        m.on('mouseenter', 'pts', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'pts', () => { m.getCanvas().style.cursor = ''; });
      }
    };
    if (m.isStyleLoaded()) apply(); else m.once('load', apply);
  }, [points, lookups]);

  useEffect(() => {
    const m = map.current;
    if (!m || !hotspots) return;
    const list = emergingOnly ? hotspots.hotspots.filter((h) => h.emergingFlag) : hotspots.hotspots;
    const fc = { type: 'FeatureCollection', features: list.map((h) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [h.centroidLng, h.centroidLat] },
      properties: { emerging: h.emergingFlag ? 1 : 0, count: h.recentCount, cell: h.cellId },
    })) };
    const apply = () => {
      if (m.getSource('hs')) (m.getSource('hs') as any).setData(fc);
      else {
        m.addSource('hs', { type: 'geojson', data: fc as any });
        m.addLayer({ id: 'hs', type: 'circle', source: 'hs', paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 5, 8, 70, 26],
          'circle-color': ['case', ['==', ['get', 'emerging'], 1], '#E8871E', '#1A6FC4'],
          'circle-opacity': 0.25, 'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['==', ['get', 'emerging'], 1], '#E8871E', '#1A6FC4'],
        } });
      }
    };
    if (m.isStyleLoaded()) apply(); else m.once('load', apply);
  }, [hotspots, emergingOnly]);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy">Spatiotemporal Map</h1>
          <p className="text-sm text-ink-muted">Incident points + DBSCAN hotspots. Saffron rings = emerging trends. Click a point to open its network.</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={head} onChange={(e) => setHead(e.target.value)} className="input">
            <option value="">All crime heads</option>
            {lookups?.heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={emergingOnly} onChange={(e) => setEmergingOnly(e.target.checked)} /> Emerging only</label>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-3">
        <div className="card overflow-hidden" style={{ height: 'calc(100vh - 12rem)' }}><div ref={ref} className="w-full h-full" /></div>
        <div className="space-y-3">
          <Section title="Emerging hotspots">
            <div className="p-3 space-y-2 max-h-[40vh] overflow-auto">
              {(hotspots?.hotspots || []).filter((h) => h.emergingFlag).map((h) => (
                <div key={h.cellId} className="border border-line rounded-ctl p-2 text-sm">
                  <div className="flex items-center gap-2"><Chip color="saffron">emerging</Chip><span className="font-num">{h.recentCount}/60d</span></div>
                  <div className="text-xs text-ink-muted mt-1">vs ~{h.baselineExpected} expected · {h.centroidLat.toFixed(3)},{h.centroidLng.toFixed(3)}</div>
                </div>
              ))}
              {!(hotspots?.hotspots || []).some((h) => h.emergingFlag) && <div className="text-sm text-ink-muted">None currently.</div>}
            </div>
          </Section>
          <Section title="Legend">
            <div className="p-3 space-y-1 text-xs">
              {lookups?.heads.map((h) => <div key={h.id} className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: HEAD_COLOR[h.id] || '#1A6FC4' }} />{h.name}</div>)}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function headOf(headName: string, lookups: any) {
  if (!lookups) return '';
  const h = lookups.heads.find((x: any) => x.name === headName);
  return h ? h.id : '';
}
