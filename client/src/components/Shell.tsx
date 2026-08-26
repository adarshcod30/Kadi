// Shell — top bar (brand, global search, language, alerts, role), sidebar nav,
// persistent fairness banner. Light, government-grade layout (docs/04 §3).
import { ReactNode, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Share2, Brain, FileText, Users, Activity, Map, MessageSquare, ShieldCheck, Settings,
  Search, Bell, ChevronLeft, ChevronRight, ShieldAlert, X, Info,
  Globe, MapPin, ChevronDown, Check, LogOut, PanelLeftClose, PanelLeftOpen, Building2,
} from 'lucide-react';
import { useMe, useAlerts, useLookups } from '../api/hooks';
import { useLang, useT } from '../lib/i18n';
import { setRole, getRole, Role } from '../lib/api';
import { SeverityDot } from './ui';
import { useDismiss } from '../lib/useDismiss';

const NAV = [
  { to: '/', icon: Home, key: 'home', end: true },
  { to: '/graph', icon: Share2, key: 'graph' },
  { to: '/cases', icon: FileText, key: 'cases' },
  { to: '/offenders', icon: Users, key: 'offenders' },
  { to: '/health', icon: Activity, key: 'health' },
  { to: '/map', icon: Map, key: 'map' },
  { to: '/intelligence', icon: Brain, key: 'intelligence' },
  { to: '/audit', icon: ShieldCheck, key: 'audit', roles: ['SP', 'DSP', 'Analyst', 'DGP', 'Admin'] },
  { to: '/admin', icon: Settings, key: 'admin', roles: ['Admin'] },
  { to: '/about', icon: Info, key: 'about' },
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

  const alerts_ = useDismiss<HTMLDivElement>(showAlerts, () => setShowAlerts(false), { closeOnLeave: true });

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
          <span className="font-semibold tracking-tight">{t('appName')}</span>
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
        <div className="relative" ref={alerts_.ref} {...alerts_.hoverProps}>
          <button onClick={() => setShowAlerts((s) => !s)} className="relative p-1.5 rounded hover:bg-white/10">
            <Bell size={18} />
            {alerts && alerts.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-kadi-gold text-kadi-navy font-semibold text-[10px] rounded-full w-4 h-4 grid place-items-center">{alerts.length}</span>
            )}
          </button>
          {showAlerts && <AlertsPanel onClose={() => setShowAlerts(false)} />}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — icon-only below md, labelled (collapsible) from md up */}
        <aside className={`bg-surface border-r border-line flex flex-col shrink-0 transition-all w-14 ${collapsed ? 'md:w-14' : 'md:w-52'}`}>
          {/* The collapse control belongs at the top of the rail, next to what it collapses --
              not buried at the foot beneath the account row, which is where people looked for
              sign-out and found a chevron instead. */}
          <div className={`hidden md:flex items-center border-b border-line h-9 ${collapsed ? 'justify-center px-1' : 'justify-end px-2'}`}>
            <button onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="grid place-items-center w-7 h-7 rounded-ctl text-ink-muted hover:bg-kadi-blue50 hover:text-kadi-blue transition-colors">
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <nav className={`flex-1 py-2 space-y-0.5 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-1.5 md:px-2'}`}>
            {visibleNav.map((n) => (
              <NavLink key={n.key} to={n.to} end={n.end} title={t(n.key)}
                className={({ isActive }) =>
                  // Pill-shaped active state rather than a full-bleed band with a right rule.
                  // The inset pill reads as a selected item; the edge-to-edge band read as a
                  // section header, which is why the current page never looked current.
                  `group relative flex items-center gap-3 rounded-ctl px-2.5 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-kadi-blue text-white shadow-sm'
                      : 'text-ink-muted hover:bg-kadi-blue50 hover:text-kadi-navy700'
                  }`}>
                {({ isActive }) => (
                  <>
                    <n.icon size={19} className={`shrink-0 transition-transform ${isActive ? '' : 'group-hover:scale-110'}`} />
                    {!collapsed && <span className="hidden md:inline truncate">{t(n.key)}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <SidebarFooter
            role={role} label={me?.capabilities.label} scopeLabel={me?.capabilities.scope}
            unitName={me?.capabilities.unitName} districtName={me?.capabilities.districtName}
            collapsed={collapsed}
            onChangeRole={(r) => { setRole(r); window.location.reload(); }}
          />
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
  const dismiss = useDismiss<HTMLDivElement>(open, () => setOpen(false), { closeOnLeave: true });
  const { data: lookups } = useLookups();
  if (!me) return null;
  const cap = me.capabilities || {};
  const districts = (lookups?.districts || []) as any[];
  // /lookups returns {id, name}. Reading districtId/districtName here rendered 31 blank
  // buttons -- the dropdown looked empty rather than broken, which is why it survived review.
  const current = districts.find((d: any) => String(d.id) === String(cap.districtId));
  const atState = cap.effectiveScope === 'state';
  // A station officer holds exactly one register. Offering a district picker would imply a
  // choice they do not have, and the server would refuse it anyway -- so show the scope as a
  // fixed badge instead of a control.
  if (cap.effectiveScope === 'unit') {
    return (
      <div className="hidden sm:flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] border bg-kadi-teal/20 border-kadi-teal/40"
        title={`${cap.unitName} — this is the whole of your read scope`}>
        <Building2 size={13} />
        <span className="truncate max-w-[150px]">{cap.unitName}</span>
      </div>
    );
  }

  // Changing scope is a URL change, not client state: it has to survive a reload and be
  // shareable, and the server re-derives scope from the query on every request anyway.
  const go = (districtId: string | null) => {
    const u = new URL(window.location.href);
    if (districtId) u.searchParams.set('district', districtId);
    else u.searchParams.delete('district');
    window.location.href = u.toString();
  };

  return (
    <div className="relative hidden sm:block" ref={dismiss.ref} {...dismiss.hoverProps}>
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

// The sidebar's footer: who you are signed in as, and the control that collapses the rail.
//
// These were two stacked strips -- an identity row above a lone chevron button -- which read
// as two unrelated features and wasted a whole row on a single icon. Merged into one bar:
// identity on the left opens the account menu, the chevron on the right collapses. When the
// rail is collapsed the row reduces to the avatar alone, with the chevron moving beneath it
// so neither control is lost.
// The account control — the sidebar's foot.
//
// It was a click-to-open menu with a chevron, which made it look like a disclosure widget and
// meant sign-out took two deliberate actions to even see. It now opens on hover and closes
// when the pointer leaves, so the whole card is a single gesture: move onto it, read who you
// are signed in as and exactly what that role can reach, move away and it is gone.
//
// The panel leads with SCOPE rather than title. "Station House Officer" says nothing about
// what is on screen; "one station register, 276 FIRs" is the thing that explains why the
// numbers look the way they do, and it is the first question a new viewer asks.
const TIER_META: Record<string, { icon: any; tint: string; ring: string }> = {
  state: { icon: Globe, tint: 'text-kadi-blue', ring: 'ring-kadi-blue/30' },
  district: { icon: MapPin, tint: 'text-kadi-saffron', ring: 'ring-kadi-saffron/30' },
  unit: { icon: Building2, tint: 'text-kadi-teal', ring: 'ring-kadi-teal/30' },
};

function SidebarFooter({ role, label, scopeLabel, unitName, districtName, collapsed, onChangeRole }: {
  role: Role; label?: string; scopeLabel?: string; unitName?: string | null;
  districtName?: string | null; collapsed: boolean; onChangeRole: (r: Role) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { ref, hoverProps } = useDismiss<HTMLDivElement>(open, () => setOpen(false), { closeOnLeave: true });
  const roles: Role[] = ['DGP', 'Analyst', 'Admin', 'SP', 'DSP', 'SI', 'SHO'];
  const signOut = () => { localStorage.removeItem('kadi.role'); window.location.href = '/app/login'; };

  const tier = scopeLabel === 'unit' ? 'unit' : scopeLabel === 'district' ? 'district' : 'state';
  const meta = TIER_META[tier];
  const TierIcon = meta.icon;
  const scopeText = tier === 'unit'
    ? (unitName || 'One station register')
    : tier === 'district' ? (districtName || 'One district') : 'All 31 districts';

  return (
    <div className="border-t border-line relative" ref={ref} {...hoverProps}
      onMouseEnter={() => setOpen(true)}>
      {open && (
        <div className="absolute left-2 right-2 bottom-full mb-2 w-[15.5rem] card p-0 z-40 text-ink shadow-xl overflow-hidden">
          <div className="px-3 py-2.5 bg-kadi-navy text-white">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/55">Signed in as</div>
            <div className="text-[14px] font-semibold leading-tight mt-0.5">{label || role}</div>
            <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-white/75">
              <TierIcon size={12} className="shrink-0" />
              <span className="truncate">{scopeText}</span>
            </div>
          </div>

          <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-[0.14em] text-ink-muted">
            {t('switchRole')}
          </div>
          <div className="pb-1 max-h-[13rem] overflow-auto">
            {roles.map((r) => (
              <button key={r} onClick={() => { setOpen(false); onChangeRole(r); }}
                className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-kadi-blue50 ${
                  r === role ? 'text-kadi-blue font-medium' : 'text-ink'}`}>
                <span className="w-5 h-5 rounded-full bg-surface-3 grid place-items-center text-[10px] font-semibold shrink-0">{r[0]}</span>
                {r}
                {r === role && <Check size={13} className="ml-auto" />}
              </button>
            ))}
          </div>
          <button onClick={signOut}
            className="w-full text-left px-3 py-2 text-[13px] text-danger hover:bg-red-50 flex items-center gap-2 border-t border-line">
            <LogOut size={14} /> {t('signOut')}
          </button>
        </div>
      )}

      {/* The resting state. A tier-coloured ring around the initial is the whole status
          indicator: which of the three levels you are standing at, readable at a glance and
          still readable when the rail is collapsed to icons. */}
      <div className={`flex items-center gap-2.5 cursor-default transition-colors ${
        open ? 'bg-surface-3' : 'hover:bg-surface-3/70'} ${collapsed ? 'justify-center p-2' : 'px-3 py-2.5'}`}>
        <span className={`relative w-8 h-8 rounded-full bg-kadi-navy text-white grid place-items-center text-xs font-semibold shrink-0 ring-2 ${meta.ring}`}>
          {role[0]}
          <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-surface grid place-items-center ${meta.tint}`}>
            <TierIcon size={9} />
          </span>
        </span>
        {!collapsed && (
          <span className="hidden md:flex flex-col items-start min-w-0 leading-tight">
            <span className="text-[13px] font-medium text-ink truncate max-w-[118px]">{label || role}</span>
            <span className={`text-[11px] truncate max-w-[118px] ${meta.tint}`}>{scopeText}</span>
          </span>
        )}
      </div>
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
