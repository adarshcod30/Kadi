// Forecast — what is coming, split into the two things that actually produce it.
//
// The page carries two heads, because "forecast" was covering two different kinds of claim
// and the reader could not tell which they were looking at:
//
//   STATISTICAL   trend, seasonality, deviation, co-occurrence, time-of-day. Decomposition an
//                 investigator can challenge line by line, with its backtest beside it.
//   MODEL         two trained models that RANK. Each is shown with the simple rule it beats
//                 and by how much, and with the five candidate models that lost, because a
//                 model page that only lists winners is a sales page.
//
// One honesty rule runs through both: no projection without its error, and no ranking without
// the baseline it was measured against. A forecast with no track record is a guess with a
// chart; a model with no baseline is a number with a logo.
//
// TIER SHAPING. A forecast is only useful at the grain the reader can act on:
//
//   STATE     the whole state and all 31 districts. Deliberately NO station-level projection —
//             station×month cells average 4.9 cases, where the Poisson floor alone is 36% and
//             any projection is noise with a decimal point.
//   DISTRICT  their own district against the state, and where inside it is moving.
//   STATION   the few things a station can act on: which way the register is going, the patrol
//             window, and who on this register is likely back. Not a projection of its own
//             monthly count, for the reason above.
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart, Area, Line, BarChart, Bar, Cell, ResponsiveContainer,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, ReferenceArea,
} from 'recharts';

import {
  TrendingUp, TrendingDown, Minus, Sparkles, Flame, Clock, Network, AlertTriangle,
  BarChart3, Cpu, Users2, CheckCircle2, XCircle, Activity,
} from 'lucide-react';
import { useOutlook, useForecast, useAnomalies, useOffenderRisk, usePendencyRisk, useMe } from '../api/hooks';
import { Skeleton, Empty, Section, TierChip } from '../components/ui';
import { InfoDot, AiProvenanceInfo } from '../components/InfoDot';
import { useNav } from '../lib/useNav';

const AXIS = { fontSize: 10, fill: '#5B6B7E' };

const DIR = {
  rising: { icon: TrendingUp, tint: 'text-danger', word: 'Rising' },
  falling: { icon: TrendingDown, tint: 'text-success', word: 'Falling' },
  flat: { icon: Minus, tint: 'text-ink-muted', word: 'Flat' },
};

// The measurement behind the whole ML head, stated on the page rather than in a commit
// message. Five of these lost and are shown losing: a reader who only ever sees the winners
// has no way to judge how hard the winners had to work.
// THE MODEL FAMILY, re-measured on the files that actually ship.
//
// This table has been corrected twice, and both corrections are worth stating because they
// both moved numbers that were already on the page.
//
// The first pass measured on a research panel and reported 30d 0.644, 90d 0.648, 180d 0.650,
// 365d 0.760. That panel asked a slightly different question -- it admitted offenders with a
// single prior case -- so the figures described a dataset nobody trains on.
//
// The second pass measured on the shipped file but censored every task at the same date. That
// is wrong in the other direction: a 90-day target only needs 90 days of future, and censoring
// it by a year costs it six observation dates and drags its train/test split a year earlier.
// Under that mistake the served 180-day model measured 0.609. Censored by its own horizon, as
// it ships, it measures 0.746.
//
// So: every model below is trained on rows whose future is complete FOR THAT MODEL, split on
// the observation date, and scored against the best simple rule that can see the question.
const MODEL_FAMILY = [
  { slug: 'h90', label: 'Back within 90 days', model: 0.699, rule: 0.584, ap: 0.319, apRule: 0.257,
    ruleName: 'recency', pos: 775, state: 'serving',
    use: 'A station duty list. Shares 7 of its top 20 with the six-month model, so it is a genuinely different set of names rather than the same list read sooner.' },
  { slug: 'h180', label: 'Back within six months', model: 0.746, rule: 0.562, ap: 0.538, apRule: 0.387,
    ruleName: 'recency', pos: 1051, state: 'serving',
    use: 'The default, and the widest margin on average precision — which is the number that matters for a list read from the top.' },
  { slug: 'h365', label: 'Back within a year', model: 0.733, rule: 0.512, ap: 0.720, apRule: 0.517,
    ruleName: 'recency', pos: 1318, state: 'serving',
    use: 'A watchlist review horizon.' },
  { slug: 'new365', label: 'Surfaces somewhere new', model: 0.762, rule: 0.561, ap: 0.452, apRule: 0.309,
    ruleName: 'districts worked so far', pos: 732, state: 'serving',
    use: 'Will their next FIR be in a district they have never worked? The question no single SP can answer from their own register — and it shares ONE name in its top 20 with the year-long return list.' },
  { slug: 'heinous365', label: 'Escalates to Heinous', model: 0.661, rule: 0.502, ap: 0.089, apRule: 0.057,
    ruleName: 'recency', pos: 155, state: 'serving',
    use: 'Severity rather than frequency. Survives the test that killed the crime-family models: conditioned on the offender returning at all, it still beats the rule by +0.121.' },
  { slug: 'women365', label: 'Returns with a crime against women', model: 0.638, rule: 0.459, ap: 0.040, apRule: 0.021,
    ruleName: 'recency', pos: 60, state: 'serving',
    use: 'The thinnest evidence base here — 60 positives in the hold-out — and the clearest operational claim. Read it as a prompt to look, not a finding.' },
];

// Measured on the same panel and NOT shipped. A family of six that all happen to win would be
// a family that was never really tested.
const FAMILY_REJECTED = [
  { label: 'Back within 30 days', model: 0.658, rule: 0.588,
    why: '+0.069 on AUC and +0.013 on average precision. Its shortlist IS distinct — 1 of 20 shared with the six-month list — but a list that names different people less accurately is just a different wrong list.' },
  { label: 'Next FIR is a property crime', model: 0.657, rule: 0.562,
    why: 'Looks like a win and is not. "Comes back AND it is property" inherits the predictability of "comes back". Conditioned on the offender actually returning, the margin collapses to +0.022 — it was ranking who returns, not what with.' },
  { label: 'Next FIR is a body crime', model: 0.710, rule: 0.575,
    why: 'Same failure. Conditional margin +0.074.' },
  { label: 'Next FIR is an economic crime', model: 0.728, rule: 0.508,
    why: 'Same failure. Conditional margin +0.085.' },
  { label: 'Next FIR is a cyber crime', model: 0.464, rule: 0.566,
    why: 'Loses outright to prior case count.' },
];

