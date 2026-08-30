// assistant.js — grounded NL assistant over the structured DB.
// Local intent engine (works offline for the demo) that answers ONLY from data and
// always cites FIR numbers. When QUICKML_LLM_ENDPOINT is configured, the Catalyst
// adapter would instead call GLM-4.7 with the same safe parametrized query "tools".
// Never infers/uses caste, religion or occupation for any judgment.
const { load } = require('./store.mock');
const queries = require('./queries');
const quickml = require('./quickml');

const KN = /[ಀ-೿]/; // Kannada script range

// How long the wording model may take before the request stops waiting for it. Sized against
// what it actually costs: the phrasing call runs 8-12s at state tier, and the deterministic
// answer beneath it is ready in about one. Five seconds keeps the nicety on the fast path and
// removes it from the critical one.
// Figures an officer reads aloud in a briefing. 16136 is a digit soup; 16,136 is a number.
// The phrasing model is told to copy figures exactly, and the numeric guard strips commas
// before comparing, so formatting here reaches the reader without tripping either.
const n = (v) => Number(v || 0).toLocaleString('en-IN');

const PHRASE_DEADLINE_MS = Number(process.env.ASSISTANT_PHRASE_DEADLINE_MS || 5000);

// Safe parametrized query tools (whitelisted) — the assistant may only call these.
const TOOLS = {
  casesByHeadDistrict(user, { head, district, dateFrom }) {
    const res = queries.listCases(user, { head, district, dateFrom, pageSize: 200 });
    return res;
  },
  offenderByName(user, { name }) {
    const r = queries.listOffenders(user, { search: name, pageSize: 5 });
    return r.items[0] || null;
  },
  slippingCases(user) {
    return queries.listHealth(user, { severity: 'high', pageSize: 200 });
  },
  // One FIR, by the number written on it. The register holds 59,987 cases and every one of
  // them was reachable by this route -- there was simply no intent that took it, so a question
  // naming a case number fell into the generic list and the model was handed six unrelated
  // FIRs to answer from. It said, correctly, that the one asked about was not among them.
  caseByNumber(user, { crimeNo }) {
    const res = queries.listCases(user, { search: crimeNo, pageSize: 5 });
    const hit = (res.items || []).find((c) => String(c.crimeNo) === String(crimeNo))
      || (res.items || [])[0];
    if (!hit) return null;
    let detail = null;
    let graph = null;
    // `hit` came out of listCases, which is scoped, so this lookup is always in scope. Kept
    // explicit anyway: getCase answers a case outside the caller's scope with a
    // { visible:false } stub rather than throwing, and handing that to the model as though it
    // were a case would have it answer from a refusal.
    try { detail = queries.getCase(user, hit.caseMasterId); } catch { detail = null; }
    if (detail && detail.visible === false) detail = null;
    try { graph = queries.graphForCase(user, hit.caseMasterId); } catch { graph = null; }
    return { hit, detail, graph };
  },
  emergingHotspots(user) {
    return queries.hotspots(user, { emerging: 'true' });
  },
};

function detectHead(text, db) {
  const t = text.toLowerCase();
  const map = [['cyber', '4'], ['fraud', '4'], [' otp', '4'], ['upi', '4'],
    ['theft', '2'], ['robber', '2'], ['burglar', '2'], ['snatch', '2'], ['property', '2'],
    ['murder', '1'], ['assault', '1'], ['hurt', '1'], ['women', '3'], ['dowry', '3'],
    ['ndps', '6'], ['drug', '6'], ['missing', '7']];
  for (const [kw, id] of map) if (t.includes(kw)) return id;
  return null;
}
function detectDistrict(text, db) {
  const t = text.toLowerCase();
  for (const d of db.lookups.districts.values()) {
    if (t.includes(d.DistrictName.toLowerCase()) || (d.DistrictName.includes('Bengaluru') && t.includes('bengaluru')) || (d.DistrictName.includes('Bengaluru') && t.includes('bangalore'))) {
      return String(d.DistrictID);
    }
  }
  if (t.includes('bengaluru') || t.includes('bangalore')) return '1';
  return null;
}
function detectDateFrom(text) {
  const t = text.toLowerCase();
  if (t.includes('this quarter') || t.includes('ಈ ತ್ರೈಮಾಸಿಕ')) return '2026-04-01';
  if (t.includes('this year') || t.includes('ಈ ವರ್ಷ')) return '2026-01-01';
  if (t.includes('last year')) return '2025-01-01';
  if (t.includes('this month')) return '2026-07-01';
  return null;
}

