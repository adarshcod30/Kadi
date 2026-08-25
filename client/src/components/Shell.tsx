// Shell — top bar (brand, global search, language, alerts, role), sidebar nav,
// persistent fairness banner. Light, government-grade layout (docs/04 §3).
import { ReactNode, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Share2, Brain, FileText, Users, Activity, Map, MessageSquare, ShieldCheck, Settings,
  Search, Bell, ChevronLeft, ChevronRight, ShieldAlert, X, Info,
  Globe, MapPin, ChevronDown,
} from 'lucide-react';
import { useMe, useAlerts, useLookups } from '../api/hooks';
import { useLang, useT } from '../lib/i18n';
import { setRole, getRole, Role } from '../lib/api';
import { SeverityDot } from './ui';

const NAV = [
  { to: '/about', icon: Info, key: 'about' },
  { to: '/', icon: Home, key: 'home', end: true },
  { to: '/graph', icon: Share2, key: 'graph' },
  { to: '/cases', icon: FileText, key: 'cases' },
  { to: '/offenders', icon: Users, key: 'offenders' },
  { to: '/health', icon: Activity, key: 'health' },
  { to: '/map', icon: Map, key: 'map' },
  { to: '/intelligence', icon: Brain, key: 'intelligence' },
  { to: '/audit', icon: ShieldCheck, key: 'audit', roles: ['SP', 'DSP', 'Analyst', 'DGP', 'Admin'] },
  { to: '/admin', icon: Settings, key: 'admin', roles: ['Admin'] },
];

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const { lang, setLang } = useLang();
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const { data: me } = useMe();
  const { data: alerts } = useAlerts();
  const role = getRole();

  const [search, setSearch] = useState('');
  const doSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) nav(`/cases?search=${encodeURIComponent(search.trim())}`);
  };

  const visibleNav = NAV.filter((n) => !n.roles || (me && n.roles.includes(me.user.role)));

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      {/* KSP chrome: navy-teal bar with their signature gold rule beneath */}
      <header className="h-14 bg-kadi-navy text-white flex items-center px-4 gap-4 shrink-0 z-20 border-b-[3px] border-kadi-gold">
        <div className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt="Government of Karnataka" className="h-9 w-9 rounded-full bg-white/95 p-0.5 shrink-0" />
          <div className="flex items-center gap-1.5 font-semibold tracking-tight">
            <span className="w-6 h-6 rounded bg-white/15 grid place-items-center text-kadi-gold font-bold kn text-sm">ಕ</span>
            <span>{t('appName')}</span>
          </div>
          <span className="hidden md:inline text-white/70 text-sm font-normal ml-1 border-l border-white/20 pl-3">{t('ksp')}</span>
        </div>
        <form onSubmit={doSearch} className="ml-auto relative hidden sm:block">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')}
            className="bg-white/10 placeholder-white/50 text-white text-sm rounded-ctl pl-9 pr-3 py-1.5 w-64 focus:bg-white/20 outline-none" />
        </form>
        <NavLink to="/assistant"
          className={({ isActive }) => `flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-ctl transition-colors ${
            isActive ? 'bg-kadi-gold text-kadi-navy' : 'bg-white/10 text-white hover:bg-white/20'}`}
          title="Ask KADI anything about a case, offender, or district">
          <MessageSquare size={16} /> <span className="hidden sm:inline">{t('assistant')}</span>
        </NavLink>
        <button onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
          className="text-sm px-2 py-1 rounded hover:bg-white/10" title="Language">
          {lang === 'en' ? 'ಕನ್ನಡ' : 'EN'}
        </button>
        <ScopeBadge me={me} />
        <div className="relative">
          <button onClick={() => setShowAlerts((s) => !s)} className="relative p-1.5 rounded hover:bg-white/10">
            <Bell size={18} />
            {alerts && alerts.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-kadi-gold text-kadi-navy font-semibold text-[10px] rounded-full w-4 h-4 grid place-items-center">{alerts.length}</span>
            )}
          </button>
          {showAlerts && <AlertsPanel onClose={() => setShowAlerts(false)} />}
        </div>
        <RoleMenu current={role} onChange={(r) => { setRole(r); window.location.reload(); }} label={me?.capabilities.label} />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — icon-only below md, labelled (collapsible) from md up */}
        <aside className={`bg-surface border-r border-line flex flex-col shrink-0 transition-all w-14 ${collapsed ? 'md:w-14' : 'md:w-52'}`}>
          <nav className="flex-1 py-3">
            {visibleNav.map((n) => (
              <NavLink key={n.key} to={n.to} end={n.end} title={t(n.key)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'text-kadi-blue bg-kadi-blue50 border-r-2 border-kadi-blue' : 'text-ink-muted hover:bg-surface-3'
                  }`}>
                <n.icon size={20} className="shrink-0" />
                {!collapsed && <span className="hidden md:inline">{t(n.key)}</span>}
              </NavLink>
            ))}
          </nav>
          <button onClick={() => setCollapsed((c) => !c)}
            className="p-3 text-ink-muted hover:bg-surface-3 border-t border-line hidden md:block">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-auto">
          <FairnessBanner />
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname.split('/')[1] || 'home'}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }} className="p-5 max-w-[1500px] mx-auto">
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function FairnessBanner() {
  const t = useT();
  const [open, setOpen] = useState(sessionStorage.getItem('kadi.fairness.dismissed') !== '1');
  if (!open) return null;
  return (
    <div className="bg-kadi-blue50 border-b border-line px-5 py-2 flex items-center gap-2 text-[13px] text-kadi-navy700">
      <ShieldAlert size={16} className="text-kadi-blue shrink-0" />
      <span>{t('fairness')}</span>
      <button onClick={() => { setOpen(false); sessionStorage.setItem('kadi.fairness.dismissed', '1'); }}
        className="ml-auto text-ink-muted hover:text-ink"><X size={14} /></button>
    </div>
  );
}

// Scope has to be legible at a glance, not inferred from which numbers look smaller.
// Without this the two-tier model was invisible: a Sub-Inspector and the DGP saw the same
// chrome, and the only difference was in figures nobody was comparing side by side.
function ScopeBadge({ me }: { me: any }) {
  const [open, setOpen] = useState(false);
  const { data: lookups } = useLookups();
  if (!me) return null;
  const cap = me.capabilities || {};
  const districts = (lookups?.districts || []) as any[];
  // /lookups returns {id, name}. Reading districtId/districtName here rendered 31 blank
  // buttons -- the dropdown looked empty rather than broken, which is why it survived review.
  const current = districts.find((d: any) => String(d.id) === String(cap.districtId));
  const atState = cap.effectiveScope === 'state';

  // Changing scope is a URL change, not client state: it has to survive a reload and be
  // shareable, and the server re-derives scope from the query on every request anyway.
  const go = (districtId: string | null) => {
    const u = new URL(window.location.href);
    if (districtId) u.searchParams.set('district', districtId);
    else u.searchParams.delete('district');
    window.location.href = u.toString();
  };

  return (
    <div className="relative hidden sm:block">
      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] border transition-colors ${
          atState ? 'bg-white/10 border-white/20 hover:bg-white/20'
                  : 'bg-kadi-gold/20 border-kadi-gold/40 hover:bg-kadi-gold/30'}`}>
        {atState ? <Globe size={13} /> : <MapPin size={13} />}
        {atState ? 'All Karnataka' : (current?.name || `District ${cap.districtId}`)}
        {atState && <span className="text-white/55">· 31 districts</span>}
        <ChevronDown size={12} className="opacity-70" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 max-h-[420px] overflow-auto bg-surface border border-line rounded-card shadow-lg z-50 py-1">
          {cap.canViewWholeState && (
            <>
              <button onClick={() => go(null)}
                className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 hover:bg-kadi-blue50 ${
                  atState ? 'text-kadi-blue font-medium' : 'text-ink'}`}>
                <Globe size={13} /> All Karnataka
                <span className="text-ink-muted text-[11px] ml-auto">state view</span>
              </button>
              <div className="border-t border-line my-1" />
            </>
          )}
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-ink-muted">
            {cap.canViewWholeState ? 'Drill into a district' : 'Switch district'}
          </div>
          {districts.map((d: any) => (
            <button key={d.id} onClick={() => go(String(d.id))}
              className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-kadi-blue50 ${
                !atState && String(d.id) === String(cap.districtId)
                  ? 'text-kadi-blue font-medium' : 'text-ink'}`}>
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleMenu({ current, onChange, label }: { current: Role; onChange: (r: Role) => void; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const roles: Role[] = ['Analyst', 'DGP', 'Admin', 'SP', 'DSP', 'SI'];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-white/10">
        <span className="w-7 h-7 rounded-full bg-white/20 grid place-items-center text-xs font-semibold">{current[0]}</span>
        <span className="hidden md:inline">{label || current}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 card p-1 z-30 text-ink">
          <div className="px-3 py-2 text-xs text-ink-muted">{t('switchRole')}</div>
          {roles.map((r) => (
            <button key={r} onClick={() => onChange(r)}
              className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-surface-3 ${r === current ? 'text-kadi-blue font-medium' : ''}`}>{r}</button>
          ))}
          <div className="border-t border-line mt-1 pt-1">
            <button
              onClick={() => { localStorage.removeItem('kadi.role'); window.location.href = '/app/login'; }}
              className="w-full text-left px-3 py-2 rounded text-sm text-ink-muted hover:bg-surface-3">
              {t('signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { data: alerts } = useAlerts();
  const nav = useNavigate();
  const go = (a: any) => {
    onClose();
    if (a.caseMasterId) nav(`/graph?case=${a.caseMasterId}`);
    else if (a.offenderIdentityId) nav(`/offenders/${a.offenderIdentityId}`);
    else if (a.clusterId) nav(`/graph?cluster=${a.clusterId}`);
    else if (a.kind === 'hotspot') nav('/map');
    else if (a.kind === 'health') nav('/health');
  };
  return (
    <div className="absolute right-0 mt-2 w-80 card z-30 text-ink max-h-[70vh] overflow-auto">
      <div className="px-4 py-2 border-b border-line flex items-center justify-between">
        <span className="text-sm font-semibold">{t('alerts')}</span>
        <button onClick={onClose}><X size={14} className="text-ink-muted" /></button>
      </div>
      {(alerts || []).slice(0, 12).map((a) => (
        <button key={a.alertId} onClick={() => go(a)} className="w-full text-left px-4 py-2.5 hover:bg-surface-3 border-b border-line/60 flex gap-2">
          <SeverityDot severity={a.severity} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{a.title}</div>
            <div className="text-xs text-ink-muted truncate">{a.reason}</div>
          </div>
        </button>
      ))}
      {(!alerts || alerts.length === 0) && <div className="p-4 text-sm text-ink-muted">No alerts.</div>}
    </div>
  );
}
