// Shell — top bar (brand, global search, language, alerts, role), sidebar nav,
// persistent fairness banner. Light, government-grade layout (docs/04 §3).
import { ReactNode, useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home, Share2, Brain, FileText, Users, Activity, Map, MessageSquare, ShieldCheck, Settings,
  Search, Bell, ChevronLeft, ChevronRight, ShieldAlert, X, Info,
  Globe, MapPin, ChevronDown, Check, LogOut, PanelLeftClose, PanelLeftOpen, Building2,
  Zap, TrendingUp, FilePlus2, Inbox,
} from 'lucide-react';
import { useMe, useAlerts, useLookups, useSubmissions } from '../api/hooks';
import { useLang, useT } from '../lib/i18n';
import { setRole, getRole, signOut as clearSession, districtParam, Role } from '../lib/api';
import { SeverityDot } from './ui';
import { Popover, usePopover } from '../lib/Popover';
import { useNav } from '../lib/useNav';

const NAV = [
  { to: '/', icon: Home, key: 'home', end: true },
  { to: '/graph', icon: Share2, key: 'graph' },
  { to: '/cases', icon: FileText, key: 'cases' },
  { to: '/offenders', icon: Users, key: 'offenders' },
  { to: '/health', icon: Activity, key: 'health' },
  { to: '/map', icon: Map, key: 'map' },
  { to: '/intelligence', icon: Brain, key: 'insights' },
  { to: '/react', icon: Zap, key: 'react' },
  { to: '/forecast', icon: TrendingUp, key: 'forecast' },
  { to: '/audit', icon: ShieldCheck, key: 'audit', roles: ['SP', 'DSP', 'Analyst', 'DGP', 'Admin'] },
  { to: '/admin', icon: Settings, key: 'admin', roles: ['Admin', 'DGP'] },
  // About sits at the very bottom of the rail: orientation material, not a daily destination,
  // so it is last — below the operational and admin sections, out of the way but reachable.
  { to: '/about', icon: Info, key: 'about' },
];

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const alertsPop = usePopover();
  const { lang, setLang } = useLang();
  const t = useT();
  const nav = useNav();
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

  // Scope lives in the URL (see lib/api.ts), which means a link that drops the query string
  // silently widens what the reader is looking at. Drilling into Belagavi and clicking any
  // sidebar item returned a state view under the same session -- no warning, and the scope
  // chip in the header quietly flipped back to "All Karnataka". Carrying the parameter keeps
  // the rail a way of changing SUBJECT while the scope stays where it was put.
  const scopeQuery = (() => {
    const d = districtParam();
    return d ? `?district=${encodeURIComponent(d)}` : '';
  })();
  const withScope = (to: string) => (to === '/' ? `/${scopeQuery}` : `${to}${scopeQuery}`);

  // One destination, two meanings. A station officer files a case; an SP, the DGP or the
  // Administrator decides one. The approver also gets a count, because a queue you have to
  // open to discover is empty is a queue people stop opening.
  const canSubmitCase = Boolean(me?.capabilities.canSubmitCase);
  const canApproveCases = Boolean(me?.capabilities.canApproveCases);
  const { data: pendingSubs } = useSubmissions('pending', canApproveCases);
  const writePath = canSubmitCase
    ? { icon: FilePlus2, label: t('registerCase'), pending: 0 }
    : canApproveCases
      ? { icon: Inbox, label: t('approvals'), pending: (pendingSubs?.items || []).length }
      : null;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      {/* KSP chrome: navy-teal bar with their signature gold rule beneath */}
      {/* A non-wrapping flex row in which nothing was allowed to shrink. At 768px its children
          measured 791px against a 656px budget, so the document scrolled sideways on every page
          -- the search box is a fixed w-64 and the scope chip renders at its natural width, and
          neither would give. The row now has exactly ONE elastic child, the search, and every
          other item is pinned; the gap tightens below lg, where the pressure is. */}
      <header className="h-14 bg-kadi-navy text-white flex items-center px-4 gap-2 lg:gap-4 shrink-0 z-20 border-b-[3px] border-kadi-gold">
        <div className="flex items-center gap-2.5 shrink-0">
          <img src={`${import.meta.env.BASE_URL}seal-karnataka.svg`} alt="Government of Karnataka" className="h-9 w-9 rounded-full bg-white/95 p-0.5 shrink-0" />
          <span className="font-semibold tracking-tight">{t('appName')}</span>
          {/* "Karnataka State Police — Crime Intelligence" is a 290px subtitle. Shown from md it
              took the whole middle of the row and squeezed the search to 51px; it is masthead
              decoration, so it waits until there is genuinely room for it. */}
          <span className="hidden xl:inline text-white/70 text-sm font-normal ml-1 border-l border-white/20 pl-3">{t('ksp')}</span>
        </div>
        {/* The one thing that gives. flex-1 lets it absorb the slack at wide widths and shrink
            first at narrow ones; max-w-64 stops it stretching across a large monitor; min-w-0 is
            what actually permits a flex child to go below its content width. */}
        <form onSubmit={doSearch} className="ml-auto relative hidden sm:block flex-1 min-w-0 max-w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')}
            className="bg-white/10 placeholder-white/50 text-white text-sm rounded-ctl pl-9 pr-3 py-1.5 w-full focus:bg-white/20 outline-none" />
        </form>
        {/* The write path lives in the top bar, not the sidebar, and it is icon-only.
            It is one screen that means two different things: a station officer FILES a case
            there, everyone senior APPROVES one. Calling it "Register" in the sidebar was wrong
            for every role above a police station, and carrying two labels for one destination
            in a list of nouns read as two features. An icon with a role-correct tooltip says
            it once, and the badge does the rest. */}
        {writePath && (
          <NavLink to="/register"
            className={({ isActive }) => `relative grid place-items-center w-9 h-9 shrink-0 rounded-ctl transition-colors ${
              isActive ? 'bg-kadi-gold text-kadi-navy' : 'bg-white/10 text-white hover:bg-white/20'}`}
            title={writePath.label} aria-label={writePath.label}>
            <writePath.icon size={17} />
            {writePath.pending > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white
                text-[10px] font-semibold grid place-items-center font-num" data-notranslate>
                {writePath.pending > 99 ? '99+' : writePath.pending}
              </span>
            )}
          </NavLink>
        )}
        {/* Icon-only below lg. The label is the widest piece of optional text in this row, and
            dropping it there is what buys the search box a usable width at 640-1023px. The
            tooltip and aria-label carry the meaning when the word is not on screen. */}
        <NavLink to="/assistant"
          className={({ isActive }) => `flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 shrink-0 rounded-ctl transition-colors ${
            isActive ? 'bg-kadi-gold text-kadi-navy' : 'bg-white/10 text-white hover:bg-white/20'}`}
          title="Ask KADI anything about a case, offender, or district"
          aria-label={t('assistant')}>
          <MessageSquare size={16} /> <span className="hidden lg:inline">{t('assistant')}</span>
        </NavLink>
        <button onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
          className="text-sm px-2 py-1 shrink-0 rounded hover:bg-white/10" title="Language">
          {lang === 'en' ? 'ಕನ್ನಡ' : 'EN'}
        </button>
        <ScopeBadge me={me} />
        <button ref={alertsPop.anchorRef as React.RefObject<HTMLButtonElement>}
          onClick={alertsPop.toggle} {...alertsPop.holdProps}
          aria-expanded={alertsPop.open} title={t('alerts')}
          className="relative p-1.5 shrink-0 rounded hover:bg-white/10">
          <Bell size={18} />
          {alerts && alerts.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-kadi-gold text-kadi-navy font-semibold text-[10px] rounded-full w-4 h-4 grid place-items-center">{alerts.length}</span>
          )}
        </button>
        <Popover open={alertsPop.open} anchorRef={alertsPop.anchorRef} panelRef={alertsPop.panelRef}
          side="bottom" align="end" {...alertsPop.panelProps}
          className="pop-in w-80 card text-ink shadow-xl" style={{ maxHeight: '70vh' }}>
          <AlertsPanel onClose={alertsPop.close} />
        </Popover>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — icon-only below md, labelled (collapsible) from md up */}
        <aside className={`bg-surface border-r border-line flex flex-col shrink-0 transition-all w-14 ${collapsed ? 'md:w-14' : 'md:w-52'}`}>
          {/* The collapse control belongs at the top of the rail, next to what it collapses --
              not buried at the foot beneath the account row, which is where people looked for
              sign-out and found a chevron instead. */}
          {/* The rail's own heading. This strip held a lone chevron and a lot of nothing, directly
              under the masthead — the first thing a reader's eye lands on when it drops into the
              sidebar. Naming what the list below IS costs nothing and stops the column starting
              on an empty note. Hidden when collapsed, where there is no room for a word. */}
          <div className={`hidden md:flex items-center border-b border-line h-9 ${collapsed ? 'justify-center px-1' : 'justify-between pl-3 pr-2'}`}>
            {!collapsed && (
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">
                {t('navHeading')}
              </span>
            )}
            <button onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="grid place-items-center w-7 h-7 rounded-ctl text-ink-muted hover:bg-kadi-blue50 hover:text-kadi-blue transition-colors">
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <nav className={`flex-1 py-2 space-y-0.5 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-1.5 md:px-2'}`}>
            {visibleNav.map((n) => (
              <NavLink key={n.key} to={withScope(n.to)} end={n.end} title={t(n.key)}
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
            role={role} label={me?.capabilities.label} scopeLabel={me?.capabilities.effectiveScope}
            unitName={me?.capabilities.unitName} districtName={me?.capabilities.districtName}
            authenticated={me?.capabilities.authenticated} email={me?.capabilities.email}
            collapsed={collapsed}
            onChangeRole={(r) => { setRole(r); window.location.reload(); }}
          />
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-auto">
          <FairnessBanner />
          {/* Keyed on the route so each page replays the enter animation. The animation
              itself is CSS (see .page-enter) rather than framer-motion: a JS tween on this
              wrapper stalled at opacity 0 on the map route and left the whole page invisible,
              and no decorative fade is worth that. */}
          <div key={location.pathname.split('/')[1] || 'home'}
            className="page-enter p-5 max-w-[1500px] mx-auto">
            {children}
          </div>
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
  const p = usePopover();
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
  // A signed-in district officer is pinned to their own district: show what they hold, not a
  // picker that cannot go anywhere.
  if (cap.effectiveScope === 'district' && !cap.canSwitchDistrict) {
    return (
      <div className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] border bg-kadi-gold/20 border-kadi-gold/40"
        title={`${cap.districtName || 'Your district'} — this is the whole of your read scope`}>
        <MapPin size={13} />
        <span className="truncate max-w-[150px]">{cap.districtName || current?.name || 'Your district'}</span>
      </div>
    );
  }
  if (cap.effectiveScope === 'unit') {
    return (
      <div className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] border bg-kadi-teal/20 border-kadi-teal/40"
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
    <div className="hidden sm:block shrink-0">
      <button ref={p.anchorRef as React.RefObject<HTMLButtonElement>}
        onClick={p.toggle} {...p.holdProps} aria-expanded={p.open}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] border transition-colors ${
          atState ? 'bg-white/10 border-white/20 hover:bg-white/20'
                  : 'bg-kadi-gold/20 border-kadi-gold/40 hover:bg-kadi-gold/30'}`}>
        {atState ? <Globe size={13} className="shrink-0" /> : <MapPin size={13} className="shrink-0" />}
        <span className="truncate max-w-[9rem]">
          {atState ? 'All Karnataka' : (current?.name || `District ${cap.districtId}`)}
        </span>
        {/* The count is a decoration, not the scope. It is the first thing to go when the row
            is tight -- "All Karnataka" alone still says everything the chip has to say. */}
        {atState && <span className="hidden lg:inline text-white/55 shrink-0">· 31 districts</span>}
        <ChevronDown size={12} className="opacity-70" />
      </button>

      <Popover open={p.open} anchorRef={p.anchorRef} panelRef={p.panelRef}
        side="bottom" align="end" {...p.panelProps}
        className="pop-in w-64 bg-surface border border-line rounded-card shadow-xl py-1"
        style={{ maxHeight: 420 }}>
        <>
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
        </>
      </Popover>
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

function SidebarFooter({ role, label, scopeLabel, unitName, districtName, collapsed, onChangeRole, authenticated, email }: {
  role: Role; label?: string; scopeLabel?: string; unitName?: string | null;
  districtName?: string | null; collapsed: boolean; onChangeRole: (r: Role) => void;
  authenticated?: boolean; email?: string | null;
}) {
  const t = useT();
  const p = usePopover();
  const roles: Role[] = ['DGP', 'Analyst', 'Admin', 'SP', 'DSP', 'SI', 'SHO'];
  // Clears the session token as well as the demo role. Dropping only the role left a
  // valid token in storage, so 'sign out' returned you to the door already signed in.
  const signOut = () => { clearSession(); window.location.href = '/app/login'; };

  const tier = scopeLabel === 'unit' ? 'unit' : scopeLabel === 'district' ? 'district' : 'state';
  const meta = TIER_META[tier];
  const TierIcon = meta.icon;
  const scopeText = tier === 'unit'
    ? (unitName || 'One station register')
    : tier === 'district' ? (districtName || 'One district') : 'All 31 districts';

  return (
    <div className="border-t border-line">
      {/* WHY SIGN OUT USED TO DISAPPEAR AS YOU REACHED FOR IT.
          This row spread its hover handlers and then wrote onMouseEnter={() => setOpen(true)}
          after the spread. The later prop wins, so the handler that CANCELS a pending close was
          silently thrown away. The panel sits a few pixels clear of this row, and crossing that
          dead space fires mouseleave and schedules a close; re-entering the panel never
          cancelled it, so the menu closed a quarter of a second later -- right as the pointer
          arrived on Sign out. usePopover keeps one timer that both the row and the panel can
          cancel, so the two are a single region, and clicking pins the panel outright. */}
      <Popover open={p.open} anchorRef={p.anchorRef} panelRef={p.panelRef}
        side="top" align="start" {...p.panelProps}
        className="pop-in w-[15.5rem] card p-0 text-ink shadow-xl">
        <>
          <div className="px-3 py-2.5 bg-kadi-navy text-white">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/55">
              {authenticated ? 'Signed in as' : 'Demo access'}
            </div>
            <div className="text-[14px] font-semibold leading-tight mt-0.5">{label || role}</div>
            {authenticated && email && (
              <div className="text-[11px] text-white/60 truncate mt-0.5">{email}</div>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-white/75">
              <TierIcon size={12} className="shrink-0" />
              <span className="truncate">{scopeText}</span>
            </div>
          </div>

          {/* Role switching belongs to the demo path only. A signed-in officer's scope comes
              from their account -- offering a switcher would imply it is theirs to change. */}
          {!authenticated && (
            <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-[0.14em] text-ink-muted">
              {t('switchRole')}
            </div>
          )}
          <div className={`pb-1 max-h-[13rem] overflow-auto ${authenticated ? 'hidden' : ''}`}>
            {roles.map((r) => (
              <button key={r} onClick={() => { p.close(); onChangeRole(r); }}
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
        </>
      </Popover>

      {/* The resting state. A tier-coloured ring around the initial is the whole status
          indicator: which of the three levels you are standing at, readable at a glance and
          still readable when the rail is collapsed to icons. */}
      <div ref={p.anchorRef as React.RefObject<HTMLDivElement>}
        {...p.hoverProps} onClick={p.toggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.toggle(); } }}
        aria-expanded={p.open} aria-label="Account"
        className={`flex items-center gap-2.5 cursor-pointer transition-colors outline-none ${
          p.open ? 'bg-surface-3' : 'hover:bg-surface-3/70'} ${collapsed ? 'justify-center p-2' : 'px-3 py-2.5'}`}>
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

// The notifications panel, enhanced (P5-2): grouped by kind with counts and a severity filter,
// and a per-viewer read state so an alert seen once stops drawing the eye. The read set lives
// in localStorage — a lightweight per-viewer convenience, not shared state — and is wrapped so
// a private window that throws on access degrades to "nothing read yet" rather than breaking.
const KIND_LABEL: Record<string, string> = {
  new_link: 'Cross-district links', offender: 'Offenders', health: 'Slipping cases',
  hotspot: 'Emerging hotspots', anomaly: 'Station anomalies', network: 'Networks',
};
function readSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('kadi.alerts.read') || '[]')); } catch { return new Set(); }
}
function markRead(ids: string[]) {
  try {
    const s = readSet(); ids.forEach((i) => s.add(i));
    localStorage.setItem('kadi.alerts.read', JSON.stringify([...s]));
  } catch { /* private window: read state is a convenience, not a requirement */ }
}
function AlertsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { data: alerts } = useAlerts();
  const nav = useNav();
  const [onlyHigh, setOnlyHigh] = useState(false);
  const read = useState(() => readSet())[0];
  // Mark everything currently shown as read when the panel opens, so the badge clears.
  useEffect(() => { if (alerts?.length) markRead(alerts.map((a: any) => a.alertId)); }, [alerts]);

  const go = (a: any) => {
    onClose();
    if (a.caseMasterId) nav(`/graph?case=${a.caseMasterId}`);
    else if (a.offenderIdentityId) nav(`/offenders/${a.offenderIdentityId}`);
    else if (a.clusterId) nav(`/graph?cluster=${a.clusterId}`);
    else if (a.kind === 'hotspot') nav('/map');
    else if (a.kind === 'health') nav('/health');
  };

  const filtered = (alerts || []).filter((a: any) => !onlyHigh || a.severity === 'high');
  // Group by kind, kinds ordered by their most-severe member. A plain object, not a Map:
  // `Map` is the lucide icon in this file's imports, so the global constructor is shadowed.
  const SEV: any = { high: 0, medium: 1, low: 2, info: 3 };
  const groups: Record<string, any[]> = {};
  for (const a of filtered) { const k = a.kind || 'other'; (groups[k] = groups[k] || []).push(a); }
  const ordered = Object.entries(groups).sort((x, y) =>
    Math.min(...x[1].map((a: any) => SEV[a.severity] ?? 3)) - Math.min(...y[1].map((a: any) => SEV[a.severity] ?? 3)));

  return (
    <div>
      <div className="px-4 py-2 border-b border-line flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t('alerts')}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setOnlyHigh((v) => !v)}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${onlyHigh ? 'bg-danger text-white border-danger' : 'border-line text-ink-muted hover:bg-surface-3'}`}>
            High only
          </button>
          <button onClick={onClose}><X size={14} className="text-ink-muted" /></button>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        {ordered.map(([kind, list]) => (
          <div key={kind}>
            <div className="px-4 pt-2.5 pb-1 flex items-center gap-2 sticky top-0 bg-surface">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">{KIND_LABEL[kind] || kind.replace(/_/g, ' ')}</span>
              <span className="text-[10.5px] text-ink-muted">{list.length}</span>
            </div>
            {list.slice(0, 6).map((a: any) => {
              const unseen = !read.has(a.alertId);
              return (
                <button key={a.alertId} onClick={() => go(a)} className="w-full text-left px-4 py-2.5 hover:bg-surface-3 border-b border-line/60 flex gap-2">
                  <SeverityDot severity={a.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-1.5">
                      {unseen && <span className="w-1.5 h-1.5 rounded-full bg-kadi-blue shrink-0" />}{a.title}
                    </div>
                    <div className="text-xs text-ink-muted truncate">{a.reason}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
        {!filtered.length && <div className="p-4 text-sm text-ink-muted">{onlyHigh ? 'No high-severity alerts.' : 'No alerts.'}</div>}
      </div>
    </div>
  );
}
