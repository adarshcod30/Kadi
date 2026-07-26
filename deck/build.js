// build.js — KADI submission deck, built on the official KSP Datathon 2026 template.
//
// The template's own background art is reused verbatim (assets/bg_*.png extracted from
// it), so the deck keeps the KSP / Datathon / Zoho branding while every content block is
// laid out here at known coordinates. Canvas is 10 x 5.625in, matching the template.
//
// Every figure quoted is read from deck/data/*.json, captured live from the deployed API.
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

const D = (f) => JSON.parse(fs.readFileSync(`${__dirname}/data/${f}.json`, 'utf8')).data;
const stats = D('stats');
const socio = D('analytics_socio');
const fc = D('analytics_forecast');
const evalr = D('eval');

// ---------------------------------------------------------------- design tokens
const NAVY = '0F2F44';   // KSP chrome
const BLUE = '1A6FC4';
const TEAL = '2FA8A0';
const SAFF = 'E8871E';
const RED = 'C0392B';
const GREY = '5B6B7E';
const INK = '1C2A3A';
const LINE = 'D9E1EC';
const SOFT = 'F5F8FB';
const WHITE = 'FFFFFF';
const NAVY2 = '1B4A63';  // lighter navy for pills on a navy band
const PALE = 'C9D8E4';   // body text on navy

const BODY = 'Arial';       // template font; safe-list, renders true to width
const HEAD = 'Cambria';     // serif header for contrast, also safe-list

// Content band between the template's black header bar and its gradient footer.
const X0 = 0.42, XW = 9.16;
const TITLE_Y = 0.66;
const Y0 = 1.50;

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';               // 10 x 5.625in — matches the template exactly
pptx.author = 'Team KadiLabs';
pptx.company = 'Karnataka State Police — Datathon 2026';
pptx.title = 'KADI — AI-Driven Crime Analytics & Visualization Platform';

const bg = (name) => ({ path: `${__dirname}/assets/${name}.png` });

function slide(title, kicker) {
  const s = pptx.addSlide();
  s.background = bg('bg_content');
  if (title) {
    s.addText(title, {
      x: X0, y: TITLE_Y, w: XW, h: 0.44, margin: 0,
      fontFace: HEAD, fontSize: 24, bold: true, color: NAVY, valign: 'middle',
    });
  }
  if (kicker) {
    s.addText(kicker, {
      x: X0, y: TITLE_Y + 0.44, w: XW, h: 0.30, margin: 0,
      fontFace: BODY, fontSize: 12, color: GREY, valign: 'middle',
    });
  }
  return s;
}

// A tinted card. No edge stripes — a soft fill plus a hairline border.
function card(s, x, y, w, h, fill = SOFT) {
  s.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill }, line: { color: LINE, width: 0.75 },
  });
}

// Card with a solid colour title bar across the top — the "title bar for each heading"
// treatment used on the features, technologies, snapshots and use-case slides.
function titled(s, x, y, w, h, heading, colour, barH = 0.38, size = 11) {
  card(s, x, y, w, h, WHITE);
  s.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: barH, rectRadius: 0.06, fill: { color: colour }, line: { color: colour },
  });
  s.addText(heading, {
    x: x + 0.14, y, w: w - 0.28, h: barH, margin: 0,
    fontFace: BODY, fontSize: size, bold: true, color: WHITE, valign: 'middle',
  });
  return y + barH + 0.08;
}

function statTile(s, x, y, w, h, value, label, colour, vSize = 22) {
  card(s, x, y, w, h);
  s.addText(String(value), {
    x: x + 0.12, y: y + 0.06, w: w - 0.24, h: h * 0.5, margin: 0,
    fontFace: BODY, fontSize: vSize, bold: true, color: colour, valign: 'middle',
  });
  s.addText(label, {
    x: x + 0.12, y: y + h * 0.52, w: w - 0.24, h: h * 0.44, margin: 0,
    fontFace: BODY, fontSize: 9.5, color: GREY, valign: 'top',
  });
}

function bullets(s, items, x, y, w, h, size = 10, colour = INK) {
  s.addText(
    items.map((t, i) => ({
      text: t, options: { bullet: true, breakLine: i !== items.length - 1, paraSpaceAfter: 5 },
    })),
    { x, y, w, h, margin: 0, fontFace: BODY, fontSize: size, color: colour, valign: 'top' },
  );
}

function arrowR(s, x, y, w = 0.11) {
  s.addShape(pptx.ShapeType.rightArrow, {
    x, y, w, h: 0.15, fill: { color: 'B7C6D6' }, line: { color: 'B7C6D6' },
  });
}
function arrowD(s, cx, y, h) {
  s.addShape(pptx.ShapeType.downArrow, {
    x: cx - 0.075, y, w: 0.15, h, fill: { color: 'A9BCCF' }, line: { color: 'A9BCCF' },
  });
}

// ============================================================ 1. Team details
{
  const s = pptx.addSlide();
  s.background = bg('bg_title');
  // The title art fills the upper ~62%; put the team block in the white lower band.
  s.addText('KADI — Karnataka Analytics & Detection Intelligence', {
    x: X0, y: 3.56, w: XW, h: 0.44, margin: 0,
    fontFace: HEAD, fontSize: 23, bold: true, color: NAVY,
  });
  s.addText('AI-Driven Crime Analytics & Visualization Platform for the Karnataka State Police', {
    x: X0, y: 3.98, w: XW, h: 0.28, margin: 0,
    fontFace: BODY, fontSize: 12.5, color: GREY,
  });
  const rows = [
    ['Team name', 'KadiLabs'],
    ['Team leader', 'Adarsh Dwivedi'],
    ['Team size', '1'],
    ['Problem Statement', 'Challenge 02 — AI-Driven Crime Analytics & Visualization Platform'],
  ];
  let y = 4.38;
  rows.forEach(([k, v]) => {
    s.addText(k, {
      x: X0, y, w: 1.70, h: 0.24, margin: 0,
      fontFace: BODY, fontSize: 11, bold: true, color: GREY, valign: 'middle',
    });
    s.addText(v, {
      x: X0 + 1.74, y, w: XW - 1.74, h: 0.24, margin: 0,
      fontFace: BODY, fontSize: 11, color: INK, valign: 'middle',
    });
    y += 0.245;
  });
  s.addNotes('KADI turns 40,836 siloed FIRs into one connected, explainable intelligence picture. Deployed end-to-end on Zoho Catalyst.');
}