const CANDIDATES = [
  { task: 'Repeat offending within 180 days', model: 0.746, rule: 0.562, ruleName: 'recency', ship: true },
  { task: 'Repeat offending within 90 days', model: 0.699, rule: 0.584, ruleName: 'recency', ship: true },
  { task: 'Repeat offending within a year', model: 0.733, rule: 0.512, ruleName: 'recency', ship: true },
  { task: 'Next FIR in a district never worked', model: 0.762, rule: 0.561, ruleName: 'districts worked so far', ship: true },
  { task: 'Next FIR recorded Heinous', model: 0.661, rule: 0.502, ruleName: 'recency', ship: true },
  { task: 'Next FIR a crime against women', model: 0.638, rule: 0.459, ruleName: 'recency', ship: true },
  { task: 'District × head spike next month', model: 0.677, rule: 0.620, ruleName: 'inverse recent level', ship: true },
  { task: 'Station pendency +20% in 3 months', model: 0.870, rule: 0.701, ruleName: 'inflow over recent clearance', ship: true },
  { task: 'Station surge next month', model: 0.738, rule: 0.717, ruleName: 'inverse recent level', ship: false,
    why: 'Wins by +0.021 — but strip absolute volumes from the features and it falls to 0.583, below the rule. It was learning station size, not risk.' },
  { task: 'Location re-victimisation, 14 days', model: 0.621, rule: 0.632, ruleName: '26-week rate', ship: false,
    why: 'Loses outright. Persistence — "somewhere that had a crime recently will have another" — is most of the signal.' },
  { task: 'Cross-district escalation (per case)', model: 0.586, rule: 0.691, ruleName: 'share of districts so far', ship: false,
    why: 'Loses to a one-line ratio by a wide margin — asked once per case. Re-asked on the offender × observation-date panel as "will their next FIR be in a district they have never worked", the same idea wins by +0.201 and ships. The framing was the problem, not the question.' },
  { task: 'Charge-sheet within 90 days, at registration', model: 0.520, rule: 0.527, ruleName: 'sub-head history', ship: false,
    why: 'No signal beyond what the crime type already tells you.' },
  { task: 'Linkage at registration', model: 0.930, rule: 0.929, ruleName: 'sub-head history', ship: false,
    why: 'Scores 0.930 and adds +0.002. The linkage pipeline keys on modus operandi and MO derives from sub-head, so the target is nearly a function of one input column.' },
  { task: 'Repeat victimisation (person)', model: 0.692, rule: 0.758, ruleName: 'prior count', ship: false,
    why: 'Loses to counting. It is also near-degenerate on this corpus — 91% of observed victims are victimised again inside six months, so there is almost nothing to separate.' },
  { task: 'IO caseload surge', model: 0.731, rule: 0.589, ruleName: 'z of last month', ship: false,
    why: 'Beats the rule on AUC and is still not worth shipping: the event happens to 0.1% of officer-months, so average precision is 0.018. A model that is right about almost nothing ranks well and helps no one.' },
];

// Counted, not typed. These sentences have been wrong twice: once when the model family grew
// from two to seven, and once when I "corrected" them by hand and still got the rejected count
// wrong. A number that describes a list on the same page should be read off that list.
const N_SERVING = CANDIDATES.filter((c) => c.ship).length;
const N_REJECTED = CANDIDATES.filter((c) => !c.ship).length + FAMILY_REJECTED.length;
const N_MEASURED = N_SERVING + N_REJECTED;
const WORDS: Record<number, string> = {
  5: 'Five', 6: 'Six', 7: 'Seven', 10: 'Ten', 11: 'Eleven', 12: 'Twelve', 14: 'Fourteen',
  17: 'Seventeen', 18: 'Eighteen', 19: 'Nineteen', 20: 'Twenty',
};
const word = (n: number) => WORDS[n] || String(n);

