// i18n (en / kn), in two layers.
//
// LAYER 1 is DICT below: hand-held keys for the chrome that must never be wrong -- the app
// name, the nav, the role labels. Short, reviewed, and looked up by key.
//
// LAYER 2 is tx(): pass it the ENGLISH SENTENCE and it returns the Kannada. It reads
// kn.json, a dictionary built once by scripts/build_kannada_dictionary.js and committed, so
// the toggle is instant and the Kannada can be corrected in a diff by someone who reads it.
// Anything not in that file is translated at runtime through /translate and cached in
// localStorage, so a string added after the last build still turns over -- once, on first
// sight, and free from then on.
//
// Why two layers rather than one: keys are right for the twenty labels that appear on every
// screen, and unbearable for the five hundred sentences that do not. Wrapping a sentence in
// tx() costs nothing at the call site and needs no key invented for it.
import { createContext, useContext, useEffect, useState } from 'react';
import KN from './kn.json';

export type Lang = 'en' | 'kn';

export const DICT: Record<string, { en: string; kn: string }> = {
  // The sidebar's own heading. Named here so it turns over with everything else.
  navHeading: { en: 'Workspace', kn: 'ಕಾರ್ಯಕ್ಷೇತ್ರ' },
  appName: { en: 'KADI', kn: 'ಕಡಿ' },
  tagline: { en: 'Connecting the links', kn: 'ಕೊಂಡಿಗಳನ್ನು ಜೋಡಿಸುವುದು' },
  ksp: { en: 'Karnataka State Police — Crime Intelligence', kn: 'ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪೊಲೀಸ್ — ಅಪರಾಧ ಗುಪ್ತಚರ' },
  about: { en: 'About', kn: 'ಬಗ್ಗೆ' },
  home: { en: 'Home', kn: 'ಮುಖಪುಟ' },
  graph: { en: 'Graph', kn: 'ಗ್ರಾಫ್' },
  cases: { en: 'Cases', kn: 'ಪ್ರಕರಣಗಳು' },
  offenders: { en: 'Offenders', kn: 'ಆರೋಪಿಗಳು' },
  health: { en: 'Health', kn: 'ಆರೋಗ್ಯ' },
  map: { en: 'Map', kn: 'ನಕ್ಷೆ' },
  intelligence: { en: 'Insights', kn: 'ಒಳನೋಟಗಳು' },
  insights: { en: 'Insights', kn: 'ಒಳನೋಟಗಳು' },
  react: { en: 'React', kn: 'ಪ್ರತಿಕ್ರಿಯೆ' },
  forecast: { en: 'Forecast', kn: 'ಮುನ್ಸೂಚನೆ' },
  register: { en: 'Register', kn: 'ದಾಖಲಾತಿ' },
  // One destination, two meanings. A station officer FILES a case there; everyone senior
  // APPROVES one. The button is icon-only, so this is what the tooltip says.
  registerCase: { en: 'Register a case', kn: 'ಪ್ರಕರಣ ದಾಖಲಿಸಿ' },
  approvals: { en: 'Approvals', kn: 'ಅನುಮೋದನೆಗಳು' },
  assistant: { en: 'Assistant', kn: 'ಸಹಾಯಕ' },
  audit: { en: 'Audit', kn: 'ಲೆಕ್ಕಪರಿಶೋಧನೆ' },
  admin: { en: 'Admin', kn: 'ನಿರ್ವಹಣೆ' },
  fairness: {
    en: 'Insights use evidence & behavior only — never caste, religion, or occupation.',
    kn: 'ಒಳನೋಟಗಳು ಸಾಕ್ಷ್ಯ ಮತ್ತು ವರ್ತನೆಯನ್ನು ಮಾತ್ರ ಬಳಸುತ್ತವೆ — ಜಾತಿ, ಧರ್ಮ ಅಥವಾ ಉದ್ಯೋಗವಲ್ಲ.',
  },
  learnMore: { en: 'Learn', kn: 'ತಿಳಿಯಿರಿ' },
  search: { en: 'Search cases, offenders…', kn: 'ಪ್ರಕರಣಗಳು, ಆರೋಪಿಗಳನ್ನು ಹುಡುಕಿ…' },
  linkedCases: { en: 'Linked cases', kn: 'ಸಂಬಂಧಿತ ಪ್ರಕರಣಗಳು' },
  whyLinked: { en: 'Why linked?', kn: 'ಏಕೆ ಸಂಬಂಧಿಸಿದೆ?' },
  openCases: { en: 'Open cases', kn: 'ತೆರೆದ ಪ್ರಕರಣಗಳು' },
  flagged: { en: 'Serious flags', kn: 'ಗಂಭೀರ ಗುರುತುಗಳು' },
  networks: { en: 'Offender networks', kn: 'ಆರೋಪಿ ಜಾಲಗಳು' },
  riskScore: { en: 'Risk score', kn: 'ಅಪಾಯ ಸೂಚ್ಯಂಕ' },
  recommendedAction: { en: 'Recommended action', kn: 'ಶಿಫಾರಸು ಮಾಡಿದ ಕ್ರಮ' },

  // --- Dashboard cards -------------------------------------------------------
  firsPerMonth: { en: 'FIRs registered per month', kn: 'ತಿಂಗಳಿಗೆ ದಾಖಲಾದ ಎಫ್‌ಐಆರ್‌ಗಳು' },
  whenCrime: { en: 'When crime happens — hour × weekday', kn: 'ಅಪರಾಧ ಯಾವಾಗ — ಗಂಟೆ × ವಾರದ ದಿನ' },
  topDistricts: { en: 'Top districts by case volume', kn: 'ಪ್ರಕರಣ ಪ್ರಮಾಣದಲ್ಲಿ ಪ್ರಮುಖ ಜಿಲ್ಲೆಗಳು' },
  whereCasesEnd: { en: 'Where cases end up', kn: 'ಪ್ರಕರಣಗಳು ಎಲ್ಲಿ ಕೊನೆಗೊಳ್ಳುತ್ತವೆ' },
  countsMislead: { en: 'Counts mislead — the same districts by rate', kn: 'ಸಂಖ್ಯೆಗಳು ದಾರಿತಪ್ಪಿಸುತ್ತವೆ — ದರದ ಪ್ರಕಾರ ಅದೇ ಜಿಲ್ಲೆಗಳು' },
  caseStatusMix: { en: 'Case status mix', kn: 'ಪ್ರಕರಣ ಸ್ಥಿತಿಯ ಮಿಶ್ರಣ' },
  crimeMix: { en: 'Crime mix', kn: 'ಅಪರಾಧ ಮಿಶ್ರಣ' },
  alerts: { en: 'Alerts', kn: 'ಎಚ್ಚರಿಕೆಗಳು' },
  indiaContext: { en: 'India context', kn: 'ಭಾರತದ ಸಂದರ್ಭ' },
  pictureBehind: { en: 'The picture behind the numbers', kn: 'ಸಂಖ್ಯೆಗಳ ಹಿಂದಿನ ಚಿತ್ರ' },
  whereHeading: { en: 'Where this is heading', kn: 'ಇದು ಎತ್ತ ಸಾಗುತ್ತಿದೆ' },
  whatKind: { en: 'What kind of crime', kn: 'ಯಾವ ಬಗೆಯ ಅಪರಾಧ' },
  whyThere: { en: 'Why it is there', kn: 'ಅದು ಏಕೆ ಅಲ್ಲಿದೆ' },
  whoVolume: { en: 'Who carries the volume', kn: 'ಪ್ರಮಾಣವನ್ನು ಯಾರು ಹೊರುತ್ತಾರೆ' },
  exploreIntel: { en: 'Explore the intelligence', kn: 'ಗುಪ್ತಚರವನ್ನು ಅನ್ವೇಷಿಸಿ' },

  // --- Status / common labels -------------------------------------------------
  chargesheeted: { en: 'Chargesheeted', kn: 'ದೋಷಾರೋಪ ಪಟ್ಟಿ' },
  underInvestigation: { en: 'Under investigation', kn: 'ತನಿಖೆಯಲ್ಲಿ' },
  undetected: { en: 'Undetected', kn: 'ಪತ್ತೆಯಾಗದ' },
  closed: { en: 'Closed', kn: 'ಮುಚ್ಚಲಾಗಿದೆ' },
  clearanceRate: { en: 'Clearance rate', kn: 'ಇತ್ಯರ್ಥ ದರ' },
  district: { en: 'District', kn: 'ಜಿಲ್ಲೆ' },
  station: { en: 'Station', kn: 'ಠಾಣೆ' },
  status: { en: 'Status', kn: 'ಸ್ಥಿತಿ' },
  gravity: { en: 'Gravity', kn: 'ಗಂಭೀರತೆ' },
  links: { en: 'Links', kn: 'ಕೊಂಡಿಗಳು' },
  registered: { en: 'Registered', kn: 'ದಾಖಲಾದ' },
  crime: { en: 'Crime', kn: 'ಅಪರಾಧ' },
  all: { en: 'All', kn: 'ಎಲ್ಲಾ' },
  open: { en: 'Open', kn: 'ತೆರೆಯಿರಿ' },
  signOut: { en: 'Sign out', kn: 'ಹೊರನಡೆಯಿರಿ' },
  switchRole: { en: 'Switch role (demo)', kn: 'ಪಾತ್ರ ಬದಲಾಯಿಸಿ (ಡೆಮೊ)' },

  // --- Graph ------------------------------------------------------------------
  caseLinkage: { en: 'Case-Linkage Graph', kn: 'ಪ್ರಕರಣ-ಸಂಪರ್ಕ ಗ್ರಾಫ್' },
  layout: { en: 'Layout', kn: 'ವಿನ್ಯಾಸ' },
  linkTypes: { en: 'Link types', kn: 'ಕೊಂಡಿ ಪ್ರಕಾರಗಳು' },
  exploreNetwork: { en: 'Explore the network', kn: 'ಜಾಲವನ್ನು ಅನ್ವೇಷಿಸಿ' },
};

