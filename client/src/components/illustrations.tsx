// illustrations.tsx — on-brand animated SVG illustrations (navy/blue/teal/saffron).
// Custom vector art (no external images) so they stay crisp, themeable and CSP-safe.
import { motion } from 'framer-motion';

const NAVY = '#0f2f44', BLUE = '#1A6FC4', TEAL = '#2FA8A0', SAFFRON = '#E8871E', RED = '#C0392B', GREY = '#8A94A3';

// 1) Silos → connected graph: the core "connect the links" idea.
export function SiloToGraph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 240" className={className} role="img" aria-label="Fragmented FIRs connecting into one network">
      <defs>
        <linearGradient id="il-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#EAF3FB" /><stop offset="1" stopColor="#F5F7FA" /></linearGradient>
      </defs>
      <rect width="420" height="240" rx="12" fill="url(#il-sky)" />
      {/* left: isolated silos */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(40, ${40 + i * 55})`}>
          <rect width="70" height="38" rx="6" fill="#fff" stroke="#D9E1EC" />
          <rect x="10" y="9" width="34" height="4" rx="2" fill={GREY} />
          <rect x="10" y="19" width="50" height="4" rx="2" fill="#D9E1EC" />
          <rect x="10" y="27" width="24" height="4" rx="2" fill="#D9E1EC" />
        </g>
      ))}
      <text x="60" y="220" fontSize="11" fill={GREY} textAnchor="middle">Siloed FIRs</text>
      {/* arrow */}
      <motion.path d="M130 120 h50" stroke={BLUE} strokeWidth="2.5" fill="none" markerEnd="url(#il-arrow)"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
      <defs><marker id="il-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill={BLUE} /></marker></defs>
      {/* right: connected network */}
      <g transform="translate(200, 0)">
        {[[70, 60], [150, 45], [40, 130], [120, 120], [180, 130], [95, 190]].map((p, i) => (
          <motion.line key={i} x1="110" y1="110" x2={p[0]} y2={p[1]} stroke={i % 2 ? TEAL : NAVY} strokeWidth="2" strokeOpacity="0.6"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.4 + i * 0.08 }} />
        ))}
        <line x1="70" y1="60" x2="150" y2="45" stroke={TEAL} strokeWidth="2" strokeOpacity="0.5" />
        {([[70, 60], [150, 45], [40, 130], [120, 120], [180, 130], [95, 190]] as [number, number][]).map((n, i) => (
          <motion.rect key={i} x={n[0] - 11} y={n[1] - 8} width="22" height="16" rx="4" fill={BLUE} stroke="#fff" strokeWidth="1.5"
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.08, type: 'spring', stiffness: 200 }} />
        ))}
        <motion.circle cx="110" cy="110" r="16" fill={SAFFRON} stroke="#fff" strokeWidth="2.5"
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 160 }} />
      </g>
      <text x="310" y="220" fontSize="11" fill={NAVY} fontWeight="600" textAnchor="middle">One living graph</text>
    </svg>
  );
}

// 2) Fairness shield: excluded protected attributes.
export function FairnessShield({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="Fairness — protected attributes excluded">
      <motion.path d="M100 20 L165 45 V105 C165 150 135 172 100 185 C65 172 35 150 35 105 V45 Z"
        fill="#EAF3FB" stroke={BLUE} strokeWidth="3" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1 }} />
      <motion.path d="M72 100 l18 18 l38 -42" fill="none" stroke={'#1E874B'} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.8 }} />
      {['caste', 'religion', 'occupation'].map((t, i) => (
        <g key={t} transform={`translate(${40 + i * 45}, 150)`}>
          <text x="0" y="0" fontSize="9" fill={RED} textAnchor="middle" textDecoration="line-through">{t}</text>
        </g>
      ))}
    </svg>
  );
}

// 3) Pipeline flow: FIR → resolve → graph → insight.
export function PipelineFlow({ className = '' }: { className?: string }) {
  const steps = [['FIR', BLUE], ['Resolve', TEAL], ['Graph', NAVY], ['Insight', SAFFRON]];
  return (
    <svg viewBox="0 0 460 90" className={className} role="img" aria-label="Analytics pipeline">
      {steps.map((s, i) => (
        <g key={i} transform={`translate(${20 + i * 115}, 25)`}>
          <motion.rect width="90" height="42" rx="9" fill="#fff" stroke={s[1] as string} strokeWidth="2"
            initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.15 }} />
          <circle cx="18" cy="21" r="6" fill={s[1] as string} />
          <text x="34" y="26" fontSize="12" fontWeight="600" fill={NAVY}>{s[0]}</text>
          {i < 3 && <motion.path d={`M92 21 h20`} stroke={GREY} strokeWidth="2" markerEnd="url(#pf-a)"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2 + i * 0.15 }} />}
        </g>
      ))}
      <defs><marker id="pf-a" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill={GREY} /></marker></defs>
    </svg>
  );
}

// 4) Map hotspot with pulsing ring.
export function MapHotspot({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={className} role="img" aria-label="Emerging crime hotspot">
      <rect width="200" height="160" rx="10" fill="#E7EEF6" />
      <path d="M40 30 Q60 20 90 34 T150 40 Q170 60 160 100 T120 140 Q80 150 50 120 T30 70 Q28 45 40 30 Z" fill="#D3E1F0" stroke="#B9C6D8" />
      {[[70, 60], [110, 50], [95, 95], [140, 90], [60, 110]].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={BLUE} opacity="0.7" />)}
      <motion.circle cx="110" cy="80" r="9" fill={RED} stroke="#fff" strokeWidth="2" />
      <motion.circle cx="110" cy="80" r="9" fill="none" stroke={RED} strokeWidth="2"
        animate={{ r: [9, 28], opacity: [0.6, 0] }} transition={{ duration: 1.8, repeat: Infinity }} />
    </svg>
  );
}

// 5) Risk gauge.
export function RiskArt({ className = '' }: { className?: string }) {
  const r = 46, c = Math.PI * r;
  return (
    <svg viewBox="0 0 160 110" className={className} role="img" aria-label="Behaviour-based risk score">
      <path d={`M30 90 A${r} ${r} 0 0 1 130 90`} fill="none" stroke="#EDF1F6" strokeWidth="12" strokeLinecap="round" />
      <motion.path d={`M30 90 A${r} ${r} 0 0 1 130 90`} fill="none" stroke={SAFFRON} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * 0.35 }} transition={{ duration: 1.1 }} />
      <text x="80" y="86" fontSize="26" fontWeight="700" fill={NAVY} textAnchor="middle">72</text>
      <text x="80" y="102" fontSize="10" fill={GREY} textAnchor="middle">behaviour only</text>
    </svg>
  );
}

// 7) Investigation health: an ECG pulse that flatlines into a flagged case.
export function HealthPulse({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 110" className={className} role="img" aria-label="Investigation health early warning">
      <line x1="0" y1="60" x2="260" y2="60" stroke="#EDF1F6" strokeWidth="1" />
      <motion.path
        d="M0 60 h30 l8 -22 l10 44 l9 -22 h28 l8 -16 l10 32 l9 -16 h30 l8 -10 l10 20 l9 -10 h40"
        fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4 }} />
      <motion.path d="M209 60 h51" fill="none" stroke={RED} strokeWidth="2.5" strokeDasharray="4 3"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 1.2 }} />
      <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.6, type: 'spring' }}>
        <circle cx="235" cy="60" r="9" fill={RED} />
        <text x="235" y="64" fontSize="11" fontWeight="700" fill="#fff" textAnchor="middle">!</text>
      </motion.g>
      <text x="6" y="92" fontSize="9" fill={GREY}>investigation progressing</text>
      <text x="196" y="92" fontSize="9" fill={RED}>slipping</text>
    </svg>
  );
}

// 8) Offender network cluster: a gang emerging from scattered cases.
export function NetworkCluster({ className = '' }: { className?: string }) {
  const nodes: [number, number][] = [[52, 40], [110, 26], [150, 62], [96, 78], [40, 92], [140, 112], [78, 122]];
  return (
    <svg viewBox="0 0 200 150" className={className} role="img" aria-label="Offender network cluster">
      <motion.ellipse cx="98" cy="74" rx="76" ry="58" fill={BLUE} fillOpacity="0.08" stroke={BLUE} strokeOpacity="0.35"
        strokeDasharray="5 4" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6 }} />
      {nodes.map((n, i) => (
        <motion.line key={i} x1="98" y1="74" x2={n[0]} y2={n[1]} stroke={NAVY} strokeOpacity="0.45" strokeWidth="1.4"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3 + i * 0.07, duration: 0.5 }} />
      ))}
      {nodes.map((n, i) => (
        <motion.rect key={i} x={n[0] - 8} y={n[1] - 6} width="16" height="12" rx="3" fill={BLUE} stroke="#fff" strokeWidth="1.2"
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.35 + i * 0.07, type: 'spring', stiffness: 220 }} />
      ))}
      <motion.circle cx="98" cy="74" r="13" fill={RED} stroke="#fff" strokeWidth="2.5"
        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 180 }} />
      <text x="98" y="145" fontSize="9" fill={GREY} textAnchor="middle">one offender · seven FIRs</text>
    </svg>
  );
}

// 9) Excel sheets → live dashboard.
export function SheetToDashboard({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 130" className={className} role="img" aria-label="Static sheets replaced by live dashboards">
      <g>
        <rect x="8" y="20" width="86" height="92" rx="6" fill="#fff" stroke="#D9E1EC" />
        {Array.from({ length: 7 }).map((_, i) => (
          <line key={i} x1="8" y1={32 + i * 12} x2="94" y2={32 + i * 12} stroke="#EDF1F6" />
        ))}
        <line x1="36" y1="20" x2="36" y2="112" stroke="#EDF1F6" /><line x1="64" y1="20" x2="64" y2="112" stroke="#EDF1F6" />
        <text x="51" y="124" fontSize="9" fill={GREY} textAnchor="middle">Excel</text>
      </g>
      <motion.path d="M104 66 h32" stroke={BLUE} strokeWidth="2.5" markerEnd="url(#s2d)"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
      <defs><marker id="s2d" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill={BLUE} /></marker></defs>
      <g transform="translate(150,20)">
        <rect width="102" height="92" rx="6" fill="#fff" stroke="#D9E1EC" />
        {[[10, 62, 14], [30, 50, 26], [50, 34, 42], [70, 56, 20]].map(([x, y, h], i) => (
          <motion.rect key={i} x={x} y={y} width="12" height={h} rx="2" fill={[BLUE, TEAL, SAFFRON, NAVY][i]}
            initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
            style={{ transformOrigin: `${x + 6}px ${y + h}px` }} transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }} />
        ))}
        <motion.path d="M10 30 q22 -14 40 4 t42 -10" fill="none" stroke={TEAL} strokeWidth="2"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.8, duration: 0.7 }} />
        <text x="51" y="104" fontSize="9" fill={NAVY} fontWeight="600" textAnchor="middle">Live intelligence</text>
      </g>
    </svg>
  );
}

// 6) Assistant / chat with citation.
export function AssistantArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" className={className} role="img" aria-label="AI assistant with citations">
      <motion.rect x="20" y="20" width="120" height="30" rx="10" fill={NAVY} initial={{ x: 40, opacity: 0 }} animate={{ x: 20, opacity: 1 }} />
      <rect x="32" y="31" width="70" height="4" rx="2" fill="#fff" opacity="0.85" />
      <rect x="32" y="39" width="45" height="4" rx="2" fill="#fff" opacity="0.5" />
      <motion.rect x="60" y="62" width="120" height="40" rx="10" fill="#fff" stroke="#D9E1EC" initial={{ x: 40, opacity: 0 }} animate={{ x: 60, opacity: 1 }} transition={{ delay: 0.2 }} />
      <rect x="72" y="72" width="90" height="4" rx="2" fill={GREY} />
      <rect x="72" y="80" width="60" height="4" rx="2" fill="#D9E1EC" />
      <rect x="72" y="90" width="34" height="9" rx="4" fill={TEAL} opacity="0.25" />
      <text x="89" y="97" fontSize="7" fill={TEAL} textAnchor="middle">FIR-2026</text>
      <circle cx="150" cy="125" r="4" fill={SAFFRON} /><text x="70" y="128" fontSize="9" fill={GREY}>ಕನ್ನಡ · English · voice</text>
    </svg>
  );
}
