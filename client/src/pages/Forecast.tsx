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
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Minus, Sparkles, Flame, Clock, Network, AlertTriangle,
  BarChart3, Cpu, Users2, CheckCircle2, XCircle,
} from 'lucide-react';
import { useOutlook, useForecast, useAnomalies, useOffenderRisk, useMe } from '../api/hooks';
import { Skeleton, Empty, Section, TierChip } from '../components/ui';
import { InfoDot, AiProvenanceInfo } from '../components/InfoDot';

const DIR = {
  rising: { icon: TrendingUp, tint: 'text-danger', word: 'Rising' },
  falling: { icon: TrendingDown, tint: 'text-success', word: 'Falling' },
  flat: { icon: Minus, tint: 'text-ink-muted', word: 'Flat' },
};

// The measurement behind the whole ML head, stated on the page rather than in a commit
// message. Five of these lost and are shown losing: a reader who only ever sees the winners
// has no way to judge how hard the winners had to work.
const CANDIDATES = [
  { task: 'Repeat offending within 180 days', model: 0.769, rule: 0.565, ruleName: 'recency', ship: true },
  { task: 'District × head spike next month', model: 0.677, rule: 0.620, ruleName: 'inverse recent level', ship: true },
  { task: 'Station surge next month', model: 0.738, rule: 0.717, ruleName: 'inverse recent level', ship: false,
    why: 'Wins by +0.021 — but strip absolute volumes from the features and it falls to 0.583, below the rule. It was learning station size, not risk.' },
  { task: 'Location re-victimisation, 14 days', model: 0.621, rule: 0.632, ruleName: '26-week rate', ship: false,
    why: 'Loses outright. Persistence — "somewhere that had a crime recently will have another" — is most of the signal.' },
  { task: 'Cross-district escalation', model: 0.586, rule: 0.691, ruleName: 'share of districts so far', ship: false,
    why: 'Loses to a one-line ratio by a wide margin.' },
  { task: 'Charge-sheet within 90 days, at registration', model: 0.520, rule: 0.527, ruleName: 'sub-head history', ship: false,
    why: 'No signal beyond what the crime type already tells you.' },
  { task: 'Linkage at registration', model: 0.930, rule: 0.929, ruleName: 'sub-head history', ship: false,
    why: 'Scores 0.930 and adds +0.002. The linkage pipeline keys on modus operandi and MO derives from sub-head, so the target is nearly a function of one input column.' },
];

export default function Forecast() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useOutlook();
  const { data: fc } = useForecast();
  const { data: anom } = useAnomalies(8);
  const { data: risk } = useOffenderRisk();
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
            blurb: 'Two trained models that rank, each against the simple rule it has to beat — and the five that did not.' },
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
          : 'Two trained models that rank, each against the simple rule it has to beat — and the five that did not.'}
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
            {tier !== 'station' && (
              <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {[...fc.districts]
                  .filter((d: any) => fc.scope !== 'district' || String(d.districtId) !== String(fc.focus?.districtId))
                  .sort((a: any, b: any) => (b.changePct || 0) - (a.changePct || 0))
                  .slice(0, tier === 'state' ? 31 : 9)
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

      {head === 'ml' && <MlHead risk={risk} spike={data.spikeRisk} tier={tier} nav={nav} />}
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
function MlHead({ risk, spike, tier, nav }: { risk: any; spike: any; tier: string; nav: any }) {
  const served = (s: any) => s?.rankedBy === 'model';
  return (
    <>
      {/* What is actually serving, first and without decoration. A model page whose first
          panel is a result rather than a provenance statement is asking to be believed. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ModelCard
          title="Repeat offending"
          question="Will this offender be back within 180 days?"
          model={0.769} rule={0.565} ruleName="recency"
          serving={served(risk)} lastError={risk?.serving?.lastError}
        />
        <ModelCard
          title="Spike risk"
          question="Which district and crime head runs well above its own normal next month?"
          model={0.677} rule={0.620} ruleName="inverse recent level"
          serving={served(spike)} lastError={spike ? undefined : 'not computed at this rank'}
        />
      </div>

      {/* Offender risk — every tier. A station cares about its own register's offenders, a
          district about its stations', the state about the ones crossing district lines. */}
      <Section title={<span className="flex items-center gap-2">
        <Users2 size={15} className="text-kadi-blue" /> Likely to reoffend within {risk?.horizonDays || 180} days
        <span className="text-[12px] font-normal text-ink-muted">
          {risk?.candidates || 0} on the watchlist · ranked by {risk?.rankedBy || 'rule'}
        </span>
        <InfoDot label="How this is ranked" align="left" width="w-96">
          <b className="block mb-1 text-kadi-navy">Behaviour and evidence only</b>
          Prior case count, days since the last one, how long they have been known, their own
          offending tempo, districts and crime heads spanned, and recorded gravity. No age, no
          gender, and no caste, religion or occupation — the feature list is asserted against the
          protected set before the training file is written.
          <b className="block mt-1.5 text-kadi-navy">What it beats</b>
          Recency — "who was active lately" — which scores 0.565 AUC on its own and is a strong
          baseline. The model scores 0.769 on a time-ordered hold-out. That +0.204 is the widest
          margin of any model measured on this corpus.
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

      {/* The losers. This is the panel that makes the two winners mean something. */}
      <Section title={<span className="flex items-center gap-2">
        <Cpu size={15} className="text-ink-muted" /> Seven tasks were measured. Two shipped.
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