export function tr(key: string, lang: Lang): string {
  const e = DICT[key];
  return e ? e[lang] : key;
}

// ---- layer 2: translate by English source text -------------------------------------------
const BUILT: Record<string, string> = KN as Record<string, string>;
const RUNTIME_KEY = 'kadi.kn.runtime';

function loadRuntime(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(RUNTIME_KEY) || '{}'); } catch { return {}; }
}
let runtime: Record<string, string> = loadRuntime();

// Subscribers re-render when a batch of runtime translations lands. Without this the first
// render of a new string stays English until something else happens to re-render it, which
// looks like the toggle half-worked.
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

const queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

async function flush() {
  timer = null;
  if (inFlight || !queue.size) return;
  // Twenty-four rather than sixty. The server translates in sequential groups of eight and a
  // group that falls through to the slower model costs seconds, so a sixty-string ask was
  // reliably past the function's budget. Smaller calls converge; one large call died whole.
  const batch = [...queue].slice(0, 24);
  batch.forEach((t) => queue.delete(t));
  inFlight = true;
  try {
    // Imported lazily: i18n is pulled in by nearly every module, and a static import of the
    // api layer here would make the dependency graph circular.
    const { api } = await import('./api');
    const out = await api.post<{ items: { source: string; text: string; translated: boolean }[] }>(
      '/translate', { to: 'kn', texts: batch },
    );
    let changed = false;
    for (const it of out.items || []) {
      if (it.translated && it.text && it.text !== it.source) { runtime[it.source] = it.text; changed = true; }
    }
    if (changed) {
      try { localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime)); } catch { /* quota */ }
      notify();
    }
  } catch {
    // Untranslated is a fine outcome: the English still renders. Failing loudly here would
    // put an error banner over a working page because one label did not turn over.
  } finally {
    inFlight = false;
    if (queue.size) timer = setTimeout(flush, 50);
  }
}

