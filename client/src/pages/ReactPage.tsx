// React — one queue, ordered by what fails first.
//
// The signals here all existed already, spread across four screens with four orderings and
// nothing anywhere saying which to do first. An officer with an hour before a review meeting
// had no way to spend it well. This is that ordering.
//
// Present tense only. Everything is already recorded; nothing is predicted — that is Forecast,
// deliberately kept separate. React answers "what do I do today".
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, ArrowRight, Sparkles, FileText, Users, Building2, Share2 } from 'lucide-react';
import { useWorklist, useMe } from '../api/hooks';
import { Skeleton, Empty, Section } from '../components/ui';
import { InfoDot, AiProvenanceInfo } from '../components/InfoDot';

const KIND: Record<string, { label: string; icon: any; tint: string }> = {
  case_failing: { label: 'Cases at risk', icon: FileText, tint: '#C0392B' },
  offender_active: { label: 'Active offenders', icon: Users, tint: '#E8871E' },
  station_pulsing: { label: 'Stations rising', icon: Building2, tint: '#C9820A' },
  linked_in: { label: 'Linked in', icon: Share2, tint: '#2FA8A0' },
};
const SEV: Record<string, string> = {
  high: 'border-l-danger bg-red-50/40',
  medium: 'border-l-warning bg-amber-50/30',
  info: 'border-l-kadi-teal bg-teal-50/25',
};

export default function ReactPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useWorklist({ limit: 60 });
  const [kind, setKind] = useState('');

  const items = (data?.items || []).filter((i: any) => !kind || i.kind === kind);
  const scopeWord = me?.capabilities.effectiveScope === 'unit' ? 'this station'
    : me?.capabilities.effectiveScope === 'district' ? 'this district' : 'the state';

  const open = (l: any) => {
    if (!l) return;
    if (l.page === 'case') nav(`/cases/${l.id}`);
    else if (l.page === 'offender') nav(`/offenders/${l.id}`);
    else if (l.page === 'graph') nav(`/graph?case=${l.id}`);
    else if (l.page === 'cases') nav(`/cases?${new URLSearchParams(l.query || {}).toString()}`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          <Zap size={19} className="text-kadi-gold" /> React
          <InfoDot label="What this page is" align="left">
            <b className="block mb-1 text-kadi-navy">One queue, ordered by what fails first</b>
            Every item here already exists somewhere else — health flags on Health, rising
            stations on Map, active offenders on Offenders, inbound links on Cases. Four
            screens, four orderings, and nothing that said which to do first.
            <b className="block mt-1.5 text-kadi-navy">How it is ranked</b>
            Severity first, then urgency within severity. A case is urgent by how far past the
            peer median for its own type it has run — not by raw age, because an old case of a
            slow type is not in trouble and a young one of a fast type may be.
            <b className="block mt-1.5 text-kadi-navy">Nothing here is predicted</b>
            This is all recorded fact. Projections and emerging risk live on Forecast.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">
          What needs a response in {scopeWord} today, ranked.
        </p>
      </div>

      {isLoading ? <div className="card"><Skeleton rows={8} /></div> : !data?.total ? (
        <Empty title="Nothing needs attention" hint="No case, offender or station in your scope is currently flagged." />
      ) : (
        <>
          {data.insight && (
            <div className="rounded-card border border-kadi-blue/25 bg-kadi-blue50/40 px-4 py-3 flex items-start gap-2.5">
              <Sparkles size={15} className="text-kadi-blue shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-blue mb-0.5 flex items-center gap-1.5">
                  Your queue today <AiProvenanceInfo source={data.insightSource} />
                </div>
                <p className="text-[13px] text-ink leading-relaxed">{data.insight}</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setKind('')}
              className={`px-3 py-1.5 rounded-full border text-[12.5px] transition-colors ${
                !kind ? 'bg-kadi-navy text-white border-kadi-navy' : 'bg-surface border-line text-ink-muted hover:bg-kadi-blue50'}`}>
              <span className="font-num font-semibold">{data.total.toLocaleString()}</span> total
              {data.highCount > 0 && <span className="text-danger"> · {data.highCount} urgent</span>}
            </button>
            {Object.entries(KIND).map(([k, meta]) => {
              const n = data.counts?.[k] || 0;
              if (!n) return null;
              const on = kind === k;
              return (
                <button key={k} onClick={() => setKind(on ? '' : k)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] transition-colors ${
                    on ? 'bg-kadi-navy text-white border-kadi-navy' : 'bg-surface border-line text-ink-muted hover:bg-kadi-blue50'}`}>
                  <meta.icon size={13} style={{ color: on ? undefined : meta.tint }} />
                  <span className="font-num font-semibold">{n.toLocaleString()}</span> {meta.label}
                </button>
              );
            })}
          </div>

          <Section title={`${items.length} shown${kind ? ` · ${KIND[kind]?.label}` : ''}`}>
            <div className="divide-y divide-line">
              {items.map((i: any) => (
                <motion.button key={i.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  onClick={() => open(i.link)}
                  className={`w-full text-left px-4 py-3 border-l-[3px] hover:bg-surface-3/60 transition-colors ${SEV[i.severity] || SEV.info}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-medium text-ink">{i.title}</span>
                        {i.metric && (
                          <span className="text-[11px] font-num bg-surface-3 text-ink-muted rounded-full px-2 py-0.5">
                            {i.metric}
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-ink-subtle mt-0.5">{i.where}</div>
                      <div className="text-[12.5px] text-ink-muted mt-1 leading-relaxed">{i.why}</div>
                      {/* The action is the reason this page exists. A queue that says what is
                          wrong but not what to do is a report with extra steps. */}
                      <div className="text-[12.5px] text-kadi-navy700 mt-1 flex items-start gap-1.5">
                        <ArrowRight size={12} className="mt-0.5 shrink-0 text-kadi-blue" />
                        {i.action}
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
