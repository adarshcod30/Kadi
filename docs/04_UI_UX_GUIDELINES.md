# 04 — How it should look and feel

### Light, government-grade, trustworthy, effortless

**The north star:** it should feel like an official Government-of-Karnataka digital service —
calm, light, authoritative, and obvious to a non-technical officer — but with modern,
data-dense polish. "gov.in portal meets a clean analytics product."

If a screen ever feels clever, it has probably got worse. Optimise for an SI
understanding it in five seconds.

---

## 1. Principles

1. **Clarity over cleverness.** No training required to read any screen.
2. **Evidence on demand.** Every insight has a visible "Why?" affordance. Nothing is a black
   box. This is the single most important principle in the product.
3. **Light and legible.** White surfaces, strong contrast, generous spacing. **No dark
   theme** — it reads as a consumer app, not a government service.
4. **Trust cues.** KSP header, role badge, audit visibility, the fairness banner.
5. **Progressive disclosure.** Lead with the answer; details expand on click.
6. **Accessible (WCAG 2.1 AA).** Contrast ≥ 4.5:1, keyboard navigation, focus states, screen
   reader labels, English **and** Kannada.

## 2. Design tokens

**Colour — light government palette**

```
--kadi-navy:        #0B3D75   /* primary — headers, primary buttons, brand */
--kadi-navy-700:    #12305C
--kadi-blue:        #1A6FC4   /* interactive, links, active nav */
--kadi-blue-50:     #EAF3FB   /* selected / hover surfaces */
--kadi-saffron:     #E8871E   /* accent, flagged / alert highlight — sparingly */
--kadi-teal:        #2FA8A0   /* graph edges, secondary data */
--surface:          #FFFFFF
--surface-2:        #F5F7FA   /* app background */
--surface-3:        #EDF1F6   /* cards and wells */
--border:           #D9E1EC
--text:             #1C2A3A
--text-muted:       #5B6B7E

--success:#1E874B  --warning:#C9820A  --danger:#C0392B  --info:#1A6FC4
--heinous:#C0392B  --nonheinous:#5B6B7E
--status-open:#1A6FC4  --status-chargesheeted:#1E874B
--status-undetected:#C9820A  --status-false:#8A94A3
```

Saffron and red are **only** for genuine alerts and flags. The moment red is used for
decoration, it stops meaning anything. Base UI is navy and blue on white.

**Typography**

- **Inter** for UI, **Noto Sans Kannada** for Kannada, system-font fallback.
- Display 28/600 · H1 22/600 · H2 18/600 · Body 14/400 · Small 12.5/400 · mono for IDs and
  CrimeNo.
- Line-height 1.5 on body. `tabular-nums` on every metric, or the KPI cards jitter as
  numbers change.

**Spacing and shape**

- 8px grid (4 / 8 / 12 / 16 / 24 / 32).
- Radius: 8px cards, 6px inputs and buttons, 999px chips.
- Elevation stays subtle: `0 1px 2px rgba(16,40,70,.06)`, hover `0 4px 12px rgba(16,40,70,.10)`.

**Icons:** Lucide line icons, 1.75px stroke. 20px in nav, 16px inline.

## 3. The shell

```
┌────────────────────────────────────────────────────────────────────┐
│ TOPBAR  [KADI]  Karnataka State Police — Crime Intelligence         │
│         [ Search cases, offenders… ]    [ಕನ್ನಡ] [🔔] [Role ▾]        │
├──────────┬─────────────────────────────────────────────────────────┤
│ SIDEBAR  │  FAIRNESS BANNER (thin, dismissible per session)         │
│ ▸ About  │  "Insights use evidence & behaviour only — never caste,  │
│ ▸ Home   │   religion, or occupation."                              │
│ ▸ Graph  │ ┌─────────────────────────────────────────────────────┐ │
│ ▸ Cases  │ │                                                     │ │
│ ▸ Offend.│ │   PAGE CONTENT                                      │ │
│ ▸ Health │ │                                                     │ │
│ ▸ Map    │ │                                                     │ │
│ ▸ Intel. │ │                                                     │ │
│ ▸ Assist │ └─────────────────────────────────────────────────────┘ │
└──────────┴─────────────────────────────────────────────────────────┘
```

Collapsible left sidebar, top bar with global search, language toggle, alerts bell and role
menu. The fairness banner is a trust cue a judge will notice within about four seconds — do
not bury it.

## 4. Components

- **KPI card** — big tabular number, label, delta vs baseline, optional sparkline.
- **Data table** — sticky header, sortable, filter chips, row-click to detail, density
  toggle. Status and gravity as colour-coded chips.