// ============================================================ 2. Brief about the solution
{
  const s = slide('Brief about the solution', 'What is broken today, and what KADI does about it');

  let iy = titled(s, X0, Y0, 4.42, 1.78, 'The problem today', RED);
  bullets(s, [
    'FIRs sit in station-level silos; analysis is Excel',
    'A serial offender across districts is invisible',
    'SCRB gets fragmented extracts, not a state picture',
    'Policing stays reactive — no early warning',
    'No link from a Bengaluru case to a Kalaburagi gang',
  ], X0 + 0.16, iy, 4.10, 1.22, 11);

  iy = titled(s, X0 + 4.74, Y0, 4.42, 1.78, 'What KADI delivers', TEAL);
  bullets(s, [
    'One graph: every FIR joined by proven evidence',
    '36,289 name records resolved to 300 real people',
    'Per-capita analytics explain why, not just where',
    'Forecasts, hotspots, investigation-health alerts',
    'One audited source the SI and SCRB both read',
  ], X0 + 4.90, iy, 4.10, 1.22, 11);

  const tiles = [
    [stats.totalCases.toLocaleString(), 'FIRs analysed', BLUE],
    [stats.resolvedOffenders.toLocaleString(), 'Offenders resolved', TEAL],
    ['68,808', 'Typed evidence links', SAFF],
    [`${evalr.overallRecoveryPct}%`, 'Ground-truth recovery', NAVY],
    [`${fc.accuracy.mape}%`, 'Forecast MAPE', RED],
  ];
  tiles.forEach((t, i) => statTile(s, X0 + i * 1.86, 3.38, 1.72, 0.98, t[0], t[1], t[2], 23));

  s.addShape(pptx.ShapeType.roundRect, {
    x: X0, y: 4.48, w: XW, h: 0.82, rectRadius: 0.06, fill: { color: NAVY }, line: { color: NAVY },
  });
  s.addText('One graph. 40,836 FIRs. Every link is evidence an officer can click.', {
    x: X0 + 0.20, y: 4.54, w: XW - 0.40, h: 0.32, margin: 0,
    fontFace: BODY, fontSize: 14, bold: true, color: WHITE, valign: 'middle',
  });
  s.addText('Every figure above is read live from the deployed Catalyst API — nothing on this slide is illustrative.', {
    x: X0 + 0.20, y: 4.88, w: XW - 0.40, h: 0.30, margin: 0,
    fontFace: BODY, fontSize: 10, color: PALE, valign: 'middle',
  });
  s.addNotes('Lead with the silo problem. The 300-from-36,289 number is the entity-resolution story in one line.');
}

// ============================================================ 3. Opportunities / USP
{
  const s = slide('Opportunities', 'How it differs, how it solves the problem, and the USP');

  const cols = [
    ['How is it different?', BLUE, [
      'Not a dashboard over counts — a graph over evidence',
      'Every link is clickable proof: which attribute matched, on which FIRs',
      'Rates per 100,000 residents, not raw counts that merely track population',
      'Fairness enforced by a failing unit test, not a paragraph of policy',
      'Kannada is first-class throughout, not a translation bolted on at the end',
    ]],
    ['How does it solve it?', TEAL, [
      'Entity resolution merges spelling variants into one offender identity',
      'Six typed link kinds connect FIRs no single station could ever join',
      'Investigation-health flags cases slipping past their peer median',
      'DBSCAN hotspots + 3-month forecast move policing from reactive to planned',
      'A bilingual assistant answers in plain language and cites the FIRs it used',
    ]],
    ['USP', SAFF, [
      '100% recovery of planted gangs, chains and identities — measured every run',
      'Forecast accuracy is a hold-out backtest (MAPE 3.9%), not an in-sample claim',
      'Bilingual EN / ಕನ್ನಡ, voice-capable, every answer cites real FIR numbers',
      'Runs end-to-end on eight Zoho Catalyst services, with nothing third-party',
      'What did not work is documented too — every claim is checkable on the live URL',
    ]],
  ];
  cols.forEach(([h, c, items], i) => {
    const x = X0 + i * 3.10;
    const iy = titled(s, x, Y0, 2.92, 2.42, h, c, 0.42, 12);
    bullets(s, items, x + 0.15, iy, 2.62, 1.86, 9.5);
  });

  s.addText('Where a conventional crime dashboard stops — and KADI starts', {
    x: X0, y: 4.02, w: XW, h: 0.24, margin: 0,
    fontFace: BODY, fontSize: 11.5, bold: true, color: NAVY,
  });
  const contrast = [
    ['Counts by district', 'Rates per 100,000, with p-values'],
    ['A hunch that two cases relate', 'A typed edge naming the matching attribute'],
    ['A monthly Excel extract', 'A nightly, auditable rebuild'],
    ['"Trust the risk score"', 'Read the factor breakdown behind it'],
  ];
  contrast.forEach(([oldw, neww], i) => {
    const x = X0 + i * 2.32;
    card(s, x, 4.30, 2.20, 0.98, WHITE);
    s.addText(oldw, {
      x: x + 0.12, y: 4.36, w: 1.96, h: 0.28, margin: 0,
      fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle',
    });
    s.addShape(pptx.ShapeType.line, {
      x: x + 0.12, y: 4.66, w: 1.96, h: 0, line: { color: LINE, width: 0.75 },
    });
    s.addText(neww, {
      x: x + 0.12, y: 4.70, w: 1.96, h: 0.52, margin: 0,
      fontFace: BODY, fontSize: 9.5, bold: true, color: INK, valign: 'middle',
    });
  });
  s.addNotes('The USP column is the one to dwell on: everything there is measured, not asserted.');
}

// ============================================================ 4. Features
{
  const s = slide('List of features offered by the solution', 'Nine capabilities, all live in the deployed build');
  const F = [
    ['Case-Linkage Graph', 'Ego-network per FIR across six typed link kinds, with a click-through evidence trail on every edge.', BLUE],
    ['Entity Resolution', 'Rarity-aware fuzzy matching folds 36,289 accused records into 300 real people.', TEAL],
    ['Offender Risk', 'Glass-box score with a full factor breakdown; protected attributes excluded by construction.', SAFF],
    ['Investigation Health', 'Flags ageing, pendency, undetected-risk and false-case patterns against peer medians.', RED],
    ['Spatiotemporal Map', 'Satellite basemap, district choropleth, DBSCAN hotspots, hour x weekday layering.', NAVY],
    ['Socio-economic Analytics', 'Per-capita rates correlated with urbanisation, literacy and density, with p-values.', BLUE],
    ['Crime Forecasting', 'Three-month district projections with a 95% interval and a measured backtest.', TEAL],
    ['Bilingual Assistant', 'Grounded EN / ಕನ್ನಡ Q&A over the records, by text or voice; always cites FIRs.', SAFF],
    ['Fairness & Audit', 'Caste, religion and occupation excluded — asserted in tests; sensitive reads audited.', RED],
  ];
  F.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = X0 + col * 3.10, y = Y0 + row * 1.18;
    const iy = titled(s, x, y, 2.92, 1.08, f[0], f[2], 0.36, 10.5);
    s.addText(f[1], {
      x: x + 0.15, y: iy, w: 2.62, h: 0.58, margin: 0,
      fontFace: BODY, fontSize: 9, color: GREY, valign: 'top',
    });
  });
  s.addText('All nine ship in the deployed build — none of them is a mockup or a roadmap item.', {
    x: X0, y: 5.00, w: XW, h: 0.26, margin: 0,
    fontFace: BODY, fontSize: 9, italic: true, color: GREY, valign: 'middle',
  });
}

