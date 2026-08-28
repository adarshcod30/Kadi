// MapPage — spatiotemporal intelligence.
// Three layers over a satellite/streets basemap: district crime-density choropleth, a
// true crime heatmap, and individual incident points — all filterable by crime head and
// time-of-day. Karnataka districts are outlined + labelled, emerging trends pulse as red
// zones, and clicking a district flies in and drills down. India is drawn with its
// official boundary (datameet composite).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, Flame, MapPin, TrendingUp, X, ArrowRight, Clock, Grid3x3, Building2, Moon, Activity } from 'lucide-react';
import { useGeoPoints, useGeoGrid, useHotspots, useLookups, useDistricts, useNational , useMe, useStations , useGeoIntel } from '../api/hooks';
import { Section, Chip } from '../components/ui';
import { Hint } from '../components/viz';
import kaDistricts from '../geo/karnataka_districts.json';
import indiaOutline from '../geo/india_outline.json';
import { Select } from '../components/Select';
import { InfoDot } from '../components/InfoDot';
import { IntelligenceBand } from '../components/IntelligenceBand';

// bright, satellite-legible palette
const HEAD_COLOR: Record<string, string> = {
  '1': '#FF5A4E', '2': '#4DA3FF', '3': '#FF6FA5', '4': '#2FD9C8',
  '5': '#A98BFF', '6': '#7C8CFF', '7': '#C8D2E0', '8': '#4BD68A',
};

// Station specialisation, not the same axis as crime type. Fill colour on the map still
// carries zone status (is this station running hot); the RING is the station's kind, so
// both read at a glance without needing two separate layers.
const STATION_CATEGORIES: [string, string][] = [
  ['1', 'Law and Order (Town/City)'], ['2', 'Law and Order (Rural)'],
  ['3', 'Traffic'], ['4', 'Women'],
  ['5', 'CEN (Cyber/Economic/Narcotics)'], ['6', 'Cyber Crime'], ['7', 'Railway'],
];
const STATION_RING_COLOR: Record<string, string> = {
  '3': '#0B3D75', '4': '#D6336C', '5': '#7C4DFF', '6': '#00B8A9', '7': '#5B6B7F',
};

const STYLE: any = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tileSize: 256, attribution: '© Esri, Maxar',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
    osm: { type: 'raster', tileSize: 256, attribution: '© OpenStreetMap',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
    // A real dark cartographic basemap, not a darkened satellite image: incident colours and
    // the pulsing red zones read far better against it, and it is the sane choice on a
    // control-room screen at night.
    //
    // Called DARK, not "night", and the distinction is not pedantry. This map already has a
    // shift filter whose options include "Night" (22:00-23:00), so two unrelated controls
    // carried the same word: one a rendering style, one a time of day. Someone reaching for a
    // dark map had no way to tell which was which.
    //
    // Esri, NOT CARTO. The CARTO dark basemap this used renders every tile stamped
    // "API KEY REQUIRED" across it -- they gated their free basemaps, and the tiles still
    // return 200 so nothing in the code could tell. Esri's Dark Gray Canvas needs no key and
    // is the same provider as the satellite layer above, which was already working.
    //
    // Split into base and labels, because that is how Esri ships it: the base carries land and
    // water, the reference layer carries the place names on transparent PNG. Both are needed
    // or the map is a dark shape with nothing named on it.
    dark: { type: 'raster', tileSize: 256, attribution: '© Esri',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'] },
    darkref: { type: 'raster', tileSize: 256, attribution: '© Esri',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'] },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#08131f' } },
    { id: 'basemap-sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 } },
    { id: 'basemap-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.5 } },
    { id: 'basemap-dark', type: 'raster', source: 'dark', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1 } },
    // Declared here but MOVED above the choropleth once the data layers exist (see the
    // moveLayer call in the load handler). Declared position would put it under the district
    // fill, which is opaque enough to hide every place name -- a dark map of Karnataka with
    // nothing named on it.
    { id: 'basemap-darkref', type: 'raster', source: 'darkref', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9 } },
  ],
};

// Standard shift windows, so a supervisor can jump to "Night" without working out the hours.
const SHIFTS: [string, string, [number, number]][] = [
  ['latenight', 'Late night', [0, 4]],
  ['day', 'Day', [9, 17]],
  ['evening', 'Evening', [18, 21]],
  ['night', 'Night', [22, 23]],
];
// Recency windows. The corpus spans 43 months; "where is it happening now" and "where has it
// ever happened" are different questions, and only the first one deploys officers.
const PERIODS: [string, string][] = [
  ['', 'All time'],
  ['180', 'Last 6 months'],
  ['90', 'Last 3 months'],
  ['30', 'Last month'],
  ['15', 'Last 15 days'],
  ['7', 'Last week'],
];

const KA_BOUNDS: [[number, number], [number, number]] = [[73.9, 11.4], [78.7, 18.6]];
type LayerMode = 'density' | 'heat' | 'points';