// The registry phrases each task as a statement -- "next FIR is in a district they have never
// worked" -- because that is how it reads in a table. A card asks it, so it needs a capital and
// a question mark and nothing else. Prefixing "Will this offender ..." is what produced "Will
// this offender next FIR is in a district they have never worked?".
const askable = (q?: string) => {
  const t = String(q || 'back on a new FIR').trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${t.endsWith('?') ? '' : '?'}`;
};
const ML_BLURB = `${word(N_SERVING)} trained models that rank, each against the simple rule it `
  + `has to beat — and the ${word(N_REJECTED).toLowerCase()} that did not.`;

export default function Forecast() {
  const nav = useNav();
  const { data: me } = useMe();
  const { data, isLoading } = useOutlook();
  const { data: fc } = useForecast();
  const { data: anom } = useAnomalies(8);
  const [model, setModel] = useState('h180');
  const { data: risk } = useOffenderRisk(model);
  const { data: pend } = usePendencyRisk();
  const [head, setHead] = useState<'stat' | 'ml'>('stat');

  const caps = me?.capabilities;
  const tier: 'state' | 'district' | 'station' = caps?.isStation ? 'station'
    : (caps?.tier === 'district' || caps?.drilledFromState) ? 'district' : 'state';
  const scopeName = tier === 'station' ? (caps?.unitName || 'this station')
    : tier === 'district' ? (caps?.districtName || 'this district') : 'Karnataka';

  if (isLoading) return <div className="card"><Skeleton rows={10} /></div>;
  if (!data?.casesAnalysed) return <Empty title="Not enough data to project" />;

  const m = data.momentum;
  const dir = DIR[(m?.direction || 'flat') as keyof typeof DIR];
  const bt = fc?.accuracy;

  return (
    <div className="space-y-4">
      {/* Header. The scope badge sits at the far right, where Health and React put it. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2">
            <TrendingUp size={19} className="text-kadi-teal" /> Forecast
            <InfoDot label="What this page is" align="left" width="w-96">
              <b className="block mb-1 text-kadi-navy">Two heads, because they make two different claims</b>
              The statistical head decomposes the series — trend, seasonality, deviation — and
              shows its backtest. The model head ranks, and shows the simple rule each model
              beats and by how much.
              <b className="block mt-1.5 text-kadi-navy">Why there is no station-level projection</b>
              A station-month cell averages 4.9 cases. For a Poisson count with that mean, even
              a perfect predictor misses by 36%, so a monthly projection per station would be
              noise with a decimal point. Stations get the things they can act on instead.
              <b className="block mt-1.5 text-kadi-navy">No projection without its error</b>
              The backtest sits beside the forecast, and every model sits beside its baseline.
            </InfoDot>
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Read from {data.casesAnalysed.toLocaleString()} cases in {scopeName}.
          </p>
        </div>
        <TierChip tier={tier} label={scopeName} />
      </div>

      {/* The two heads. */}
      <div className="flex gap-1 border-b border-line">
        {([
          { key: 'stat', icon: BarChart3, label: 'Statistical forecaster',
            blurb: 'Trend, seasonality and deviation, computed in the open and shown with the error it measured on itself.' },
          { key: 'ml', icon: Cpu, label: 'ML forecaster',
            blurb: ML_BLURB },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setHead(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${
              head === t.key ? 'border-kadi-teal text-kadi-teal' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-ink-muted -mt-2">
        {head === 'stat'
          ? 'Trend, seasonality and deviation, computed in the open and shown with the error it measured on itself.'
          : ML_BLURB}
      </p>

      {head === 'stat' && <>
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

        {/* Momentum — every tier. Which way the register is going is the one thing that means
            the same at all three ranks. */}
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

        {/* When to be there — deliberately FIRST at station rank. A patrol window is the one
            forecast output an SHO can act on this evening; a projection is not. */}
        {tier === 'station' && <ShiftPanel data={data} />}

        {/* Emerging risk. At station rank the district's other stations are not this officer's
            business, so it is dropped rather than shown scoped-but-irrelevant. */}
        {tier !== 'station' && (
          <Section title={<span className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-danger" /> Emerging risk
            <span className="text-[12px] font-normal text-ink-muted">
              {data.emergingRisk?.total || 0} rising against their own baseline · as of {data.emergingRisk?.asOfMonth}
            </span>
            <InfoDot label="How this is ranked" align="left">
              <b className="block mb-1 text-kadi-navy">Ranked by how unusual, not how large</b>
              Each district and crime type is compared to its <i>own</i> history and scored in
              standard deviations. A district that always runs 400 a month going to 430 is noise;
              one that runs 12 going to 40 is a signal. Ranking by absolute rise would surface
              the first and bury the second every time.
              <b className="block mt-1.5 text-kadi-navy">Minimum evidence</b>
              At least six months of history and a baseline of three or more.
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
        )}

        <div className={`grid grid-cols-1 ${tier === 'state' ? 'lg:grid-cols-2' : ''} gap-4`}>
          {/* Co-occurrence needs variation ACROSS district-months to have anything to measure.
              Inside one district the common heads appear in nearly every month, chance is
              already near one, and the panel can only ever say "nothing". State only. */}
          {tier === 'state' && (
            <Section title={<span className="flex items-center gap-2">
              <Network size={15} className="text-kadi-blue" /> Co-occurring crime types
              <InfoDot label="How co-occurrence is scored">
                <b className="block mb-1 text-kadi-navy">Lift, not raw count</b>
                How much more often two crime types appear in the same district-month than they
                would if they were unrelated. Counting raw co-occurrence would just rank the two
                commonest crimes together everywhere.
                <b className="block mt-1.5 text-kadi-navy">What it is not</b>
                A relationship between crime TYPES, not a link between specific cases.
              </InfoDot>
            </span>}>
              {!data.patterns?.items?.length ? (
                <Empty title="No co-occurrence above chance"
                  hint="No pair of crime types appears together materially more often than if they were unrelated." />
              ) : (
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
          )}

          {tier !== 'station' && <ShiftPanel data={data} />}
        </div>

        {/* Projection. State sees the state line and all 31; a district sees its own against
            the rest; a station sees its district's, labelled as context rather than as theirs. */}
        {fc?.districts?.length && (
          <Section title={<span className="flex items-center gap-2">
            <TrendingUp size={15} className="text-kadi-teal" />
            {tier === 'station' ? 'Where this district is heading' : 'Three-month projection'}
            <InfoDot label="How to read a projection" align="left">
              <b className="block mb-1 text-kadi-navy">The interval is the honest part</b>
              The central figure is a projection of a trend, not a statement about what will
              happen. Read it with the range.
              {bt && (
                <>
                  <b className="block mt-1.5 text-kadi-navy">Measured error</b>
                  Backtested on {bt.holdoutMonths} held-out months: {bt.mape}% mean absolute
                  percentage error, {bt.mae} cases mean absolute error.
                </>
              )}
              <b className="block mt-1.5 text-kadi-navy">Level shifts are refitted, not averaged through</b>
              This corpus steps from about 1,300 registrations a month to about 2,300 in January
              2026. A straight line drawn across that break splits the difference and then
              under-forecasts for ever — it scored 24.4% error doing exactly that. The fit
              restarts after a detected break, and the response says which month it restarted at.
            </InfoDot>
          </span>}
          action={bt && (
            <span className="text-[11.5px] text-ink-muted">
              backtest {bt.mape}% MAPE over {bt.holdoutMonths} months
            </span>
          )}>
            {tier === 'station' && (
              <p className="px-4 pt-3 text-[12.5px] text-ink-muted">
                Aggregate monthly counts for the district this station sits in. There is no
                station-level projection, and that is deliberate: at 4.9 cases a month the
                arrival noise alone is larger than any trend a model could find.
              </p>
            )}
            {/* The projection as a picture. Numbers in brackets cannot show whether the
                forecast continues the shape of the history or departs from it. */}
            <ProjectionChart
              history={(fc.scope === 'district' && fc.focus ? fc.focus.history : fc.state?.history) || []}
              forecast={(fc.scope === 'district' && fc.focus ? fc.focus.forecast : fc.state?.forecast) || []}
              label={fc.scope === 'district' && fc.focus
                ? `${fc.focus.districtName}, last 18 months and the next ${fc.horizonMonths || 3}`
                : `Karnataka, last 24 months and the next ${fc.horizonMonths || 3}`}
            />
            {fc.scope === 'district' && fc.focus && (
              <div className="p-3 pb-0">
                <div className="rounded-ctl border border-kadi-teal/30 bg-teal-50/40 px-3.5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold text-kadi-navy">{fc.focus.districtName}</span>
                    <span className={`text-[12.5px] font-num ${fc.focus.direction === 'rising' ? 'text-danger' : 'text-success'}`}>
                      {fc.focus.changePct > 0 ? '+' : ''}{fc.focus.changePct}%
                    </span>
                    <span className="ml-auto text-[11.5px] text-ink-muted">
                      {fc.focus.rankByChange} of {fc.focus.ofDistricts} by change
                    </span>
                  </div>
                  {(fc.focus.forecast || [])[0] && (
                    <div className="text-[12.5px] text-ink-muted mt-1 font-num">
                      {fc.focus.forecast[0].month}: <b className="text-ink">{Math.round(fc.focus.forecast[0].predicted)}</b>
                      <span className="text-ink-subtle"> ({Math.round(fc.focus.forecast[0].lower)}–{Math.round(fc.focus.forecast[0].upper)})</span>
                      <span className="text-ink-subtle"> · {fc.focus.vsStateChangePct > 0 ? '+' : ''}{fc.focus.vsStateChangePct} points against the state trend</span>
                    </div>
                  )}
                </div>
                {tier !== 'station' && (
                  <div className="label mt-3 mb-1">
                    Other districts, for comparison
                    <InfoDot label="Why other districts appear here" className="ml-1.5">
                      Forecasts are aggregate monthly counts, not case-level records, so comparing
                      yours against the rest is not a scope breach — it is the only way to know
                      whether a rise is yours or everyone's.
                    </InfoDot>
                  </div>
                )}
              </div>
            )}
            {/* At state rank, thirty-one cards make a reader compare numbers one at a time.
                One axis makes the distribution visible and shows where any district sits. */}
            {tier === 'state' && (
              <DistrictSpread districts={fc.districts} focusId={fc.focus?.districtId}
                onPick={(id) => nav(`/cases?district=${id}`)} />
            )}
            {tier === 'district' && (
              <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {[...fc.districts]
                  .filter((d: any) => fc.scope !== 'district' || String(d.districtId) !== String(fc.focus?.districtId))
                  .sort((a: any, b: any) => (b.changePct || 0) - (a.changePct || 0))
                  // Inside the district branch, so the count is fixed: nine peers is enough
                  // to place your own district without turning the panel into a directory.
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
            )}
            {tier === 'state' && (
              <p className="px-4 pb-3 text-[11.5px] text-ink-subtle">
                All {fc.districts.length} districts, steepest rise first. The method is a linear
                trend with a multiplicative month-of-year index, refitted after a detected level
                shift; the interval is ±1.96σ of the in-sample residuals.
              </p>
            )}
          </Section>
        )}

        {/* The two halves of the projection, each drawn: what the fit got wrong on months it
            never saw, and the month-of-year shape it carries. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bt?.detail?.length > 0 && (
            <Section title={<span className="flex items-center gap-2">
              <BarChart3 size={15} className="text-kadi-blue" /> Backtest — predicted against actual
              <InfoDot label="Why this is here" align="left">
                The MAPE figure beside the projection is a summary of exactly this chart. The
                chart says something the summary cannot: which direction the misses go. Three
                misses on the same side is a bias; three that scatter are noise, and they mean
                different things when you read the forecast.
              </InfoDot>
            </span>}>
              <BacktestChart bt={bt} />
            </Section>
          )}
          {fc?.state?.seasonality?.length > 0 && (
            <Section title={<span className="flex items-center gap-2">
              <Clock size={15} className="text-kadi-saffron" /> The shape of the year
              <InfoDot label="What a seasonal index is" align="left">
                Every projection here is a trend multiplied by a month-of-year index. This is
                that index: how much each calendar month runs above or below an average one once
                the trend is removed. It is shown because an officer who has policed the state
                for a decade can check it against their own experience — which is the point of
                choosing a decomposition rather than a black box.
              </InfoDot>
            </span>}>
              <SeasonalityChart seasonality={fc.state.seasonality} />
            </Section>
          )}
        </div>

        {tier !== 'station' && anom?.cases?.length && (
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
      </>}

      {head === 'ml' && <MlHead risk={risk} spike={data.spikeRisk} tier={tier} nav={nav}
        model={model} setModel={setModel} pend={pend} />}
    </div>
  );
}

// The patrol window. Extracted because it is the FIRST panel at station rank and one of two
// columns above it — the same panel, in a different place, because its usefulness changes with
// who is reading.
function ShiftPanel({ data }: { data: any }) {
  return (
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
  );
}

// ---------------------------------------------------------------------------------------
// The model head.
// ---------------------------------------------------------------------------------------
function MlHead({ risk, spike, tier, nav, model, setModel, pend }: {
  risk: any; spike: any; tier: string; nav: any; model: string; setModel: (m: string) => void;
  pend?: any;
}) {
  const served = (s: any) => s?.rankedBy === 'model';
  // The row for whichever model the picker is on, from the server's own registry when it has
  // answered and from the page's table before that.
  const fam = MODEL_FAMILY.find((f) => f.slug === model) || MODEL_FAMILY[1];
  const sel = ((risk?.models || []).find((m: any) => m.slug === model))
    || { question: fam.label.toLowerCase(), modelAuc: fam.model, ruleAuc: fam.rule, ruleName: fam.ruleName };
  return (
    <>
      {/* What is actually serving, first and without decoration. A model page whose first
          panel is a result rather than a provenance statement is asking to be believed. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Reads the model the picker is on rather than restating one model's numbers. The
            hard-coded version drifted the moment the measurement was corrected: this card said
            0.769 while the panel directly beneath it said 0.746, which is worse than either
            number being wrong on its own. */}
        <ModelCard
          title="Repeat offending"
          question={askable(sel.question)}
          model={sel.modelAuc} rule={sel.ruleAuc} ruleName={sel.ruleName || 'recency'}
          serving={served(risk)} lastError={risk?.serving?.lastError}
        />
        <ModelCard
          title="Spike risk"
          question="Which district and crime head runs well above its own normal next month?"
          model={0.677} rule={0.620} ruleName="inverse recent level"
          serving={served(spike)} lastError={spike ? undefined : 'not computed at this rank'}
        />
        {/* The third family, and the one this row was missing: the header sentence above counts
            the serving models off the registry and said EIGHT while this row showed two. A count
            that is computed sitting next to a set of cards that is hand-maintained is the same
            drift the counter was introduced to kill, one level up.

            Its numbers come from the serving object rather than the page's own table, for the
            reason the offender card does: when the measurement was corrected the hard-coded card
            said 0.769 over a panel saying 0.746. The rule name is shortened the way the panel
            subtitle below shortens it -- "load", not "load (inflow over recent clearance)" --
            because at three columns the long form is what breaks the row. */}
        <ModelCard
          title="Station pendency"
          question="Which registers are falling further behind over the next three months?"
          model={pend?.serving?.modelAuc ?? 0.870}
          rule={pend?.serving?.ruleAuc ?? 0.701}
          ruleName={pend?.serving?.ruleName?.split(' (')[0] || 'load'}
          serving={served(pend)}
          lastError={pend ? pend.serving?.lastError : 'not loaded'}
        />
      </div>

      {/* Offender risk — every tier. A station cares about its own register's offenders, a
          district about its stations', the state about the ones crossing district lines. */}
      <Section
        action={
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {(risk?.models || MODEL_FAMILY.map((m) => ({ slug: m.slug, short: m.label }))).map((m: any) => (
              <button key={m.slug} onClick={() => setModel(m.slug)} title={m.question || m.short}
                className={`text-[11.5px] rounded-full px-2.5 py-1 border transition-colors ${
                  model === m.slug
                    ? 'bg-kadi-navy text-white border-kadi-navy'
                    : 'bg-surface border-line text-ink-muted hover:bg-kadi-blue50'}`}>
                {m.short}
              </button>
            ))}
          </div>
        }
        title={<span className="flex items-center gap-2">
        <Users2 size={15} className="text-kadi-blue" /> {(risk?.question || 'back on a new FIR within 180 days')
          .replace(/^./, (c: string) => c.toUpperCase())}
        <span className="text-[12px] font-normal text-ink-muted">
          {risk?.candidates || 0} on the watchlist · top {risk?.scored || 24} by recency,
          re-ranked by {risk?.rankedBy || 'rule'}
        </span>
        <InfoDot label="How this is ranked" align="left" width="w-96">
          <b className="block mb-1 text-kadi-navy">Behaviour and evidence only</b>
          Prior case count, days since the last one, how long they have been known, their own
          offending tempo, districts and crime heads spanned, and recorded gravity. No age, no
          gender, and no caste, religion or occupation — the feature list is asserted against the
          protected set before the training file is written.
          <b className="block mt-1.5 text-kadi-navy">What it beats, and why there are six of them</b>
          Each model is scored against the best simple rule that can see its own question —
          recency for the return horizons, districts-worked for the mobility model. The buttons
          above change the list rather than relabelling it: the top-20 shortlists of the four
          year-long models share at most one person with each other, so "who is back", "who
          surfaces somewhere new", "who escalates to Heinous" and "who returns with a crime
          against women" are four different sets of names.
          <b className="block mt-1.5 text-kadi-navy">A caveat worth carrying</b>
          Some of that margin may be the synthetic generator giving each offender a stable
          offending rate, which prior-count and span together recover almost exactly. Re-measure
          on real records before relying on the number.
        </InfoDot>
      </span>}>
        {!risk?.items?.length ? (
          <Empty title="No repeat offenders in scope" hint="This ranking covers identities carrying two or more resolved cases." />
        ) : (
          <>
            <p className="px-4 pt-3 text-[12.5px] text-ink-muted">{risk.note}</p>
            {risk.rankedBy === 'model' && (
              <ScoreSpread items={risk.items} field="modelScore"
                label="Model scores across the shortlist" />
            )}
            <div className="divide-y divide-line mt-2">
              {risk.items.map((o: any, i: number) => (
                <button key={o.offenderIdentityId} onClick={() => nav(`/offenders/${o.offenderIdentityId}`)}
                  className="w-full text-left px-4 py-2.5 hover:bg-surface-3/60 transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-num text-[11px] text-ink-subtle w-5">{i + 1}</span>
                    <span className="text-[13.5px] font-medium text-ink">{o.name}</span>
                    <span className="text-[12px] text-ink-muted">
                      {o.priorCases} cases · {o.districts} district{o.districts === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto text-[11px] font-num rounded-full px-2 py-0.5"
                      style={o.modelScore !== null
                        ? { background: '#EAF2FB', color: '#1A6FC4' }
                        : { background: '#F1F4F8', color: '#5B6B7F' }}>
                      {o.modelScore !== null ? `p ${o.modelScore}` : `${o.daysSinceLast}d since last`}
                    </span>
                  </div>
                  <div className="text-[12px] text-ink-muted mt-0.5">
                    Last case {o.lastSeen} ({o.daysSinceLast} days ago) · offending at{' '}
                    <b className="text-ink font-num">{o.ratePerYear}</b> cases a year
                    {o.heinous > 0 && <> · <b className="text-danger">{o.heinous} heinous</b></>}
                    {o.districtNames?.length > 1 && <> · {o.districtNames.slice(0, 3).join(', ')}</>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* Spike risk — the district×head model. Not shown at station rank: the grain is a
          district, and an SHO cannot act on another district's crime head. */}
      {tier !== 'station' && spike?.items?.length > 0 && (
        <Section title={<span className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-warning" /> Spike risk next month
          <span className="text-[12px] font-normal text-ink-muted">
            {spike.candidates} candidates · ranked by {spike.rankedBy} · for {spike.forMonth}
          </span>
          <InfoDot label="What this predicts" align="left" width="w-96">
            <b className="block mb-1 text-kadi-navy">A ranking, never a number</b>
            Predicting next month's count means predicting an arrival process. At the district
            grain the Poisson floor alone is 11.5% and a three-month moving average already sits
            near it — every regression tried lost to that average. Classification escapes the
            problem because it only has to put the riskiest first.
            <b className="block mt-1.5 text-kadi-navy">How much of this is real</b>
            0.677 AUC against 0.620 for the best trivial rule. Note the honest baseline: the
            target "40% above the trailing mean" is easier to hit on a small series, so a model
            given absolute volumes can win by learning which series are small. Strip the volumes
            and this model falls to 0.516. Its real contribution is +0.058.
          </InfoDot>
        </span>}>
          <p className="px-4 pt-3 text-[12.5px] text-ink-muted">{spike.note}</p>
          {spike.rankedBy === 'model' && (
            <ScoreSpread items={spike.items} field="modelScore"
              label="Model scores across the candidates" />
          )}
          <div className="divide-y divide-line mt-2">
            {spike.items.map((s: any, i: number) => (
              <button key={`${s.districtId}-${s.crimeHeadId}`}
                onClick={() => nav(`/cases?district=${s.districtId}&head=${s.crimeHeadId}`)}
                className="w-full text-left px-4 py-2.5 hover:bg-surface-3/60 transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-num text-[11px] text-ink-subtle w-5">{i + 1}</span>
                  <span className="text-[13.5px] font-medium text-ink">{s.crimeHead}</span>
                  <span className="text-[12.5px] text-ink-muted">in {s.districtName}</span>
                  <span className="ml-auto text-[11px] font-num rounded-full px-2 py-0.5"
                    style={s.modelScore !== null
                      ? { background: '#FDF3E3', color: '#B4690E' }
                      : { background: '#F1F4F8', color: '#5B6B7F' }}>
                    {s.modelScore !== null ? `p ${s.modelScore}` : `rule ${s.ruleScore}`}
                  </span>
                </div>
                <div className="text-[12px] text-ink-muted mt-0.5 font-num">
                  {s.lastMonth} last month against a 3-month average of {s.recentAvg}
                  <span className="text-ink-subtle"> · acceleration {s.acceleration}×</span>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Station pendency. The only model here that scores a REGISTER, and the only one that came
          from reading the Indian literature rather than the Western predictive-policing canon. */}
      {pend?.items?.length > 0 && (
      <Section title={<span className="flex items-center gap-2">
        <Activity size={15} className="text-kadi-blue" /> Registers falling further behind
        <span className="text-[12px] font-normal text-ink-muted">
          {pend.stations} in scope · top {pend.scored} by {pend.serving?.ruleName?.split(' (')[0]},
          re-ranked by {pend.rankedBy}
        </span>
        <InfoDot label="Why pendency" align="left" width="w-[26rem]">
          <b className="block mb-1 text-kadi-navy">Why this question and not hotspots</b>
          The Indian econometric literature is consistent that the deterrence variables which move
          crime rates here are charge-sheeting rate, conviction rate and pendency — Hazra (2020) across
          32 states, Dutta &amp; Husain (2009) on earlier panel data. That is a lever about disposal,
          and a FIR register can speak to disposal.
          <b className="block mt-1.5 text-kadi-navy">Why not "where will crime happen"</b>
          At a 1&nbsp;km cell and a week this register averages one case, so the best possible predictor
          of the count is still 78% out. A backlog averages 46 per station-month and is worth modelling.
          <b className="block mt-1.5 text-kadi-navy">What it must not become</b>
          It scores registers, not people. A station forecast to fall behind is somewhere to send help.
          Note the failure mode honestly: the strongest feature is the stale share of the register, and
          an officer could improve that by registering fewer cases.
        </InfoDot>
      </span>}>
        <p className="px-4 pt-3 text-[12.5px] text-ink-muted leading-relaxed">{pend.note}</p>
        <div className="px-4 pb-2 pt-2 text-[12px] text-ink-subtle">
          As at {pend.month} · asking whether the past-window stock will be at least
          {' '}{Math.round((pend.growthThreshold - 1) * 100)}% larger in {pend.horizonMonths} months.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-ink-subtle border-b border-line">
                <th className="text-left font-medium px-4 py-2">Station</th>
                <th className="text-right font-medium px-3 py-2">Past window</th>
                <th className="text-right font-medium px-3 py-2">Share of register</th>
                <th className="text-right font-medium px-3 py-2">Cleared / month</th>
                <th className="text-right font-medium px-3 py-2">Arriving vs clearing</th>
                <th className="text-right font-medium px-4 py-2">{pend.rankedBy === 'model' ? 'Score' : 'Rank by'}</th>
              </tr>
            </thead>
            <tbody>
              {pend.items.map((r: any) => (
                <tr key={r.unitId} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2">
                    <span className="text-ink">{r.unitName}</span>
                    <span className="text-ink-subtle text-[11.5px] ml-1.5">{r.districtName}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-num">{r.backlog}<span className="text-ink-subtle"> of {r.openCases}</span></td>
                  <td className="px-3 py-2 text-right font-num">{Math.round(r.staleShare * 100)}%</td>
                  <td className="px-3 py-2 text-right font-num">{r.cleared}</td>
                  <td className="px-3 py-2 text-right font-num">
                    <span className={r.load >= 5 ? 'text-danger' : 'text-ink-muted'}>{r.load.toFixed(1)}×</span>
                  </td>
                  <td className="px-4 py-2 text-right font-num text-ink-muted">
                    {r.modelScore != null ? `p ${r.modelScore}` : `${r.load.toFixed(1)}×`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11.5px] text-ink-subtle leading-relaxed border-t border-line">
          {pend.serving?.caveat}
        </p>
      </Section>
      )}

      {/* The model family. Added after a second sweep, because "seven tasks measured" was
          where the first pass stopped rather than where the space ended — and the obvious
          question, whether the offender panel answers more than one question, had not been
          asked. It answers six. */}
      <Section title={<span className="flex items-center gap-2">
        <Users2 size={15} className="text-kadi-teal" /> Six questions about the same people
      </span>}>
        <p className="px-4 pt-3 text-[12.5px] text-ink-muted leading-relaxed">
          One panel, one set of seven features, six different things to predict. That is what
          makes them cheap to run together: the scoring record is identical, so choosing a model
          means choosing an endpoint rather than rebuilding the question.
        </p>
        <p className="px-4 pt-2 text-[12.5px] text-ink-muted leading-relaxed">
          It is also what makes them worth having separately. Measured across the hold-out —
          every repeat offender, not a shortlist — <b>their top-20 lists share at most one
          person.</b> Rank correlation over the whole panel runs 0.33 to 0.46, which reads like
          "much the same model" and is misleading: correlation is dominated by the vast middle
          of the list nobody acts on. The top twenty is the product.
        </p>
        <p className="px-4 pt-2 text-[12.5px] text-ink-muted leading-relaxed">
          The lists <i>on this page</i> overlap more than that, and it is worth saying why rather
          than letting the two numbers look like a contradiction. Serving does not score all
          {' '}{risk?.candidates || 200} offenders in scope: the recency rule takes the top
          {' '}{risk?.scored || 24} — it is cheap and it supplies the recall — and the model
          re-ranks those. So every model here is ordering the same two dozen people, and
          typically shares three to six of ten with its neighbours. The measured figure is what
          the models do when each picks freely from everyone; this page is what they do inside a
          shared shortlist. Both are true, and the first is the one that says whether the models
          are different.
        </p>
        <div className="p-3 space-y-1.5">
          {MODEL_FAMILY.map((m) => (
            <div key={m.slug} className="rounded-ctl border border-kadi-teal/40 bg-teal-50/30 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 size={14} className="text-kadi-teal shrink-0" />
                <span className="text-[13px] font-medium text-ink">{m.label}</span>
                <span className="ml-auto font-num text-[12px]">
                  <span className="text-kadi-teal font-semibold">{m.model.toFixed(3)}</span>
                  <span className="text-ink-subtle"> vs {m.rule.toFixed(3)} {m.ruleName}</span>
                  <span className="text-ink-muted"> · AP {m.ap.toFixed(3)} vs {m.apRule.toFixed(3)}</span>
                </span>
              </div>
              <div className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">
                {m.use} <span className="text-ink-subtle font-num">({m.pos} hold-out positives)</span>
              </div>
            </div>
          ))}
        </div>
        <p className="px-4 pt-1 text-[12px] font-medium text-ink">Measured on the same panel and not shipped</p>
        <div className="px-3 pb-3 pt-2 space-y-1.5">
          {FAMILY_REJECTED.map((r) => (
            <div key={r.label} className="rounded-ctl border border-line bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <XCircle size={14} className="text-ink-subtle shrink-0" />
                <span className="text-[13px] text-ink">{r.label}</span>
                <span className="ml-auto font-num text-[12px] text-ink-subtle">
                  {r.model.toFixed(3)} vs {r.rule.toFixed(3)}
                </span>
              </div>
              <div className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">{r.why}</div>
            </div>
          ))}
        </div>
        <p className="px-4 pb-3 text-[11.5px] text-ink-subtle leading-relaxed">
          Three of those rejections score <i>higher</i> than models that ship. That is the whole
          point of the conditional test: a target of "comes back AND it is a property crime"
          inherits the predictability of "comes back", which is 0.733 on its own. Ask instead
          whether the model can say <i>what</i> they come back with — score it only on the people
          who did come back — and property, body and economic collapse while Heinous and crimes
          against women hold. Every training file carries exactly its own target and nothing
          else; a sibling target left in the frame would be handed to the model as a feature,
          and the horizons nest, so "back within 180 days" would give away "back within a year".
        </p>
      </Section>

      {/* The losers. This is the panel that makes the two winners mean something. */}
      <Section title={<span className="flex items-center gap-2">
        <Cpu size={15} className="text-ink-muted" /> {word(N_MEASURED)} tasks were measured. {word(N_SERVING)} are serving.
      </span>}>
        <p className="px-4 pt-3 text-[12.5px] text-ink-muted leading-relaxed">
          Every candidate was scored on a time-ordered hold-out against the <b>best</b> simple
          rule available on the same information — not the first baseline that came to mind.
          That choice decided most of these results: against an obvious baseline nearly all of
          them win, and against the best one nearly all of them lose. A model that cannot beat a
          one-line rule is worse than no model, because it reads as capability while adding a
          serving dependency and a failure mode.
        </p>
        <div className="p-3 space-y-1.5">
          {CANDIDATES.map((c) => (
            <div key={c.task} className={`rounded-ctl border px-3 py-2 ${
              c.ship ? 'border-kadi-teal/40 bg-teal-50/30' : 'border-line bg-surface-2'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {c.ship
                  ? <CheckCircle2 size={14} className="text-kadi-teal shrink-0" />
                  : <XCircle size={14} className="text-ink-subtle shrink-0" />}
                <span className="text-[13px] font-medium text-ink">{c.task}</span>
                <span className="ml-auto font-num text-[12px]">
                  <span className={c.ship ? 'text-kadi-teal font-semibold' : 'text-ink-muted'}>{c.model.toFixed(3)}</span>
                  <span className="text-ink-subtle"> vs {c.rule.toFixed(3)} {c.ruleName}</span>
                </span>
              </div>
              {c.why && <div className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">{c.why}</div>}
            </div>
          ))}
        </div>
        <p className="px-4 pb-3 text-[11.5px] text-ink-subtle leading-relaxed">
          AUC on time-ordered hold-outs. A random split would flatter every one of them: crime
          series are autocorrelated, so random test rows sit between training rows of the same
          series. Fairness holds across all seven — counts, dates, places and calendar positions
          only, and a unit test fails the build if a protected column reaches a feature set.
        </p>
      </Section>
    </>
  );
}

