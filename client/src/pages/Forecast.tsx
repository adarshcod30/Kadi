// Forecast — what is coming, and what changed.
//
// The counterpart to React. React is present tense over recorded fact; this is forward-looking
// and change-detecting, and it is the brief's items 4 and 6.
//
// One honesty rule runs through the page: no projection is shown without its error. A forecast
// without a track record is a guess with a chart, and the interval is the part that says how
// much to trust the middle.
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, Sparkles, Flame, Clock, Network, AlertTriangle } from 'lucide-react';
import { useOutlook, useForecast, useAnomalies } from '../api/hooks';
import { Skeleton, Empty, Section } from '../components/ui';
import { InfoDot, AiProvenanceInfo } from '../components/InfoDot';

const DIR = {
  rising: { icon: TrendingUp, tint: 'text-danger', word: 'Rising' },
  falling: { icon: TrendingDown, tint: 'text-success', word: 'Falling' },
  flat: { icon: Minus, tint: 'text-ink-muted', word: 'Flat' },
};

export default function Forecast() {
  const nav = useNavigate();
  const { data, isLoading } = useOutlook();
  const { data: fc } = useForecast();
  const { data: anom } = useAnomalies(8);

  if (isLoading) return <div className="card"><Skeleton rows={10} /></div>;
  if (!data?.casesAnalysed) return <Empty title="Not enough data to project" />;

  const m = data.momentum;
  const dir = DIR[(m?.direction || 'flat') as keyof typeof DIR];
  const bt = fc?.backtest;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
          <TrendingUp size={19} className="text-kadi-teal" /> Forecast
          <InfoDot label="What this page is" align="left">
            <b className="block mb-1 text-kadi-navy">Forward-looking, and change-detecting</b>
            Where React shows what needs a response today, this shows what is coming and what
            has shifted — projections, rises against an area's own history, co-occurring crime
            types, and the busiest hours.
            <b className="block mt-1.5 text-kadi-navy">Everything here is unsupervised</b>
            Trend, deviation and co-occurrence, not outcome prediction. Detection outcome in
            this corpus is essentially independent of case features, so a model predicting
            whether a case will be solved would return the base rate for everything. Measuring
            that first is why it is not on this page.
            <b className="block mt-1.5 text-kadi-navy">No projection without its error</b>
            The backtest is shown beside the forecast. A projection with no track record is a
            guess with a chart.
          </InfoDot>
        </h1>
        <p className="text-sm text-ink-muted">
          Read from {data.casesAnalysed.toLocaleString()} cases in your scope.
        </p>
      </div>

      {data.insight && (
        <div className="rounded-card border border-kadi-teal/25 bg-teal-50/40 px-4 py-3 flex items-start gap-2.5">
          <Sparkles size={15} className="text-kadi-teal shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-teal mb-0.5 flex items-center gap-1.5">
              The outlook <AiProvenanceInfo source={data.insightSource} />
            </div>
            <p className="text-[13px] text-ink leading-relaxed">{data.insight}</p>
          </div>
        </div>
      )}

      {/* Momentum */}
      {m && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
          <div className="card p-4">
            <div className="label flex items-center gap-1.5">
              Direction
              <InfoDot label="How direction is measured" align="left">
                The last three complete months against the three before them. The most recent
                month is excluded — it is usually partial, and a partial month always reads as
                a collapse.
              </InfoDot>
            </div>
            <div className={`flex items-baseline gap-2 mt-1.5 ${dir.tint}`}>
              <dir.icon size={22} />
              <span className="text-3xl font-semibold font-num">
                {m.changePct > 0 ? '+' : ''}{m.changePct}%
              </span>
            </div>
            <div className="text-[12.5px] text-ink-muted mt-1.5 leading-relaxed">
              {dir.word} — averaging <b className="text-ink">{m.recentAvg.toLocaleString()}</b> a
              month against <b className="text-ink">{m.priorAvg.toLocaleString()}</b> before.
            </div>
          </div>
          <Sparkline series={m.series} />
        </div>
      )}

      {/* Emerging risk */}
      <Section title={<span className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-danger" /> Emerging risk
        <span className="text-[12px] font-normal text-ink-muted">
          {data.emergingRisk?.total || 0} rising against their own baseline · as of {data.emergingRisk?.asOfMonth}
        </span>
        <InfoDot label="How this is ranked" align="left">
          <b className="block mb-1 text-kadi-navy">Ranked by how unusual, not how large</b>
          Each district and crime type is compared to its <i>own</i> history and scored in
          standard deviations. A district that always runs 400 a month going to 430 is noise; one
          that runs 12 going to 40 is a signal. Ranking by absolute rise would surface the first
          and bury the second every time — the failure mode of every volume dashboard.
          <b className="block mt-1.5 text-kadi-navy">Minimum evidence</b>
          At least six months of history and a baseline of three or more, or a rise cannot mean
          anything.
        </InfoDot>
      </span>}>
        {!data.emergingRisk?.items?.length ? (
          <Empty title="Nothing rising unusually" hint="No district and crime-type combination is materially above its own baseline." />
        ) : (
          <div className="divide-y divide-line">
            {data.emergingRisk.items.map((r: any) => (
              <button key={r.key} onClick={() => nav(`/cases?district=${r.districtId}&subhead=${r.subHeadId}`)}
                className={`w-full text-left px-4 py-2.5 border-l-[3px] hover:bg-surface-3/60 transition-colors ${
                  r.severity === 'high' ? 'border-l-danger' : r.severity === 'medium' ? 'border-l-warning' : 'border-l-kadi-blue'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-medium text-ink">{r.subHead}</span>
                  <span className="text-[12.5px] text-ink-muted">in {r.districtName}</span>
                  <span className="ml-auto text-[11px] font-num bg-surface-3 text-ink-muted rounded-full px-2 py-0.5">
                    {r.z}σ
                  </span>
                </div>
                <div className="text-[12.5px] text-ink-muted mt-0.5">
                  <b className="text-ink font-num">{r.current}</b> last month against a baseline
                  of <b className="text-ink font-num">{r.baseline}</b> — up {r.changePct}%, over{' '}
                  {r.monthsOfHistory} months of history.
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pattern discovery */}
        <Section title={<span className="flex items-center gap-2">
          <Network size={15} className="text-kadi-blue" /> Co-occurring crime types
          <InfoDot label="How co-occurrence is scored">
            <b className="block mb-1 text-kadi-navy">Lift, not raw count</b>
            How much more often two crime types appear in the same district-month than they
            would if they were unrelated. Counting raw co-occurrence would just rank the two
            commonest crimes together everywhere, which tells nobody anything.
            <b className="block mt-1.5 text-kadi-navy">What it is not</b>
            This is a relationship between crime TYPES, not a link between specific cases.
            Case-to-case links are on the Graph, and they carry evidence.
          </InfoDot>
        </span>}>
          {!data.patterns?.items?.length ? <Empty title="No co-occurrence above chance" /> : (
            <div className="p-3 space-y-2">
              {data.patterns.items.slice(0, 6).map((p: any) => (
                <div key={p.key} className="border border-line rounded-ctl px-3 py-2">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-medium text-ink">{p.a}</span>
                    <span className="text-ink-subtle">+</span>
                    <span className="font-medium text-ink">{p.b}</span>
                    <span className="ml-auto text-[11px] font-num text-kadi-blue bg-kadi-blue50 rounded-full px-2 py-0.5">
                      {p.lift}×
                    </span>
                  </div>
                  <div className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">{p.reading}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Shift profile */}
        <Section title={<span className="flex items-center gap-2">
          <Clock size={15} className="text-kadi-saffron" /> When to be there
          <InfoDot label="How to use this">
            Location tells you where; time tells you when. Together they make a patrol window,
            which is the deployable output — a map alone is not.
            <b className="block mt-1.5 text-kadi-navy">Read against an even day</b>
            Each block is compared to the {data.shiftProfile?.evenShare}% it would hold if
            incidents were spread evenly across the day.
          </InfoDot>
        </span>}>
          {!data.shiftProfile ? <Empty title="Not enough timed incidents" /> : (
            <div className="p-3 space-y-1.5">
              {data.shiftProfile.blocks.map((b: any, i: number) => (
                <div key={b.from} className="flex items-center gap-2.5">
                  <span className="font-num text-[12px] text-ink-muted w-24 shrink-0">{b.from}–{b.to}</span>
                  <div className="flex-1 h-4 bg-surface-3 rounded overflow-hidden">
                    <div className="h-full rounded transition-all" style={{
                      width: `${Math.min(100, (b.sharePct / (data.shiftProfile.blocks[0].sharePct || 1)) * 100)}%`,
                      background: i === 0 ? '#E8871E' : '#1A6FC4',
                      opacity: i === 0 ? 1 : 0.45,
                    }} />
                  </div>
                  <span className="font-num text-[12px] text-ink w-14 text-right shrink-0">{b.sharePct}%</span>
                  <span className={`font-num text-[11px] w-12 text-right shrink-0 ${b.lift >= 1.15 ? 'text-danger' : 'text-ink-subtle'}`}>
                    {b.lift}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Projection + its error, together */}
      {fc?.districts?.length && (
        <Section title={<span className="flex items-center gap-2">
          <TrendingUp size={15} className="text-kadi-teal" /> Three-month projection
          <InfoDot label="How to read a projection" align="left">
            <b className="block mb-1 text-kadi-navy">The interval is the honest part</b>
            The central figure is a projection of a trend, not a statement about what will
            happen. Read it with the range.
            {bt && (
              <>
                <b className="block mt-1.5 text-kadi-navy">Measured error</b>
                Backtested on {bt.holdoutMonths} held-out months: {bt.mape}% mean absolute
                percentage error. Shown because a projection without its track record is a guess.
              </>
            )}
          </InfoDot>
        </span>}
        action={bt && (
          <span className="text-[11.5px] text-ink-muted">
            backtest {bt.mape}% MAPE over {bt.holdoutMonths} months
          </span>
        )}>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {[...fc.districts]
              .sort((a: any, b: any) => (b.changePct || 0) - (a.changePct || 0))
              .slice(0, 9)
              .map((d: any) => {
                const nextMonth = (d.forecast || [])[0];
                const rising = d.direction === 'rising';
                return (
                  <button key={d.districtId} onClick={() => nav(`/cases?district=${d.districtId}`)}
                    className="border border-line rounded-ctl px-3 py-2.5 text-left hover:bg-kadi-blue50/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-ink truncate">{d.districtName}</span>
                      <span className={`ml-auto text-[11.5px] font-num ${rising ? 'text-danger' : d.direction === 'falling' ? 'text-success' : 'text-ink-muted'}`}>
                        {d.changePct > 0 ? '+' : ''}{d.changePct}%
                      </span>
                    </div>
                    {nextMonth && (
                      <div className="text-[12px] text-ink-muted mt-1 font-num">
                        {nextMonth.month}: <b className="text-ink">{Math.round(nextMonth.predicted)}</b>
                        <span className="text-ink-subtle"> ({Math.round(nextMonth.lower)}–{Math.round(nextMonth.upper)})</span>
                      </div>
                    )}
                  </button>
                );
              })}
          </div>
        </Section>
      )}

      {/* Anomalies */}
      {anom?.cases?.length && (
        <Section title={<span className="flex items-center gap-2">
          <Flame size={15} className="text-kadi-saffron" /> Behavioural anomalies
          <span className="text-[12px] font-normal text-ink-muted">{anom.caseTotal?.toLocaleString()} detected</span>
          <InfoDot label="What an anomaly is">
            A case whose recorded features — reporting delay, investigation age, number of
            parties — sit far from the norm for its type. Unsupervised: it needs no labels and
            makes no claim about guilt or outcome. It marks a record worth a second look.
          </InfoDot>
        </span>}>
          <div className="divide-y divide-line">
            {anom.cases.slice(0, 6).map((a: any) => (
              <button key={a.caseMasterId} onClick={() => nav(`/cases/${a.caseMasterId}`)}
                className="w-full text-left px-4 py-2.5 hover:bg-surface-3/60 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12.5px] text-ink">{a.crimeNo}</span>
                  <span className="ml-auto text-[11px] font-num bg-surface-3 text-ink-muted rounded-full px-2 py-0.5">
                    score {a.anomalyScore}
                  </span>
                </div>
                <div className="text-[12px] text-ink-muted mt-0.5 leading-relaxed">{a.reason}</div>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// A bare monthly line. No axis furniture: the numbers beside it already carry the magnitude,
// and this only has to show the shape.
function Sparkline({ series }: { series: { month: string; count: number }[] }) {
  if (!series?.length) return null;
  const w = 100; const h = 34;
  const max = Math.max(...series.map((s) => s.count));
  const min = Math.min(...series.map((s) => s.count));
  const span = max - min || 1;
  const pts = series.map((s, i) => {
    const x = (i / Math.max(1, series.length - 1)) * w;
    const y = h - ((s.count - min) / span) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <div className="card p-4 flex flex-col justify-between">
      <div className="label">Registrations per month · {series.length} months</div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-20 mt-2">
        <defs>
          <linearGradient id="fcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2FA8A0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2FA8A0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="url(#fcFill)" />
        <polyline points={pts.join(' ')} fill="none" stroke="#2FA8A0" strokeWidth="1.2"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-subtle font-num">
        <span>{series[0].month}</span>
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {min.toLocaleString()}–{max.toLocaleString()} per month
        </motion.span>
        <span>{series[series.length - 1].month}</span>
      </div>
    </div>
  );
}