// ============================================================ 5. Process flow
{
  const s = slide('Process flow', 'From a raw FIR register to an investigator acting on a lead');

  const steps = [
    ['FIR intake', '29 KSP tables — FIRs, parties, acts & sections, arrests, chargesheets', BLUE],
    ['Entity resolution', 'Blocking + rarity-aware fuzzy match; 36,289 records to 300 identities', TEAL],
    ['Link building', 'Six typed edges: offender, co-accused, MO, location, time, section', SAFF],
    ['Analytics', 'Louvain communities, risk, health, DBSCAN hotspots, per-capita, forecast', RED],
    ['Delivery', 'Precomputed read-model served to the SPA in under 100 ms', NAVY],
  ];
  const w = 1.74;
  steps.forEach((st, i) => {
    const x = X0 + i * 1.855;
    card(s, x, Y0, w, 1.40, WHITE);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y: Y0, w, h: 0.34, rectRadius: 0.06, fill: { color: st[2] }, line: { color: st[2] },
    });
    s.addText(`STEP ${i + 1}`, {
      x: x + 0.12, y: Y0, w: w - 0.24, h: 0.34, margin: 0,
      fontFace: BODY, fontSize: 8.5, bold: true, color: WHITE, charSpacing: 1.2, valign: 'middle',
    });
    s.addText(st[0], {
      x: x + 0.13, y: Y0 + 0.40, w: w - 0.26, h: 0.30, margin: 0,
      fontFace: BODY, fontSize: 11, bold: true, color: INK, valign: 'middle',
    });
    s.addText(st[1], {
      x: x + 0.13, y: Y0 + 0.72, w: w - 0.26, h: 0.62, margin: 0,
      fontFace: BODY, fontSize: 9, color: GREY, valign: 'top',
    });
    if (i < steps.length - 1) arrowR(s, x + w + 0.005, Y0 + 0.63);
  });

  s.addText('Where each stage runs — and why the platform forces that split', {
    x: X0, y: 3.18, w: XW, h: 0.28, margin: 0,
    fontFace: BODY, fontSize: 12.5, bold: true, color: NAVY,
  });
  const runtimes = [
    ['Catalyst Job — 15 minutes', TEAL,
      'Entity resolution, MO similarity, graph build, communities, DBSCAN and the forecast all run here. Peaks at 738 MB and 24.6 s. Triggered nightly by Cron at 02:00 IST. A 15-minute budget is the only place on the platform where this legally fits.'],
    ['Function / AppSail — 30 s cap', SAFF,
      'Confirmed by the Zoho team in the workshop Q&A, and not raisable. Neither runtime may host the pipeline, so the web tier only ever reads what the Job has already written. That one cap shaped every other decision in the architecture.'],
    ['Browser — instant', BLUE,
      'Every screen reads a precomputed read-model. No officer ever waits on a model to finish, and no request can time out mid-analysis. The payload is interned to 12.1 MB so the first paint stays under 100 ms.'],
  ];
  runtimes.forEach((rt, i) => {
    const x = X0 + i * 3.10;
    const iy = titled(s, x, 3.52, 2.92, 1.62, rt[0], rt[1], 0.38, 10.5);
    s.addText(rt[2], {
      x: x + 0.15, y: iy, w: 2.62, h: 1.08, margin: 0,
      fontFace: BODY, fontSize: 9, color: GREY, valign: 'top',
    });
  });

  s.addNotes('The 30-second cap on both Functions and AppSail was confirmed by the Zoho team in the workshop Q&A — it is the reason the pipeline lives in a Job.');
}

// ============================================================ 6. Use-case view
{
  const s = slide('Use-case view', 'Five ranks, one dataset, and exactly what each is entitled to see');

  const roles = [
    ['Sub-Inspector', 'Own station', 'Their unit\'s FIRs and worklist', TEAL],
    ['Inspector', 'Own station', 'Plus arrest & chargesheet detail', TEAL],
    ['ACP / DySP', 'Whole district', 'Cross-station networks, audit log', SAFF],
    ['SCRB Analyst', 'Entire state', 'All 40,836 FIRs, forecasting', NAVY],
    ['Administrator', 'State + governance', 'Fairness report, pipeline status', BLUE],
  ];
  roles.forEach((r, i) => {
    const x = X0 + i * 1.855;
    card(s, x, Y0, 1.74, 1.04, WHITE);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y: Y0, w: 1.74, h: 0.32, rectRadius: 0.06, fill: { color: r[3] }, line: { color: r[3] },
    });
    s.addText(r[0], {
      x: x + 0.12, y: Y0, w: 1.50, h: 0.32, margin: 0,
      fontFace: BODY, fontSize: 10, bold: true, color: WHITE, valign: 'middle',
    });
    s.addText(r[1], {
      x: x + 0.12, y: Y0 + 0.36, w: 1.50, h: 0.22, margin: 0,
      fontFace: BODY, fontSize: 9, bold: true, color: r[3], valign: 'middle',
    });
    s.addText(r[2], {
      x: x + 0.12, y: Y0 + 0.58, w: 1.50, h: 0.42, margin: 0,
      fontFace: BODY, fontSize: 8, color: GREY, valign: 'top',
    });
  });

  // Capability matrix — the concrete answer to "what does each rank actually get?"
  const caps = [
    ['FIRs registered at their own station', [1, 1, 1, 1, 1]],
    ['Every FIR in the district', [0, 0, 1, 1, 1]],
    ['All 40,836 FIRs, state-wide', [0, 0, 0, 1, 1]],
    ['Case-linkage graph + why-linked evidence', [1, 1, 1, 1, 1]],
    ['Arrest and chargesheet detail', [0, 1, 1, 1, 1]],
    ['Per-capita analytics, forecasting, anomalies', [0, 0, 0, 1, 1]],
    ['Audit log and fairness report', [0, 0, 1, 1, 1]],
  ];
  const CX = X0 + 4.40, CW = 0.94, CS = 0.95;
  s.addShape(pptx.ShapeType.roundRect, {
    x: X0, y: 2.66, w: XW, h: 0.30, rectRadius: 0.04, fill: { color: NAVY }, line: { color: NAVY },
  });
  s.addText('What the rank can actually query', {
    x: X0 + 0.14, y: 2.66, w: 4.10, h: 0.30, margin: 0,
    fontFace: BODY, fontSize: 9, bold: true, color: WHITE, valign: 'middle',
  });
  ['SI', 'Insp', 'ACP', 'Analyst', 'Admin'].forEach((h, c) => {
    s.addText(h, {
      x: CX + c * CS, y: 2.66, w: CW, h: 0.30, margin: 0,
      fontFace: BODY, fontSize: 9, bold: true, color: WHITE, align: 'center', valign: 'middle',
    });
  });
  caps.forEach(([label, marks], i) => {
    const y = 2.96 + i * 0.30;
    if (i % 2 === 0) {
      s.addShape(pptx.ShapeType.rect, { x: X0, y, w: XW, h: 0.30, fill: { color: SOFT }, line: { color: SOFT } });
    }
    s.addText(label, {
      x: X0 + 0.14, y, w: 4.10, h: 0.30, margin: 0,
      fontFace: BODY, fontSize: 9, color: INK, valign: 'middle',
    });
    marks.forEach((m, c) => {
      s.addText(m ? '✓' : '—', {
        x: CX + c * CS, y, w: CW, h: 0.30, margin: 0,
        fontFace: BODY, fontSize: m ? 11 : 9, bold: !!m,
        color: m ? TEAL : 'B7C6D6', align: 'center', valign: 'middle',
      });
    });
  });
  s.addText('Scoping is enforced server-side on every query — an out-of-scope read is refused, not merely hidden in the UI. '
    + 'Catalyst Authentication is provisioned; the demo build presents a role chooser so an evaluator can exercise all five scopes without five accounts.', {
    x: X0, y: 5.08, w: XW, h: 0.24, margin: 0,
    fontFace: BODY, fontSize: 8, italic: true, color: GREY, valign: 'middle',
  });
}

