# 04 — UI / UX Guidelines
### KADI — Light, government-grade, trustworthy, effortless

**Design north star:** it should feel like an official KSP / Government-of-Karnataka digital service — calm, light, authoritative, and *obvious to use for a non-technical officer* — but with modern, data-dense polish. Think "gov.in portal meets a clean analytics product."

---

## 1. Design principles
1. **Clarity over cleverness.** An SI with no training should understand any screen in 5 seconds.
2. **Evidence on demand.** Every insight has a visible "Why?" affordance. Nothing is a black box.
3. **Light & legible.** White/near-white surfaces, strong contrast, generous spacing. No dark theme.
4. **Trust cues.** KSP-style header, role badge, audit visibility, the fairness banner.
5. **Progressive disclosure.** Lead with the answer; details expand on click.
6. **Accessible (WCAG 2.1 AA).** Contrast ≥4.5:1, keyboard-navigable, focus states, screen-reader labels, English + Kannada.

## 2. Visual language (design tokens)

**Color — light government palette**
```
--kadi-navy:        #0B3D75   /* primary — headers, primary buttons, brand */
--kadi-navy-700:    #12305C
--kadi-blue:        #1A6FC4   /* interactive/links, active nav */
--kadi-blue-50:     #EAF3FB   /* selected/hover surfaces */
--kadi-saffron:     #E8871E   /* accent, "flagged"/alert highlight (use sparingly) */
--kadi-teal:        #2FA8A0   /* graph edges, secondary data */
--surface:          #FFFFFF
--surface-2:        #F5F7FA   /* app background */
--surface-3:        #EDF1F6   /* cards/wells */
--border:           #D9E1EC
--text:             #1C2A3A
--text-muted:       #5B6B7E
/* semantic */
--success:#1E874B  --warning:#C9820A  --danger:#C0392B  --info:#1A6FC4
/* gravity/status chips */
--heinous:#C0392B  --nonheinous:#5B6B7E
--status-open:#1A6FC4 --status-chargesheeted:#1E874B --status-undetected:#C9820A --status-false:#8A94A3
```
Use saffron/red **only** for genuine alerts/flags so they carry weight. Base UI is navy + blue on white.

**Typography**
- Font: **Inter** (UI) with **Noto Sans Kannada** for Kannada. System-font fallback.
- Scale: Display 28/600, H1 22/600, H2 18/600, Body 14/400, Small 12.5/400, Mono for IDs/CrimeNo.
- Line-height 1.5 body; tabular-nums for metrics.

**Spacing & shape**
- 8px spacing grid (4/8/12/16/24/32).
- Radius: 8px cards, 6px inputs/buttons, 999px chips.
- Elevation: subtle only — `0 1px 2px rgba(16,40,70,.06)`, hover `0 4px 12px rgba(16,40,70,.10)`.

**Iconography:** Lucide (line icons), 1.75px stroke. Consistent 20px in nav, 16px inline.

## 3. Layout shell
```
┌────────────────────────────────────────────────────────────────────┐
│ TOPBAR: [KADI logo] Karnataka State Police — Crime Intelligence      │
│         [ Global search ⌘K ]           [Kn/En] [🔔 alerts] [Role ▾]  │
├──────────┬─────────────────────────────────────────────────────────┤
│ SIDEBAR  │  FAIRNESS BANNER (thin, dismissible per session):         │
│ ▸ Home   │  "Insights use evidence & behavior only — never caste,   │
│ ▸ Graph  │   religion, or occupation."                    [Learn ▸]  │
│ ▸ Cases  │ ┌─────────────────────────────────────────────────────┐  │
│ ▸ Offend.│ │                                                     │  │
│ ▸ Health │ │   PAGE CONTENT                                       │  │
│ ▸ Map    │ │                                                     │  │
│ ▸ Assist │ │                                                     │  │
│ ▸ Audit* │ └─────────────────────────────────────────────────────┘  │
│ ▸ Admin* │  * = role-gated                                           │
└──────────┴─────────────────────────────────────────────────────────┘
```
- Left sidebar (collapsible, icon+label), top bar with global search (⌘K), language toggle (En/ಕನ್ನಡ), alerts bell, role/profile menu.
- Persistent **fairness banner** (thin) on analytics pages — a trust cue judges will notice.
- Breadcrumbs under top bar on detail pages.

