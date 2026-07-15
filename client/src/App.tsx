import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/Shell';
import { LangContext, Lang } from './lib/i18n';
import About from './pages/About';
import Dashboard from './pages/Dashboard';
import Cases from './pages/Cases';
import CaseDetail from './pages/CaseDetail';
import GraphExplorer from './pages/GraphExplorer';
import Offenders from './pages/Offenders';
import OffenderDetail from './pages/OffenderDetail';
import Health from './pages/Health';
import MapPage from './pages/MapPage';
import Assistant from './pages/Assistant';
import Audit from './pages/Audit';
import Admin from './pages/Admin';

export default function App() {
  const [lang, setLang] = useState<Lang>((localStorage.getItem('kadi.lang') as Lang) || 'en');
  const setLangP = (l: Lang) => { setLang(l); localStorage.setItem('kadi.lang', l); };

  return (
    <LangContext.Provider value={{ lang, setLang: setLangP }}>
      <Shell>
        <Routes>
          <Route path="/about" element={<About />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
          <Route path="/graph" element={<GraphExplorer />} />
          <Route path="/offenders" element={<Offenders />} />
          <Route path="/offenders/:id" element={<OffenderDetail />} />
          <Route path="/health" element={<Health />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </Shell>
    </LangContext.Provider>
  );
}
