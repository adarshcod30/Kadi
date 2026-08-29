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
    try { detail = queries.getCase(user, hit.caseMasterId); } catch { detail = null; }
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

function query(user, text, lang) {
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
  const crimeNoAsked = crimeNoMatch ? crimeNoMatch[1] : null;

  if (hasWhy && !hasForecast) {
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
      : `Over the next ${fc.horizonMonths || 3} months, ${rising.length} district(s) are projected to rise against their own 12-month average.${acc}`;
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
      ? `${res.total} ಪ್ರಕರಣಗಳು ತನಿಖೆಯಲ್ಲಿ ವಿಳಂಬವಾಗುತ್ತಿವೆ. ಅತಿ ಹೆಚ್ಚು ಅಪಾಯದ ${top.length} ಪ್ರಕರಣಗಳನ್ನು ಕೆಳಗೆ ತೋರಿಸಲಾಗಿದೆ.`
      : `${res.total} cases are flagged as slipping (ageing / pendency / undetected-risk). The ${top.length} highest-risk are cited below, each with a recommended action in the Health cockpit.`;
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
      : `${off.canonicalName} is linked to ${off.distinctCases} cases across ${off.distinctDistricts} district(s); behaviour-based risk ${off.riskScore}/100 (${off.band}). Caste/religion/occupation are not used.`;
    action = { type: 'open_offender', offenderId: off.offenderIdentityId };
  } else if (hasHotspot) {
    intent = 'hotspots';
    const res = TOOLS.emergingHotspots(user);
    res.hotspots.slice(0, 3).forEach((h) => citations.push({ type: 'hotspot', id: h.cellId, label: `${h.recentCount} cases/60d` }));
    answer = isKn
      ? `${res.hotspots.length} ಉದಯೋನ್ಮುಖ ಅಪರಾಧ ತಾಣಗಳು ಪತ್ತೆಯಾಗಿವೆ.`
      : `${res.hotspots.length} emerging hotspot(s) detected where recent activity far exceeds the historical baseline. See the Map.`;
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
      ? `${distName} ${res.total} ${headName ? headName + ' ' : ''}ಪ್ರಕರಣಗಳು ಕಂಡುಬಂದಿವೆ.`
      : `Found ${res.total} ${headName || 'matching'} case(s) in ${distName}${dateFrom ? ' for the selected period' : ''}. Sample FIRs are cited; open any to explore its linkage graph.`;
    action = { type: 'open_cases', filters: { head, district, dateFrom } };
  } else {
    answer = isKn
      ? 'ನಾನು ಪ್ರಕರಣಗಳು, ಆರೋಪಿಗಳ ಇತಿಹಾಸ, ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು, ಅಪರಾಧ ತಾಣಗಳು, ತಲಾ ಜನಸಂಖ್ಯೆಯ ಅಪರಾಧ ದರ ಮತ್ತು ಮುನ್ಸೂಚನೆಯ ಬಗ್ಗೆ ಉತ್ತರಿಸಬಲ್ಲೆ.'
      : 'I can answer over the case records — try: "cyber-crime FIRs in Bengaluru this quarter", "show this accused\'s past cases", "which cases are slipping?", "emerging hotspots", "highest crime rate per capita", or "forecast for next month".';
  }

  return {
    intent, lang: isKn ? 'kn' : 'en', answer, citations, action, noPhrase,
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
async function queryEnhanced(user, text, lang, req) {
  // Timed, and the timings are returned. This endpoint returned an empty HTTP 200 past about
  // fifteen seconds -- the platform gives up and sends nothing, the browser's res.json()
  // throws, and the interface said "could not be answered" over an answer that had been
  // computed correctly. Knowing which half spent the time is the difference between fixing
  // that and guessing at it.
  const t0 = Date.now();
  const base = query(user, text, lang);
  const baseMs = Date.now() - t0;
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
    if (base.lang === 'kn') {
      // eslint-disable-next-line global-require
      const translate = require('./translate');
      const en = await translate.translateOne(req, text, 'en').catch(() => null);
      if (en && en.translated && en.text && en.text !== text) {
        const retry = query(user, en.text, 'kn');
        if (retry.intent !== 'unknown') {
          return {
            ...retry,
            lang: 'kn',
            llm: 'intent-via-translation',
            // Surfaced rather than hidden: the reader should be able to see that the question
            // was re-read in English, in case the translation changed what was asked.
            interpretedAs: en.text,
          };
        }
      }
    }
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
  // Citations, intent and action stay as computed; only the prose is replaced.
  return {
    ...base, answer: phrased, llm: 'glm-4.7', deterministicAnswer: base.answer,
    timing: { baseMs, phraseMs },
  };
}

module.exports = { queryEnhanced, query, TOOLS };
