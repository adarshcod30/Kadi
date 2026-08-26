// Minimal i18n (en / kn). Kannada strings for the KSP-facing labels.
import { createContext, useContext } from 'react';

export type Lang = 'en' | 'kn';

export const DICT: Record<string, { en: string; kn: string }> = {
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
  intelligence: { en: 'Intelligence', kn: 'ಗುಪ್ತಚರ' },
  react: { en: 'React', kn: 'ಪ್ರತಿಕ್ರಿಯೆ' },
  forecast: { en: 'Forecast', kn: 'ಮುನ್ಸೂಚನೆ' },
  register: { en: 'Register a case', kn: 'ಪ್ರಕರಣ ದಾಖಲಿಸಿ' },
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

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'en', setLang: () => {},
});
export const useLang = () => useContext(LangContext);
export const useT = () => {
  const { lang } = useLang();
  return (key: string) => tr(key, lang);
};
