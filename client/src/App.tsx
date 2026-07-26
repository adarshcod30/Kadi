import { useState } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
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
import Intelligence from './pages/Intelligence';
import Assistant from './pages/Assistant';
import Audit from './pages/Audit';
import Admin from './pages/Admin';
import Login from './pages/Login';

export default function App() {
  const [lang, setLang] = useState<Lang>((localStorage.getItem('kadi.lang') as Lang) || 'en');
  const setLangP = (l: Lang) => { setLang(l); localStorage.setItem('kadi.lang', l); };

  // Login renders standalone (no shell chrome), and a first-time visitor lands there so
  // the role model is the first thing seen rather than something buried in a menu.
  const loc = useLocation();
  // ?as=<Role> lets a link open the app directly in a given rank. Useful for sharing a
  // demo view, and for headless capture where there is no stored session.
  const asRole = new URLSearchParams(loc.search).get('as');
  if (asRole && ['SI', 'Inspector', 'ACP', 'Analyst', 'Admin'].includes(asRole)) {
    localStorage.setItem('kadi.role', asRole);
  }
  const hasRole = Boolean(localStorage.getItem('kadi.role'));
  if (loc.pathname === '/login') {
    return (
      <LangContext.Provider value={{ lang, setLang: setLangP }}>
        <Login />
      </LangContext.Provider>
    );
  }
  if (!hasRole) return <Navigate to="/login" replace />;

  return (
    <LangContext.Provider value={{ lang, setLang: setLangP }}>
      <Shell>
        <Routes>
          <Route path="/about" element={<About />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
          <Route path="/intelligence" element={<Intelligence />} />
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