// WHY THIS CARRIES RESOLVED ENTITIES AND NOT A CHAT HISTORY.
//
// "who is accused in the case" answered with a list of unrelated FIRs, and "why is this case
// heinous" answered that the facts contain nothing about this specific case. Both were right
// about their own inputs: each question arrived with no idea that "the case" had been resolved
// two turns earlier, so a referring expression matched nothing and fell to the catch-all.
//
// The obvious fix is to send the transcript and let a model work it out. That is the fix that
// costs this assistant the property it is built on. A model given a conversation will answer
// FROM the conversation -- restating a count it saw three turns ago rather than recomputing it,
// and a stale count is indistinguishable on screen from a fresh one.
//
// So the client carries FACTS, not prose: the case, district and crime head that were last
// RESOLVED by the deterministic engine. A follow-up binds its pronoun to those and re-queries
// the register. "who is accused in the case" becomes a fresh lookup of a known case number,
// answered from rows, cited, and as verifiable as if the number had been typed again.
function query(user, text, lang, context = {}) {
  const db = load();
  const isKn = KN.test(text) || lang === 'kn';
  const t = text.toLowerCase();
  let intent = 'unknown';
  const citations = [];
  let answer = '';
  let action = null;
  // Set by any branch whose exact wording is the answer. See the scope case below.
  let noPhrase = false;

  const hasSlip = /slip|at.?risk|ageing|aging|pending|pendenc|ಜಾರುತ್ತಿರುವ|ವಿಳಂಬ/.test(t);
  const hasPast = /past case|previous case|history|prior|ಹಿಂದಿನ ಪ್ರಕರಣ|previous/.test(t);
  const hasHotspot = /hotspot|emerging|spike|ಹಾಟ್‌ಸ್ಪಾಟ್|ಏರಿಕೆ/.test(t);
  const hasForecast = /forecast|predict|next month|coming month|projection|ಮುನ್ಸೂಚನೆ|ಮುನ್ನೋಟ/.test(t);
  // "why are there so many cases" is a causal question, not a count. Without this it fell
  // through to the list intent and answered "Found 40836 cases", which is not the question.
  const hasWhy = /\bwhy\b|what (is|are) (the )?(reason|driver|cause)|because|ಏಕೆ|ಕಾರಣ/.test(t);
  // Per-capita / socio-economic questions. \b on "rate" matters: without it this also
  // fires on "accurate", stealing "how accurate is the forecast" from the branch above.
  const hasRate = /per.?capita|per 100|\brates?\b|literac|urbanis|urbaniz|densit|socio|ತಲಾ|ದರ/.test(t);
  const hasList = /fir|case|ಪ್ರಕರಣ|show|list|how many|count/.test(t);
  // A crime number as written on the register: a long unbroken digit run. Matched on the raw
  // text rather than the lowercased copy because digits are the whole pattern, and bounded at
  // 10 so a year or a count cannot be mistaken for one.
  const crimeNoMatch = String(text).match(/\b(\d{10,})\b/);
  // A referring expression only binds when there is something to bind it TO. Without the
  // context check this would hijack every sentence containing the word "case".
  const refersBack = /\b(this|that|the|its|it'?s?)\s+(case|fir|incident)\b|\bthis fir\b|\bಈ ಪ್ರಕರಣ|\bಆ ಪ್ರಕರಣ/i
    .test(String(text));
  const carriedCase = context && context.crimeNo ? String(context.crimeNo) : null;
  const crimeNoAsked = crimeNoMatch ? crimeNoMatch[1] : (refersBack && carriedCase ? carriedCase : null);
  // Recorded so the interface can say WHICH case it took the question to be about. A follow-up
  // answered against the wrong case is the failure mode here, and it should be visible.
  const resolvedFromContext = Boolean(!crimeNoMatch && crimeNoAsked);

  // ...and not when a case is on the table. "why is this case heinous" is a question about one
  // FIR, but the socio branch owns the word "why" and answered it with per-capita rates across
  // five districts. The same guard already exists for forecasts; a case needs it too.
  if (hasWhy && !hasForecast && !crimeNoAsked) {
    intent = 'socio_rates';
    const socio = queries.socio();
    const top = (socio.districts || []).slice(0, 5);
    top.forEach((d) => citations.push({
      type: 'district', id: String(d.districtId), label: `${d.districtName} ${d.ratePer100k}/100k`,
    }));
    const corr = (socio.correlations || []).filter((c) => c.strength !== 'not significant');
    const comp = socio.composition || [];
    const urban = comp.find((c) => c.band === 'Urban');
    const rural = comp.find((c) => c.band === 'Rural');
    answer = isKn
      ? `ಒಟ್ಟು ಸಂಖ್ಯೆ ಹೆಚ್ಚಾಗಿ ಜನಸಂಖ್ಯೆಯನ್ನು ಅಳೆಯುತ್ತದೆ. ತಲಾ ಒಂದು ಲಕ್ಷಕ್ಕೆ ನೋಡಿದಾಗ ನಗರ ಜಿಲ್ಲೆಗಳ ದರ ${urban ? urban.ratePer100k : 0}, ಗ್ರಾಮೀಣ ${rural ? rural.ratePer100k : 0}.`
      : `Raw counts mostly track population. Normalised per 100,000 residents, urban districts run at ${urban ? urban.ratePer100k : 0} versus ${rural ? rural.ratePer100k : 0} in rural ones`
        + (corr.length ? `, and ${corr.map((c) => `${c.indicator.toLowerCase()} correlates ${c.direction}ly (r=${c.pearson})`).join('; ')}` : '')
        + '. Higher urban rates also reflect better reporting and station access, so this is association, not cause.';
    action = { type: 'open_intelligence' };
  } else if (hasForecast) {
    intent = 'forecast';
    const fc = queries.forecast();
    const rising = (fc.districts || []).filter((d) => d.direction === 'rising').slice(0, 5);
    rising.forEach((d) => citations.push({
      type: 'district', id: String(d.districtId), label: `${d.districtName} ${d.changePct > 0 ? '+' : ''}${d.changePct}%`,
    }));
    const acc = fc.accuracy ? ` Backtest MAPE ${fc.accuracy.mape}% over ${fc.accuracy.holdoutMonths} withheld months.` : '';
    answer = isKn
      ? `ಮುಂದಿನ ${fc.horizonMonths || 3} ತಿಂಗಳ ಮುನ್ಸೂಚನೆ ಪ್ರಕಾರ ${rising.length} ಜಿಲ್ಲೆಗಳಲ್ಲಿ ಏರಿಕೆ ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ.`
      : `Over the next ${fc.horizonMonths || 3} months, ${rising.length} district${rising.length === 1 ? '' : 's'} are projected to rise against their own 12-month average.${acc}`;
    action = { type: 'open_intelligence' };
  } else if (hasRate) {
    intent = 'socio_rates';
    const socio = queries.socio();
    const top = (socio.districts || []).slice(0, 5);
    top.forEach((d) => citations.push({
      type: 'district', id: String(d.districtId), label: `${d.districtName} ${d.ratePer100k}/100k`,
    }));
    const lead = top[0];
    // The interesting finding is the rank shift: districts raw counts hide.
    const hidden = (socio.districts || [])
      .filter((d) => d.rankShift > 5)
      .sort((a, b) => b.rankShift - a.rankShift)[0];
    const corr = (socio.correlations || []).find((c) => c.strength !== 'not significant');
    answer = isKn
      ? `ತಲಾ ಒಂದು ಲಕ್ಷ ಜನಸಂಖ್ಯೆಗೆ ಅತಿ ಹೆಚ್ಚು ಅಪರಾಧ ದರ ${lead ? lead.districtName : ''} ನಲ್ಲಿದೆ (${lead ? lead.ratePer100k : 0}).`
        + (hidden ? ` ${hidden.districtName} ಒಟ್ಟು ಸಂಖ್ಯೆಯಲ್ಲಿ ${hidden.rankByCount}ನೇ ಸ್ಥಾನದಲ್ಲಿದ್ದರೂ ದರದಲ್ಲಿ ${hidden.rankByRate}ನೇ ಸ್ಥಾನದಲ್ಲಿದೆ.` : '')
      : `Normalised by population, the highest rate is ${lead ? lead.districtName : 'n/a'} at ${lead ? lead.ratePer100k : 0} per 100,000 residents.`
        + (hidden ? ` Raw counts hide ${hidden.districtName}: ${hidden.rankByCount}th by count but ${hidden.rankByRate}th per capita.` : '')
        + (corr ? ` ${corr.indicator} correlates ${corr.direction}ly with the rate (r=${corr.pearson}, p=${corr.pValue}).` : '');
    action = { type: 'open_intelligence' };
  } else if (hasSlip) {
    intent = 'slipping_cases';
    const res = TOOLS.slippingCases(user);
    const top = res.items.slice(0, 5);
    top.forEach((h) => citations.push({ type: 'case', id: h.caseMasterId, label: h.crimeNo }));
    answer = isKn
      ? `${n(res.total)} ಪ್ರಕರಣಗಳು ತನಿಖೆಯಲ್ಲಿ ವಿಳಂಬವಾಗುತ್ತಿವೆ. ಅತಿ ಹೆಚ್ಚು ಅಪಾಯದ ${top.length} ಪ್ರಕರಣಗಳನ್ನು ಕೆಳಗೆ ತೋರಿಸಲಾಗಿದೆ.`
      : `${n(res.total)} cases are flagged as slipping (ageing / pendency / undetected-risk). The ${top.length} highest-risk are cited below, each with a recommended action in the Health cockpit.`;
    action = { type: 'open_health' };
  } else if (hasPast) {
    intent = 'offender_history';
    // try to find a name token after "of"/"for" or any offender name mentioned
    let off = null;
    for (const o of db.offenders) {
      const first = o.canonicalName.split(' ')[0].toLowerCase();
      if (t.includes(o.canonicalName.toLowerCase()) || t.includes(first)) { off = o; break; }
    }
    if (!off) off = db.offenders[0];
    (off.caseIds || []).slice(0, 8).forEach((cid) => {
      const c = db.cases.get(String(cid));
      if (c) citations.push({ type: 'case', id: c.caseMasterId, label: c.crimeNo });
    });
    answer = isKn
      ? `${off.canonicalName} ಅವರ ವಿರುದ್ಧ ${off.distinctCases} ಪ್ರಕರಣಗಳು ${off.distinctDistricts} ಜಿಲ್ಲೆಗಳಲ್ಲಿ ದಾಖಲಾಗಿವೆ. ಅಪಾಯ ಸೂಚ್ಯಂಕ ${off.riskScore}/100 (${off.band}). ಜಾತಿ/ಧರ್ಮ ಬಳಸಲಾಗಿಲ್ಲ.`
      : `${off.canonicalName} is linked to ${off.distinctCases} cases across ${off.distinctDistricts} district${off.distinctDistricts === 1 ? '' : 's'}; behaviour-based risk ${off.riskScore}/100 (${off.band}). Caste/religion/occupation are not used.`;
    action = { type: 'open_offender', offenderId: off.offenderIdentityId };
  } else if (hasHotspot) {
    intent = 'hotspots';
    const res = TOOLS.emergingHotspots(user);
    res.hotspots.slice(0, 3).forEach((h) => citations.push({ type: 'hotspot', id: h.cellId, label: `${h.recentCount} cases/60d` }));
    answer = isKn
      ? `${res.hotspots.length} ಉದಯೋನ್ಮುಖ ಅಪರಾಧ ತಾಣಗಳು ಪತ್ತೆಯಾಗಿವೆ.`
      : `${res.hotspots.length} emerging hotspot${res.hotspots.length === 1 ? '' : 's'} detected where recent activity far exceeds the historical baseline. See the Map.`;
    action = { type: 'open_map' };
  } else if (crimeNoAsked) {
    // A specific FIR, asked for by number. This must sit ABOVE the generic list branch: the
    // phrasing that carries a case number ("tell me about FIR ...") also matches hasList, and
    // whichever branch runs first decides whether the reader gets their case or a count.
    intent = 'case_lookup';
    const found = TOOLS.caseByNumber(user, { crimeNo: crimeNoAsked });
    if (!found) {
      // NOT RE-WORDED. "Not visible in your scope" and "does not exist" are different
      // statements and the model collapses the first into the second -- which tells a station
      // officer that a case they cannot see is a case that is not there. The distinction is
      // the entire content of this answer, so it is returned exactly as written.
      noPhrase = true;
      answer = isKn
        ? `${crimeNoAsked} ಸಂಖ್ಯೆಯ ಪ್ರಕರಣ ನಿಮ್ಮ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ ಕಾಣಿಸುತ್ತಿಲ್ಲ. ಅದು ಅಸ್ತಿತ್ವದಲ್ಲಿ `
          + `ಇಲ್ಲ ಎಂದಲ್ಲ — ಬೇರೆ ಜಿಲ್ಲೆಯ ಪ್ರಕರಣವಾಗಿರಬಹುದು. ಸಂಖ್ಯೆಯನ್ನು ಪರಿಶೀಲಿಸಿ, ಅಥವಾ ಆ ಜಿಲ್ಲೆಯ `
          + 'ವ್ಯಾಪ್ತಿ ಇರುವವರನ್ನು ಕೇಳಿ.'
        : `Case ${crimeNoAsked} is not visible in your scope. That is not the same as it not `
          + 'existing — it may be registered in a district you do not read. Check the number, '
          + 'or ask someone whose scope covers that district.';
    } else {
      const c = found.hit;
      const d = found.detail || {};
      const g = found.graph || { nodes: [], edges: [] };
      citations.push({ type: 'case', id: String(c.caseMasterId), label: String(c.crimeNo) });
      // The linked cases are the point of "and the network around it": name them so they are
      // clickable rather than counted.
      const linked = (g.nodes || [])
        .filter((n) => n.type === 'case' && String(n.caseId) !== String(c.caseMasterId))
        .slice(0, 6);
      linked.forEach((n) => citations.push({ type: 'case', id: String(n.caseId), label: String(n.label) }));
      const accused = (d.parties && d.parties.accused) || [];
      const nLinks = (g.edges || []).length;

      // ANSWER THE QUESTION THAT WAS ASKED, NOT THE ONE THE INTENT IS NAMED AFTER.
      //
      // Every question about a case used to get the same summary paragraph, so "who is accused"
      // was answered with a station and a status and no names. A case has several things a
      // reader can want from it and they are all already on the record.
      const asks = (re) => re.test(t);
      if (asks(/\bwho\b|accused|ಆರೋಪಿ/)) {
        const names = accused.map((a) => a.name).filter(Boolean);
        names.slice(0, 8).forEach((nm, i) => citations.push({
          type: 'accused', id: String(accused[i].accusedMasterId || i), label: nm,
        }));
        answer = names.length
          ? (isKn
            ? `${c.crimeNo} ಪ್ರಕರಣದಲ್ಲಿ ${names.length} ಆರೋಪಿ: ${names.join(', ')}.`
            : `${names.length} accused recorded on FIR ${c.crimeNo}: ${names.join(', ')}.`)
          : (isKn
            ? `${c.crimeNo} ಪ್ರಕರಣದಲ್ಲಿ ಯಾವುದೇ ಆರೋಪಿ ದಾಖಲಾಗಿಲ್ಲ.`
            : `No accused is recorded on FIR ${c.crimeNo}.`);
        // Names are records, not wording. The model paraphrasing a list of accused persons is
        // exactly the place not to let it.
        noPhrase = true;
      } else if (asks(/heinous|ಘೋರ|serious|gravity/)) {
        answer = isKn
          ? `${c.crimeNo} — ${c.crimeHead || ''}, ಗಂಭೀರತೆ ${c.gravity || 'ದಾಖಲಾಗಿಲ್ಲ'}. `
            + 'ಘೋರ ಎಂಬ ವರ್ಗೀಕರಣ ದಾಖಲಾದ ಅಪರಾಧ ಶೀರ್ಷಿಕೆ ಮತ್ತು ಕಲಮುಗಳಿಂದ ಬರುತ್ತದೆ, ಮಾದರಿಯಿಂದ ಅಲ್ಲ.'
          : `FIR ${c.crimeNo} is recorded as ${c.crimeHead || 'an unrecorded head'} with gravity `
            + `${c.gravity || 'not recorded'}. That classification comes from the crime head and `
            + 'the sections applied on the register, not from any model — KADI reports it, it does '
            + 'not decide it.';
        noPhrase = true;
      } else if (asks(/network|linked|connect|ಜಾಲ|ಸಂಬಂಧ/)) {
        answer = isKn
          ? `${c.crimeNo} ಸುತ್ತ ${linked.length} ಸಂಬಂಧಿತ ಪ್ರಕರಣ ಮತ್ತು ${nLinks} ಕೊಂಡಿಗಳಿವೆ.`
          : `The network around FIR ${c.crimeNo} holds ${linked.length} linked case`
            + `${linked.length === 1 ? '' : 's'} across ${nLinks} links.`;
      } else if (asks(/status|charge ?sheet|ಸ್ಥಿತಿ/)) {
        answer = isKn
          ? `${c.crimeNo} ಪ್ರಕರಣದ ಸ್ಥಿತಿ: ${c.status || 'ದಾಖಲಾಗಿಲ್ಲ'}.`
          : `FIR ${c.crimeNo} is currently ${c.status || 'of unrecorded status'}, registered at `
            + `${c.unitName || 'an unrecorded station'}.`;
        noPhrase = true;
      } else {
      answer = isKn
        ? `ಎಫ್‌ಐಆರ್ ${c.crimeNo} — ${c.crimeHead || ''}, ${c.districtName || ''} `
          + `(${c.unitName || ''}), ಸ್ಥಿತಿ ${c.status || ''}. `
          + `${accused.length} ಆರೋಪಿ(ಗಳು). ಸುತ್ತಲಿನ ಜಾಲದಲ್ಲಿ ${linked.length} ಸಂಬಂಧಿತ ಪ್ರಕರಣ`
          + `${linked.length === 1 ? '' : 'ಗಳು'} ಮತ್ತು ${nLinks} ಕೊಂಡಿಗಳು.`
        : `FIR ${c.crimeNo} — ${c.crimeHead || 'crime head not recorded'} in `
          + `${c.districtName || 'an unrecorded district'}`
          + `${c.unitName ? ` (${c.unitName})` : ''}, registered ${c.registrationDate || 'on an unrecorded date'}, `
          + `status ${c.status || 'unrecorded'}. ${accused.length} accused recorded. `
          + (linked.length
            ? `The network around it holds ${linked.length} linked case`
              + `${linked.length === 1 ? '' : 's'} across ${nLinks} links.`
            : 'No linked cases were found around it.');
      }
      action = { type: 'open_case', id: String(c.caseMasterId) };
    }
  } else if (hasList) {
    intent = 'cases_query';
    const head = detectHead(text, db);
    const district = detectDistrict(text, db);
    const dateFrom = detectDateFrom(text);
    const res = TOOLS.casesByHeadDistrict(user, { head, district, dateFrom });
    res.items.slice(0, 6).forEach((c) => citations.push({ type: 'case', id: c.caseMasterId, label: c.crimeNo }));
    // Fall-backs must match the answer's language or the Kannada sentence ends up with
    // English words spliced into it ("the state ನಲ್ಲಿ 40836 matching ಪ್ರಕರಣಗಳು").
    const headName = head ? (db.lookups.heads.get(head) || {}).CrimeGroupName : '';
    const distName = district
      ? (db.lookups.districts.get(district) || {}).DistrictName
      : (isKn ? 'ರಾಜ್ಯಾದ್ಯಂತ' : 'the state');
    answer = isKn
      ? `${distName} ${n(res.total)} ${headName ? headName + ' ' : ''}ಪ್ರಕರಣಗಳು ಕಂಡುಬಂದಿವೆ.`
      : `Found ${n(res.total)} ${headName || 'matching'} case${res.total === 1 ? '' : 's'} in ${distName}${dateFrom ? ' for the selected period' : ''}. Sample FIRs are cited; open any to explore its linkage graph.`;
    action = { type: 'open_cases', filters: { head, district, dateFrom } };
  } else {
    answer = isKn
      ? 'ನಾನು ಪ್ರಕರಣಗಳು, ಆರೋಪಿಗಳ ಇತಿಹಾಸ, ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು, ಅಪರಾಧ ತಾಣಗಳು, ತಲಾ ಜನಸಂಖ್ಯೆಯ ಅಪರಾಧ ದರ ಮತ್ತು ಮುನ್ಸೂಚನೆಯ ಬಗ್ಗೆ ಉತ್ತರಿಸಬಲ್ಲೆ.'
      : 'I can answer over the case records — try: "cyber-crime FIRs in Bengaluru this quarter", "show this accused\'s past cases", "which cases are slipping?", "emerging hotspots", "highest crime rate per capita", or "forecast for next month".';
  }

  return {
    intent, lang: isKn ? 'kn' : 'en', answer, citations, action, noPhrase,
    // What a follow-up may refer to. Facts the deterministic engine resolved, not prose.
    context: {
      crimeNo: crimeNoAsked || (context && context.crimeNo) || null,
      districtId: detectDistrict(text, db) || (context && context.districtId) || null,
      head: detectHead(text, db) || (context && context.head) || null,
    },
    // Surfaced so the reader can see the assistant took "this case" to mean a specific one.
    ...(resolvedFromContext ? { resolvedFromContext: crimeNoAsked } : {}),
    fairness: queries.FAIRNESS_STATEMENT,
    grounded: true,
  };
}

/**
 * QuickML-enhanced answer. The deterministic engine above still produces the facts and
 * citations; GLM-4.7 is only asked to word them. If it is unconfigured, slow, or errors,
 * the original answer is returned unchanged - the model can improve phrasing but can
 * never be a single point of failure, and can never invent an FIR number.
 */
async function queryEnhanced(user, text, lang, req, context = {}) {
  // Timed, and the timings are returned. This endpoint returned an empty HTTP 200 past about
  // fifteen seconds -- the platform gives up and sends nothing, the browser's res.json()
  // throws, and the interface said "could not be answered" over an answer that had been
  // computed correctly. Knowing which half spent the time is the difference between fixing
  // that and guessing at it.
  const t0 = Date.now();

  // A KANNADA QUESTION IS READ IN ENGLISH BEFORE IT IS ROUTED.
  //
  // Every intent pattern in query() is written against English phrasing, with a handful of
  // Kannada words bolted on beside each one. That works for the exact wordings someone thought
  // to add and fails for every inflection they did not: "ಯಾವ ಪ್ರಕರಣಗಳು ಜಾರುತ್ತಿವೆ?" missed the
  // slipping pattern, which carries ಜಾರುತ್ತಿರುವ, and fell through to the generic case list --
  // answering "no cases are reported as slipping" over sixteen thousand of them.
  //
  // Worse, the existing rescue only fired on intent 'unknown', and a Kannada question rarely
  // reaches 'unknown': the word ಪ್ರಕರಣ alone matches the catch-all list branch, so the question
  // lands on a confidently wrong answer instead of an admission.
  //
  // Translating first costs about 140ms and makes every intent reachable in Kannada rather
  // than the subset somebody hand-listed. The ANSWER is still built in Kannada -- query() takes
  // its language from the lang argument, not from the text it was handed.
  let routed = text;
  let interpretedAs = null;
  const asksInKannada = KN.test(text) || lang === 'kn';
  if (asksInKannada) {
    // eslint-disable-next-line global-require
    const translate = require('./translate');
    // noCache: this is a question, not an interface label. See the note in translate.js --
    // the shared cache answered this one with a nearby UI string and sent the router to the
    // wrong intent.
    const en = await translate.translateOne(req, text, 'en', { noCache: true }).catch(() => null);
    if (en && en.translated && en.text && en.text !== text) {
      routed = en.text;
      interpretedAs = en.text;
    }
  }

  // ROUTE ON THE NATIVE TEXT FIRST, AND USE THE TRANSLATION ONLY TO RESCUE IT.
  //
  // Translating first was the right instinct and the wrong order. Zia renders
  // "ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು ಯಾವುವು?" -- which asks which cases are SLIPPING -- as "Active
  // cases", and routing on those two words sent it to the catch-all list branch: the reader
  // asked which cases are in trouble and was told how many cases exist. The Kannada word
  // ಜಾರುತ್ತಿರುವ is in the slipping pattern already and matches the original exactly.
  //
  // So the hand-written Kannada patterns get first refusal, because when they match they are
  // certain, and the translation is consulted only when they do not -- when intent came back
  // 'unknown', or came back as the catch-all list branch that any sentence containing ಪ್ರಕರಣ
  // falls into. That keeps the coverage the translation buys for phrasings nobody listed,
  // without letting a loose rendering overrule a word that was actually there.
  let base = query(user, text, asksInKannada ? 'kn' : lang, context);
  const weak = (i) => i === 'unknown' || i === 'cases_query';
  if (routed !== text && weak(base.intent)) {
    const viaEnglish = query(user, routed, asksInKannada ? 'kn' : lang, context);
    if (!weak(viaEnglish.intent)) base = viaEnglish;
    else if (base.intent === 'unknown') base = viaEnglish;
  }
  const baseMs = Date.now() - t0;
  if (interpretedAs) base.interpretedAs = interpretedAs;
  if (!quickml.configured()) return { ...base, llm: 'disabled', timing: { baseMs } };

  // Questions the case database cannot answer go to the knowledge base.
  //
  // The two halves are complementary, not competing. The deterministic engine answers
  // questions of FACT exactly -- how many cyber cases in Udupi, who is linked to FIR 11597 --
  // and it must keep doing so, because a retrieved sentence can go stale where a live query
  // cannot. What it has no way to answer is what a thing MEANS: how the risk score is built,
  // why a busy station is not automatically red, what a health flag asks you to do. None of
  // that is in a column, and those are exactly the documents in the knowledge base.
  //
  // So RAG is consulted only when intent came back 'unknown' -- the engine saying "this is not
  // a question about the records". Consulting it earlier would risk answering a countable
  // question from prose.
  if (base.intent === 'unknown') {
    // A Kannada question the engine did not recognise gets one more chance in English before
    // it falls through to the knowledge base.
    //
    // The intent patterns are written against English phrasing, so a question asked in Kannada
    // -- or a Kannada suggestion the interface itself offered -- misses every one of them and
    // lands in RAG, which answers "no information is provided" to a question the records could
    // have answered exactly. Translating the QUESTION costs one model call and recovers the
    // deterministic answer; the ANSWER still comes back in Kannada, because base.lang decides
    // that and is taken from the original.
    // (The Kannada re-read used to live here, after the fact. It now happens before
    // routing, above, so a Kannada question reaches every intent rather than only the
    // ones that failed loudly enough to reach 'unknown'.)
    const rag = await quickml.ragAnswer(req, { question: text, lang: base.lang });
    if (rag && rag.answer) {
      return {
        ...base,
        answer: rag.answer,
        // Still grounded, in documents rather than rows -- and labelled so the difference is
        // visible instead of implied.
        grounded: true,
        source: 'knowledge_base',
        documentsSearched: rag.documents,
        llm: 'rag',
        deterministicAnswer: base.answer,
      };
    }
  }
  const facts = [
    base.answer,
    ...(base.citations || []).slice(0, 8).map((c) => `- ${c.type} ${c.label} (id ${c.id})`),
  ].join('\n');

  // Some answers are their own wording. A branch that sets noPhrase has said something the
  // model reliably degrades -- see the scope case in query() -- so it is returned verbatim.
  if (base.noPhrase) return { ...base, llm: 'verbatim', timing: { baseMs } };

  // THE PHRASING IS COSMETIC AND MUST NEVER COST THE ANSWER.
  //
  // The deterministic answer is complete in about a second; the model then spends eight to
  // twelve more re-wording it, and the whole request was waiting on that. At state tier this
  // put a simple "which cases are slipping" at 9-13 seconds -- close enough to the gateway's
  // patience that it failed intermittently, showing a generic error over an answer that had
  // been computed correctly and thrown away.
  //
  // So the model gets a deadline rather than the request's whole budget. Past it, the answer
  // that already exists is returned and the response says the phrasing timed out, which is a
  // true statement about a nicety rather than a failure of the question.
  const phrased = await Promise.race([
    quickml.phrase(req, { question: text, facts, lang: base.lang }).catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(null), PHRASE_DEADLINE_MS); }),
  ]);
  const phraseMs = Date.now() - t0 - baseMs;
  if (!phrased) return { ...base, llm: 'fallback', timing: { baseMs, phraseMs } };

  // A NUMBER THE FACTS DO NOT CONTAIN IS A NUMBER THE MODEL MADE UP.
  //
  // Prompting is not enough here and this is the demonstration: told to lead with the figure
  // that answers the question, the model counted the five example FIRs beneath the facts and
  // wrote "Five cases are flagged as slipping" over a deterministic answer that said 16,136.
  // Fluent, confident, and wrong by three orders of magnitude.
  //
  // So the phrasing is checked rather than trusted, the same way the endpoints are: every run
  // of digits in what the model wrote must appear in what it was given. Commas are stripped
  // first so 16,136 still matches 16136, and years and short ordinals are ignored because they
  // legitimately arise from wording ("the 5 highest" is already in the facts, "in 2026" is not
  // a claim about the register). Anything else and the deterministic answer is served instead
  // -- it was always correct, it was only ever plainer.
  const factDigits = new Set((String(facts).replace(/,/g, '').match(/\d+/g) || []));
  const invented = (String(phrased).replace(/,/g, '').match(/\d+/g) || [])
    .filter((n) => n.length > 1 && !factDigits.has(n));
  if (invented.length) {
    return {
      ...base,
      llm: 'rejected-phrasing',
      // Named so it can be seen in /ai/status and in a transcript rather than being silent.
      phrasingRejected: `introduced ${invented.slice(0, 3).join(', ')}`,
      timing: { baseMs, phraseMs },
    };
  }
  // Citations, intent and action stay as computed; only the prose is replaced.
  return {
    ...base, answer: phrased, llm: 'glm-4.7', deterministicAnswer: base.answer,
    timing: { baseMs, phraseMs },
  };
}

module.exports = { queryEnhanced, query, TOOLS };