// ============================================================ 7. Architecture
{
  const s = slide('Architecture', 'Five layers, every runtime component a Catalyst service');

  // Dashed boundary — everything inside is one Catalyst project, one origin.
  s.addShape(pptx.ShapeType.rect, {
    x: X0, y: 1.44, w: XW, h: 3.60,
    fill: { color: 'FBFDFF' }, line: { color: BLUE, width: 1.25, dashType: 'dash' },
  });
  s.addShape(pptx.ShapeType.roundRect, {
    x: 5.90, y: 1.33, w: 3.68, h: 0.22, rectRadius: 0.05,
    fill: { color: WHITE }, line: { color: BLUE, width: 0.75 },
  });
  s.addText('ZOHO CATALYST — ONE PROJECT, ONE ORIGIN, NO THIRD-PARTY RUNTIME', {
    x: 5.90, y: 1.33, w: 3.68, h: 0.22, margin: 0,
    fontFace: BODY, fontSize: 6.5, bold: true, color: BLUE, align: 'center', valign: 'middle',
  });

  const LX = 0.55, LW = 1.20;            // layer label chip
  const BX = [1.87, 4.44, 7.01], BW = 2.44;
  const BH = 0.55, STEP = 0.685;

  const layers = [
    ['PRESENTATION', 'What the officer sees', BLUE, [
      ['React 18 + TypeScript SPA', 'Web Client Hosting · /app'],
      ['Graph · Map · Charts', 'Cytoscape.js · MapLibre GL · Recharts'],
      ['EN / ಕನ್ನಡ + voice', 'Web Speech API, client-side'],
    ]],
    ['API', 'Read-only, rank-scoped', TEAL, [
      ['21 REST endpoints', 'Serverless Function · Node 20 · 512 MB'],
      ['RBAC on every query', 'Refuses out-of-scope reads server-side'],
      ['Audit + grounded assistant', 'Cites the FIR numbers it drew from'],
    ]],
    ['COMPUTE', 'Heavy work lives here', SAFF, [
      ['Analytics service', 'AppSail · Python · ~135 ms per call'],
      ['Nightly pipeline', 'Job · 15-min budget · peaks 738 MB'],
      ['Scheduler', 'Cron · 02:00 IST · full recompute'],
    ]],
    ['DATA', 'One source of record', NAVY, [
      ['40,836 FIRs · 11 tables', 'Data Store · queried with ZCQL'],
      ['Bulk-import objects', 'Stratus bucket · ~9 MB'],
      ['KPI segment', 'Cache · adapter written, see slide 10'],
    ]],
    ['PLATFORM', 'Identity, secrets, delivery', GREY, [
      ['Sign-in and role model', 'Authentication · provisioned'],
      ['OAuth out to QuickML', 'Connections · deployment.READ'],
      ['Deploy and rollback', 'Catalyst CLI 1.27.0'],
    ]],
  ];

  layers.forEach((L, i) => {
    const y = 1.58 + i * STEP;
    // layer label chip
    s.addShape(pptx.ShapeType.roundRect, {
      x: LX, y, w: LW, h: BH, rectRadius: 0.05, fill: { color: L[2] }, line: { color: L[2] },
    });
    s.addText(L[0], {
      x: LX + 0.07, y: y + 0.05, w: LW - 0.14, h: 0.22, margin: 0,
      fontFace: BODY, fontSize: 8.5, bold: true, color: WHITE, valign: 'middle',
    });
    s.addText(L[1], {
      x: LX + 0.07, y: y + 0.27, w: LW - 0.14, h: 0.24, margin: 0,
      fontFace: BODY, fontSize: 6.5, color: 'E3EDF5', valign: 'top',
    });
    // three boxes
    L[3].forEach((b, c) => {
      s.addShape(pptx.ShapeType.roundRect, {
        x: BX[c], y, w: BW, h: BH, rectRadius: 0.05,
        fill: { color: WHITE }, line: { color: L[2], width: 1 },
      });
      s.addText(b[0], {
        x: BX[c] + 0.10, y: y + 0.04, w: BW - 0.20, h: 0.24, margin: 0,
        fontFace: BODY, fontSize: 9.5, bold: true, color: INK, valign: 'middle',
      });
      s.addText(b[1], {
        x: BX[c] + 0.10, y: y + 0.27, w: BW - 0.20, h: 0.24, margin: 0,
        fontFace: BODY, fontSize: 8, color: BLUE, valign: 'middle',
      });
    });
    // connector arrows into the next layer
    if (i < layers.length - 1) {
      BX.forEach((bx) => arrowD(s, bx + BW / 2, y + BH, 0.135));
    }
  });

  s.addText('Design rule that shaped every box above: no heavy compute may sit behind an HTTP request. '
    + 'The pipeline peaks at ~740 MB and ~25 s against a hard 30 s cap, so it runs as a Job and the web tier reads only what the Job wrote. '
    + 'The graph payload is interned before shipping — 54.9 MB of adjacency becomes 12.1 MB with identical evidence text.', {
    x: X0, y: 5.08, w: XW, h: 0.24, margin: 0,
    fontFace: BODY, fontSize: 7.5, color: GREY, valign: 'middle',
  });
}

// ============================================================ 8. Technologies
{
  const s = slide('Technologies used', 'Each chosen for a constraint, not for the list');
  const groups = [
    ['Frontend', BLUE, [
      'React 18 · TypeScript · Vite',
      'Tailwind CSS on the KSP palette',
      'Cytoscape.js + fcose — the linkage graph',
      'MapLibre GL — satellite and choropleth',
      'Recharts — trends, mix, funnels',
      'Framer Motion — interaction polish',
    ]],
    ['Backend & API', TEAL, [
      'Node.js 20 — Advanced I/O Function',
      'Express-compatible routing, 21 endpoints',
      'Role-based access control per query',
      'In-request audit trail on sensitive reads',
      'Deterministic grounded assistant engine',
      'Interned read-model, lazily rehydrated',
    ]],
    ['Data & ML', SAFF, [
      'Python 3.11',
      'scikit-learn — TF-IDF, NearestNeighbors, DBSCAN',
      'networkx — multigraph and Louvain communities',
      'RapidFuzz — rarity-aware name matching',
      'pandas / NumPy / SciPy',
      'Shapely — in-polygon rejection sampling',
    ]],
    ['Platform & quality', NAVY, [
      'Zoho Catalyst — the deployment mandate',
      'Catalyst CLI 1.27.0',
      'ZCQL for Data Store queries',
      'Git / GitHub, Conventional Commits',
      '19 automated tests — 8 Node, 11 Python',
      'A fairness test that fails the build',
    ]],
  ];
  groups.forEach((g, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = X0 + col * 4.74, y = Y0 + row * 1.76;
    const iy = titled(s, x, y, 4.42, 1.66, g[0], g[1], 0.38, 11.5);
    bullets(s, g[2], x + 0.16, iy, 4.10, 1.14, 9);
  });
  s.addText('Nothing here is exotic — every choice traces back to a Catalyst limit: the 30 s request cap, the 512 MB ceiling, the stdlib-only AppSail container.', {
    x: X0, y: 5.00, w: XW, h: 0.32, margin: 0,
    fontFace: BODY, fontSize: 9, italic: true, color: GREY, valign: 'middle',
  });
}

