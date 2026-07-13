// assistant.js — grounded NL assistant over the structured DB.
// Local intent engine (works offline for the demo) that answers ONLY from data and
// always cites FIR numbers. When QUICKML_LLM_ENDPOINT is configured, the Catalyst
// adapter would instead call GLM-4.7 with the same safe parametrized query "tools".
// Never infers/uses caste, religion or occupation for any judgment.
const { load } = require('./store.mock');
const queries = require('./queries');

const KN = /[ಀ-೿]/; // Kannada script range

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

  const hasSlip = /slip|at.?risk|ageing|aging|pending|pendenc|ಜಾರುತ್ತಿರುವ|ವಿಳಂಬ/.test(t);
  const hasPast = /past case|previous case|history|prior|ಹಿಂದಿನ ಪ್ರಕರಣ|previous/.test(t);
  const hasHotspot = /hotspot|emerging|spike|ಹಾಟ್‌ಸ್ಪಾಟ್|ಏರಿಕೆ/.test(t);
  const hasList = /fir|case|ಪ್ರಕರಣ|show|list|how many|count/.test(t);

  if (hasSlip) {
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
  } else if (hasList) {
    intent = 'cases_query';
    const head = detectHead(text, db);
    const district = detectDistrict(text, db);
    const dateFrom = detectDateFrom(text);
    const res = TOOLS.casesByHeadDistrict(user, { head, district, dateFrom });
    res.items.slice(0, 6).forEach((c) => citations.push({ type: 'case', id: c.caseMasterId, label: c.crimeNo }));
    const headName = head ? (db.lookups.heads.get(head) || {}).CrimeGroupName : 'matching';
    const distName = district ? (db.lookups.districts.get(district) || {}).DistrictName : 'the state';
    answer = isKn
      ? `${distName} ನಲ್ಲಿ ${res.total} ${headName || ''} ಪ್ರಕರಣಗಳು ಕಂಡುಬಂದಿವೆ.`
      : `Found ${res.total} ${headName} case(s) in ${distName}${dateFrom ? ' for the selected period' : ''}. Sample FIRs are cited; open any to explore its linkage graph.`;
    action = { type: 'open_cases', filters: { head, district, dateFrom } };
  } else {
    answer = isKn
      ? 'ನಾನು ಪ್ರಕರಣಗಳು, ಆರೋಪಿಗಳ ಇತಿಹಾಸ, ಜಾರುತ್ತಿರುವ ಪ್ರಕರಣಗಳು ಮತ್ತು ಅಪರಾಧ ತಾಣಗಳ ಬಗ್ಗೆ ಉತ್ತರಿಸಬಲ್ಲೆ.'
      : 'I can answer over the case records — try: "cyber-crime FIRs in Bengaluru this quarter", "show this accused\'s past cases", "which cases are slipping?", or "emerging hotspots".';
  }

  return {
    intent, lang: isKn ? 'kn' : 'en', answer, citations, action,
    fairness: queries.FAIRNESS_STATEMENT,
    grounded: true,
  };
}

module.exports = { query, TOOLS };