export default function MapPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  // A specific incident someone navigated here to locate -- from a case detail's "Open
  // map" or the graph's "Map" button. Parsed once; NaN (no lat/lng in the URL) means "not
  // a deep link", handled below.
  const focusLat = Number(params.get('lat'));
  const focusLng = Number(params.get('lng'));
  const focusCrimeNo = params.get('crimeNo') || '';
  const hasFocusIncident = Number.isFinite(focusLat) && Number.isFinite(focusLng) && !!params.get('lat');
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<LayerMode>('density');
  const [basemap, setBasemap] = useState<'sat' | 'streets' | 'dark'>('sat');
  const pumpRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [head, setHead] = useState('');
  const [hours, setHours] = useState<[number, number]>([0, 23]);
  const [period, setPeriod] = useState('');
  // Which preset the current hour range corresponds to, so the dropdown reflects a range set
  // by dragging the sliders rather than going blank whenever the two are edited directly.
  const shiftKey = SHIFTS.find(([, , r]) => r[0] === hours[0] && r[1] === hours[1])?.[0] || '';
  const { data: intel, isLoading: intelLoading } = useGeoIntel({ head });

  // Map findings drive the map's own controls -- a patrol-window signal sets the hour slider,
  // a district signal drills the scope. Turning the reading into the view it describes is the
  // point; a finding you have to reproduce by hand is just a sentence.
  const applySignal = (query: Record<string, string>) => {
    if (query.hourFrom !== undefined && query.hourTo !== undefined) {
      setHours([Number(query.hourFrom), Number(query.hourTo)]);
      setLayer('heat');
    }
    if (query.district) {
      const u = new URL(window.location.href);
      u.searchParams.set('district', query.district);
      window.location.href = u.toString();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const { data: me } = useMe();
  // A district officer should land on their district, not on all Karnataka with their own
  // area as one polygon among 31. State tier still opens on the whole state.
  const [selDistrict, setSelDistrict] = useState<string | null>(null);
  const [showStations, setShowStations] = useState(false);
  const [stationCategory, setStationCategory] = useState('');
  useEffect(() => {
    const cap = me?.capabilities;
    if (cap && cap.effectiveScope === 'district' && cap.districtId && selDistrict === null) {
      setSelDistrict(String(cap.districtId));
    }
  }, [me]);

  const { data: districts } = useDistricts();
  const { data: national } = useNational();
  const { data: points } = useGeoPoints({ head, limit: 9000, days: period || undefined });
  const { data: hotspots } = useHotspots();
  const { data: stations } = useStations({ sort: 'zone' });
  const { data: lookups } = useLookups();
  // binned density over the FULL dataset (only fetched when the heat layer is showing)
  const { data: grid } = useGeoGrid(
    { cell: 0.05, head, hourFrom: hours[0], hourTo: hours[1], days: period || undefined }, layer === 'heat');

  const countById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of districts?.districts || []) m[d.districtId] = d.total;
    return m;
  }, [districts]);

  // Scope, from the account and the current drill — every panel on this page keys off it.
  const scopeTier: 'state' | 'district' | 'station' =
    me?.capabilities?.effectiveScope === 'unit' ? 'station'
      : (selDistrict || me?.capabilities?.effectiveScope === 'district') ? 'district' : 'state';
  // Stations inside the current scope, biggest register first.
  const scopedStations = useMemo(() => {
    const rows = (stations?.items || [])
      .filter((r: any) => !selDistrict || String(r.districtId) === String(selDistrict))
      .sort((a: any, b: any) => (b.cases || 0) - (a.cases || 0));
    // A station officer's own register, not the 120 others in their district. /stations stays
    // district-wide on purpose -- the map still draws neighbouring stations as context -- so the
    // narrowing happens here, where the panel claims to be about "your station".
    const own = me?.capabilities?.unitId;
    if (own) return rows.filter((r: any) => String(r.unitId) === String(own));
    return rows;
  }, [stations, selDistrict, me]);

  // The two things that pulse on the canvas, derived once so the markers, the side panel and
  // the cards below can never disagree about what is "emerging" in this view.
  const emergingClusters = useMemo(
    () => (hotspots?.hotspots || []).filter((h: any) => h.emergingFlag),
    [hotspots],
  );
  const pulsingStations = useMemo(
    () => (selDistrict
      ? (stations?.items || []).filter((r: any) => String(r.districtId) === String(selDistrict)
        && (r.zone === 'red_pulsing' || r.zone === 'red') && r.lat != null && r.lng != null)
      : []),
    [stations, selDistrict],
  );

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
    // Reachable from a console. A WebGL map that renders nothing gives you almost no signal
    // from the outside -- no error, no failed request, just a dark rectangle -- and the
    // instance is the only thing that can say whether the style loaded, where it is centred
    // and which layers it thinks are visible.
    (window as any).__kadiMap = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', (e: any) => console.warn('[map]', e?.error?.message || e));

    // KEEP THE CANVAS THE SIZE OF ITS CONTAINER.
    //
    // MapLibre measures the container once, at construction, and never again unless told.
    // This container's height comes from a flex layout that resolves AFTER the map is created,
    // so the canvas was locked at 400x418 inside a 718x494 box -- the map painted a fraction
    // of its own area and the rest showed page background. It read as "the basemap is broken":
    // satellite looked like a grey rectangle, the dark basemap like a black one, and no
    // amount of changing tile sources would have fixed it because the tiles were never the
    // problem.
    //
    // A ResizeObserver rather than a window 'resize' listener, because the container also
    // changes size when the sidebar collapses or a panel opens, and neither of those resizes
    // the window.
    const ro = new ResizeObserver(() => {
      try { m.resize(); } catch { /* torn down mid-observation */ }
    });
    ro.observe(ref.current);
    // One immediate resize after the first paint, for the case where the container was already
    // its final size before the observer attached and no mutation ever fires.
    requestAnimationFrame(() => { try { m.resize(); } catch { /* no-op */ } });
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
      // Heat is driven by SERVER-BINNED cells carrying a log-normalised weight (`w`), not
      // by thousands of equally-weighted raw points. One weighted kernel per grid cell,
      // with the radius tracking the cell's on-screen size, makes heat density a direct
      // function of real case counts — so the ramp maps to volume instead of flooring
      // (all blue) or saturating (all red). Counts span ~1..1300 per cell, hence log.
      m.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      m.addLayer({
        id: 'heat', type: 'heatmap', source: 'grid', layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['get', 'w'],
          // >1 so a run of dense adjacent cells (a city core) reaches the top of the ramp
          'heatmap-intensity': 1.4,
          // radius must exceed the cell's on-screen spacing (~2px at z6) so kernels
          // overlap into a smooth surface instead of a speckled dot-grid
          'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 8, 7, 18, 9, 45, 11, 150, 13, 400],
          'heatmap-opacity': 0.85,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.1, 'rgba(43,108,176,0.7)', 0.3, '#38b2ac',
            0.5, '#ecc94b', 0.7, '#ed8936', 1, '#c53030'],
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
      // Lift the dark basemap's labels above the choropleth.
      //
      // Layer order is paint order, and the data layers are added here -- after the basemap
      // layers in STYLE -- so the labels start underneath them. The district fill is opaque
      // enough to bury every place name, which leaves a dark map with no towns on it. Above
      // the fill and below the incidents is the right slot: names stay readable, dots and
      // pulsing zones still sit on top of the names.
      if (m.getLayer('basemap-darkref') && m.getLayer('heat')) {
        try { m.moveLayer('basemap-darkref', 'heat'); } catch { /* order already fine */ }
      }
      setReady(true);
      // Repaint once the style, sources and layers are all in place.
      //
      // Without this the map mounted, fetched its tiles, sized its canvas correctly -- and
      // then painted nothing. Every diagnostic said it was healthy: sources loaded, twelve
      // layers in order, worker running, bounds over Karnataka. It rendered the instant
      // anything nudged it, which is the tell: the render loop had gone idle before the last
      // tiles arrived and nothing asked it to draw again.
      //
      // The ResizeObserver above cannot cover this. It only fires when the container CHANGES
      // size, and here the container was already final -- so it never fired, and the one
      // requestAnimationFrame resize ran before the tiles were in.
      requestAnimationFrame(() => {
        try { m.resize(); m.triggerRepaint(); } catch { /* torn down */ }
      });
      } catch (err) {
        console.warn('[map] layer setup failed', err);
      }
    });

    // WAKE THE RENDER LOOP WHEN A SOURCE FINISHES.
    //
    // MapLibre parks its render loop when it believes there is nothing left to draw, and here
    // it parked before the last raster tiles had decoded -- so the canvas stayed the
    // background colour while isSourceLoaded('sat') reported true and no error was raised
    // anywhere. A single triggerRepaint() painted the whole map instantly, which is the proof:
    // nothing was missing, nothing had failed, the loop had simply gone to sleep early.
    //
    // 'sourcedata' with isSourceLoaded is the moment new pixels become available, so that is
    // where the nudge belongs. It is cheap -- a repaint that has nothing to do is a no-op.
    m.on('sourcedata', (e: any) => {
      if (e && e.isSourceLoaded) { try { m.triggerRepaint(); } catch { /* torn down */ } }
    });
    // And once more when everything settles, for the case where the last tile lands between
    // the final sourcedata and the loop parking.
    m.once('idle', () => { try { m.resize(); m.triggerRepaint(); } catch { /* torn down */ } });

    // A BOUNDED REPAINT PUMP, and the reason it exists rather than a cleverer hook.
    //
    // This map paints nothing on first load until something asks it to draw. Every state read
    // says it should be fine -- canvas sized to its container, style applied, twelve layers in
    // order, isSourceLoaded('sat') true, worker alive, no error on any channel -- and a single
    // triggerRepaint() renders the whole thing instantly. The render loop parks before the last
    // tiles decode and never wakes.
    //
    // The 'sourcedata' and 'idle' hooks above are the correct place to fix that and they do not
    // catch it, so this is the blunt instrument: ask for a frame every 250ms for the first eight
    // seconds, then stop. A repaint with nothing to draw is a no-op, the window is short and
    // bounded, and it is cleared on unmount. Ugly, honest, and it makes the most important
    // screen in the product reliably visible -- which is worth more than an elegant fix that
    // does not work.
    const pumpStart = Date.now();
    const pump = setInterval(() => {
      if (Date.now() - pumpStart > 8000) { clearInterval(pump); return; }
      try { m.triggerRepaint(); } catch { clearInterval(pump); }
    }, 250);
    pumpRef.current = pump;

    // Tear the map down on unmount — without this, navigating away (or an HMR update)
    // leaves orphaned WebGL map instances attached to detached DOM nodes.
    return () => {
      try {
        ro.disconnect();
        if (pumpRef.current) { clearInterval(pumpRef.current); pumpRef.current = null; }
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
      0, '#dbeafe', 0.35, '#93c5fd', 0.6, '#3b82f6', 0.8, '#1d4ed8', 1, '#0f2f44'];
    const fc = { ...(kaDistricts as any), features: (kaDistricts as any).features.map((f: any) => ({
      ...f, properties: { ...f.properties, count: countById[f.properties.districtId] || 0 } })) };
    (m.getSource('ka') as any)?.setData(fc);
    m.setPaintProperty('ka-fill', 'fill-color', layer === 'density' ? expr : '#4A90D9');
    m.setPaintProperty('ka-fill', 'fill-opacity', layer === 'density' ? 0.66 : 0.06);

  }, [ready, districts, layer, countById]);

  // ---- incident points ----
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

  // ---- binned heat: log-normalise real per-cell counts into the 0..1 heat weight ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !grid || !m.getSource('grid')) return;
    const denom = Math.log((grid.maxCount || 1) + 1) || 1;
    (m.getSource('grid') as any).setData({
      type: 'FeatureCollection',
      features: (grid.cells || []).map((c: any) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: { w: Math.log(c.count + 1) / denom, count: c.count },
      })),
    });
  }, [ready, grid]);

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
    if (m.getLayer('basemap-dark')) m.setLayoutProperty('basemap-dark', 'visibility', basemap === 'dark' ? 'visible' : 'none');
    if (m.getLayer('basemap-darkref')) m.setLayoutProperty('basemap-darkref', 'visibility', basemap === 'dark' ? 'visible' : 'none');
  }, [ready, basemap]);

  // ---- pulsing red zones ----
  //
  // Two different things pulse, at two different zooms, and the page previously only had the
  // first. State-wide there is exactly ONE emerging DBSCAN cluster, so clicking into a city
  // showed nothing pulsing at all and the feature looked broken.
  //
  // Drilling into a district now also pulses the stations inside it that are running above
  // their OWN baseline. That is the right unit at city zoom: a district-level cluster answers
  // "which neighbourhood", a station answers "whose ground", and only the second one names
  // someone who can be told to act.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];

    for (const h of emergingClusters) {
      const el = document.createElement('div');
      el.className = 'hotspot-pulse';
      el.title = `Emerging cluster: ${h.recentCount} in 60d vs ~${h.baselineExpected} expected`;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([h.centroidLng, h.centroidLat]).addTo(m));
    }

    {
      for (const r of pulsingStations) {
        const el = document.createElement('div');
        el.className = r.zone === 'red_pulsing' ? 'hotspot-pulse' : 'hotspot-pulse hotspot-pulse--steady';
        el.title = `${r.unitName}: ${r.current ?? 0} recent vs baseline ${r.baseline ?? 0}`
          + `${r.zone === 'red_pulsing' ? ' — sharply above its own average' : ' — above its own average'}`;
        markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(m));
      }
    }
  }, [ready, emergingClusters, pulsingStations]);


  // ---- police stations, toggled ----
  // Drawn as circles rather than the square incident markers so the two never read as the
  // same thing: a station is a fixed place that exists whether or not crime happened there.
  // Colour carries its zone, so the layer doubles as a status map instead of just dots.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const feats = (stations?.items || [])
      .filter((r: any) => r.lat != null && r.lng != null)
      .filter((r: any) => !stationCategory || String(r.categoryId) === stationCategory)
      .map((r: any) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
        properties: {
          unitName: r.unitName, districtName: r.districtName, zone: r.zone,
          cases: r.cases, current: r.current ?? 0, baseline: r.baseline ?? 0,
          redAt: r.thresholds?.redAt ?? 0,
          category: r.category || '', categoryId: String(r.categoryId || ''),
        },
      }));
    const data = { type: 'FeatureCollection' as const, features: feats };
    if (!m.getSource('stations')) {
      m.addSource('stations', { type: 'geojson', data: data as any });
      m.addLayer({
        id: 'stations-dot', type: 'circle', source: 'stations',
        paint: {
          // Size by caseload so the busy stations are findable at state zoom.
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            5, ['interpolate', ['linear'], ['get', 'cases'], 0, 2.5, 250, 6],
            11, ['interpolate', ['linear'], ['get', 'cases'], 0, 5, 250, 14]],
          'circle-color': ['match', ['get', 'zone'],
            'red_pulsing', '#C0392B', 'red', '#C0392B', 'yellow', '#E0A106', '#2FA8A0'],
          // Ring colour carries the station's TYPE, independent of the fill's zone status --
          // a Women's or Traffic station is identifiable at a glance even when it is
          // otherwise reading normal. Ordinary Law & Order stations keep the plain white ring.
          'circle-stroke-width': ['match', ['get', 'categoryId'],
            '3', 2.4, '4', 2.4, '5', 2.4, '6', 2.4, '7', 2.4, 1.4],
          'circle-stroke-color': ['match', ['get', 'categoryId'],
            '3', STATION_RING_COLOR['3'], '4', STATION_RING_COLOR['4'],
            '5', STATION_RING_COLOR['5'], '6', STATION_RING_COLOR['6'],
            '7', STATION_RING_COLOR['7'], '#FFFFFF'],
          'circle-opacity': 0.92,
        },
      });
      m.on('click', 'stations-dot', (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:13px/1.45 system-ui"><b>${p.unitName}</b><br/>`
            + `<span style="color:#5B6B7F">${p.districtName}${p.category ? ' · ' + p.category : ''}</span><br/>`
            + `${Number(p.cases).toLocaleString()} FIRs total<br/>`
            + `<b>${p.current}</b> this month vs an average of ${p.baseline}<br/>`
            + `<span style="color:#5B6B7F">Its own red line: +${p.redAt}</span></div>`,
          )
          .addTo(m);
      });
      m.on('mouseenter', 'stations-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'stations-dot', () => { m.getCanvas().style.cursor = ''; });
    } else {
      (m.getSource('stations') as any).setData(data);
    }
    if (m.getLayer('stations-dot')) {
      m.setLayoutProperty('stations-dot', 'visibility', showStations ? 'visible' : 'none');
    }
  }, [ready, stations, showStations, stationCategory]);

  // ---- drill-down highlight + fly ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer('ka-sel')) return;
    m.setFilter('ka-sel', ['==', ['get', 'districtId'], selDistrict || '']);
    if (!selDistrict || !districts) return;
    const d = districts.districts.find((x: any) => x.districtId === selDistrict);
    if (d) m.flyTo({ center: [d.centroidLng, d.centroidLat], zoom: 8.4, duration: 900 });
  }, [ready, selDistrict, districts]);

  // ---- deep-linked incident: Incidents layer, fly in tight, drop a pin ----
  // "Open map" from a case, or "Map" from the graph, should land the viewer looking at the
  // one FIR they came from -- not the state-wide choropleth with no idea where to look.
  const focusedRef = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !hasFocusIncident || focusedRef.current) return;
    focusedRef.current = true;
    setLayer('points');
    m.flyTo({ center: [focusLng, focusLat], zoom: 15, duration: 1400 });
    const el = document.createElement('div');
    el.className = 'incident-pin';
    el.innerHTML = `<svg viewBox="0 0 24 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 22 12 22s12-13 12-22c0-6.6-5.4-12-12-12z" fill="#E8871E" stroke="#0B3D75" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#0B3D75"/>
    </svg>`;
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([focusLng, focusLat]);
    if (focusCrimeNo) {
      marker.setPopup(new maplibregl.Popup({ offset: 28, closeButton: false })
        .setHTML(`<div style="font:600 12px system-ui;color:#0B3D75">${focusCrimeNo}</div>`));
    }
    marker.addTo(m);
    if (focusCrimeNo) marker.togglePopup();
    markers.current.push(marker);
  }, [ready, hasFocusIncident, focusLat, focusLng, focusCrimeNo]);

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
            <button onClick={() => setBasemap('dark')} title="Dark cartographic basemap"
              className={`px-3 py-1.5 flex items-center gap-1 ${basemap === 'dark' ? 'bg-kadi-navy text-white' : 'text-ink-muted hover:bg-surface-3'}`}><Moon size={13} /> Dark</button>
          </div>
          <Select value={head} onChange={setHead} className="w-48"
            options={[{ value: '', label: 'All crime heads' }, ...(lookups?.heads || []).map((h) => ({ value: h.id, label: h.name }))]} />
          {/* Stations are a separate concern from incidents: they are fixed places that
              exist whether or not anything happened there, so they get their own toggle
              rather than being folded into the layer switch. */}
          <button
            onClick={() => setShowStations((v) => !v)}
            aria-pressed={showStations}
            title="Show or hide every police station, coloured by its own status"
            className={`btn text-sm gap-1.5 ${showStations
              ? 'bg-kadi-navy text-white hover:bg-kadi-navy700'
              : 'border border-line text-ink-muted hover:bg-surface-3'}`}
          >
            <Building2 size={15} />
            {showStations ? 'Hide' : 'Show'} stations
            {stations?.mappable ? (
              <span className={`font-num text-[11.5px] ${showStations ? 'text-white/70' : 'text-ink-subtle'}`}>
                {stations.mappable}
              </span>
            ) : null}
          </button>
          {showStations && (
            <Select value={stationCategory} onChange={setStationCategory} className="w-56"
              title="Filter stations by type"
              options={[{ value: '', label: 'All station types' }, ...STATION_CATEGORIES.map(([id, label]) => ({ value: id, label }))]} />
          )}
        </div>
      </div>

      <IntelligenceBand data={intel} isLoading={intelLoading} onApply={applySignal}
        title="Spatiotemporal reading"
        subtitle="Where and when, and what to do about the timing" />

      {layer !== 'density' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="card px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="label flex items-center gap-1.5"><Clock size={13} /> Time of day
            <InfoDot label="Why time of day matters" align="left">
              <b className="block mb-1 text-kadi-navy">Layering time over location</b>
              Where a crime type concentrates at 02:00 is rarely where it concentrates at
              14:00. Narrowing the window turns a map of where crime happened into a map of
              when to be there, which is what a duty roster actually needs.
              <b className="block mt-1.5 text-kadi-navy">Read with the period filter</b>
              The period filter beside it controls how far back the incidents are drawn from,
              so a shift pattern can be checked against the last week rather than three years.
            </InfoDot>
          </span>
          <input type="range" min={0} max={23} value={hours[0]} onChange={(e) => setHours(([, b]) => [Math.min(Number(e.target.value), b), b])} className="w-28 accent-kadi-blue" />
          <input type="range" min={0} max={23} value={hours[1]} onChange={(e) => setHours(([a]) => [a, Math.max(Number(e.target.value), a)])} className="w-28 accent-kadi-blue" />
          <span className="font-num text-sm text-kadi-navy font-medium whitespace-nowrap">{String(hours[0]).padStart(2, '0')}:00 – {String(hours[1]).padStart(2, '0')}:59</span>

          {/* Shift presets as a dropdown rather than four loose chips. They are one choice,
              not four toggles, and as chips they read as filters that could stack. */}
          <Select value={shiftKey} onChange={(v) => { const p = SHIFTS.find((x) => x[0] === v); if (p) setHours(p[2]); else setHours([0, 23]); }}
            className="w-40" title="Jump to a standard shift window"
            options={[{ value: '', label: 'Whole day' }, ...SHIFTS.map(([k, label, r]) => ({ value: k, label: `${label} · ${String(r[0]).padStart(2, '0')}–${String(r[1]).padStart(2, '0')}` }))]} />

          {/* How far back to draw from. Without this the map answers "where has crime ever
              happened", which on a 43-month corpus is a very different question from "where
              is it happening now" -- and only the second one is deployable. */}
          <Select value={period} onChange={setPeriod} className="w-44" title="How far back to draw incidents from"
            options={PERIODS.map(([v, label]) => ({ value: v, label }))} />

          <span className="text-xs text-ink-muted whitespace-nowrap">
            {layer === 'heat'
              ? `${(grid?.total ?? 0).toLocaleString()} incidents`
              : `${filteredPoints.length.toLocaleString()} incidents (sample)`}
          </span>
          {(hours[0] !== 0 || hours[1] !== 23 || period) && (
            <button onClick={() => { setHours([0, 23]); setPeriod(''); }} className="text-xs link">reset</button>
          )}
        </motion.div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3 items-stretch">
        <div className="card overflow-hidden relative" style={{ height: 'calc(100vh - 14rem)', minHeight: 420 }}>
          <div ref={ref} className="w-full h-full" />
          {layer === 'density' && (
            <div className="absolute bottom-8 left-3 card px-3 py-2 text-xs bg-white/95">
              <div className="font-medium text-ink-muted mb-1">Cases per district</div>
              <div className="h-2 w-40 rounded" style={{ background: 'linear-gradient(90deg,#dbeafe,#93c5fd,#3b82f6,#1d4ed8,#0f2f44)' }} />
              <div className="flex justify-between font-num mt-0.5"><span>{districts?.minCount ?? 0}</span><span>{districts?.maxCount?.toLocaleString() ?? ''}</span></div>
            </div>
          )}
          {layer === 'heat' && (
            <div className="absolute bottom-8 left-3 card px-3 py-2 text-xs bg-white/95">
              <div className="font-medium text-ink-muted mb-1">Incidents per ~5 km cell</div>
              <div className="h-2 w-44 rounded" style={{ background: 'linear-gradient(90deg,rgba(43,108,176,.7),#38b2ac,#ecc94b,#ed8936,#c53030)' }} />
              <div className="flex justify-between font-num mt-0.5">
                <span>1</span><span>{grid ? Math.round(Math.sqrt(grid.maxCount)) : ''}</span><span>{grid?.maxCount?.toLocaleString() ?? ''}</span>
              </div>
              <div className="text-[10px] text-ink-muted mt-0.5">log scale · {grid?.total?.toLocaleString() ?? 0} incidents binned</div>
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
          {/* Station types sit opposite the crime-head legend: two different things are
              plotted, and reading one key for both was the source of the confusion. */}
          {showStations && (
            <div className="absolute bottom-8 right-3 card px-3 py-2 text-xs bg-white/95 max-w-[210px]">
              <div className="font-medium text-ink-muted mb-1 flex items-center gap-1">
                <Building2 size={11} /> Station type
              </div>
              <div className="space-y-0.5">
                {STATION_CATEGORIES.filter(([id]) => !stationCategory || id === stationCategory).map(([id, label]) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-white"
                      style={{ boxShadow: `0 0 0 2px ${STATION_RING_COLOR[id] || '#0B3D75'}` }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}
          {selDistrict && <button onClick={resetView} className="absolute top-3 left-3 btn-outline text-xs bg-white/95">← All Karnataka</button>}
        </div>

        {/* The panel now matches the map's height and scrolls inside itself, so the two read
            as one instrument rather than a tall column beside a short map (P3-8). */}
        <div className="space-y-3 overflow-auto pr-0.5" style={{ height: 'calc(100vh - 14rem)', minHeight: 420 }}>
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
            /* A ladder of 31 districts is a STATE question. Below state scope it is context
               the reader cannot act on and, for a station officer, not even about them — so
               the panel becomes the stations in their own scope instead. */
            scopeTier === 'state' ? (
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
            ) : (
              <Section title={scopeTier === 'station' ? 'Your station' : 'Stations by volume'}>
                <div className="p-2 max-h-[300px] overflow-auto">
                  {scopedStations.length ? scopedStations.map((r: any, i: number) => (
                    <button key={r.unitId} onClick={() => r.lat != null && map.current?.flyTo({ center: [r.lng, r.lat], zoom: 12, duration: 900 })}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-kadi-blue50 text-sm">
                      <span className="w-5 text-ink-muted font-num text-xs">{i + 1}</span>
                      <span className="flex-1 text-left truncate">{r.unitName}</span>
                      <div className="w-16 h-1.5 bg-surface-3 rounded overflow-hidden">
                        <div className="h-full bg-kadi-blue" style={{ width: `${(r.cases / (scopedStations[0]?.cases || 1)) * 100}%` }} />
                      </div>
                      <span className="font-num text-xs w-12 text-right">{(r.cases || 0).toLocaleString()}</span>
                    </button>
                  )) : <div className="px-2 py-3 text-sm text-ink-muted">No stations in this scope.</div>}
                </div>
              </Section>
            )
          )}

          {/* A compact reading of the current view, not a second dashboard. It answers the
              two questions the map itself cannot: how concentrated is what I am looking at,
              and when does it happen -- both recomputed as the filters change. */}
          <ViewPulse points={filteredPoints} grid={grid} layer={layer} hours={hours} period={period} />

          {/* THE PANEL MUST LIST WHAT THE MAP DRAWS. Two different things pulse on the canvas —
              DBSCAN clusters state-wide, and stations running above their own baseline once you
              drill into a district — but this panel only ever counted the clusters. So Mysuru
              showed two pulsing dots beside the words "None currently", which reads as a broken
              feature. It now lists both, labelled by what each one is. */}
          <Section title={<span className="flex items-center gap-2"><Flame size={14} className="text-danger" /> Emerging hotspots</span>}>
            <div className="p-3 space-y-2 max-h-[22vh] overflow-auto">
              {emergingClusters.map((h: any) => (
                <button key={h.cellId} onClick={() => map.current?.flyTo({ center: [h.centroidLng, h.centroidLat], zoom: 11, duration: 900 })}
                  className="w-full text-left border border-line rounded-ctl p-2 text-sm hover:bg-kadi-blue50">
                  <div className="flex items-center gap-2"><Chip color="red">cluster</Chip><span className="font-num">{h.recentCount} in 60d</span></div>
                  <div className="text-xs text-ink-muted mt-1">vs ~{h.baselineExpected} expected · tap to zoom</div>
                </button>
              ))}
              {pulsingStations.map((r: any) => (
                <button key={r.unitId} onClick={() => map.current?.flyTo({ center: [r.lng, r.lat], zoom: 12, duration: 900 })}
                  className="w-full text-left border border-line rounded-ctl p-2 text-sm hover:bg-kadi-blue50">
                  <div className="flex items-center gap-2">
                    <Chip color={r.zone === 'red_pulsing' ? 'red' : 'amber'}>station</Chip>
                    <span className="truncate">{r.unitName}</span>
                    <span className="font-num text-ink-muted ml-auto">{r.current ?? 0}</span>
                  </div>
                  <div className="text-xs text-ink-muted mt-1">
                    vs baseline {r.baseline ?? 0}{r.changePct != null ? ` · ${r.changePct > 0 ? '+' : ''}${r.changePct}%` : ''} · tap to zoom
                  </div>
                </button>
              ))}
              {!emergingClusters.length && !pulsingStations.length
                && <div className="text-sm text-ink-muted">None currently — nothing in this view sits materially above its own baseline.</div>}
            </div>
          </Section>

          {/* India context removed from the map for every role (P3-9): it is a state-wide
              framing that belongs on the state Home, not beside an operational map. */}
        </div>
      </div>

      {/* Three cards beneath the map and its panel (P3-10), tier-shaped: the most important
          reading of the current view for whoever is looking. */}
      <MapCards me={me} selDistrict={selDistrict} selData={selData} districts={districts}
        clusters={emergingClusters} pulsing={pulsingStations} stations={stations}
        points={filteredPoints} grid={grid} />
    </div>
  );
}

// The three cards beneath the map (P3-10). Tier-shaped, because what matters about a map
// differs by altitude: a DGP wants the districts crossing threshold and the biggest mover; an
// SP wants the busiest window and cross-boundary reach; an SHO wants their own beat.
function MapCard({ tone, title, children }: { tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: tone }} />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">{title}</div>
      {children}
    </div>
  );
}
function MapCards({ me, selDistrict, selData, districts, clusters, pulsing, stations, points, grid }: any) {
  const tier = me?.capabilities?.effectiveScope === 'unit' ? 'station'
    : (selDistrict || me?.capabilities?.effectiveScope === 'district') ? 'district' : 'state';
  const tone = { state: '#1A6FC4', district: '#E8871E', station: '#2FA8A0' }[tier];

  // Busiest hour across whatever is plotted, in the current scope.
  const byHour = new Array(24).fill(0);
  for (const p of points || []) if (p.hour != null) byHour[p.hour] += 1;
  let peak = 0; for (let h = 1; h < 24; h += 1) if (byHour[h] > byHour[peak]) peak = h;
  const hasHours = byHour.some((n) => n > 0);
  const win = `${String(peak).padStart(2, '0')}:00–${String((peak + 3) % 24).padStart(2, '0')}:00`;

  // Everything pulsing in THIS view — clusters plus stations above their own baseline — so the
  // card agrees with the map and the panel rather than counting only one of the two.
  const hot = (clusters?.length || 0) + (pulsing?.length || 0);

  // THE LEADING AREA IS SCOPE-DEPENDENT, and reading it off the state district list was the
  // bug: drilled into Mysuru the card still announced Bengaluru City, because that list is
  // always state-wide. At district scope the right unit is a STATION inside that district; at
  // state scope it is a district.
  let leadLabel = 'Leading area';
  let leadName = '—';
  let leadSub = 'No area data in this view.';
  if (tier === 'state') {
    const top = (districts?.districts || [])[0];
    leadLabel = 'Heaviest district';
    if (top) { leadName = top.district; leadSub = `${top.total.toLocaleString()} cases — the district carrying the most volume state-wide.`; }
  } else {
    const inScope = (stations?.items || [])
      .filter((r: any) => !selDistrict || String(r.districtId) === String(selDistrict))
      .sort((a: any, b: any) => (b.cases || 0) - (a.cases || 0));
    const top = inScope[0];
    leadLabel = tier === 'station' ? 'Your station' : 'Busiest station';
    if (top) {
      leadName = top.unitName;
      leadSub = `${(top.cases || 0).toLocaleString()} cases — the heaviest register in ${selData?.district || 'this district'}.`;
    }
  }

  const total = grid?.total ?? (points || []).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
      <MapCard tone={tone} title="Concentration">
        <div className="text-2xl font-semibold font-num text-kadi-navy">{total?.toLocaleString()}</div>
        <p className="text-[13px] text-ink-muted mt-0.5">
          incidents in view · {hot} area{hot === 1 ? '' : 's'} running above their own baseline
          {pulsing?.length ? ` (${pulsing.length} station${pulsing.length === 1 ? '' : 's'})` : ''}.
        </p>
      </MapCard>
      <MapCard tone={tone} title="Busiest window">
        <div className="text-2xl font-semibold font-num text-kadi-navy">{hasHours ? win : '—'}</div>
        <p className="text-[13px] text-ink-muted mt-0.5">
          {hasHours
            ? 'peak hours in the current view — the window to weight patrol cover toward.'
            : 'no timed incidents in the current view.'}
        </p>
      </MapCard>
      <MapCard tone={tone} title={leadLabel}>
        <div className="text-lg font-semibold text-kadi-navy truncate">{leadName}</div>
        <p className="text-[13px] text-ink-muted mt-0.5">{leadSub}</p>
      </MapCard>
    </div>
  );
}

