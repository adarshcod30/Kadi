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
  flagged: { en: 'Flagged cases', kn: 'ಗುರುತಿಸಲಾದ ಪ್ರಕರಣಗಳು' },
  networks: { en: 'Offender networks', kn: 'ಆರೋಪಿ ಜಾಲಗಳು' },
  riskScore: { en: 'Risk score', kn: 'ಅಪಾಯ ಸೂಚ್ಯಂಕ' },
  recommendedAction: { en: 'Recommended action', kn: 'ಶಿಫಾರಸು ಮಾಡಿದ ಕ್ರಮ' },
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
