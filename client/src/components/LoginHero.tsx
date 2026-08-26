// The welcome hero — Karnataka, drawn from the same district geometry the product runs on.
//
// The earlier backdrop was a field of random dots and lines. It read as generic tech wallpaper
// and said nothing, which is a poor first argument for a tool whose whole claim is that it
// connects things that look unrelated.
//
// This draws the actual state: the real district boundaries the map page uses, with the
// heaviest-caseload districts pulsing and arcs running between the ones that share offenders.
// It is the product's thesis as a picture — a case in Bengaluru joined to one in Kalaburagi —
// and every coordinate is real rather than decorative.
import { useEffect, useMemo, useState } from 'react';
import districts from '../geo/karnataka_districts.json';

// Karnataka's bounding box, from the geometry itself.
const LNG0 = 74.05; const LNG1 = 78.58;
const LAT0 = 11.57; const LAT1 = 18.46;
const W = 420; const H = 560;

// Equirectangular is fine at one state's scale and keeps the whole thing to arithmetic --
// a projection library would be a dependency for no visible difference here.
const px = (lng: number) => ((lng - LNG0) / (LNG1 - LNG0)) * W;
const py = (lat: number) => H - ((lat - LAT0) / (LAT1 - LAT0)) * H;

function ringToPath(ring: number[][]): string {
  if (!ring.length) return '';
  // Every third point. The outline stays honest at this size and the DOM stays small --
  // the full geometry is ~192KB of coordinates and none of that detail survives at 420px.
  const step = Math.max(1, Math.floor(ring.length / 90));
  const pts: string[] = [];
  for (let i = 0; i < ring.length; i += step) {
    const [lng, lat] = ring[i];
    pts.push(`${px(lng).toFixed(1)},${py(lat).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

type Shape = { id: string; name: string; d: string; cx: number; cy: number };

function buildShapes(): Shape[] {
  const out: Shape[] = [];
  for (const f of (districts as any).features) {
    const g = f.geometry;
    const polys: number[][][] = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    let d = '';
    let sx = 0; let sy = 0; let n = 0;
    for (const ring of polys) {
      if (!Array.isArray(ring) || !ring.length || !Array.isArray(ring[0])) continue;
      d += ringToPath(ring as number[][]);
      for (const [lng, lat] of ring as number[][]) { sx += px(lng); sy += py(lat); n += 1; }
    }
    if (!d || !n) continue;
    out.push({
      id: String(f.properties.districtId),
      name: f.properties.district,
      d,
      cx: sx / n,
      cy: sy / n,
    });
  }
  return out;
}

// The districts that actually carry the load, and pairs that genuinely share offenders in the
// corpus. Hard-coded because this is a pre-auth screen: it must render instantly with no API
// call, and these are stable properties of the shipped dataset rather than live figures.
const HOT = ['1', '3', '10', '14', '16'];
const ARCS: [string, string][] = [['1', '3'], ['1', '10'], ['3', '14'], ['1', '16'], ['10', '16']];

export function LoginHero() {
  const shapes = useMemo(buildShapes, []);
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  // Draw-on, so the state assembles rather than appearing. It reads as the system building a
  // picture, which is what it does.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 120); return () => clearTimeout(t); }, []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" aria-hidden="true"
      style={{ filter: 'drop-shadow(0 0 42px rgba(26,111,196,0.30))' }}>
      <defs>
        <linearGradient id="kaFill" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#1A6FC4" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#2FA8A0" stopOpacity="0.09" />
        </linearGradient>
        <linearGradient id="arcLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E8B44A" stopOpacity="0" />
          <stop offset="45%" stopColor="#E8B44A" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#7CC4F5" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="hotGlow">
          <stop offset="0%" stopColor="#E8871E" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#E8871E" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Districts */}
      <g>
        {shapes.map((s, i) => (
          <path key={s.id} d={s.d} fill="url(#kaFill)" stroke="#7CC4F5"
            strokeWidth={HOT.includes(s.id) ? 0.9 : 0.5}
            strokeOpacity={HOT.includes(s.id) ? 0.55 : 0.28}
            style={{
              opacity: drawn ? 1 : 0,
              transition: `opacity 700ms ease ${i * 26}ms`,
            }} />
        ))}
      </g>

      {/* Cross-district links — the product's actual claim, drawn as arcs so they read as
          connections between places rather than as borders. */}
      <g style={{ opacity: drawn ? 1 : 0, transition: 'opacity 900ms ease 700ms' }}>
        {ARCS.map(([a, b], i) => {
          const A = byId.get(a); const B = byId.get(b);
          if (!A || !B) return null;
          // Bow the arc perpendicular to the chord so two links between the same pair of
          // districts never sit on top of each other.
          const mx = (A.cx + B.cx) / 2;
          const my = (A.cy + B.cy) / 2;
          const dx = B.cx - A.cx; const dy = B.cy - A.cy;
          const len = Math.hypot(dx, dy) || 1;
          const bow = Math.min(70, len * 0.32);
          const qx = mx - (dy / len) * bow;
          const qy = my + (dx / len) * bow;
          const path = `M${A.cx},${A.cy} Q${qx},${qy} ${B.cx},${B.cy}`;
          return (
            <g key={`${a}-${b}`}>
              <path d={path} fill="none" stroke="url(#arcLine)" strokeWidth="1.4" strokeLinecap="round" />
              {/* A packet running the arc: the link is a live connection, not a drawn line.
                  The motion is applied to a wrapper <g>, not to the circle itself. React can
                  mount an <animate> child before its parent's attributes land, and SMIL then
                  evaluates the circle with r="undefined"; a <g> has no geometry to be missing,
                  so the ordering stops mattering. */}
              <g>
                <animateMotion dur={`${3.4 + i * 0.7}s`} repeatCount="indefinite" path={path} />
                <circle r="2.2" fill="#E8B44A">
                  <animate attributeName="opacity" values="0;1;1;0" dur={`${3.4 + i * 0.7}s`} repeatCount="indefinite" />
                </circle>
              </g>
            </g>
          );
        })}
      </g>

      {/* Hotspots */}
      <g style={{ opacity: drawn ? 1 : 0, transition: 'opacity 700ms ease 900ms' }}>
        {HOT.map((id, i) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <g key={id}>
              {/* Scaled rather than radius-animated. Animating r makes the browser recompute
                  geometry each frame, and React can mount the <animate> child before the
                  parent's r attribute lands -- which SMIL reports as r="undefined". A
                  transform sidesteps both: it composites, and it needs nothing from r. */}
              <circle cx={s.cx} cy={s.cy} r="22" fill="url(#hotGlow)"
                style={{ transformOrigin: `${s.cx}px ${s.cy}px`, animation: `kadi-hot ${3 + i * 0.4}s ease-in-out infinite` }} />
              <circle cx={s.cx} cy={s.cy} r="3.1" fill="#E8871E" stroke="#fff" strokeWidth="0.9" strokeOpacity="0.85" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