- **Graph canvas (the hero)** — Cytoscape. Node shape by type (case = rounded square,
  offender = circle), size by importance, colour by cluster. Edge thickness = strength,
  colour = type. Hover tooltip, click → "why linked" side panel, legend, zoom/fit controls,
  layout switcher (force / radial / tree / circle / grid).
- **"Why linked" panel** — the matched attributes and the source FIR numbers, clickable. For
  scores, the factor breakdown. **This panel is the product.** If it is empty or vague, the
  whole "evidence not hunches" claim collapses.
- **Map** — MapLibre, satellite basemap, district choropleth, points and heat, cluster
  popovers, layer switch by crime head and time.
- **Assistant panel** — chat bubbles with citation chips, push-to-talk mic, language toggle,
  export button, suggested prompts.
- **Empty / loading / error states** — skeletons, never bare spinners. Friendly empty copy
  ("No linked cases found for this FIR"). Retry on error.

## 5. The screens

### Login
A **role chooser**, not a password gate — and it says so, in plain language, on the page.
Each of the five ranks gets a card describing exactly what that rank can see. The honest
note about Authentication being provisioned but not yet bound belongs here and nowhere else.

### About
Platform, dataset and fairness documentation. What every Catalyst service is used for and
why, plus what could not be wired and the diagnosis. Put this first in the nav: it answers
the judge's questions before they are asked.

### Home / dashboard
Role-aware. KPI cards, monthly trend, hour × weekday heatmap, disposal funnel, and the
rank-shift finding. Alerts feed on the right rail.

> The disposal funnel must sum to 100%. It once showed 86% because "Closed" was omitted —
> check the arithmetic against `statusBreakdown`, not against what looks right.

### Case-Linkage Graph — hero screen
Filters left, canvas centre, "why linked" panel right. Entry from a case, an offender, a
cluster or search. A case switcher moves between cases without going back.

Open on a case whose network is genuinely populated. An empty hero screen is worse than no
hero screen.

### Cases (list + detail)
List: searchable, filterable table. Detail: header chips, timeline (incident → info received
→ registered → chargesheet), parties, acts and sections, location mini-map, **"Linked cases
(N)"** into the graph, health panel.

### Offender profile
Canonical name, risk gauge with a **"why this score?"** factor breakdown, districts touched,
first and last seen. Tabs for cases, network, arrest and bail history, co-offenders. Entity
resolution confidence is shown, and low-confidence merges are flagged rather than hidden.

### Investigation health
Summary KPIs, then a worklist of flagged cases: flag chips, reason, recommended action, IO,
age. Sort, filter, export.

### Map / hotspots
Satellite basemap, district choropleth, points and heat, DBSCAN hotspots, time-of-day
filter. Cluster click → FIR list → open in graph.

### Intelligence
Per-capita ranking, correlation scatter with p-values, crime mix by urbanisation band, and
the three-month forecast with its interval. This is where the Kodagu finding lives.

### Assistant
Chat with citations, mic for English and Kannada, suggested prompts, export to a print-ready
briefing.

> **Two bugs worth remembering here.** Voice used to fire one response per interim
> transcript result — fix is to gate on `isFinal` plus a submitted flag, an in-flight ref and
> a short duplicate guard. And "why are there so many cases?" returned a count until intent
> routing learned to detect "why" and answer from the socio explanation instead.

## 6. Motion

Functional and quick, 150–250ms. One delight moment: the graph assembling when a case opens.
Respect `prefers-reduced-motion`. Skeletons over spinners.

## 7. Internationalisation

Every string lives in an i18n dictionary (en, kn). **Every** string — the failure mode to
already hit was a half-translated page where headings were Kannada and body text was
English, which looks worse than no translation at all. Numbers and dates localised
(DD-MM-YYYY, IST). The assistant answers in the language it was asked in.

## 8. Accessibility

AA contrast, visible focus rings, full keyboard navigation (including a list-view fallback of
linked cases for screen readers on the graph), ARIA labels on icons and nodes, labelled
forms, error text never colour-only, hit targets ≥ 40px.

## 9. Branding

Wordmark is set in type — there is no logo image file in the repo, and there should not be
one. Co-brand respectfully: "Karnataka State Police" leads, KADI is secondary. This is
*their* tool.

## 10. Demo readiness

- Land on a case whose graph, health flags and offender profile are guaranteed populated.
- Keep the "synthetic dataset" tag visible in the footer. Judges respect the disclosure and
  will ask if it is missing.
- Check the graph and the Kannada answer on a projector: large type, high contrast.
- **Show the feature, do not just mention it.** If a feature exists, it should be reachable
  in one click from wherever the reader already is.