## 4. Core components
- **KPI card:** big tabular number, label, delta vs baseline (arrow + %), sparkline optional.
- **Data table:** sticky header, sortable, filter chips row, row-click → detail, density toggle; status/gravity **chips** color-coded.
- **Chips/badges:** CaseCategory, Gravity (Heinous red), CaseStatus, edge-type.
- **Graph canvas (hero):** Cytoscape; node shapes by type (Case=rounded square, Offender=circle, Victim=diamond, Location=pin), size by importance, color by cluster; edge thickness = strength, color = type; hover tooltip; click → side "Why linked" panel; legend; controls (zoom, fit, expand cluster, filter, timeline scrubber). Smooth animated layout on load (the demo "snap-together" moment).
- **"Why?" side panel:** lists matched attributes + source FIR numbers (clickable), model factors for scores.
- **Map:** MapLibre, light basemap; district choropleth + points/heat; cluster popovers; layer switch (crime head, time).
- **Assistant panel:** chat bubbles with citation chips; mic button (push-to-talk), language toggle, "Export PDF" button; suggested prompts.
- **Alert item:** severity dot, title, reason, time, "view" action.
- **Empty/loading/error states:** skeletons for tables/graph; friendly empty copy ("No linked cases found for this FIR"); retry on error.

## 5. Screens (page-by-page)

### S1. Login
- KSP-style split: left = KADI brand + tagline "Connecting the links" + Karnataka emblem strip; right = Catalyst embedded auth (email + optional social). Government footer.
- After login → role-aware Home.

### S2. Home / Dashboard (role-aware)
- Row of KPI cards: Open cases (scope), Cases flagged (health), Active offender networks, New links (24h).
- **Alerts feed** (right rail): new cross-silo links, health flags, hotspots.
- **Quick actions:** "Open a case", "Explore the graph", search box.
- Small trend chart (cases by week) + top crime heads. Scope label shows the user's jurisdiction.

### S3. Case-Linkage Graph explorer (**hero screen**)
- Left: filters (crime head, date, district, edge types, min strength). Center: graph canvas. Right: contextual "Why linked" / selected-node detail.
- Entry: from a case, an offender, a cluster, or a search. On load, animate the ego-network assembling.
- Toggle: ego view ↔ full cluster; timeline scrubber to watch a chain form over time.
- Top actions: "Open in map", "Create alert/watch", "Export PDF briefing".

### S4. Cases (list) + Case detail
- List: searchable/filterable table (CrimeNo, crime head, station, date, status, gravity, flags).
- Detail: header (CrimeNo, status, gravity chips), timeline (incident → info received → registered → chargesheet), parties (accused/victims/complainant), acts/sections, location mini-map, **"Linked cases (N)"** → graph, health panel, "Ask assistant about this case".

### S5. Offender profile
- Header: canonical name, risk score gauge (with "Why this score?" factor breakdown — **no protected attributes**), districts touched, first/last seen.
- Tabs: Cases (all linked FIRs), Network (mini-graph), Arrests/Bail history, Co-offenders. Entity-resolution confidence shown.

### S6. Investigation-Health cockpit (**secondary hero**)
- Summary KPIs (avg investigation age, pendency %, undetected %, false-case %).
- Worklist table of flagged cases: flag chips + reason + **recommended action** + IO + age; sort/filter; bulk "acknowledge"/"export".
- Anomaly section: cases deviating from peers, with explanation.

### S7. Map / Hotspots
- District choropleth + points/heat; layer + time controls; cluster click → FIR list → "open in graph". Emerging-trend badges on spiking areas.

### S8. Assistant (full page + dockable panel)
- Chat with citations; mic (En/Kn); suggested prompts ("Show this accused's past cases", "Cyber-crime FIRs in Bengaluru this quarter"); export conversation to PDF; deep-links into graph/cockpit.

### S9. Audit (ACP/Admin) & Admin (Admin)
- Audit: searchable log (user, action, target, time).
- Admin: user list, assign roles + jurisdiction, data ingestion status, model recompute status/trigger.

## 6. Interaction & motion
- Motion is functional and quick (150–250ms). The one "delight" moment: the graph assembling on case open. Respect `prefers-reduced-motion`.
- Optimistic, cached reads (TanStack Query); skeletons never spinners-only.

## 7. Internationalization
- All strings in an i18n dictionary (en, kn). Kannada uses Noto Sans Kannada. Numbers/dates localized (DD-MM-YYYY, IST). Assistant answers in the asked language.

## 8. Accessibility checklist
- Contrast AA; visible focus rings; full keyboard nav (incl. graph: list-view fallback of linked cases for screen readers); ARIA labels on icons/graph nodes; forms labelled; error text not color-only; hit targets ≥40px.

## 9. Branding
- Use `KADI_logo.png` (icon) in top-bar; `KADI_logo_wordmark.png` on login/exports.
- Co-brand respectfully with "Karnataka State Police" wordmark; keep KADI secondary to the KSP identity in headers (this is *their* tool).

## 10. Demo-readiness UI notes
- Seed a **flawless demo case** whose graph, health flags, and offender profile are guaranteed populated.
- Add a subtle "Demo dataset (synthetic)" tag in the footer so judges know the data is synthetic by design.
- Ensure the graph "snap-together" and the Kannada voice answer both look great on a projector (large fonts, high contrast).