/**
 * Translate an English interface string. Returns the English unchanged in English mode, on a
 * miss, or on any failure -- this never returns empty, because a blank label is worse than an
 * untranslated one.
 */
export function tx(text: string, lang: Lang): string {
  if (lang !== 'kn' || !text) return text;
  const hit = BUILT[text] || runtime[text];
  if (hit) return hit;
  // Do not queue data. Numbers, ids and single tokens are values, not interface copy, and
  // sending an FIR number to a translator is how a record gets corrupted.
  if (/^[\d\s.,:%/-]+$/.test(text) || !/[a-zA-Z]/.test(text)) return text;
  if (!queue.has(text)) {
    queue.add(text);
    if (!timer) timer = setTimeout(flush, 120);
  }
  return text;
}

/** tx() bound to the current language, re-rendering when late translations arrive. */
export const useTx = () => {
  const { lang } = useLang();
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return (text: string) => tx(text, lang);
};

/**
 * Kannada -> English, built by inverting the dictionary.
 *
 * The restore path cannot rely on remembering which text nodes it changed. React owns those
 * nodes and recreates them whenever a component re-renders, which silently breaks a WeakMap
 * keyed on node identity -- and the symptom is a page that goes to Kannada and only half comes
 * back. Matching on the TEXT instead needs no memory at all: if a node says
 * "ವರದಿ ರಫ್ತು ಮಾಡಿ" and the dictionary says that is "Export briefing", it can be put back
 * whoever wrote it and however many times React has re-rendered since.
 *
 * Rebuilt on demand rather than cached, because the runtime half grows as strings are
 * translated and a stale inverse would strand exactly the newest ones.
 */
export function reverseKn(): Record<string, string> {
  const out: Record<string, string> = {};
  // Built first, runtime second: where both know a phrase, the reviewed translation wins.
  for (const [en, kn] of Object.entries(runtime)) if (kn && kn !== en) out[kn] = en;
  for (const [en, kn] of Object.entries(BUILT)) if (kn && kn !== en) out[kn] = en;
  return out;
}

/** How much of the interface is actually turning over, for the About page to state honestly. */
export const dictionaryStats = () => ({
  built: Object.keys(BUILT).length,
  runtime: Object.keys(runtime).length,
});

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'en', setLang: () => {},
});
export const useLang = () => useContext(LangContext);
export const useT = () => {
  const { lang } = useLang();
  return (key: string) => tr(key, lang);
};
