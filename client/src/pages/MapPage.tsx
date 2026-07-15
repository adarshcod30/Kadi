// MapPage — spatiotemporal intelligence. Karnataka district choropleth (crime density),
// switchable point layer, DBSCAN hotspots with pulsing red-zone markers for emerging
// trends, district drill-down, and an all-India context panel. India is drawn with its
// official boundary (datameet composite).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, Flame, MapPin, TrendingUp, X, ArrowRight } from 'lucide-react';
import { useGeoPoints, useHotspots, useLookups, useDistricts, useNational } from '../api/hooks';
import { Section, Chip, KpiCard } from '../components/ui';
import kaDistricts from '../geo/karnataka_districts.json';
import indiaOutline from '../geo/india_outline.json';

const HEAD_COLOR: Record<string, string> = {
  '1': '#C0392B', '2': '#1A6FC4', '3': '#D6457F', '4': '#2FA8A0',
  '5': '#7E57C2', '6': '#5C6BC0', '7': '#8A94A3', '8': '#3AA76D',
};

const STYLE: any = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tileSize: 256, attribution: '© Esri, Maxar',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
    osm: { type: 'raster', tileSize: 256, attribution: '© OpenStreetMap',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0A1929' } },
    { id: 'basemap-sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 } },
    { id: 'basemap-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1, 'raster-saturation': -0.4 } },
  ],
};

export default function MapPage() {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<'density' | 'points'>('density');
  const [basemap, setBasemap] = useState<'sat' | 'streets'>('sat');
  const [head, setHead] = useState('');
  const [selDistrict, setSelDistrict] = useState<any>(null);

  const { data: districts } = useDistricts();
  const { data: national } = useNational();
  const { data: points } = useGeoPoints({ head, limit: 6000 });
  const { data: hotspots } = useHotspots();
  const { data: lookups } = useLookups();

  const countById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of districts?.districts || []) m[d.districtId] = d.total;
    return m;
  }, [districts]);

  // init map once
  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = new maplibregl.Map({ container: ref.current, style: STYLE, center: [76.3, 15.0], zoom: 6.0, attributionControl: false });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('india', { type: 'geojson', data: indiaOutline as any });
      m.addLayer({ id: 'india-line', type: 'line', source: 'india', paint: { 'line-color': '#7FB2FF', 'line-width': 1, 'line-opacity': 0.5 } });
      m.addSource('ka', { type: 'geojson', data: kaDistricts as any });
      m.addLayer({ id: 'ka-fill', type: 'fill', source: 'ka', paint: { 'fill-color': '#4A90D9', 'fill-opacity': 0.55 } });
      m.addLayer({ id: 'ka-line', type: 'line', source: 'ka', paint: { 'line-color': '#FFFFFF', 'line-width': 1, 'line-opacity': 0.7 } });
      m.addLayer({ id: 'ka-outline', type: 'line', source: 'ka', paint: { 'line-color': '#FFD54F', 'line-width': 0 } });
      m.addLayer({ id: 'ka-hover', type: 'line', source: 'ka', paint: { 'line-color': '#E8871E', 'line-width': 3 }, filter: ['==', 'districtId', ''] });
      m.on('mousemove', 'ka-fill', (e: any) => {
        if (e.features[0]) { m.getCanvas().style.cursor = 'pointer'; m.setFilter('ka-hover', ['==', 'districtId', e.features[0].properties.districtId]); }
      });
      m.on('mouseleave', 'ka-fill', () => { m.getCanvas().style.cursor = ''; m.setFilter('ka-hover', ['==', 'districtId', '']); });
      m.on('click', 'ka-fill', (e: any) => {
        const id = e.features[0]?.properties.districtId;
        setSelDistrict((prev: any) => (prev?.districtId === id ? null : { districtId: id }));
      });
      m.fitBounds([[74.0, 11.5], [78.6, 18.5]], { padding: 20, duration: 0 });
      setReady(true);
    });
  }, []);

  // choropleth fill (log-scaled by district case count)
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !districts) return;
    const max = Math.log(districts.maxCount + 1);
    const expr: any = ['interpolate', ['linear'], ['/', ['ln', ['+', ['coalesce', ['get', 'count'], 1], 1]], max],
      0, '#EAF3FB', 0.35, '#9DC3E6', 0.6, '#4A90D9', 0.8, '#1A6FC4', 1, '#0B3D75'];
    // inject counts into features
    const fc = { ...(kaDistricts as any), features: (kaDistricts as any).features.map((f: any) => ({
      ...f, properties: { ...f.properties, count: countById[f.properties.districtId] || 0 } })) };
    (m.getSource('ka') as any)?.setData(fc);
    m.setPaintProperty('ka-fill', 'fill-color', layer === 'density' ? expr : '#4A90D9');
    m.setPaintProperty('ka-fill', 'fill-opacity', layer === 'density' ? 0.62 : 0.08);
  }, [ready, districts, layer, countById]);

  // basemap toggle (satellite <-> streets)
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty('basemap-sat', 'visibility', basemap === 'sat' ? 'visible' : 'none');
    m.setLayoutProperty('basemap-osm', 'visibility', basemap === 'streets' ? 'visible' : 'none');
  }, [ready, basemap]);

  // points layer
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const show = layer === 'points';
    const fc = { type: 'FeatureCollection', features: show ? (points?.items || []).map((p: any) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { color: HEAD_COLOR[headId(p.head, lookups)] || '#1A6FC4', caseId: p.caseId } })) : [] };
    if (m.getSource('pts')) (m.getSource('pts') as any).setData(fc);
    else {
      m.addSource('pts', { type: 'geojson', data: fc as any });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': 3, 'circle-color': ['get', 'color'], 'circle-opacity': 0.85, 'circle-stroke-width': 0.6, 'circle-stroke-color': '#fff' } });
      m.on('click', 'pts', (e: any) => { const f = e.features[0]; if (f) nav(`/graph?case=${f.properties.caseId}`); });
    }
  }, [ready, points, layer, lookups]);

  // emerging hotspots as pulsing markers
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !hotspots) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    hotspots.hotspots.filter((h) => h.emergingFlag).forEach((h) => {
      const el = document.createElement('div');
      el.className = 'hotspot-pulse';
      el.title = `Emerging: ${h.recentCount} in 60d vs ~${h.baselineExpected}`;
      const mk = new maplibregl.Marker({ element: el }).setLngLat([h.centroidLng, h.centroidLat]).addTo(m);
      markers.current.push(mk);
    });
  }, [ready, hotspots]);

  const selData = useMemo(() => districts?.districts.find((d: any) => d.districtId === selDistrict?.districtId), [districts, selDistrict]);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2"><Layers size={18} /> Spatiotemporal Intelligence</h1>
          <p className="text-sm text-ink-muted max-w-2xl">District-level crime density across Karnataka, live incident points, and DBSCAN hotspots. <span className="text-danger font-medium">Pulsing red rings</span> flag emerging trends where recent activity far exceeds the historical baseline. Click a district to drill down.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex rounded-ctl border border-line overflow-hidden text-sm">
            <button onClick={() => setLayer('density')} className={`px-3 py-1.5 flex items-center gap-1 ${layer === 'density' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}><Flame size={14} /> Density</button>
            <button onClick={() => setLayer('points')} className={`px-3 py-1.5 flex items-center gap-1 ${layer === 'points' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}><MapPin size={14} /> Incidents</button>
          </div>
          <div className="flex rounded-ctl border border-line overflow-hidden text-sm">
            <button onClick={() => setBasemap('sat')} className={`px-3 py-1.5 ${basemap === 'sat' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}>Satellite</button>
            <button onClick={() => setBasemap('streets')} className={`px-3 py-1.5 ${basemap === 'streets' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}>Streets</button>
          </div>
          {layer === 'points' && (
            <select value={head} onChange={(e) => setHead(e.target.value)} className="input">
              <option value="">All crime heads</option>
              {lookups?.heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-3">
        <div className="card overflow-hidden relative" style={{ height: 'calc(100vh - 12rem)' }}>
          <div ref={ref} className="w-full h-full" />
          {/* choropleth legend */}
          {layer === 'density' && (
            <div className="absolute bottom-3 left-3 card px-3 py-2 text-xs bg-white/95">
              <div className="font-medium text-ink-muted mb-1">Cases per district</div>
              <div className="h-2 w-40 rounded" style={{ background: 'linear-gradient(90deg,#EAF3FB,#9DC3E6,#4A90D9,#1A6FC4,#0B3D75)' }} />
              <div className="flex justify-between font-num mt-0.5"><span>{districts?.minCount ?? 0}</span><span>{districts?.maxCount?.toLocaleString() ?? ''}</span></div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {/* District drill-down */}
          {selData ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Section title={<span className="flex items-center justify-between w-full">Drill-down</span>}
                action={<button onClick={() => setSelDistrict(null)}><X size={14} className="text-ink-muted" /></button>}>
                <div className="p-3 space-y-2">
                  <div className="font-semibold text-kadi-navy">{selData.district}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Mini label="Cases" value={selData.total.toLocaleString()} />
                    <Mini label="Open" value={selData.open.toLocaleString()} />
                    <Mini label="Flagged" value={selData.flaggedHigh.toLocaleString()} accent="#C9820A" />
                  </div>
                  <div className="label pt-1">Top crime heads</div>
                  {selData.topHeads.map((h: any) => (
                    <div key={h.name} className="flex justify-between text-xs"><span>{h.name}</span><span className="font-num text-ink-muted">{h.count.toLocaleString()}</span></div>
                  ))}
                  <div className="label pt-1">Busiest stations</div>
                  {selData.topStations.slice(0, 4).map((s: any) => (
                    <div key={s.unitId} className="flex justify-between text-xs"><span className="truncate">{s.name}</span><span className="font-num text-ink-muted">{s.count}</span></div>
                  ))}
                  <button onClick={() => nav(`/cases?district=${selData.districtId}`)} className="btn-outline text-sm w-full mt-2">Open cases <ArrowRight size={14} /></button>
                </div>
              </Section>
            </motion.div>
          ) : (
            <Section title="Districts by volume">
              <div className="p-2 max-h-[280px] overflow-auto">
                {(districts?.districts || []).slice(0, 12).map((d: any, i: number) => (
                  <button key={d.districtId} onClick={() => setSelDistrict({ districtId: d.districtId })}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-3 text-sm">
                    <span className="w-5 text-ink-muted font-num text-xs">{i + 1}</span>
                    <span className="flex-1 text-left truncate">{d.district}</span>
                    <div className="w-16 h-1.5 bg-surface-3 rounded overflow-hidden"><div className="h-full bg-kadi-blue" style={{ width: `${(d.total / (districts.maxCount || 1)) * 100}%` }} /></div>
                    <span className="font-num text-xs w-12 text-right">{d.total.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title={<span className="flex items-center gap-2"><Flame size={14} className="text-danger" /> Emerging hotspots</span>}>
            <div className="p-3 space-y-2 max-h-[24vh] overflow-auto">
              {(hotspots?.hotspots || []).filter((h) => h.emergingFlag).map((h) => (
                <div key={h.cellId} className="border border-line rounded-ctl p-2 text-sm">
                  <div className="flex items-center gap-2"><Chip color="red">emerging</Chip><span className="font-num">{h.recentCount} in 60d</span></div>
                  <div className="text-xs text-ink-muted mt-1">vs ~{h.baselineExpected} expected · {h.centroidLat.toFixed(3)},{h.centroidLng.toFixed(3)}</div>
                </div>
              ))}
              {!(hotspots?.hotspots || []).some((h) => h.emergingFlag) && <div className="text-sm text-ink-muted">None currently.</div>}
            </div>
          </Section>

          {national && (
            <Section title={<span className="flex items-center gap-2"><TrendingUp size={14} /> India context</span>}>
              <div className="p-3 text-sm">
                <p className="text-xs text-ink-muted mb-2">Karnataka ranks <b className="text-kadi-navy">#{national.focusRank}</b> of {national.states.length} states by crime volume ({national.focusRatePerLakh}/lakh).</p>
                {national.states.slice(0, 6).map((s: any) => (
                  <div key={s.state} className={`flex items-center gap-2 text-xs py-0.5 ${s.isFocus ? 'font-semibold text-kadi-navy' : ''}`}>
                    <span className="w-4 text-ink-muted">{s.rank}</span>
                    <span className="flex-1 truncate">{s.state}{s.isFocus ? ' ★' : ''}</span>
                    <span className="font-num">{s.crimesThousands}k</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="bg-surface-2 rounded-ctl py-1.5"><div className="text-[10px] text-ink-muted uppercase">{label}</div><div className="font-num font-semibold" style={accent ? { color: accent } : undefined}>{value}</div></div>;
}
function headId(headName: string, lookups: any) {
  if (!lookups) return '';
  const h = lookups.heads.find((x: any) => x.name === headName);
  return h ? h.id : '';
}