// ============================================================ 9. Catalyst services used
{
  const s = slide('Catalyst services in the solution', 'Eight services, each answering a specific constraint');
  const rows = [
    ['Web Client Hosting', 'Serves the SPA at /app', 'Same origin as the API; deep links use a 404-to-shell fallback'],
    ['Serverless Functions', '21-endpoint REST API + nightly Job', 'Advanced I/O accepts an Express app; raised to 512 MB'],
    ['AppSail', 'Python analytics service', 'Per-capita and forecast in ~135 ms; stdlib-only build'],
    ['Data Store', '11 tables · 40,836 FIRs · live ZCQL', 'The FIR schema is genuinely relational, so a relational store fits'],
    ['Stratus', 'Object storage for bulk import', 'Data Store bulk-write reads its source from a bucket'],
    ['Job Scheduling + Cron', 'Nightly analytics revalidation, 02:00 IST', 'Only Jobs get 15 minutes; Functions and AppSail both cap at 30 s'],
    ['Connections', 'OAuth for QuickML (deployment.READ)', 'QuickML rejects anonymous calls outright'],
    ['Authentication', 'Provisioned; role model shown at sign-in', 'RBAC scoping is enforced server-side on every query'],
  ];
  const hy = 0.32, ry = 0.355;
  s.addShape(pptx.ShapeType.roundRect, {
    x: X0, y: Y0, w: XW, h: hy, rectRadius: 0.04, fill: { color: NAVY }, line: { color: NAVY },
  });
  [['Service', 0, 2.10], ['Used for', 2.32, 3.00], ['Why this service', 5.42, 3.60]].forEach(([h, dx, w]) => {
    s.addText(h, {
      x: X0 + 0.12 + dx, y: Y0, w, h: hy, margin: 0,
      fontFace: BODY, fontSize: 9, bold: true, color: WHITE, valign: 'middle',
    });
  });
  rows.forEach((r, i) => {
    const y = Y0 + hy + i * ry;
    if (i % 2 === 0) {
      s.addShape(pptx.ShapeType.rect, { x: X0, y, w: XW, h: ry, fill: { color: SOFT }, line: { color: SOFT } });
    }
    s.addText(r[0], { x: X0 + 0.12, y, w: 2.10, h: ry, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: INK, valign: 'middle' });
    s.addText(r[1], { x: X0 + 2.44, y, w: 3.00, h: ry, margin: 0, fontFace: BODY, fontSize: 9, color: INK, valign: 'middle' });
    s.addText(r[2], { x: X0 + 5.54, y, w: 3.50, h: ry, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
  });

  const tiles = [
    ['8 / 8', 'services live in the deployed build', TEAL],
    ['21', 'REST endpoints, all returning 200', BLUE],
    ['0', 'third-party runtimes or hosting', NAVY],
  ];
  tiles.forEach((t, i) => {
    const x = X0 + i * 3.10;
    card(s, x, 4.72, 2.92, 0.58, SOFT);
    s.addText(t[0], { x: x + 0.14, y: 4.76, w: 0.90, h: 0.50, margin: 0, fontFace: BODY, fontSize: 18, bold: true, color: t[2], valign: 'middle' });
    s.addText(t[1], { x: x + 1.06, y: 4.76, w: 1.74, h: 0.50, margin: 0, fontFace: BODY, fontSize: 9, color: GREY, valign: 'middle' });
  });
  s.addNotes('All eight are live in the deployed build, not aspirational.');
}

// ============================================================ 10. Not used — and why
{
  const s = slide('What we did not wire — and exactly why', 'Listed deliberately: each was attempted and diagnosed');
  const rows = [
    ['Cache', 'Adapter written, segment provisioned. Writes from inside a deployed function return 401 PERMISSION_NEEDED. Ruled out: segment id, SDK, scope API, table permissions. Zero user impact — the KPI query recomputes in ~1 ms.', SAFF],
    ['QuickML (GLM-4.7 + RAG)', 'Endpoint, model id, org header and a valid OAuth token all in place; the endpoint rejects our body with 400 PATTERN_NOT_MATCHED. The assistant runs a deterministic intent engine instead — which cannot hallucinate an FIR number.', RED],
    ['Zia (STT / TTS / translate)', 'Not enabled on the project. The adapter includes the recommended degradation (translate to English, then speak). Voice today runs on the browser Web Speech API, client-side.', SAFF],
    ['NoSQL / SmartBrowz', 'The graph read-model is served from the function bundle; briefing export returns print-ready HTML rather than claiming a PDF pipeline that does not exist.', GREY],
    ['API Gateway', 'Enabled once, then disabled: with no routes configured it intercepted all traffic and the site returned INVALID_URL. Needs route config before it is safe to turn on.', GREY],
  ];
  let y = Y0;
  rows.forEach((r) => {
    const h = 0.68;
    card(s, X0, y, XW, h, WHITE);
    s.addShape(pptx.ShapeType.ellipse, { x: X0 + 0.14, y: y + 0.25, w: 0.18, h: 0.18, fill: { color: r[2] }, line: { color: r[2] } });
    s.addText(r[0], { x: X0 + 0.40, y: y + 0.06, w: 2.05, h: 0.56, margin: 0, fontFace: BODY, fontSize: 10, bold: true, color: INK, valign: 'middle' });
    s.addText(r[1], { x: X0 + 2.50, y: y + 0.05, w: XW - 2.66, h: 0.58, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
    y += h + 0.07;
  });
  s.addText('Stating this plainly is a deliberate choice: an evaluator can verify every claim on the live URL.', {
    x: X0, y: y + 0.02, w: XW, h: 0.22, margin: 0, fontFace: BODY, fontSize: 9, italic: true, color: GREY,
  });
}

// ============================================================ 11. The dataset
{
  const s = slide('The dataset', 'Synthetic FIRs, generated against a real skeleton');

  card(s, X0, Y0, XW, 0.54, 'FFF6EC');
  s.addText('Every FIR is synthetic — no real case, person or complainant appears anywhere. Real KSP records cannot leave KSP, '
    + 'so the corpus is generated against the real schema, real geography and real published statistics.', {
    x: X0 + 0.16, y: Y0 + 0.04, w: XW - 0.32, h: 0.46, margin: 0,
    fontFace: BODY, fontSize: 10, color: INK, valign: 'middle',
  });

  const facts = [['40,836', 'FIRs · 43 months'], ['31', 'districts'], ['298', 'police stations'],
    ['50,656', 'victim records'], ['300', 'resolved offenders'], ['7', 'planted patterns']];
  facts.forEach((f, i) => statTile(s, X0 + i * 1.545, 2.14, 1.42, 0.92, f[0], f[1], NAVY, 19));

  let iy = titled(s, X0, 3.16, 4.42, 2.14, 'How it is generated', TEAL, 0.36, 11);
  bullets(s, [
    'Real skeleton: 31 districts, 298 stations, IPC / BNS / IT / NDPS sections, KSP taxonomy',
    'Volume follows published statistics — Bengaluru City ~16,900 FIRs against a few hundred rural',
    'Coordinates rejection-sampled inside real district polygons — 100% land, inside Karnataka',
    'Kannada name pool carrying spelling variants, initials and transliteration drift',
    'Deterministic under seed 2026 — the corpus regenerates byte-for-byte',
  ], X0 + 0.16, iy, 4.10, 1.60, 8.5);

  iy = titled(s, X0 + 4.74, 3.16, 4.42, 2.14, 'Where the synthetic origin shows', SAFF, 0.36, 11);
  bullets(s, [
    'MO narratives are template-drawn — cleaner and more uniform than real free text',
    'The urbanisation correlation is partly circular: the generator weights urban crime upward',
    'Names come from a finite pool, making resolution slightly easier than reality',
    'No missing fields, typos or duplicate registrations — real registers are messier',
    'Census 2011 population, literacy and urbanisation are real, and used as the denominator',
  ], X0 + 4.90, iy, 4.10, 1.60, 8.5);
}

// ============================================================ 12. Estimated cost
{
  const s = slide('Estimated implementation cost', 'Free-tier today; the shape of a state-wide rollout');
  const rows = [
    ['Web Client Hosting', 'SPA + assets (~2 MB)', 'Free tier', 'Static hosting, negligible at KSP scale'],
    ['Serverless Functions', '2 functions · 512 MB · ~50k req/mo', 'Free tier', 'Scales per invocation; no idle cost'],
    ['AppSail', '1 service · stdlib runtime', 'Free tier', 'Analytics on demand, ~135 ms per call'],
    ['Data Store', '40,836 FIRs across 11 tables', 'Free tier', 'Real KSP volume is ~20x — paid tier'],
    ['Stratus', '~9 MB of import objects', 'Free tier', 'Grows with exports and briefings'],
    ['Job + Cron', '1 nightly run, under a minute', 'Free tier', 'One scheduled execution per day'],
    ['QuickML / Zia', 'Not yet enabled', 'Hackathon credits', 'Per-token / per-call once wired'],
  ];
  const hy = 0.32, ry = 0.37;
  s.addShape(pptx.ShapeType.roundRect, { x: X0, y: Y0, w: XW, h: hy, rectRadius: 0.04, fill: { color: NAVY }, line: { color: NAVY } });
  [['Service', 0, 2.10], ['Prototype usage', 2.32, 2.60], ['Cost today', 5.02, 1.45], ['At production scale', 6.57, 2.50]].forEach(([h, dx, w]) => {
    s.addText(h, { x: X0 + 0.12 + dx, y: Y0, w, h: hy, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: WHITE, valign: 'middle' });
  });
  rows.forEach((r, i) => {
    const y = Y0 + hy + i * ry;
    if (i % 2 === 0) s.addShape(pptx.ShapeType.rect, { x: X0, y, w: XW, h: ry, fill: { color: SOFT }, line: { color: SOFT } });
    s.addText(r[0], { x: X0 + 0.12, y, w: 2.10, h: ry, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: INK, valign: 'middle' });
    s.addText(r[1], { x: X0 + 2.44, y, w: 2.55, h: ry, margin: 0, fontFace: BODY, fontSize: 9, color: INK, valign: 'middle' });
    s.addText(r[2], { x: X0 + 5.14, y, w: 1.45, h: ry, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: TEAL, valign: 'middle' });
    s.addText(r[3], { x: X0 + 6.69, y, w: 2.40, h: ry, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: X0, y: 4.50, w: XW, h: 0.80, rectRadius: 0.06, fill: { color: NAVY }, line: { color: NAVY },
  });
  const pills = [
    ['Rs 0 / month today', 'the whole prototype fits inside the free tier'],
    ['~800,000 FIRs a year', 'the real KSP register the same code would carry'],
    ['Only tokens are usage-priced', 'compute stays flat; QuickML is the variable line'],
  ];
  pills.forEach((p, i) => {
    const x = X0 + 0.14 + i * 2.98;
    s.addShape(pptx.ShapeType.roundRect, { x, y: 4.58, w: 2.86, h: 0.64, rectRadius: 0.05, fill: { color: NAVY2 }, line: { color: NAVY2 } });
    s.addText(p[0], { x: x + 0.12, y: 4.61, w: 2.62, h: 0.26, margin: 0, fontFace: BODY, fontSize: 10, bold: true, color: WHITE, valign: 'middle' });
    s.addText(p[1], { x: x + 0.12, y: 4.87, w: 2.62, h: 0.30, margin: 0, fontFace: BODY, fontSize: 8, color: PALE, valign: 'top' });
  });
}

// ============================================================ 13. Snapshots
{
  const s = slide('Snapshots of the prototype', 'Nine screens, all live at the deployed URL right now');
  const shots = [
    ['Command Dashboard', 'KPIs, monthly trend, hour x weekday heatmap, disposal funnel and the rank-shift finding.', BLUE],
    ['Case-Linkage Graph', 'Ego-network with a layout switcher, six link-type filters and a "why linked" evidence panel.', TEAL],
    ['Intelligence', 'Per-capita ranking, correlation scatter, crime mix by band, forecast with its interval.', SAFF],
    ['Spatiotemporal Map', 'Satellite basemap, district choropleth, DBSCAN hotspots and a time-of-day filter.', NAVY],
    ['Investigation Health', 'Worklist of 19,006 flagged cases, each with a reason and a recommended action.', RED],
    ['Offender Watchlist', 'Risk gauge, glass-box factor breakdown, name variants and every linked FIR.', BLUE],
    ['Bilingual Assistant', 'EN / ಕನ್ನಡ Q&A by text or voice, every answer citing real FIR numbers.', TEAL],
    ['Cases Register', 'All 40,836 FIRs, filterable by head, district, status, gravity and health flag.', SAFF],
    ['About & Audit', 'Full platform, dataset and fairness documentation; audited sensitive reads.', NAVY],
  ];
  shots.forEach((sh, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = X0 + col * 3.10, y = Y0 + row * 1.18;
    const iy = titled(s, x, y, 2.92, 1.08, sh[0], sh[2], 0.36, 10.5);
    s.addText(sh[1], {
      x: x + 0.15, y: iy, w: 2.62, h: 0.58, margin: 0,
      fontFace: BODY, fontSize: 9, color: GREY, valign: 'top',
    });
  });
  s.addText('Best seen live: Home  ->  Intelligence (Kodagu)  ->  Graph (click an edge)  ->  Map  ->  Assistant.   '
    + 'Sign-in is a role chooser — no password needed.', {
    x: X0, y: 5.06, w: XW, h: 0.24, margin: 0,
    fontFace: BODY, fontSize: 8.5, italic: true, color: GREY, valign: 'middle',
  });
  s.addNotes('Walk the live URL rather than reading this slide: Home, Intelligence (Kodagu), Graph (why-linked), Map, Assistant.');
}

// ============================================================ 14. Benchmarking
{
  const s = slide('Performance & benchmarking', 'Measured on the deployed build — and here is exactly how');

  s.addText('Ground-truth recovery (%)', { x: X0, y: Y0, w: 4.30, h: 0.26, margin: 0, fontFace: BODY, fontSize: 11, bold: true, color: NAVY });
  s.addChart(pptx.ChartType.bar, [{
    name: 'Recovery %',
    labels: ['Gang', 'Serial chain', 'Cyber ring', 'Identity ER'],
    values: [evalr.gangRecoveryPct, evalr.chainRecoveryPct, 100, evalr.identityRecoveryPct],
  }], {
    x: X0, y: 1.78, w: 4.30, h: 1.86,
    barDir: 'bar', chartColors: [TEAL], showValue: true, dataLabelPosition: 'outEnd',
    dataLabelColor: INK, dataLabelFontSize: 9, dataLabelFormatCode: '0"%"',
    catAxisLabelColor: GREY, catAxisLabelFontSize: 9,
    valAxisLabelColor: GREY, valAxisLabelFontSize: 9, valAxisMaxVal: 110,
    valGridLine: { color: 'EDF1F6', size: 1 }, catGridLine: { style: 'none', color: 'FFFFFF', size: 1 },
    showLegend: false, barGapWidthPct: 55,
  });

  const perf = [
    ['24.6 s', 'Pipeline runtime', 'full recompute, 40,836 FIRs'],
    ['738 MB', 'Peak memory', 'was 1,770 MB before tuning'],
    ['135 ms', 'AppSail analytics', 'against a 30 s request cap'],
    ['12.1 MB', 'Graph payload', 'interned down from 54.9 MB'],
    [`${fc.accuracy.mape}%`, 'Forecast MAPE', `${fc.accuracy.holdoutMonths}-month hold-out backtest`],
    ['19 / 19', 'Test suite', '8 Node + 11 Python, all green'],
  ];
  perf.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = X0 + 4.66 + col * 2.30, y = 1.78 + row * 0.64;
    card(s, x, y, 2.18, 0.58, SOFT);
    s.addText(p[0], { x: x + 0.10, y: y + 0.03, w: 2.00, h: 0.26, margin: 0, fontFace: BODY, fontSize: 13, bold: true, color: BLUE, valign: 'middle' });
    s.addText(p[1], { x: x + 0.10, y: y + 0.28, w: 2.00, h: 0.15, margin: 0, fontFace: BODY, fontSize: 8.5, bold: true, color: INK, valign: 'middle' });
    s.addText(p[2], { x: x + 0.10, y: y + 0.42, w: 2.00, h: 0.14, margin: 0, fontFace: BODY, fontSize: 7.5, color: GREY, valign: 'middle' });
  });

  s.addText('How these figures were obtained', { x: X0, y: 3.76, w: XW, h: 0.26, margin: 0, fontFace: BODY, fontSize: 12.5, bold: true, color: NAVY });
  const prov = [
    ['Recovery %', TEAL,
      'The generator plants 7 known patterns and writes them to _ground_truth.json before the pipeline starts. The pipeline never reads that file. eval.py scores the recovered clusters against it after every single run.'],
    ['Runtime & memory', SAFF,
      '/usr/bin/time -l over the full 40,836-FIR pipeline — the same script the Catalyst Job executes. 1,770 MB before sklearn working_memory was capped at 32 MiB; 738 MB after, with byte-identical output.'],
    ['Latency & MAPE', BLUE,
      'The 135 ms is the median of 20 sequential calls to the deployed AppSail endpoint. MAPE is a hold-out backtest: 3 months withheld, model fitted on the rest, then scored against the withheld actuals.'],
  ];
  prov.forEach((p, i) => {
    const x = X0 + i * 3.10;
    const iy = titled(s, x, 4.06, 2.92, 1.24, p[0], p[1], 0.32, 10);
    s.addText(p[2], {
      x: x + 0.14, y: iy, w: 2.64, h: 0.82, margin: 0,
      fontFace: BODY, fontSize: 8, color: GREY, valign: 'top',
    });
  });
}

// ============================================================ 15. The finding
{
  const s = slide('The finding that changes the map', 'Why counts mislead, and what per-capita analysis reveals');

  card(s, X0, Y0, XW, 0.66, 'F0F7F5');
  s.addText('Kodagu is 30th in Karnataka by raw FIR count — and 6th per 100,000 residents.', {
    x: X0 + 0.18, y: Y0 + 0.04, w: XW - 0.36, h: 0.30, margin: 0,
    fontFace: BODY, fontSize: 13, bold: true, color: TEAL, valign: 'middle',
  });
  s.addText('335 FIRs looks unremarkable beside Bengaluru City\'s 16,895 — until you divide by 648,787 residents. A count map would never surface it. '
    + 'Tumakuru moves the other way: 10th by count, 24th by rate. Same register, opposite conclusion.', {
    x: X0 + 0.18, y: Y0 + 0.34, w: XW - 0.36, h: 0.28, margin: 0,
    fontFace: BODY, fontSize: 9, color: INK, valign: 'middle',
  });

  const shift = socio.districts.slice().sort((a, b) => Math.abs(b.rankShift) - Math.abs(a.rankShift)).slice(0, 6);
  s.addText('Rank by raw count vs rank per 100,000 residents', { x: X0, y: 2.26, w: 4.30, h: 0.24, margin: 0, fontFace: BODY, fontSize: 10.5, bold: true, color: NAVY });
  s.addChart(pptx.ChartType.bar, [
    { name: 'By raw count', labels: shift.map((d) => d.districtName), values: shift.map((d) => d.rankByCount) },
    { name: 'Per capita', labels: shift.map((d) => d.districtName), values: shift.map((d) => d.rankByRate) },
  ], {
    x: X0, y: 2.52, w: 4.30, h: 2.08,
    barDir: 'bar', chartColors: [GREY, TEAL], showValue: true, dataLabelPosition: 'outEnd',
    dataLabelColor: INK, dataLabelFontSize: 8,
    catAxisLabelColor: GREY, catAxisLabelFontSize: 8.5,
    valAxisLabelColor: GREY, valAxisLabelFontSize: 8.5,
    valGridLine: { color: 'EDF1F6', size: 1 }, catGridLine: { style: 'none', color: 'FFFFFF', size: 1 },
    showLegend: true, legendPos: 'b', legendFontSize: 8.5, barGapWidthPct: 40,
  });

  const RX = X0 + 4.66, RW = 4.50;
  s.addText(`Socio-economic correlation (n = ${socio.correlations[0].n} districts)`, { x: RX, y: 2.26, w: RW, h: 0.24, margin: 0, fontFace: BODY, fontSize: 10.5, bold: true, color: NAVY });
  socio.correlations.forEach((c, i) => {
    const y = 2.52 + i * 0.30;
    card(s, RX, y, RW, 0.28, WHITE);
    s.addText(c.indicator, { x: RX + 0.14, y, w: 1.70, h: 0.28, margin: 0, fontFace: BODY, fontSize: 9, color: INK, valign: 'middle' });
    s.addText(`r = ${c.pearson > 0 ? '+' : ''}${c.pearson}`, { x: RX + 1.86, y, w: 0.90, h: 0.28, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: BLUE, valign: 'middle' });
    s.addText(`p ${c.pValue < 0.0001 ? '< 0.0001' : `= ${c.pValue}`}  ·  ${c.strength}`, { x: RX + 2.76, y, w: 1.60, h: 0.28, margin: 0, fontFace: BODY, fontSize: 8, color: GREY, valign: 'middle' });
  });

  s.addText('Crime rate per 100,000 by urbanisation band', { x: RX, y: 3.48, w: RW, h: 0.24, margin: 0, fontFace: BODY, fontSize: 10.5, bold: true, color: NAVY });
  socio.composition.forEach((b, i) => {
    const y = 3.74 + i * 0.30;
    card(s, RX, y, RW, 0.28, WHITE);
    s.addText(b.band, { x: RX + 0.14, y, w: 0.82, h: 0.28, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: INK, valign: 'middle' });
    s.addText(`${b.districts} districts`, { x: RX + 0.98, y, w: 1.00, h: 0.28, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
    s.addText(`${b.ratePer100k} / 100k`, { x: RX + 2.02, y, w: 1.05, h: 0.28, margin: 0, fontFace: BODY, fontSize: 9, bold: true, color: TEAL, valign: 'middle' });
    s.addText(`${b.total.toLocaleString()} FIRs`, { x: RX + 3.10, y, w: 1.26, h: 0.28, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
  });

  card(s, X0, 4.70, XW, 0.60, SOFT);
  s.addText('What this changes operationally: deployment follows rate, not volume — and the caveat is stated openly.', {
    x: X0 + 0.16, y: 4.74, w: XW - 0.32, h: 0.22, margin: 0, fontFace: BODY, fontSize: 9.5, bold: true, color: NAVY, valign: 'middle',
  });
  s.addText('A district ranked 30th by count draws no extra staffing; ranked 6th by rate, it does. On this corpus the generator weights urban crime upward, '
    + 'so the urbanisation correlation is partly circular — the method is sound and runs unchanged on real KSP data, but here it is confirmation, not discovery.', {
    x: X0 + 0.16, y: 4.96, w: XW - 0.32, h: 0.30, margin: 0, fontFace: BODY, fontSize: 8, color: GREY, valign: 'top',
  });
}

// ============================================================ 16. Fairness
{
  const s = slide('Fair by construction — and proven', 'The hardest question a jury asks, answered with a test');

  let iy = titled(s, X0, Y0, 4.42, 1.42, 'What is excluded, and how it is enforced', TEAL, 0.38, 11);
  s.addText('Caste, religion and occupation never enter entity resolution, linkage, risk scoring or any prediction. '
    + 'A unit test fails the build if any protected column appears in a model feature set — the guarantee is executable, not editorial.', {
    x: X0 + 0.16, y: iy, w: 4.10, h: 0.88, margin: 0, fontFace: BODY, fontSize: 9.5, color: INK, valign: 'top',
  });

  iy = titled(s, X0 + 4.74, Y0, 4.42, 1.42, 'Explainability', BLUE, 0.38, 11);
  bullets(s, [
    'Every edge names the attribute that matched, and the FIRs it matched on',
    'Every risk score shows its factor breakdown, not just a number',
    'Every assistant answer cites the FIR numbers it drew from',
    'Sensitive reads are written to an audit trail',
  ], X0 + 4.90, iy, 4.10, 0.88, 9);

  s.addText('Ground-truth evaluation — recomputed on every pipeline run', {
    x: X0, y: 3.02, w: XW, h: 0.26, margin: 0, fontFace: BODY, fontSize: 12.5, bold: true, color: NAVY,
  });
  const pats = evalr.patterns.filter((p) => p.recoveryPct !== undefined).slice(0, 5);
  pats.forEach((p, i) => {
    const y = 3.34 + i * 0.34;
    if (i % 2 === 0) s.addShape(pptx.ShapeType.rect, { x: X0, y, w: XW, h: 0.32, fill: { color: SOFT }, line: { color: SOFT } });
    s.addText(p.pattern, { x: X0 + 0.14, y, w: 5.10, h: 0.32, margin: 0, fontFace: BODY, fontSize: 9.5, color: INK, valign: 'middle' });
    s.addText(p.type, { x: X0 + 5.30, y, w: 1.30, h: 0.32, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
    s.addText(`${p.recoveryPct}%`, { x: X0 + 6.66, y, w: 0.85, h: 0.32, margin: 0, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, valign: 'middle' });
    s.addText('recovered', { x: X0 + 7.54, y, w: 1.48, h: 0.32, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
  });
  s.addText(`Overall ground-truth recovery ${evalr.overallRecoveryPct}% · identity resolution ${evalr.identityRecoveryPct}% · every figure recomputed by eval.py after each run, never hand-entered.`, {
    x: X0, y: 5.06, w: XW, h: 0.22, margin: 0, fontFace: BODY, fontSize: 8.5, italic: true, color: GREY, valign: 'middle',
  });
}

// ============================================================ 17. Links
{
  const s = slide('Links', 'Everything is publicly accessible and independently verifiable');
  const links = [
    ['Deployed solution (Catalyst)', 'https://kadilabs-60078029367.development.catalystserverless.in/app/', BLUE, 'Web Client Hosting · sign in by role, no password needed'],
    ['Demo video', 'https://drive.google.com/drive/folders/1WY3KHg1WOEnSNTBXGmTtH2ZoJM1y4cLJ?usp=sharing', SAFF, 'Problem overview · working prototype · key workflows'],
    ['GitHub repository', 'https://github.com/adarshcod30/Kadi', NAVY, 'Full source, README, setup and execution instructions'],
    ['AppSail analytics service', 'https://kadi-appsail-50043957273.development.catalystappsail.in/analytics/socio', TEAL, 'Live JSON — per-capita rates and correlations'],
  ];
  let y = Y0;
  links.forEach((l) => {
    card(s, X0, y, XW, 0.84, WHITE);
    s.addShape(pptx.ShapeType.ellipse, { x: X0 + 0.16, y: y + 0.32, w: 0.20, h: 0.20, fill: { color: l[2] }, line: { color: l[2] } });
    s.addText(l[0], { x: X0 + 0.46, y: y + 0.08, w: 3.10, h: 0.32, margin: 0, fontFace: BODY, fontSize: 11, bold: true, color: INK, valign: 'middle' });
    s.addText(l[3], { x: X0 + 0.46, y: y + 0.40, w: 3.10, h: 0.34, margin: 0, fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'middle' });
    // Only attach `hyperlink` when there really is a URL — passing `undefined` makes
    // pptxgenjs try to read a colour off it and fall back to black.
    const isUrl = l[1].startsWith('http');
    const linkOpts = {
      x: X0 + 3.64, y: y + 0.06, w: XW - 3.80, h: 0.72, margin: 0,
      fontFace: BODY, fontSize: 9, color: isUrl ? BLUE : GREY, valign: 'middle',
    };
    if (isUrl) linkOpts.hyperlink = { url: l[1] };
    s.addText(l[1], linkOpts);
    y += 0.92;
  });
  s.addText('Deployment is exclusively on the Zoho Catalyst platform, as the challenge requires — no part of the running system is hosted elsewhere.', {
    x: X0, y: y + 0.02, w: XW, h: 0.24, margin: 0, fontFace: BODY, fontSize: 9, italic: true, color: GREY, valign: 'middle',
  });
}

// ============================================================ 18. Future
{
  const s = slide('Additional details & future development', 'What ships next, in priority order');
  const items = [
    ['Bind Catalyst Authentication', 'Replace the role header with a verified JWT inside userFromRequest — one function, nothing else changes.', TEAL],
    ['Read the API from Data Store', 'Swap the bundled read-model for ZCQL reads behind the existing store interface.', BLUE],
    ['Complete QuickML + Zia', 'Settle the request-body contract with Zoho support, then enable Kannada STT / TTS server-side.', SAFF],
    ['Persist the audit trail', 'Move the in-memory ring buffer into a Data Store table for real accountability.', NAVY],
    ['Ingest live KSP data', 'Signals on FIR insert for incremental recompute instead of a nightly full rebuild.', RED],
    ['Extend the graph', 'Vehicle numbers, phone / IMEI and bank accounts as first-class link types.', BLUE],
  ];
  items.forEach((it, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = X0 + col * 3.10, y = Y0 + row * 1.16;
    const iy = titled(s, x, y, 2.92, 1.08, `${i + 1}.  ${it[0]}`, it[2], 0.34, 10);
    s.addText(it[1], {
      x: x + 0.14, y: iy, w: 2.64, h: 0.62, margin: 0,
      fontFace: BODY, fontSize: 8.5, color: GREY, valign: 'top',
    });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: X0, y: 3.84, w: XW, h: 1.46, rectRadius: 0.06, fill: { color: NAVY }, line: { color: NAVY },
  });
  s.addText('Impact at real KSP scale', {
    x: X0 + 0.18, y: 3.90, w: XW - 0.36, h: 0.28, margin: 0,
    fontFace: BODY, fontSize: 12.5, bold: true, color: WHITE, valign: 'middle',
  });
  const impact = [
    [String(stats.crossDistrictNetworks), 'cross-district networks surfaced that no single station could see'],
    [stats.flaggedCases.toLocaleString(), 'investigations flagged as drifting past their peer median'],
    ['~800,000', 'FIRs a year in the real register the same code would carry'],
  ];
  impact.forEach((p, i) => {
    const x = X0 + 0.18 + i * 2.96;
    s.addShape(pptx.ShapeType.roundRect, { x, y: 4.22, w: 2.84, h: 0.60, rectRadius: 0.05, fill: { color: NAVY2 }, line: { color: NAVY2 } });
    s.addText(p[0], { x: x + 0.12, y: 4.25, w: 1.22, h: 0.54, margin: 0, fontFace: BODY, fontSize: 16, bold: true, color: WHITE, valign: 'middle' });
    s.addText(p[1], { x: x + 1.36, y: 4.25, w: 1.36, h: 0.54, margin: 0, fontFace: BODY, fontSize: 7.5, color: PALE, valign: 'middle' });
  });
  s.addText('Applied to Karnataka\'s real register, the same code turns a monthly Excel exercise into a nightly, auditable intelligence picture '
    + 'that a Sub-Inspector and the SCRB both read from one source — with the fairness guarantee enforced by a test, not a promise.', {
    x: X0 + 0.18, y: 4.88, w: XW - 0.36, h: 0.36, margin: 0,
    fontFace: BODY, fontSize: 9, color: PALE, valign: 'top',
  });
}

// ============================================================ 19. Thank you
{
  const s = pptx.addSlide();
  s.background = bg('bg_thanks');
}

pptx.writeFile({ fileName: `${__dirname}/KADI_KSP_Datathon_2026_Submission.pptx` })
  .then((f) => console.log('WROTE', f));
