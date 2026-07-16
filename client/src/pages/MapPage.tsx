// MapPage — spatiotemporal intelligence.
// Three layers over a satellite/streets basemap: district crime-density choropleth, a
// true crime heatmap, and individual incident points — all filterable by crime head and
// time-of-day. Karnataka districts are outlined + labelled, emerging trends pulse as red
// zones, and clicking a district flies in and drills down. India is drawn with its
// official boundary (datameet composite).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, Flame, MapPin, TrendingUp, X, ArrowRight, Clock, Grid3x3 } from 'lucide-react';
import { useGeoPoints, useHotspots, useLookups, useDistricts, useNational } from '../api/hooks';
import { Section, Chip } from '../components/ui';
import { Hint } from '../components/viz';
import kaDistricts from '../geo/karnataka_districts.json';
import indiaOutline from '../geo/india_outline.json';

// bright, satellite-legible palette
const HEAD_COLOR: Record<string, string> = {
  '1': '#FF5A4E', '2': '#4DA3FF', '3': '#FF6FA5', '4': '#2FD9C8',
  '5': '#A98BFF', '6': '#7C8CFF', '7': '#C8D2E0', '8': '#4BD68A',
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
    { id: 'bg', type: 'background', paint: { 'background-color': '#08131f' } },
    { id: 'basemap-sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 } },
    { id: 'basemap-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.5 } },
  ],
};

const KA_BOUNDS: [[number, number], [number, number]] = [[73.9, 11.4], [78.7, 18.6]];
type LayerMode = 'density' | 'heat' | 'points';

export default function MapPage() {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<LayerMode>('density');
  const [basemap, setBasemap] = useState<'sat' | 'streets'>('sat');
  const [head, setHead] = useState('');
  const [hours, setHours] = useState<[number, number]>([0, 23]);
  const [selDistrict, setSelDistrict] = useState<string | null>(null);

  const { data: districts } = useDistricts();
  const { data: national } = useNational();
  const { data: points } = useGeoPoints({ head, limit: 9000 });
  const { data: hotspots } = useHotspots();
  const { data: lookups } = useLookups();

  const countById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of districts?.districts || []) m[d.districtId] = d.total;
    return m;
  }, [districts]);

  const filteredPoints = useMemo(() => {
    const items = points?.items || [];
    if (hours[0] === 0 && hours[1] === 23) return items;
    return items.filter((p: any) => p.hour == null || (p.hour >= hours[0] && p.hour <= hours[1]));
  }, [points, hours]);

  // ---- init ----
  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = new maplibregl.Map({ container: ref.current, style: STYLE, center: [76.3, 15.0], zoom: 6, attributionControl: false });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', (e: any) => console.warn('[map]', e?.error?.message || e));
    m.on('load', () => {
      try {
      m.addSource('india', { type: 'geojson', data: indiaOutline as any });
      m.addLayer({ id: 'india-line', type: 'line', source: 'india', paint: { 'line-color': '#8FC0FF', 'line-width': 1, 'line-opacity': 0.45 } });

      m.addSource('ka', { type: 'geojson', data: kaDistricts as any });
      m.addLayer({ id: 'ka-fill', type: 'fill', source: 'ka', paint: { 'fill-color': '#4A90D9', 'fill-opacity': 0.55 } });
      m.addLayer({ id: 'ka-line', type: 'line', source: 'ka', paint: { 'line-color': '#FFFFFF', 'line-width': 0.9, 'line-opacity': 0.75 } });
      m.addLayer({ id: 'ka-hover', type: 'line', source: 'ka', paint: { 'line-color': '#FFD54F', 'line-width': 2.5 }, filter: ['==', ['get', 'districtId'], ''] });
      m.addLayer({ id: 'ka-sel', type: 'line', source: 'ka', paint: { 'line-color': '#E8871E', 'line-width': 3 }, filter: ['==', ['get', 'districtId'], ''] });

      m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      m.addLayer({
        id: 'heat', type: 'heatmap', source: 'pts', layout: { visibility: 'none' },
        paint: {
          // Tuned so density gradates instead of saturating: with ~9k points at state
          // zoom a high weight/intensity turns the whole state solid red.
          // Tight radius + low per-point weight so sparse rural areas stay transparent
          // and only genuinely dense areas (cities) climb the ramp to red. A large radius
          // blurs every district into the same uniform wash.
          'heatmap-weight': 0.9,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 9, 1.4, 13, 2.4],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 9, 14, 13, 28],
          'heatmap-opacity': 0.9,
          // Ramp compressed to the density range these point volumes actually produce,
          // so towns read teal/yellow and city cores burn orange/red instead of the whole
          // state sitting in the flat blue floor of a 0..1 ramp.
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.02, 'rgba(43,108,176,0.55)', 0.08, '#38b2ac',
            0.16, '#ecc94b', 0.26, '#ed8936', 0.4, '#c53030'],
        } as any,
      });
      m.addLayer({
        id: 'pts', type: 'circle', source: 'pts', layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 10, 4.5], 'circle-color': ['get', 'color'],
          'circle-opacity': 0.85, 'circle-stroke-width': 0.5, 'circle-stroke-color': '#fff' } as any,
      });

      m.on('mousemove', 'ka-fill', (e: any) => {
        if (e.features[0]) { m.getCanvas().style.cursor = 'pointer'; m.setFilter('ka-hover', ['==', ['get', 'districtId'], e.features[0].properties.districtId]); }
      });
      m.on('mouseleave', 'ka-fill', () => { m.getCanvas().style.cursor = ''; m.setFilter('ka-hover', ['==', ['get', 'districtId'], '']); });
      m.on('click', 'ka-fill', (e: any) => {
        const id = e.features[0]?.properties.districtId;
        if (id) setSelDistrict((prev) => (prev === id ? null : id));
      });
      m.on('click', 'pts', (e: any) => { const f = e.features?.[0]; if (f) nav(`/graph?case=${f.properties.caseId}`); });
      m.on('mouseenter', 'pts', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'pts', () => { m.getCanvas().style.cursor = ''; });

      m.fitBounds(KA_BOUNDS, { padding: 24, duration: 0 });
      setReady(true);
      } catch (err) {
        console.warn('[map] layer setup failed', err);
      }
    });

    // Tear the map down on unmount — without this, navigating away (or an HMR update)
    // leaves orphaned WebGL map instances attached to detached DOM nodes.
    return () => {
      try {
        markers.current.forEach((mk) => mk.remove());
        markers.current = [];
        m.remove();
      } catch { /* already torn down */ }
      map.current = null;
      setReady(false);
    };
  }, []);

  // ---- choropleth ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !districts || !m.getLayer('ka-fill')) return;
    const max = Math.log(districts.maxCount + 1);
    const expr: any = ['interpolate', ['linear'], ['/', ['ln', ['+', ['coalesce', ['get', 'count'], 1], 1]], max],
      0, '#dbeafe', 0.35, '#93c5fd', 0.6, '#3b82f6', 0.8, '#1d4ed8', 1, '#0B3D75'];
    const fc = { ...(kaDistricts as any), features: (kaDistricts as any).features.map((f: any) => ({
      ...f, properties: { ...f.properties, count: countById[f.properties.districtId] || 0 } })) };
    (m.getSource('ka') as any)?.setData(fc);
    m.setPaintProperty('ka-fill', 'fill-color', layer === 'density' ? expr : '#4A90D9');
    m.setPaintProperty('ka-fill', 'fill-opacity', layer === 'density' ? 0.66 : 0.06);

  }, [ready, districts, layer, countById]);

  // ---- point/heat data ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('pts') as any)?.setData({
      type: 'FeatureCollection',
      features: filteredPoints.map((p: any) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { color: HEAD_COLOR[String(p.headId)] || '#4DA3FF', caseId: p.caseId },
      })),
    });
  }, [ready, filteredPoints]);

  // ---- layer + basemap visibility ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer('heat')) return;
    m.setLayoutProperty('heat', 'visibility', layer === 'heat' ? 'visible' : 'none');
    m.setLayoutProperty('pts', 'visibility', layer === 'points' ? 'visible' : 'none');
  }, [ready, layer]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer('basemap-sat')) return;
    m.setLayoutProperty('basemap-sat', 'visibility', basemap === 'sat' ? 'visible' : 'none');
    m.setLayoutProperty('basemap-osm', 'visibility', basemap === 'streets' ? 'visible' : 'none');
  }, [ready, basemap]);

  // ---- pulsing emerging hotspots ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !hotspots) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    hotspots.hotspots.filter((h) => h.emergingFlag).forEach((h) => {
      const el = document.createElement('div');
      el.className = 'hotspot-pulse';
      el.title = `Emerging: ${h.recentCount} in 60d vs ~${h.baselineExpected} expected`;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([h.centroidLng, h.centroidLat]).addTo(m));
    });
  }, [ready, hotspots]);

  // ---- drill-down highlight + fly ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer('ka-sel')) return;
    m.setFilter('ka-sel', ['==', ['get', 'districtId'], selDistrict || '']);
    if (!selDistrict || !districts) return;
    const d = districts.districts.find((x: any) => x.districtId === selDistrict);
    if (d) m.flyTo({ center: [d.centroidLng, d.centroidLat], zoom: 8.4, duration: 900 });
  }, [ready, selDistrict, districts]);

  const selData = useMemo(() => districts?.districts.find((d: any) => d.districtId === selDistrict), [districts, selDistrict]);
  const resetView = () => { setSelDistrict(null); map.current?.fitBounds(KA_BOUNDS, { padding: 24, duration: 700 }); };

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2"><Layers size={18} /> Spatiotemporal Intelligence</h1>
          <p className="text-sm text-ink-muted max-w-3xl">Crime density per district, a live heatmap, and individual incidents — over satellite imagery. Filter by crime type and <b>time of day</b> to find patrol windows. <span className="text-danger font-medium">Pulsing red zones</span> mark emerging trends. Click any district to drill in.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex rounded-ctl border border-line overflow-hidden text-sm bg-surface">
            {([['density', 'Density', <Grid3x3 size={14} key="a" />], ['heat', 'Heatmap', <Flame size={14} key="b" />], ['points', 'Incidents', <MapPin size={14} key="c" />]] as [LayerMode, string, any][]).map(([k, label, ic]) => (
              <button key={k} onClick={() => setLayer(k)}
                className={`px-3 py-1.5 flex items-center gap-1 ${layer === k ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}>{ic} {label}</button>
            ))}
          </div>
          <div className="flex rounded-ctl border border-line overflow-hidden text-sm bg-surface">
            <button onClick={() => setBasemap('sat')} className={`px-3 py-1.5 ${basemap === 'sat' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}>Satellite</button>
            <button onClick={() => setBasemap('streets')} className={`px-3 py-1.5 ${basemap === 'streets' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}>Streets</button>
          </div>
          <select value={head} onChange={(e) => setHead(e.target.value)} className="input">
            <option value="">All crime heads</option>
            {lookups?.heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
      </div>

      {layer !== 'density' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="card px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="label flex items-center gap-1.5"><Clock size={13} /> Time of day
            <Hint text="Layer time over location: narrow the window to see where a crime type concentrates at night vs daytime — the basis for proactive patrol deployment." /></span>
          <input type="range" min={0} max={23} value={hours[0]} onChange={(e) => setHours(([, b]) => [Math.min(Number(e.target.value), b), b])} className="w-32 accent-kadi-blue" />
          <input type="range" min={0} max={23} value={hours[1]} onChange={(e) => setHours(([a]) => [a, Math.max(Number(e.target.value), a)])} className="w-32 accent-kadi-blue" />
          <span className="font-num text-sm text-kadi-navy font-medium">{String(hours[0]).padStart(2, '0')}:00 – {String(hours[1]).padStart(2, '0')}:59</span>
          <span className="text-xs text-ink-muted">{filteredPoints.length.toLocaleString()} incidents</span>
          {(hours[0] !== 0 || hours[1] !== 23) && <button onClick={() => setHours([0, 23])} className="text-xs link">reset</button>}
          <div className="flex gap-1 ml-auto flex-wrap">
            {([['Late night', [0, 4]], ['Day', [9, 17]], ['Evening', [18, 21]], ['Night', [22, 23]]] as [string, [number, number]][]).map(([l, r]) => (
              <button key={l} onClick={() => setHours(r)} className="chip bg-surface-3 text-ink-muted hover:bg-kadi-blue50 hover:text-kadi-blue">{l}</button>
            ))}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3">
        <div className="card overflow-hidden relative" style={{ height: 'calc(100vh - 14rem)', minHeight: 420 }}>
          <div ref={ref} className="w-full h-full" />
          {layer === 'density' && (
            <div className="absolute bottom-8 left-3 card px-3 py-2 text-xs bg-white/95">
              <div className="font-medium text-ink-muted mb-1">Cases per district</div>
              <div className="h-2 w-40 rounded" style={{ background: 'linear-gradient(90deg,#dbeafe,#93c5fd,#3b82f6,#1d4ed8,#0B3D75)' }} />
              <div className="flex justify-between font-num mt-0.5"><span>{districts?.minCount ?? 0}</span><span>{districts?.maxCount?.toLocaleString() ?? ''}</span></div>
            </div>
          )}
          {layer === 'heat' && (
            <div className="absolute bottom-8 left-3 card px-3 py-2 text-xs bg-white/95">
              <div className="font-medium text-ink-muted mb-1">Incident density</div>
              <div className="h-2 w-40 rounded" style={{ background: 'linear-gradient(90deg,#2b6cb0,#38b2ac,#ecc94b,#ed8936,#c53030)' }} />
              <div className="flex justify-between mt-0.5"><span>low</span><span>high</span></div>
            </div>
          )}
          {layer === 'points' && lookups && (
            <div className="absolute bottom-8 left-3 card px-3 py-2 text-xs bg-white/95 max-w-[200px]">
              <div className="font-medium text-ink-muted mb-1">Crime head</div>
              <div className="space-y-0.5">
                {lookups.heads.map((h) => <div key={h.id} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: HEAD_COLOR[h.id] }} />{h.name}</div>)}
              </div>
            </div>
          )}
          {selDistrict && <button onClick={resetView} className="absolute top-3 left-3 btn-outline text-xs bg-white/95">← All Karnataka</button>}
        </div>

        <div className="space-y-3">
          {selData ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Section title="District drill-down" action={<button onClick={resetView}><X size={14} className="text-ink-muted" /></button>}>
                <div className="p-3 space-y-2">
                  <div className="font-semibold text-kadi-navy">{selData.district}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Mini label="Cases" value={selData.total.toLocaleString()} />
                    <Mini label="Open" value={selData.open.toLocaleString()} />
                    <Mini label="Flagged" value={selData.flaggedHigh.toLocaleString()} accent="#C9820A" />
                  </div>
                  <div className="label pt-1">Top crime heads</div>
                  {selData.topHeads.map((h: any) => (
                    <div key={h.name} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">{h.name}</span>
                      <div className="w-12 h-1.5 bg-surface-3 rounded overflow-hidden"><div className="h-full bg-kadi-blue" style={{ width: `${(h.count / selData.topHeads[0].count) * 100}%` }} /></div>
                      <span className="font-num text-ink-muted w-10 text-right">{h.count.toLocaleString()}</span>
                    </div>
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
              <div className="p-2 max-h-[300px] overflow-auto">
                {(districts?.districts || []).map((d: any, i: number) => (
                  <button key={d.districtId} onClick={() => setSelDistrict(d.districtId)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-kadi-blue50 text-sm">
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
            <div className="p-3 space-y-2 max-h-[22vh] overflow-auto">
              {(hotspots?.hotspots || []).filter((h) => h.emergingFlag).map((h) => (
                <button key={h.cellId} onClick={() => map.current?.flyTo({ center: [h.centroidLng, h.centroidLat], zoom: 11, duration: 900 })}
                  className="w-full text-left border border-line rounded-ctl p-2 text-sm hover:bg-kadi-blue50">
                  <div className="flex items-center gap-2"><Chip color="red">emerging</Chip><span className="font-num">{h.recentCount} in 60d</span></div>
                  <div className="text-xs text-ink-muted mt-1">vs ~{h.baselineExpected} expected · tap to zoom</div>
                </button>
              ))}
              {!(hotspots?.hotspots || []).some((h) => h.emergingFlag) && <div className="text-sm text-ink-muted">None currently.</div>}
            </div>
          </Section>

          {national && (
            <Section title={<span className="flex items-center gap-2"><TrendingUp size={14} /> India context</span>}>
              <div className="p-3 text-sm">
                <p className="text-xs text-ink-muted mb-2">Karnataka ranks <b className="text-kadi-navy">#{national.focusRank}</b> of {national.states.length} states ({national.focusRatePerLakh}/lakh).</p>
                {national.states.slice(0, 6).map((s: any) => (
                  <div key={s.state} className={`flex items-center gap-2 text-xs py-0.5 ${s.isFocus ? 'font-semibold text-kadi-navy' : ''}`}>
                    <span className="w-4 text-ink-muted">{s.rank}</span><span className="flex-1 truncate">{s.state}{s.isFocus ? ' ★' : ''}</span>
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