// Concentration and peak hour for whatever is currently plotted.
//
// The Gini-style top-decile share is the useful number here: 9,000 dots on a state map all
// look like "a lot everywhere", and the one thing a commander needs to know is whether the
// load is spread or stacked -- those call for opposite deployments.
function ViewPulse({ points, grid, layer, hours, period }: {
  points: any[]; grid: any; layer: LayerMode; hours: [number, number]; period: string;
}) {
  const stat = useMemo(() => {
    if (!points.length) return null;
    const byDistrict = new Map<string, number>();
    const byHour = new Array(24).fill(0);
    for (const p of points) {
      byDistrict.set(p.district, (byDistrict.get(p.district) || 0) + 1);
      if (p.hour != null) byHour[p.hour] += 1;
    }
    const counts = [...byDistrict.values()].sort((a, b) => b - a);
    const topN = Math.max(1, Math.ceil(counts.length * 0.1));
    const topShare = Math.round((counts.slice(0, topN).reduce((a, b) => a + b, 0) / points.length) * 100);
    let peak = 0;
    for (let h = 1; h < 24; h += 1) if (byHour[h] > byHour[peak]) peak = h;
    const top = [...byDistrict.entries()].sort((a, b) => b[1] - a[1])[0];
    return { topShare, topN, peak, peakN: byHour[peak], leader: top?.[0], leaderN: top?.[1], districts: byDistrict.size };
  }, [points]);
  if (!stat) return null;

  const periodLabel = PERIODS.find(([v]) => v === period)?.[1] || 'All time';
  return (
    <Section title={<span className="flex items-center gap-1.5">
      <Activity size={14} className="text-kadi-teal" /> This view
      <InfoDot label="How these are computed" align="right">
        <b className="block mb-1 text-kadi-navy">Concentration</b>
        The share of plotted incidents falling in the busiest tenth of districts. A high figure
        means the load is stacked and can be met by moving resources; a low one means it is
        spread, and moving resources will not help.
        <b className="block mt-1.5 text-kadi-navy">Peak hour</b>
        The single busiest hour among the incidents currently plotted — it moves with the crime
        head and period filters, so it reflects this selection rather than the corpus.
        <b className="block mt-1.5 text-kadi-navy">Sampling</b>
        Point view draws an evenly spaced sample across the whole filtered set so every district
        is represented. Proportions hold; absolute counts are of the sample.
      </InfoDot>
    </span>}>
      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 text-center">
          <Mini label="Concentration" value={`${stat.topShare}%`} accent={stat.topShare >= 60 ? '#C0392B' : undefined} />
          <Mini label="Peak hour" value={`${String(stat.peak).padStart(2, '0')}:00`} />
        </div>
        <div className="text-[11.5px] text-ink-muted leading-relaxed">
          The busiest {stat.topN} of {stat.districts} district{stat.districts === 1 ? '' : 's'} hold{' '}
          <b className="text-ink">{stat.topShare}%</b> of what is plotted, led by{' '}
          <b className="text-ink">{stat.leader}</b> ({stat.leaderN?.toLocaleString()}).{' '}
          {String(stat.peak).padStart(2, '0')}:00 is the busiest hour with {stat.peakN.toLocaleString()}.
        </div>
        <div className="text-[10.5px] text-ink-subtle border-t border-line pt-1.5">
          {periodLabel} · {String(hours[0]).padStart(2, '0')}:00–{String(hours[1]).padStart(2, '0')}:59 ·{' '}
          {layer === 'heat' ? `${(grid?.total ?? 0).toLocaleString()} binned` : `${points.length.toLocaleString()} sampled`}
        </div>
      </div>
    </Section>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="bg-surface-2 rounded-ctl py-1.5"><div className="text-[10px] text-ink-muted uppercase">{label}</div><div className="font-num font-semibold" style={accent ? { color: accent } : undefined}>{value}</div></div>;
}