function ModelCard({ title, question, model, rule, ruleName, serving, lastError }: {
  title: string; question: string; model: number; rule: number; ruleName: string;
  serving: boolean; lastError?: string;
}) {
  const margin = Math.round((model - rule) * 1000) / 1000;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-kadi-navy">{title}</span>
        <span className={`ml-auto text-[11px] rounded-full px-2 py-0.5 border ${
          serving ? 'text-kadi-teal border-kadi-teal/40 bg-teal-50' : 'text-ink-muted border-line bg-surface-2'}`}>
          {serving ? 'model is ranking' : 'rule is ranking'}
        </span>
      </div>
      <p className="text-[12.5px] text-ink-muted mt-1">{question}</p>
      <div className="mt-2.5 flex items-end gap-3">
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-ink-subtle">Model</div>
          <div className="text-2xl font-semibold font-num text-ink">{model.toFixed(3)}</div>
        </div>
        <div className="pb-1">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-subtle">{ruleName}</div>
          <div className="text-lg font-num text-ink-muted">{rule.toFixed(3)}</div>
        </div>
        <div className="pb-1.5 ml-auto text-right">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-subtle">Margin</div>
          <div className={`text-lg font-num font-semibold ${margin > 0.1 ? 'text-kadi-teal' : 'text-ink'}`}>
            +{margin.toFixed(3)}
          </div>
        </div>
      </div>
      {!serving && lastError && (
        <div className="mt-2 text-[11.5px] text-ink-muted leading-relaxed border-t border-line pt-2">
          Falling back to the rule: {lastError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The projection, drawn.
//
// The page used to state the projection as three numbers and a range in brackets. That is the
// same information and a worse instrument: a reader cannot see whether the forecast continues
// the shape of the history or departs from it, and the interval — the part that says how much
// to trust the middle — reads as punctuation rather than as width.
//
// History and forecast share one axis so the join is visible, and the 95% band is drawn as an
// area rather than as text. Where the fit restarted after a level shift, that month is marked:
// a forecast built on six months after a break is a weaker statement than one built on
// twenty-four, and the chart should say which it is looking at.
// ---------------------------------------------------------------------------------------
function ProjectionChart({ history, forecast, label }: {
  history: { month: string; count: number }[];
  forecast: any[]; label: string;
}) {
  const data = useMemo(() => {
    const h = (history || []).map((p) => ({ month: p.month, actual: p.count }));
    const last = h[h.length - 1];
    // The forecast must start where the history ends, or the two lines float apart with a gap
    // that reads as a data problem rather than as a handover.
    const f = (forecast || []).map((p: any) => ({
      month: p.month,
      predicted: p.predicted,
      band: [p.lower, p.upper] as [number, number],
      fittedFrom: p.fittedFrom,
    }));
    const bridge = last ? [{ month: last.month, actual: last.actual, predicted: last.actual,
      band: [last.actual, last.actual] as [number, number] }] : [];
    return [...h.slice(0, -1), ...bridge, ...f];
  }, [history, forecast]);
  const shiftAt = (forecast || []).find((p: any) => p.fittedFrom)?.fittedFrom;
  if (!data.length) return null;
  return (
    <div className="px-3 pt-3">
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#E6ECF4" vertical={false} />
            <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }}
              interval={Math.max(0, Math.floor(data.length / 8))} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={46}
              label={{ value: 'FIRs per month', angle: -90, position: 'insideLeft',
                offset: 8, style: { ...AXIS, textAnchor: 'middle' } }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
              formatter={(v: any, n: any) => {
                if (n === 'band') return [`${Math.round(v[0])} – ${Math.round(v[1])}`, '95% interval'];
                return [Math.round(v), n === 'actual' ? 'Registered' : 'Projected'];
              }} />
            {/* The band first, so the lines sit on top of it rather than under it. */}
            <Area dataKey="band" stroke="none" fill="#2FA8A0" fillOpacity={0.16} isAnimationActive={false} />
            <Line dataKey="actual" stroke="#1A6FC4" strokeWidth={1.8} dot={false}
              isAnimationActive={false} connectNulls={false} />
            <Line dataKey="predicted" stroke="#2FA8A0" strokeWidth={2} strokeDasharray="5 3"
              dot={{ r: 2.5, fill: '#2FA8A0' }} isAnimationActive={false} connectNulls={false} />
            {shiftAt && (
              <ReferenceLine x={shiftAt} stroke="#E8871E" strokeDasharray="3 3"
                label={{ value: 'fit restarts', position: 'insideTopRight', style: { ...AXIS, fill: '#B4690E' } }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11.5px] text-ink-subtle pb-1">
        {label}. Solid blue is registered; dashed teal is the projection; the shaded band is the
        95% interval — ±1.96σ of the residuals the fit left behind on its own history.
        {shiftAt && <> The marker at {shiftAt} is where the fit restarts: a level shift was
          detected there, and extrapolating a line drawn across it would under-forecast for ever.</>}
      </p>
    </div>
  );
}

// Predicted against actual on months the model never saw. The MAPE figure is a summary of
// exactly this picture, and the picture says something the summary cannot: which direction the
// misses go. Three misses all on the same side is a different problem from three that scatter.
function BacktestChart({ bt }: { bt: any }) {
  if (!bt?.detail?.length) return null;
  const data = bt.detail.map((d: any) => ({
    month: d.month, actual: d.actual, predicted: d.predicted,
    err: Math.round(((d.predicted - d.actual) / d.actual) * 1000) / 10,
  }));
  const allUnder = data.every((d: any) => d.err < 0);
  return (
    <div className="px-3 pt-3">
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#E6ECF4" vertical={false} />
            <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={46} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }} />
            <Bar dataKey="actual" fill="#1A6FC4" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="predicted" fill="#2FA8A0" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11.5px] text-ink-subtle pb-1">
        Blue is what happened; teal is what the model said before it happened, on {bt.holdoutMonths} months
        withheld from the fit. Mean absolute error {bt.mae} cases, {bt.mape}%.
        {allUnder && <> Every miss is on the same side — the projection runs low here, which is
          worth knowing when reading the forecast above as a floor rather than a midpoint.</>}
      </p>
    </div>
  );
}

// The month-of-year index: half of what the projection is made of, and previously invisible.
function SeasonalityChart({ seasonality }: { seasonality: any[] }) {
  if (!seasonality?.length) return null;
  const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const data = seasonality.map((s) => ({ name: NAMES[s.month - 1], pct: s.pct }));
  const hottest = [...data].sort((a, b) => b.pct - a.pct)[0];
  const coldest = [...data].sort((a, b) => a.pct - b.pct)[0];
  return (
    <div className="px-3 pt-3">
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#E6ECF4" vertical={false} />
            <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`} />
            <ReferenceLine y={0} stroke="#9AA8B8" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
              formatter={(v: any) => [`${v > 0 ? '+' : ''}${v}% against an average month`, 'Seasonal index']} />
            <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.pct >= 0 ? '#C0392B' : '#2FA8A0'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11.5px] text-ink-subtle pb-1">
        How much each calendar month runs above or below an average one, after the trend is
        removed. {hottest.name} is the heaviest at {hottest.pct > 0 ? '+' : ''}{hottest.pct}%,
        {' '}{coldest.name} the lightest at {coldest.pct}%. The index is shrunk toward zero where
        a month has few observations, so a single unusual year cannot move it far.
      </p>
    </div>
  );
}

// Every district's projected change on one axis. Thirty-one cards make a reader compare
// numbers; one chart makes them see the distribution and where their own district sits in it.
function DistrictSpread({ districts, focusId, onPick }: {
  districts: any[]; focusId?: string; onPick: (id: string) => void;
}) {
  const data = useMemo(() => [...(districts || [])]
    .sort((a, b) => (b.changePct || 0) - (a.changePct || 0))
    .map((d) => ({ name: d.districtName, pct: d.changePct, id: String(d.districtId) })),
  [districts]);
  if (!data.length) return null;
  const rising = data.filter((d) => d.pct > 5).length;
  const falling = data.filter((d) => d.pct < -5).length;
  const max = Math.max(...data.map((d) => Math.abs(d.pct))) || 1;
  // Colour by MAGNITUDE, not by a three-way threshold.
  //
  // Nearly every district is projected to rise here, so a rising/flat/falling palette paints
  // the whole chart one colour and discriminates nothing — it reads as a rendering fault
  // rather than as a finding. Ramping opacity with the size of the move puts the steepest
  // districts forward while still showing that the direction is shared.
  const shade = (pct: number) => {
    const t = Math.min(1, Math.abs(pct) / max);
    return { fill: pct >= 0 ? '#C0392B' : '#2FA8A0', fillOpacity: 0.35 + 0.65 * t };
  };
  return (
    <div className="px-3 pt-3">
      <div style={{ height: Math.max(220, data.length * 17 + 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 16 }}>
            <CartesianGrid stroke="#E6ECF4" horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`}
              label={{ value: 'Projected change against the last 12-month average',
                position: 'insideBottom', offset: -6, style: AXIS }} />
            <YAxis type="category" dataKey="name" width={118} tick={AXIS} tickLine={false} axisLine={false} />
            <ReferenceLine x={0} stroke="#9AA8B8" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
              formatter={(v: any) => [`${v > 0 ? '+' : ''}${v}%`, 'Projected change']} />
            <Bar dataKey="pct" radius={[0, 3, 3, 0]} isAnimationActive={false}
              onClick={(d: any) => onPick(d.id)} cursor="pointer">
              {data.map((d) => {
                const sh = shade(d.pct);
                return d.id === String(focusId)
                  ? <Cell key={d.id} fill="#1A6FC4" />
                  : <Cell key={d.id} fill={sh.fill} fillOpacity={sh.fillOpacity} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="px-1 pb-1 text-[11.5px] text-ink-subtle leading-relaxed">
        {rising} of {data.length} districts are projected to rise and {falling} to fall, against
        each district's own last twelve months. That the direction is almost unanimous is itself
        the reading: the state stepped up by roughly a thousand registrations a month in January
        2026, and a step that size lifts nearly every district at once. Read the ORDER here —
        who is moving fastest — rather than the sign, which mostly reflects one state-wide event.
        Deeper colour is a larger move; click a bar to open that district's register.
      </p>
    </div>
  );
}

// What a working ranker looks like.
//
// This chart exists because of a specific failure it would have caught immediately: the
// classifier endpoint returned the same hard label for every candidate, and the surface could
// only report that as a sentence in an error field. A distribution makes it obvious — a model
// that ranks produces spread, and one that does not produces a single bar.
function ScoreSpread({ items, field, label }: { items: any[]; field: string; label: string }) {
  const scores = (items || []).map((i) => i[field]).filter((v) => v !== null && v !== undefined);
  const data = useMemo(() => {
    if (scores.length < 3) return [];
    const bins = 10;
    const lo = Math.min(...scores); const hi = Math.max(...scores);
    const w = (hi - lo) / bins || 1;
    const out = Array.from({ length: bins }, (_, i) => ({
      band: `${(lo + i * w).toFixed(2)}`, n: 0,
    }));
    scores.forEach((v: number) => {
      const k = Math.min(bins - 1, Math.floor((v - lo) / w));
      out[k].n += 1;
    });
    return out;
  }, [items, field]);
  if (!data.length) return null;
  const distinct = new Set(scores).size;
  return (
    <div className="px-3 pt-3">
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <XAxis dataKey="band" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
              formatter={(v: any) => [v, 'candidates']} />
            <Bar dataKey="n" fill="#1A6FC4" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11.5px] text-ink-subtle pb-1">
        {label}: {distinct} distinct scores across {scores.length} candidates. Spread is the
        point — a ranker that returns one value for everything has not ranked anything, which
        is precisely what the classifier this replaced was doing.
      </p>
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
