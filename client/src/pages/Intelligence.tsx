// Intelligence — the sociological + predictive pillar of the problem statement.
// Answers "the WHY behind the WHERE" (per-capita rates + socio-economic correlation)
// and "forecast emerging risk" (3-month district projections with a measured backtest).
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart, Area, Line, ScatterChart, Scatter, BarChart, Bar, Cell,
  ResponsiveContainer, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, CartesianGrid, Legend as RLegend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Info, Target, Users2, Building2, MapPin, HelpCircle, CalendarDays, Sparkles, Clock, AlertTriangle, ArrowRight } from 'lucide-react';

import { useSocio, useForecast, useOccasions, useZones, useMe, useHotspots, useStations, useAnomalies, useTasking, useNearRepeat, useReporting, useScopeProfile, useStats, useConcentration } from '../api/hooks';
import { Section, Skeleton, Chip, Empty } from '../components/ui';
import { InfoDot } from '../components/InfoDot';
import { Hint, stagger, rise } from '../components/viz';
import { Select } from '../components/Select';
import { useNav } from '../lib/useNav';

type TabKey = 'where' | 'why' | 'when' | 'next';
// District tier asks different questions of the same analytics. "Why is crime distributed
// like this across Karnataka" is not an operational question for someone running one
// district; "which of my stations, and how do I compare" is.
const DISTRICT_TABS: { key: TabKey; label: string; icon: any; blurb: string }[] = [
  { key: 'where', label: 'My stations', icon: MapPin,
    blurb: 'Which stations in this district sit above their own baseline, and what is driving it.' },
  { key: 'why', label: 'Why here', icon: HelpCircle,
    blurb: 'Where this district sits against comparable districts, and on the indicators crime rate tracks with.' },
  { key: 'when', label: 'When', icon: CalendarDays,
    blurb: 'How offending here moves through the calendar — festivals and holidays are not ordinary days.' },
  { key: 'next', label: 'What next', icon: Sparkles,
    blurb: 'The two-week deployment plan: which station, which window, whose name against it, and when it is reviewed.' },
];

// A station officer was never given tabs of their own — they fell through to the state view and
// were shown all 31 districts. These are the four questions an SHO can actually act on, in the
// vocabulary of the ground they hold: a beat, a relief roster, a register.
const STATION_TABS: { key: TabKey; label: string; icon: any; blurb: string }[] = [
  { key: 'where', label: 'My beat', icon: MapPin,
    blurb: 'Where offending concentrates inside this station\u2019s ground, and how far the register sits above its own normal month.' },
  { key: 'why', label: 'Why here', icon: HelpCircle,
    blurb: 'What makes this register different from the rest of the district — in composition, and in how it performs.' },
  { key: 'when', label: 'When', icon: CalendarDays,
    blurb: 'Which relief carries the load, and which occasions move it — the shift plan behind the roster.' },
  { key: 'next', label: 'What next', icon: Sparkles,
    blurb: 'This week\u2019s list: deadlines that fall due, and the beat work that follows from them.' },
];

const TABS: { key: TabKey; label: string; icon: any; blurb: string }[] = [
  { key: 'where', label: 'Where', icon: MapPin,
    blurb: 'Which districts carry the burden once you divide by population — and which are currently above their own baseline.' },
  { key: 'why', label: 'Why', icon: HelpCircle,
    blurb: 'What area-level conditions the crime rate tracks with. Correlation, not causation, and the confounders are named.' },
  { key: 'when', label: 'When', icon: CalendarDays,
    blurb: 'How offending moves through the calendar — festivals, national holidays and ordinary days are not the same.' },
  { key: 'next', label: 'What next', icon: Sparkles,
    blurb: 'The quarterly control strategy — which districts become priorities, and what each is tasked with. The projections behind it live in Forecast.' },
];

// The narrative sits above the charts, not instead of them. Every number in it was computed
// by the pipeline and handed to the model; the model only chose the wording.
function AiNote({ text, kind }: { text?: string; kind: string }) {
  if (!text) return null;
  return (
    <div className="rounded-card border border-kadi-blue/25 bg-kadi-blue50/40 px-4 py-3 flex items-start gap-2.5">
      <Sparkles size={15} className="text-kadi-blue shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-blue mb-0.5">
          Reading the {kind} picture
        </div>
        <p className="text-[13px] text-ink leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// Three bands (D3): Pulsing, Watch, Normal. `red` kept as a Watch alias for stale payloads.
const ZONE_STYLE: Record<string, { dot: string; label: string; ring?: string }> = {
  red_pulsing: { dot: '#C0392B', label: 'Pulsing', ring: 'animate-pulse' },
  red: { dot: '#C9820A', label: 'Watch' },
  yellow: { dot: '#C9820A', label: 'Watch' },
  normal: { dot: '#3AA76D', label: 'Normal' },
};

// The brief asks for "visual indicators when a crime category spikes in a region compared to
// historical averages". Every area is measured against its OWN trailing baseline, so a
// consistently busy district does not sit permanently red -- which is what would happen if
// this ranked by volume, and is exactly the failure per-capita analysis exists to correct.
function WhyHere({ socio }: { socio: any }) {
  const f = socio?.focus;
  if (!f) return <div className="card"><Skeleton rows={4} /></div>;
  const pc = f.percentiles || {};
  const worse = (f.vsPeerMedian ?? 0) > 0;
  const bars: { label: string; pct: number | null; value: string }[] = [
    { label: 'Crime rate per 100k', pct: pc.ratePer100k, value: `${f.ratePer100k}` },
    { label: 'Urbanisation', pct: pc.urbanPct, value: `${f.urbanPct}%` },
    { label: 'Literacy', pct: pc.literacyPct, value: `${f.literacyPct}%` },
    { label: 'Population density', pct: pc.popDensity, value: `${Math.round(f.popDensity)}/km²` },
  ];
  return (
    <Section
      title={<span className="flex items-center gap-2"><HelpCircle size={15} className="text-kadi-blue" />
        Where {f.districtName} sits — against 31 districts, and against its peers</span>}
      action={<Hint text="Percentile is the district's rank among all 31 on that indicator. The peer group is districts in the same urbanisation band, closest by population density — comparing a metro with a hill district explains nothing, comparing it with places of similar character does." />}>
      <div className="p-4 space-y-4">
        <div className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
          <div className="text-[13px] text-ink">
            <b>{f.districtName}</b> is a <b>{f.band}</b> district recording{' '}
            <b className="font-num">{f.ratePer100k}</b> FIRs per 100,000 residents.
            {f.peerMedianRate != null && (
              <> Its peer median is <b className="font-num">{f.peerMedianRate}</b> —{' '}
                <b className={worse ? 'text-danger' : 'text-kadi-teal'}>
                  {worse ? '+' : ''}{f.vsPeerMedian} {worse ? 'above' : 'below'}
                </b> comparable districts.</>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {bars.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-[12.5px] mb-1">
                <span className="text-ink-muted">{b.label}</span>
                <span className="text-ink font-num">
                  {b.value}
                  {b.pct != null && <span className="text-ink-subtle ml-2">{b.pct}th pct</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-line overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${b.pct ?? 0}%`,
                           background: (b.pct ?? 0) >= 70 ? '#C0392B' : (b.pct ?? 0) >= 40 ? '#E0A106' : '#2FA8A0' }} />
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="label mb-1">Peer districts — same band, nearest by density</div>
          {(f.peers || []).map((p: any) => (
            <div key={p.districtId} className="flex items-center gap-3 px-1 py-1.5 border-b border-line/60 last:border-0">
              <span className="text-[13px] text-ink flex-1 truncate">{p.districtName}</span>
              <span className="font-num text-[12.5px] text-ink-muted w-24 text-right">
                {p.total.toLocaleString()} FIRs
              </span>
              <span className={`font-num text-[12.5px] w-20 text-right font-medium ${
                p.ratePer100k > f.ratePer100k ? 'text-danger' : 'text-kadi-teal'}`}>
                {p.ratePer100k}/100k
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function WhatNextBrief({ fc, districtView }: { fc: any; districtView: boolean }) {
  if (!fc) return <div className="card"><Skeleton rows={4} /></div>;
  const f = fc.focus;
  const movers = fc.movers || { rising: [], falling: [] };
  return (
    <Section
      title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-kadi-blue" />
        What this means — {districtView && f ? f.districtName : 'Karnataka'}</span>}
      action={<Hint text="A projection is only useful next to what it is projecting from, and next to how wrong the model has been. The backtest error is measured by hiding the last three months, predicting them, and scoring against what actually happened." />}>
      <div className="p-4 space-y-4">
        {districtView && f && (
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
              <div className="label mb-0.5">Next month here</div>
              <div className="font-num text-xl text-ink">{f.nextMonth}</div>
              <div className="text-[11.5px] text-ink-muted">
                against a recent average of {f.recentAvg}
              </div>
            </div>
            <div className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
              <div className="label mb-0.5">Direction</div>
              <div className={`font-num text-xl ${f.changePct > 0 ? 'text-danger' : 'text-kadi-teal'}`}>
                {f.changePct > 0 ? '+' : ''}{f.changePct}%
              </div>
              <div className="text-[11.5px] text-ink-muted">
                {f.vsStateChangePct > 0 ? '+' : ''}{f.vsStateChangePct} pts vs the state trend
              </div>
            </div>
            <div className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
              <div className="label mb-0.5">Among districts</div>
              <div className="font-num text-xl text-ink">#{f.rankByChange}</div>
              <div className="text-[11.5px] text-ink-muted">
                of {f.ofDistricts}, ranked by change
              </div>
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="label mb-1 flex items-center gap-1.5">
              <TrendingUp size={12} className="text-danger" /> Rising fastest
            </div>
            {(movers.rising || []).length === 0 && (
              <div className="text-[12.5px] text-ink-muted">No district is projected to rise.</div>
            )}
            {(movers.rising || []).slice(0, 5).map((d: any) => (
              <div key={d.districtId} className="flex items-center gap-2 py-1 border-b border-line/50 last:border-0">
                <span className="text-[12.5px] text-ink flex-1 truncate">{d.districtName}</span>
                <span className="font-num text-[12px] text-ink-muted">{d.recentAvg} → {d.nextMonth}</span>
                <span className="font-num text-[12px] text-danger w-14 text-right">+{d.changePct}%</span>
              </div>
            ))}
          </div>
          <div>
            <div className="label mb-1 flex items-center gap-1.5">
              <TrendingDown size={12} className="text-kadi-teal" /> Falling fastest
            </div>
            {(movers.falling || []).slice(0, 5).map((d: any) => (
              <div key={d.districtId} className="flex items-center gap-2 py-1 border-b border-line/50 last:border-0">
                <span className="text-[12.5px] text-ink flex-1 truncate">{d.districtName}</span>
                <span className="font-num text-[12px] text-ink-muted">{d.recentAvg} → {d.nextMonth}</span>
                <span className="font-num text-[12px] text-kadi-teal w-14 text-right">{d.changePct}%</span>
              </div>
            ))}
          </div>
        </div>

        {fc.accuracy && (
          <div className="text-[11.5px] text-ink-subtle border-t border-line pt-2">
            Read these against the model&rsquo;s measured error: <b className="font-num text-ink-muted">
            {fc.accuracy.mape}% MAPE</b> on {fc.accuracy.holdoutMonths} withheld months. A
            projected move smaller than that is inside the noise.
          </div>
        )}
      </div>
    </Section>
  );
}

function Outliers({ anomalies }: { anomalies: any }) {
  if (!anomalies) return <div className="card"><Skeleton rows={4} /></div>;
  const cases = anomalies.cases || [];
  const stations = anomalies.stations || [];
  return (
    <Section
      title={<span className="flex items-center gap-2"><AlertTriangle size={15} className="text-warn" />
        Behavioural outliers — cases that do not look like their peers</span>}
      action={<Hint text="Each case is compared with others of the same crime type on reporting delay, investigation age, and the number of accused and victims. A high score does not mean wrongdoing — it means this file behaves unlike its peers and is worth a human look. The specific reason is always shown, never just a score." />}>
      <div className="p-4 space-y-4">
        {stations.length > 0 && (
          <div className="rounded-card border border-warn/30 bg-warn/5 px-3 py-2.5">
            <div className="text-[13px] text-ink mb-1.5">
              {anomalies.scope === 'unit'
                ? <><b>This register</b> is closing false cases well above its peer group</>
                : <><b>{stations.length} station{stations.length > 1 ? 's' : ''}</b> closing
                  false cases well above their peer group</>}
            </div>
            {stations.slice(0, 4).map((a: any) => (
              <div key={a.unitId} className="text-[12.5px] text-ink-muted flex items-center gap-2">
                <span className="text-ink">{a.unitName}</span>
                <span className="text-ink-subtle">{a.districtName}</span>
                <span className="ml-auto font-num">
                  {a.falseCases}/{a.totalCases} — <b className="text-danger">{Math.round(a.falseRate * 100)}%</b>
                  <span className="text-ink-subtle"> vs {Math.round(a.peerMeanRate * 100)}% peer</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="label mb-1.5">
            {/* Three scopes, not two. The old ternary had a branch for district and an else
                for everything else, so a station read its own count as "state-wide". */}
            Most unusual case files — {anomalies.caseTotal.toLocaleString()} flagged
            {anomalies.scope === 'unit' ? ' on this register'
              : anomalies.scope === 'district' ? ' in this district' : ' state-wide'}
          </div>
          {cases.length === 0 && (
            <div className="text-[12.5px] text-ink-muted">No case here departs from its peers this period.</div>
          )}
          <div className="space-y-1.5">
            {cases.slice(0, 6).map((a: any) => (
              <div key={a.caseMasterId} className="rounded-card border border-line bg-surface-2 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-ink">{a.crimeNo}</span>
                  <span className="text-[12.5px] text-ink-muted">{a.crimeSubHead || a.crimeHead}</span>
                  <span className="text-[11.5px] text-ink-subtle">{a.unitName}, {a.districtName}</span>
                  {/* Score bar, so relative severity is readable without comparing decimals. */}
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="w-16 h-1.5 rounded-full bg-line overflow-hidden">
                      <span className="block h-full rounded-full bg-warn"
                        style={{ width: `${Math.round(a.anomalyScore * 100)}%` }} />
                    </span>
                    <span className="font-num text-[11.5px] text-ink-muted">
                      {a.anomalyScore.toFixed(2)}
                    </span>
                  </span>
                </div>
                <div className="text-[11.5px] text-ink-subtle mt-1">{a.reason}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

// Every station's own specialisation -- not part of the original FIR schema, added because
// a real KSP station is not a generic dot: Traffic, Women's, CEN and Cyber Crime stations
// each answer a different kind of complaint, and "classify stations by type" only means
// something if that classification is actually filterable and visible here.
const STATION_TYPE_FILTERS: [string, string][] = [
  ['1', 'Law and Order (Town/City)'], ['2', 'Law and Order (Rural)'],
  ['3', 'Traffic'], ['4', 'Women'], ['5', 'CEN'], ['6', 'Cyber Crime'], ['7', 'Railway'],
];

function StationRoster({ stations, sort, setSort, q, setQ }: any) {
  const [category, setCategory] = useState('');
  if (!stations) return <div className="card"><Skeleton rows={5} /></div>;
  const items = (stations.items || []).filter((r: any) => !category || String(r.categoryId) === category);
  const s = stations.summary || {};
  return (
    <Section
      title={<span className="flex items-center gap-2"><Building2 size={15} className="text-kadi-blue" />
        Police stations — all {stations.total}{stations.scope === 'district' ? ' in this district' : ' in Karnataka'}</span>}
      action={<Hint text="Every station, not only the ones in trouble. Each row shows the station's own bar: the rise that would take it to yellow or red, derived from its own twelve months. Two stations with the same average can have very different bars — a station that never moves is doing something unusual at a smaller rise than one that swings every month." />}>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e: any) => setQ(e.target.value)}
            placeholder="Filter stations…" className="input text-[13px] flex-1 min-w-[160px]" />
          <Select value={sort} onChange={(v) => setSort(v as any)} className="w-40"
            options={[
              { value: 'zone', label: 'Sort: status' },
              { value: 'cases_desc', label: 'Sort: caseload' },
              { value: 'name', label: 'Sort: name' },
            ]} />
          <Select value={category} onChange={setCategory} className="w-52"
            options={[{ value: '', label: 'All station types' }, ...STATION_TYPE_FILTERS.map(([id, label]) => ({ value: id, label }))]} />
        </div>

        {/* Three bands, and `red` folds into Watch rather than getting its own chip — otherwise
            the legend reads "Watch 0 · Watch 44", which is what it did here after the band
            collapse landed in ZoneBoard but not in this roster. */}
        <div className="flex flex-wrap gap-2">
          {([['red_pulsing', s.red_pulsing || 0],
             ['yellow', (s.yellow || 0) + (s.red || 0)],
             ['normal', s.normal || 0]] as const).map(([z, n]) => (
            <div key={z} className="flex items-center gap-1.5 rounded-ctl border border-line px-2.5 py-1">
              <span className={`w-2 h-2 rounded-full ${ZONE_STYLE[z].ring || ''}`}
                style={{ background: ZONE_STYLE[z].dot }} />
              <span className="text-[12px] text-ink-muted">{ZONE_STYLE[z].label}</span>
              <span className="font-num text-[12.5px] text-ink font-medium">{n}</span>
            </div>
          ))}
        </div>

        <div className="max-h-[420px] overflow-y-auto -mx-1">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-ink-subtle text-[11px] uppercase tracking-wide">
                <th className="text-left font-medium py-1.5 px-1">Station</th>
                <th className="text-left font-medium px-1 hidden md:table-cell">Type</th>
                <th className="text-right font-medium px-1">FIRs</th>
                <th className="text-right font-medium px-1">This month</th>
                <th className="text-right font-medium px-1 hidden sm:table-cell">Its average</th>
                <th className="text-right font-medium px-1 hidden md:table-cell">Its own bar</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r: any) => (
                <tr key={r.unitId} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5 px-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${ZONE_STYLE[r.zone]?.ring || ''}`}
                        style={{ background: ZONE_STYLE[r.zone]?.dot || '#3AA76D' }} />
                      <span className="text-ink truncate">{r.unitName}</span>
                      {stations.scope !== 'district' && (
                        <span className="text-ink-subtle text-[11px] truncate hidden lg:inline">
                          {r.districtName}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-1 text-ink-subtle text-[11.5px] hidden md:table-cell truncate max-w-[140px]">
                    {(r.category || '').replace('Law and Order ', '')}
                  </td>
                  <td className="text-right font-num px-1 text-ink-muted">{r.cases?.toLocaleString()}</td>
                  <td className="text-right font-num px-1 text-ink">{r.current ?? '—'}</td>
                  <td className="text-right font-num px-1 text-ink-muted hidden sm:table-cell">{r.baseline ?? '—'}</td>
                  <td className="text-right font-num px-1 text-ink-subtle hidden md:table-cell">
                    {r.thresholds?.redAt ? `+${r.thresholds.redAt}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11.5px] text-ink-subtle">
          &ldquo;Its own bar&rdquo; is the rise that would make this station red. It differs
          between stations with the same average, because it is built from how much each one
          actually varies.
        </div>
      </div>
    </Section>
  );
}

function SpatioTemporal({ hotspots }: { hotspots: any }) {
  if (!hotspots) return null;
  const rows = hotspots.spatiotemporal || [];
  const total = (hotspots.hotspots || []).length;
  return (
    <Section
      title={<span className="flex items-center gap-2"><Clock size={15} className="text-kadi-blue" />
        Spatiotemporal clusters — where, layered with when</span>}
      action={<Hint text="A hotspot on a map tells a commander where to go but not when to be there. Each cluster's incidents are binned into six-hour shifts and tested against chance: with four windows, a small cluster lands entirely in one of them often enough that ranking on percentage alone would surface noise first. Only clusters that beat that test (p < 0.01) are listed." />}>
      <div className="p-4">
        {rows.length === 0 ? (
          <div className="text-[12.5px] text-ink-muted">
            None of the {total} spatial clusters here offend on a schedule tighter than chance
            would produce. They are places, not places-at-a-time.
          </div>
        ) : (
          <>
            <div className="text-[12.5px] text-ink-muted mb-3">
              {rows.length} of {total} clusters offend in a specific shift far more than an even
              spread would give — these convert directly into a patrol window.
            </div>
            <div className="space-y-2">
              {rows.map((h: any) => {
                const t = h.temporal;
                return (
                  <div key={h.cellId} className="rounded-card border border-line bg-surface-2 px-3 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <b className="text-[13px] text-ink font-num">{t.peakWindow}</b>
                      <span className="text-[12.5px] text-ink-muted">
                        {h.districtName || `District ${h.districtId}`}
                      </span>
                      <span className="ml-auto font-num text-[12.5px] text-ink">
                        <b>{t.peakCount}</b> of {h.count} incidents
                        <span className="text-danger ml-1.5">{t.peakShare}%</span>
                      </span>
                    </div>
                    {/* Four bars, one per shift, so the shape is visible without a chart. */}
                    <div className="flex gap-1 mt-2">
                      {t.windows.map((w: any) => (
                        <div key={w.window} className="flex-1">
                          <div className="h-1.5 rounded-full bg-line overflow-hidden">
                            <div className="h-full rounded-full"
                              style={{ width: `${Math.min(100, w.share)}%`,
                                       background: w.window === t.peakWindow ? '#C0392B' : '#9AA8B8' }} />
                          </div>
                          <div className="text-[10px] text-ink-subtle mt-0.5 text-center">
                            {w.window.slice(0, 2)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-[11.5px] text-ink-subtle mt-1.5 flex flex-wrap gap-x-3">
                      <span>p = <b className="font-num text-ink-muted">{t.pValue}</b></span>
                      <span>weekend skew <b className="font-num text-ink-muted">×{t.weekendSkew}</b></span>
                      <span>night share <b className="font-num text-ink-muted">{t.nightShare}%</b></span>
                      {h.clusterParams && (
                        <span>clustered at <b className="font-num text-ink-muted">
                          {(h.clusterParams.epsDeg * 111).toFixed(2)} km</b> for this district</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

function ZoneBoard({ zones }: { zones: any }) {
  if (!zones) return <div className="card"><Skeleton rows={4} /></div>;
  const s = zones.summary || {};
  const districtScope = zones.scope === 'district';
  const rows = districtScope ? (zones.stations || []) : (zones.districts || []);
  const alerts = zones.alerts || [];
  const pulsing = (zones.stations || []).filter((x: any) => x.zone === 'red_pulsing');
  const unitWord = districtScope ? 'stations' : 'districts';
  // Three bands (D3). `red` folds into Watch, so it is summed with yellow rather than shown as
  // its own legend entry — otherwise "Watch" appears twice.
  const counts: [string, number][] = [
    ['red_pulsing', s.red_pulsing || 0],
    ['yellow', (s.yellow || 0) + (s.red || 0)],
    ['normal', s.normal || 0],
  ];
  return (
    <Section
      title={<span className="flex items-center gap-2"><Target size={15} className="text-danger" />
        Zone status — {s.month} vs each {districtScope ? 'station' : 'district'}&rsquo;s own {s.baselineMonths}-month baseline</span>}
      action={<Hint text="Every area is judged against its own history and its own natural variation, never against a shared cut-off. Monthly FIR counts behave like counts of independent events, so the expected month-to-month wobble is roughly the square root of the baseline. A district averaging 200 needs about +42 to go red; one averaging 9 needs about +9. Same statistical standard, very different absolute bars — which is the point." />}>
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {counts.map(([z, n]) => (
            <div key={z} className="flex items-center gap-2 rounded-ctl border border-line px-3 py-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${ZONE_STYLE[z].ring || ''}`}
                style={{ background: ZONE_STYLE[z].dot }} />
              <span className="text-[12.5px] text-ink-muted">{ZONE_STYLE[z].label}</span>
              <span className="font-num text-sm text-ink font-medium">{n}</span>
            </div>
          ))}
          <div className="flex items-center text-[12px] text-ink-subtle px-1">of {s.totalStations ?? 31} {unitWord}</div>
        </div>

        {/* The brief asks for an alert when a SPECIFIC crime category spikes in a region.
            A district can sit flat overall while one head doubles underneath it, so the
            category rows carry the actual signal -- Mandya is DOWN 11% in total and still
            has a body-crime rise well outside its own range. */}
        {alerts.length > 0 && (
          <div>
            <div className="label mb-1.5">Category alerts — a head moving against its own baseline</div>
            <div className="space-y-1.5">
              {alerts.slice(0, 6).map((a: any, i: number) => (
                <div key={`${a.districtId}-${a.crimeHead}-${i}`}
                  className="rounded-card border px-3 py-2"
                  style={{ borderColor: `${ZONE_STYLE[a.zone]?.dot || '#3AA76D'}55`,
                           background: `${ZONE_STYLE[a.zone]?.dot || '#3AA76D'}0D` }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ZONE_STYLE[a.zone]?.ring || ''}`}
                      style={{ background: ZONE_STYLE[a.zone]?.dot }} />
                    <b className="text-[13px] text-ink">{a.crimeHead}</b>
                    <span className="text-[12.5px] text-ink-muted">in {a.districtName}</span>
                    <span className="ml-auto font-num text-[12.5px] text-ink">
                      {a.current} vs {a.baseline}
                      <span className={a.changePct > 0 ? 'text-danger ml-1.5' : 'text-kadi-teal ml-1.5'}>
                        {a.changePct > 0 ? '+' : ''}{a.changePct}%
                      </span>
                    </span>
                  </div>
                  {/* Publishing the area's own bar is most of the feature: it answers
                      "why is my district never red?" with a number instead of a shrug. */}
                  <div className="text-[11.5px] text-ink-subtle mt-1 flex flex-wrap gap-x-3">
                    <span><b className="text-ink-muted font-num">{a.z}σ</b> above its own average</span>
                    <span>this category&rsquo;s red line here is <b className="font-num text-ink-muted">+{a.thresholds?.redAt}</b> cases</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pulsing.length > 0 && (
          <div className="rounded-card border border-danger/30 bg-danger/5 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />
              <b className="text-[13px] text-ink">Pulsing — above baseline and still rising</b>
            </div>
            {pulsing.slice(0, 4).map((x: any) => (
              <div key={x.unitId} className="text-[12.5px] text-ink-muted">
                Station {x.unitId}: <b className="text-ink">{x.current}</b> this month against a
                baseline of {x.baseline} — <b className="text-danger">{x.changePct > 0 ? '+' : ''}{x.changePct}%</b>
                {x.z ? <span className="text-ink-subtle"> ({x.z}σ, red line +{x.thresholds?.redAt})</span> : null}
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="label mb-1">
            {districtScope
              ? 'Stations above their own baseline, furthest first'
              : 'Districts, furthest from their own baseline first'}
          </div>
          {rows.length === 0 && (
            <div className="text-[12.5px] text-ink-muted px-1 py-2">
              Every station here is inside its normal range this month. That is a real result,
              not an empty panel — each is measured against its own history.
            </div>
          )}
          {rows.slice(0, 8).map((d: any) => (
            <div key={d.districtId ? `${d.districtId}-${d.unitId || ''}` : d.unitId}
              className="flex items-center gap-3 px-1 py-1.5 border-b border-line/60 last:border-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${ZONE_STYLE[d.zone]?.ring || ''}`}
                style={{ background: ZONE_STYLE[d.zone]?.dot || '#3AA76D' }} />
              <span className="text-[13px] text-ink flex-1 truncate">
                {/* District rows carry a districtName; station rows carry a unitName. The id
                    is the last resort, not the second one. */}
                {d.unitId ? (d.unitName || `Station ${d.unitId}`) : (d.districtName || '—')}
              </span>
              <span className="text-[11.5px] text-ink-muted w-40 truncate hidden sm:block">{d.driverHead || ''}</span>
              <span className="font-num text-[12.5px] text-ink-muted w-24 text-right">{d.current} vs {d.baseline}</span>
              <span className="font-num text-[11.5px] text-ink-subtle w-20 text-right hidden md:block">
                {d.z != null ? `${d.z}σ` : ''}{d.thresholds?.redAt ? ` /+${d.thresholds.redAt}` : ''}
              </span>
              <span className={`font-num text-[12.5px] w-16 text-right font-medium ${
                d.changePct > 10 ? 'text-danger' : d.changePct < -5 ? 'text-kadi-teal' : 'text-ink-muted'}`}>
                {d.changePct > 0 ? '+' : ''}{d.changePct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}


function OccasionPanels({ occ }: { occ: any }) {
  const [view, setView] = useState<'events' | 'rhythm' | 'compare'>('events');
  // Which day class is open in the rhythm view. Null means none — the cards alone.
  const [dayClass, setDayClass] = useState<string | null>(null);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  if (!occ) return <div className="card"><Skeleton rows={6} /></div>;

  // events.build shape: occasions carry category, intensity and an evidenced flag; dayClasses
  // are the pipeline's measured day-type rates.
  const occasions: any[] = occ.occasions || [];
  const dayClasses: any[] = occ.dayClasses || [];
  const cats: Record<string, any> = occ.categories || {};
  const normalClass = dayClasses.find((c: any) => /normal/i.test(c.dayClass)) || dayClasses[0];
  const selectedClass = dayClass ? dayClasses.find((c: any) => c.dayClass === dayClass) : null;
  const tone = (v: number) => (v > 8 ? 'text-danger' : v < -5 ? 'text-kadi-teal' : 'text-ink-muted');
  const INT: Record<string, { label: string; c: string }> = {
    surge: { label: 'Surge', c: '#C0392B' }, raised: { label: 'Raised', c: '#C9820A' }, quiet: { label: 'Quiet', c: '#2FA8A0' },
  };
  const pick = (k: string) => occasions.find((o) => o.key === k);
  const oa = pick(a); const ob = pick(b);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Three views, because "when" is three different questions: the ordinary weekly rhythm,
          the calendar of occasions, and a direct comparison of any two day-types (P4-5). */}
      <div className="flex flex-wrap gap-2">
        {([['events', 'Calendar of occasions'], ['rhythm', 'Ordinary rhythm'], ['compare', 'Compare two days']] as const).map(([k, lab]) => (
          <button key={k} onClick={() => setView(k)}
            className={`chip ${view === k ? 'bg-kadi-navy text-white' : 'bg-surface-3 text-ink-muted'}`}>{lab}</button>
        ))}
        <span className="ml-auto"><InfoDot>
          <b className="block mb-1 text-kadi-navy">How to read this</b>
          Festival effects are measured from real registration dates. The wider occasions —
          political visits, matches, exam days, bandhs, election phases — are indicative for a
          prototype: the direction each pushes crime, not exact historical counts. Rows measured
          from data are marked <b>measured</b>; the rest are marked <b>indicative</b>.
        </InfoDot></span>
      </div>

      {view === 'events' && (
        <motion.div variants={rise}>
          <Section title="Occasions, by how far they move crime from an ordinary day"
            action={<Hint text="Sorted by intensity: surge days first. Each row names the crime type it most affects and carries a note on what to watch — including where a fall in the total hides a rise in the type that matters, as on a bandh." />}>
            <div className="p-2">
              {occasions.map((o) => (
                <div key={o.key} className="px-2 py-2.5 border-b border-line/60 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: (INT[o.intensity] || INT.raised).c }} />
                    <span className="text-[13.5px] font-medium text-ink">{o.label}</span>
                    <span className="chip bg-surface-3 text-ink-muted text-[10.5px]">{o.categoryLabel}</span>
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ color: o.evidenced ? '#1E874B' : '#5B6B7E', background: o.evidenced ? '#E4F4EC' : '#EDF1F6' }}>
                      {o.evidenced ? 'measured' : 'indicative'}
                    </span>
                    <span className={`ml-auto font-num text-sm font-medium ${tone(o.vsNormalPct)}`}>
                      {o.vsNormalPct > 0 ? '+' : ''}{o.vsNormalPct}% vs ordinary day
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11.5px] text-ink-muted pl-4">
                    <span className="font-medium text-ink">{(INT[o.intensity] || INT.raised).label}</span>
                    <span>· drives {o.topHead}</span>
                    <span>· {o.cadence}</span>
                  </div>
                  <p className="text-[12px] text-ink-muted mt-1 pl-4">{o.note}</p>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>
      )}

      {view === 'rhythm' && (
        <motion.div variants={rise}>
          <Section title="Crime by kind of day"
            action={<InfoDot width="w-80">
              <b className="block mb-1 text-kadi-navy">Rates, not totals</b>
              Cases per day, so classes with very different day counts stay comparable — 67 festival
              days and 861 ordinary ones cannot be compared on raw volume. The baseline is an
              ordinary weekday.
              <b className="block mt-1.5 text-kadi-navy">Why the mix matters more than the rate</b>
              A day class can move the total barely at all and still change WHAT happens: a holiday
              with the same daily rate but a different composition needs a different deployment, not
              a bigger one. Select a card to see how its mix differs from an ordinary day.
            </InfoDot>}>
            <div className="p-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {dayClasses.map((c: any) => {
                  const sel = dayClass === c.dayClass;
                  return (
                    <button key={c.dayClass} onClick={() => setDayClass(sel ? null : c.dayClass)}
                      className={`rounded-card border p-3 text-left transition-all ${
                        sel ? 'border-kadi-blue bg-kadi-blue50/50 ring-1 ring-kadi-blue/30' : 'border-line hover:bg-surface-3/60'}`}>
                      <div className="text-sm font-semibold text-ink">{c.dayClass}</div>
                      <div className="text-2xl font-num text-kadi-navy mt-1">{c.casesPerDay}</div>
                      <div className="text-[11px] text-ink-muted">cases per day · {c.days} days</div>
                      <div className={`text-[12px] font-medium mt-1 ${tone(c.vsNormalPct)}`}>
                        {c.vsNormalPct > 0 ? '+' : ''}{c.vsNormalPct}% vs ordinary day
                      </div>
                      {c.peakHour != null && (
                        <div className="text-[11px] text-ink-muted mt-1">peaks {String(c.peakHour).padStart(2, '0')}:00</div>
                      )}
                      <div className="text-[11px] text-kadi-blue mt-1.5">{sel ? 'Selected — click to close' : 'See what changes →'}</div>
                    </button>
                  );
                })}
              </div>

              {/* THE PART THAT MAKES IT WORTH CLICKING. The four cards said how MUCH; this says
                  what KIND — the composition of the selected day class against an ordinary one.
                  A class that barely moves the rate can still shift the mix, and that is a
                  different deployment rather than a larger one. */}
              {selectedClass && (() => {
                const base = new Map<string, number>((normalClass?.mix || []).map((m: any) => [m.head, m.pct]));
                const rows = [...(selectedClass.mix || [])].sort((a: any, b: any) => b.pct - a.pct);
                const max = Math.max(...rows.map((m: any) => Math.max(m.pct, base.get(m.head) || 0)), 1);
                const moved = rows.map((m: any) => ({ ...m, delta: Math.round((m.pct - (base.get(m.head) || 0)) * 10) / 10 }))
                  .sort((a: any, b: any) => Math.abs(b.delta) - Math.abs(a.delta));
                const biggest = moved[0];
                return (
                  <div className="mt-4 rounded-card border border-line bg-surface-2 p-4">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                      <div className="text-[13px] text-ink">
                        <b>{selectedClass.dayClass}</b> — what changes against an ordinary day
                      </div>
                      {biggest && Math.abs(biggest.delta) >= 0.5 && (
                        <div className="text-[12.5px] text-ink-muted">
                          Biggest shift: <b className="text-ink">{biggest.head}</b>{' '}
                          <b className={biggest.delta > 0 ? 'text-danger' : 'text-kadi-teal'}>
                            {biggest.delta > 0 ? '+' : ''}{biggest.delta} pts
                          </b> of the mix
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10.5px] text-ink-muted mb-2">
                      <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-kadi-blue" />{selectedClass.dayClass}</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-line" />Ordinary day</span>
                    </div>
                    <div className="space-y-2">
                      {rows.map((m: any) => {
                        const b = base.get(m.head) || 0;
                        const delta = Math.round((m.pct - b) * 10) / 10;
                        return (
                          <div key={m.head}>
                            <div className="flex items-center justify-between text-[12.5px] mb-0.5">
                              <span className="text-ink truncate">{m.head}</span>
                              <span className="font-num text-ink-muted shrink-0">
                                {m.pct}% <span className="text-ink-subtle">vs {b}%</span>
                                {Math.abs(delta) >= 0.1 && (
                                  <b className={`ml-2 ${delta > 0 ? 'text-danger' : 'text-kadi-teal'}`}>
                                    {delta > 0 ? '+' : ''}{delta}
                                  </b>
                                )}
                              </span>
                            </div>
                            <div className="relative h-3">
                              <div className="absolute inset-x-0 top-0 h-1.5 rounded-full bg-surface-3">
                                <div className="h-full rounded-full bg-kadi-blue" style={{ width: `${(m.pct / max) * 100}%` }} />
                              </div>
                              <div className="absolute top-2 h-1 rounded-full bg-line" style={{ width: `${(b / max) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </Section>
        </motion.div>
      )}

      {view === 'compare' && (
        <motion.div variants={rise}>
          <Section title="Compare two occasions"
            action={<Hint text="Put any two day-types side by side — for example a festival against an ordinary Tuesday — to see how far each moves crime and which type it drives." />}>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Select value={a} onChange={setA} placeholder="First occasion…"
                  options={occasions.map((o) => ({ value: o.key, label: o.label }))} />
                <Select value={b} onChange={setB} placeholder="Second occasion…"
                  options={occasions.map((o) => ({ value: o.key, label: o.label }))} />
              </div>
              {oa && ob ? (
                <div className="grid grid-cols-2 gap-3">
                  {[oa, ob].map((o, i) => (
                    <div key={i} className="rounded-card border border-line p-4">
                      <div className="text-[13.5px] font-semibold text-ink">{o.label}</div>
                      <div className="text-[11px] text-ink-muted">{o.categoryLabel} · {o.evidenced ? 'measured' : 'indicative'}</div>
                      <div className={`text-3xl font-num font-semibold mt-2 ${tone(o.vsNormalPct)}`}>{o.vsNormalPct > 0 ? '+' : ''}{o.vsNormalPct}%</div>
                      <div className="text-[11px] text-ink-muted">vs an ordinary day</div>
                      <div className="mt-2 text-[12px] text-ink">Drives <b>{o.topHead}</b></div>
                      <p className="text-[11.5px] text-ink-muted mt-1">{o.note}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-ink-muted text-center py-6">Pick two occasions to compare.</div>
              )}
            </div>
          </Section>
        </motion.div>
      )}

      <div className="text-[11.5px] text-ink-muted px-1">{occ.method}</div>
    </motion.div>
  );
}

const BAND_COLOR: Record<string, string> = {
  Urban: '#1A6FC4', Mixed: '#2FA8A0', Rural: '#E8871E',
};
const AXIS = { fontSize: 10, fill: '#5B6B7E' };
// Each indicator is measured in something different, and an axis labelled just "Literacy" or
// "Population density" leaves the reader to guess whether it is a percentage, a count or a
// ratio. The unit belongs on the axis.
const INDICATOR_AXIS: Record<string, { label: string; unit: string; fmt: (v: number) => string }> = {
  urbanPct: { label: 'Share of population living in urban areas', unit: '%', fmt: (v) => `${v}%` },
  literacyPct: { label: 'Literacy rate', unit: '%', fmt: (v) => `${v}%` },
  popDensity: { label: 'Population density', unit: '/km²', fmt: (v) => `${Math.round(v).toLocaleString()}/km²` },
};

export default function Intelligence() {
  const [tab, setTab] = useState<TabKey>('where');
  const { data: zones } = useZones();
  const { data: hotspots } = useHotspots();
  const { data: anomalies } = useAnomalies();
  const { data: nearRepeat } = useNearRepeat();
  const { data: reporting } = useReporting();
  const [stationSort, setStationSort] = useState<'zone'|'cases_desc'|'name'>('zone');
  const [stationQ, setStationQ] = useState('');
  const { data: stations } = useStations({ sort: stationSort, q: stationQ || undefined });
  const { data: occ } = useOccasions();
  const { data: me } = useMe();
  const { data: profile } = useScopeProfile();
  // scope-aware heat (hour x weekday), which the shift plan folds into reliefs.
  const { data: stats } = useStats();
  const { data: concentration } = useConcentration();
  // THREE tiers, not two. `districtView` was the only branch, so a station officer fell through
  // to the state page and was handed all 31 districts — the exact opposite of what one desk
  // needs. Kept as a derived flag so the existing district branches still read the same.
  const tier: 'state' | 'district' | 'station' =
    me?.capabilities?.effectiveScope === 'unit' ? 'station'
      : me?.capabilities?.effectiveScope === 'district' ? 'district' : 'state';
  const stationView = tier === 'station';
  const districtView = tier === 'district';
  const myUnitId = me?.capabilities?.unitId || null;
  const scopeName = stationView ? (me?.capabilities?.unitName || 'this station')
    : districtView ? (me?.capabilities?.districtName || 'this district') : 'Karnataka';
  const tabs = stationView ? STATION_TABS : districtView ? DISTRICT_TABS : TABS;
  const { data: socio, isLoading: sLoad } = useSocio();
  const { data: fc, isLoading: fLoad } = useForecast();
  const [indicator, setIndicator] = useState(0);

  // NOTE: every hook must run before the loading early-return, or the hook order changes
  // between renders and React throws.
  const districts = socio?.districts || [];
  // ALL 31, not the top ten. The panel's whole claim is that raw counts mislead — showing only
  // the districts that move furthest proves it for the extremes and hides the districts a
  // commander most needs to check, which are the ones they assumed were fine. Sorted by the size
  // of the move so the strongest evidence still leads, and the chart grows to fit rather than
  // squeezing 31 labels into the height that held 10.
  const shifts = useMemo(
    () => [...districts].sort((a: any, b: any) => Math.abs(b.rankShift) - Math.abs(a.rankShift)),
    [districts],
  );
  // Districts whose rank does not move: worth stating, because "nothing changed here" is a
  // finding too and an empty-looking bar is easy to read as missing data.
  const steady = useMemo(() => shifts.filter((d: any) => d.rankShift === 0).length, [shifts]);

  // History and forecast share one series so the confidence band joins the actual line.
  const stateSeries = useMemo(() => {
    // A district officer needs their OWN curve here. The chart was hard-wired to fc.state,
    // so the "what next" tab projected Karnataka at someone running one district.
    const src = fc?.scope === 'district' && fc?.focus ? fc.focus : fc?.state;
    const hist = (src?.history || []).map((h: any) => ({
      month: h.month, actual: h.count, band: null as any,
    }));
    const last = hist[hist.length - 1];
    const proj = (src?.forecast || []).map((p: any) => ({
      month: p.month, predicted: p.predicted, band: [p.lower, p.upper],
    }));
    // stitch: repeat the last actual as the forecast's first anchor so the line connects
    if (last) proj.unshift({ month: last.month, predicted: last.actual, band: [last.actual, last.actual] });
    return [...hist, ...proj.slice(1)].map((r: any) => {
      const anchor = last && r.month === last.month;
      return anchor ? { ...r, predicted: last.actual, band: [last.actual, last.actual] } : r;
    });
  }, [fc]);

  // EVERY HOOK MUST SIT ABOVE THE LOADING RETURN. Placed below it, this memo did not run
  // on the loading render and did on the next, so the hook count changed between renders
  // and React threw #310 — a blank page.
  // Least-squares fit over the plotted points, so the correlation the panel reports is also the
  // line the reader sees rather than a number they must take on trust.
  const trendSocio = useMemo(() => {
    const pts = ((socio?.correlations?.[indicator])?.points || []).map((p: any) => ({ x: p.x, y: p.y }));
    const n = pts.length;
    if (n < 2) return null;
    const sx = pts.reduce((a: number, p: any) => a + p.x, 0);
    const sy = pts.reduce((a: number, p: any) => a + p.y, 0);
    const sxx = pts.reduce((a: number, p: any) => a + p.x * p.x, 0);
    const sxy = pts.reduce((a: number, p: any) => a + p.x * p.y, 0);
    const d = n * sxx - sx * sx;
    if (!d) return null;
    const m = (n * sxy - sx * sy) / d;
    const b = (sy - m * sx) / n;
    const xs = pts.map((p: any) => p.x);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    return [{ x: x0, y: m * x0 + b }, { x: x1, y: m * x1 + b }];
  }, [socio, indicator]);

  if (sLoad || fLoad) return <PageSkeleton />;

  const corr = socio?.correlations?.[indicator];

  const rising = (fc?.districts || []).filter((d: any) => d.direction === 'rising');

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Hero */}
      <motion.div variants={rise} className="card p-5 bg-gradient-to-br from-kadi-navy to-kadi-navy700 text-white">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">
              {stationView ? `Intelligence — ${scopeName}`
                : districtView ? `Intelligence — ${zones?.districts?.[0]?.districtName || 'this district'}`
                  : 'Sociological & Predictive Intelligence'}
            </h1>
            <p className="text-white/75 text-sm mt-1 max-w-2xl">
              {stationView
                ? 'One register, read against its own history: where offending concentrates on this ground, what makes the mix here different from the district, which relief carries the load, and what falls due this week.'
                : districtView
                  ? 'Station-level status against each station\'s own baseline, how offending here moves through the calendar, and where the next three months are heading.'
                  : 'Raw FIR counts mostly measure population — the biggest district always “looks worst”. Normalising to incidents per 100,000 residents and correlating against socio-economic indicators is what turns a count map into an explanation.'}
            </p>
          </div>
          {/* The hero stats follow the rank too: "31 districts analysed" is not a fact about
              one station, and a state forecast horizon is not that station's projection. */}
          <div className="flex gap-3">
            {stationView ? (<>
              <HeroStat label="FIRs on this register" value={(stats?.totalCases ?? 0).toLocaleString()} />
              <HeroStat label="Against baseline"
                value={profile?.available ? `${profile.totals.shareOfParent}%` : '—'} />
              <HeroStat label="Charge-sheet rate"
                value={profile?.available ? `${profile.metrics?.[0]?.mine ?? '—'}%` : '—'} good />
            </>) : (<>
              <HeroStat label={districtView ? 'Stations here' : 'Districts analysed'}
                value={districtView ? (zones?.summary?.totalStations ?? '—') : districts.length} />
              <HeroStat label="Forecast horizon" value={`${fc?.horizonMonths || 3} mo`} />
              <HeroStat label="Backtest MAPE" value={fc?.accuracy ? `${fc.accuracy.mape}%` : '—'} good />
            </>)}
          </div>
        </div>
      </motion.div>

      {/* Four themes rather than one long scroll. The brief asks for storytelling, and a
          single stacked page makes every panel feel equally important -- which means none of
          them lead. Each tab answers one question. */}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              tab === t.key ? 'border-kadi-blue text-kadi-blue' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-ink-muted -mt-2">{tabs.find((t) => t.key === tab)?.blurb}</p>

      {tab === 'where' && <AiNote kind="where" text={zones?.insight} />}
      {tab === 'when' && <AiNote kind="when" text={occ?.insight} />}

      {tab === 'where' && <>
      {/* Below state level, lead with the reader's OWN bar. The pipeline publishes the exact
          rise this area needs to reach Watch and Pulsing and nothing rendered it — so an
          officer could see they were not lit up without ever learning what would light them. */}
      {tier !== 'state' && (
        <motion.div variants={rise}>
          <ThresholdReading zones={zones} tier={tier} unitId={myUnitId} />
        </motion.div>
      )}
      <motion.div variants={rise}>
        <ZoneBoard zones={zones} />
      </motion.div>
      {/* Strategic reading: at which grain is the load actually uneven. A state commander
          allocating on district volume alone is allocating on population. */}
      {tier === 'state' && (
        <motion.div variants={rise}>
          <Concentration data={concentration} />
        </motion.div>
      )}
      {/* "Spatiotemporal Clusters: identification of hotspots by layering time of day with
          location, enabling proactive resource deployment" -- this is that panel. */}
      <motion.div variants={rise}>
        <SpatioTemporal hotspots={hotspots} />
      </motion.div>
      {/* Near-repeat (P4-2): the crime-science pattern that turns a hotspot into an
          instruction — having just had one, these streets are elevated for a fortnight. */}
      <motion.div variants={rise}>
        <NearRepeat data={nearRepeat} />
      </motion.div>
      <motion.div variants={rise}>
        <Outliers anomalies={anomalies} />
      </motion.div>
      {/* A roster of stations is a supervisor's instrument. An SHO holds exactly one. */}
      {!stationView && (
        <motion.div variants={rise}>
          <StationRoster stations={stations} sort={stationSort} setSort={setStationSort}
            q={stationQ} setQ={setStationQ} />
        </motion.div>
      )}
      {/* Per-capita ranking across districts is a state question, and only a state question.
          Guarding it on !districtView let it through at station rank too, where a board of
          31 districts answers nothing an SHO asked of their own register. */}
      {tier === 'state' && (
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Users2 size={15} className="text-kadi-blue" />Counts mislead — the same districts ranked per 100,000 residents</span>}
          action={<Hint text="Bars show how far a district moves when you divide by population. Green = it is worse per-capita than raw counts suggest; red = it only looked bad because it is populous." />}
        >
          <div className="p-4">
            <div style={{ height: Math.max(300, shifts.length * 22 + 40) }}>
              <ResponsiveContainer width="100%" height="100%" key={shifts.length}>
                <BarChart data={shifts} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false}
                    label={{ value: 'Rank places moved', position: 'insideBottom', offset: -2, style: AXIS }} />
                  <YAxis type="category" dataKey="districtName" width={118} tick={AXIS} tickLine={false} axisLine={false} />
                  <ReferenceLine x={0} stroke="#9AA8B8" />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
                    formatter={(v: any, _n: any, p: any) => [
                      `#${p.payload.rankByCount} by count → #${p.payload.rankByRate} by rate`, 'Rank',
                    ]}
                  />
                  <Bar dataKey="rankShift" isAnimationActive={false} radius={[0, 3, 3, 0]}>
                    {shifts.map((d: any) => (
                      <Cell key={d.districtId} fill={d.rankShift > 0 ? '#2FA8A0' : '#C0392B'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[12px] text-ink-muted">
              All {shifts.length} districts, ordered by how far they move.
              {steady > 0 && <> {steady} hold the same rank either way — for those, volume and rate agree.</>}
              {' '}The three biggest movers are called out below.
            </p>
            <div className="mt-3 grid sm:grid-cols-3 gap-2 text-[13px]">
              {shifts.slice(0, 3).map((d: any) => (
                <div key={d.districtId} className="rounded-ctl bg-surface-2 border border-line px-3 py-2">
                  <div className="font-medium text-ink">{d.districtName}</div>
                  <div className="text-ink-muted">
                    {d.total.toLocaleString()} FIRs · <span className="font-num">{d.ratePer100k}</span>/100k
                  </div>
                  <div className={d.rankShift > 0 ? 'text-kadi-teal' : 'text-danger'}>
                    #{d.rankByCount} → #{d.rankByRate} by rate
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </motion.div>
      )}
      </>}

      {/* The tier above is the only honest yardstick for a district or a station: a share with
          nothing beside it explains nothing. State has no tier above it, so it keeps the
          socio-economic correlation instead. */}
      {tab === 'why' && tier !== 'state' && (
        <motion.div variants={rise}><ScopeProfile data={profile} /></motion.div>
      )}
      {tab === 'why' && districtView && (
        <motion.div variants={rise}><WhyHere socio={socio} /></motion.div>
      )}

      {tab === 'why' && tier === 'state' && <>
      {/* Reporting propensity (P4-3): the confounder a rate comparison must clear before it can
          read urbanisation as cause. Here it clears — delay is uniform — which is itself a
          finding, and the kind of counter-evidence the tab should carry. */}
      <motion.div variants={rise}>
        <ReportingPropensity data={reporting} socio={socio} />
      </motion.div>
      {/* ---- Correlation ---- */}
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Building2 size={15} className="text-kadi-blue" />Socio-economic correlation</span>}
          action={
            <div className="flex gap-1">
              {(socio?.correlations || []).map((c: any, i: number) => (
                <button key={c.field} onClick={() => setIndicator(i)}
                  className={`text-xs px-2 py-1 rounded-ctl border transition-colors ${
                    i === indicator ? 'bg-kadi-blue50 border-kadi-blue text-kadi-blue font-medium'
                      : 'border-line text-ink-muted hover:bg-surface-3'}`}>
                  {c.indicator}
                </button>
              ))}
            </div>
          }
        >
          {corr && (
            <div className="p-4 grid lg:grid-cols-[1fr_260px] gap-4">
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%" key={corr.field}>
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 44, left: 12 }}>
                    {/* Gridlines, drawn axis lines, units on both labels and a fitted trend line.
                        Without them the reader is asked to judge a slope by eye against no
                        reference, which is exactly what a correlation panel must not do. */}
                    <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" />
                    <XAxis type="number" dataKey="x" name={corr.indicator} tick={AXIS} tickLine={false}
                      axisLine={{ stroke: '#D9E1EC' }} domain={['dataMin', 'dataMax']}
                      tickFormatter={(v: any) => (INDICATOR_AXIS[corr.field] ? INDICATOR_AXIS[corr.field].fmt(v) : v)}
                      label={{ value: INDICATOR_AXIS[corr.field]?.label || corr.indicator,
                        position: 'insideBottom', offset: -28, style: { ...AXIS, fontSize: 11 } }} />
                    <YAxis type="number" dataKey="y" name="Rate" tick={AXIS} tickLine={false}
                      axisLine={{ stroke: '#D9E1EC' }} width={56}
                      label={{ value: 'FIRs per 100,000 residents', angle: -90,
                        position: 'insideLeft', offset: 4, style: { ...AXIS, fontSize: 11 } }} />
                    <ZAxis range={[60, 60]} />
                    {trendSocio && <ReferenceLine ifOverflow="extendDomain" stroke="#C0392B"
                      strokeDasharray="5 4" segment={trendSocio as any} />}
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D9E1EC' }}
                      formatter={(v: any, n: any) => [typeof v === 'number' ? v.toFixed(1) : v, n === 'y' ? 'per 100k' : corr.indicator]}
                      labelFormatter={() => ''}
                      content={({ payload }: any) => {
                        const p = payload?.[0]?.payload;
                        if (!p) return null;
                        return (
                          <div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                            <div className="font-medium">{p.district}</div>
                            <div className="text-ink-muted">{corr.indicator}: {INDICATOR_AXIS[corr.field] ? INDICATOR_AXIS[corr.field].fmt(p.x) : p.x}</div>
                            <div className="text-ink-muted">Rate: {p.y}/100k</div>
                          </div>
                        );
                      }}
                    />
                    {['Urban', 'Mixed', 'Rural'].map((b) => (
                      <Scatter key={b} name={b} data={(corr.points || []).filter((p: any) => p.band === b)}
                        fill={BAND_COLOR[b]} isAnimationActive={false} />
                    ))}
                    {/* Top-aligned: the default bottom legend overlapped the x-axis
                        label, which sits at insideBottom offset -12. */}
                    <RLegend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 11 }} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3">
                <div className="rounded-ctl border border-line bg-surface-2 p-3">
                  <div className="label mb-1">Correlation</div>
                  <div className="text-2xl font-semibold font-num text-ink">
                    {corr.pearson > 0 ? '+' : ''}{corr.pearson}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    Pearson r · Spearman ρ {corr.spearman > 0 ? '+' : ''}{corr.spearman}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Chip className={corr.strength === 'not significant'
                      ? 'bg-surface-3 text-ink-muted' : 'bg-kadi-blue50 text-kadi-blue'}>
                      {corr.strength}
                    </Chip>
                    <Chip className="bg-surface-3 text-ink-muted">p {corr.pValue < 0.0001 ? '< 0.0001' : `= ${corr.pValue}`}</Chip>
                    <Chip className="bg-surface-3 text-ink-muted">n = {corr.n}</Chip>
                  </div>
                </div>
                <p className="text-[13px] text-ink-muted leading-relaxed">{corr.why}</p>
                <div className="flex items-start gap-2 text-[12px] text-ink-muted bg-surface-2 border border-line rounded-ctl p-2.5">
                  <Info size={13} className="shrink-0 mt-0.5 text-kadi-blue" />
                  <span>Correlation is not causation — higher urban crime rates also reflect
                    higher <em>reporting</em> rates, better station access and denser opportunity.</span>
                </div>
              </div>
            </div>
          )}
        </Section>
      </motion.div>

      {/* ---- Composition by urbanisation band ---- */}
      <motion.div variants={rise}>
        <Section title="Crime mix by urbanisation band"
          action={<Hint text="Districts grouped by their urban population share. Compares not just how much crime, but what kind — the composition differs even where the rate is similar." />}>
          <div className="p-4 grid sm:grid-cols-3 gap-3">
            {(socio?.composition || []).map((c: any) => (
              <div key={c.band} className="rounded-card border border-line p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: BAND_COLOR[c.band] }} />
                    {c.band}
                  </span>
                  <span className="text-xs text-ink-muted">{c.districts} districts</span>
                </div>
                <div className="text-2xl font-semibold font-num text-ink">{c.ratePer100k}</div>
                <div className="text-xs text-ink-muted mb-2">per 100k residents</div>
                <div className="space-y-1">
                  {c.mix.slice(0, 4).map((m: any) => (
                    <div key={m.head}>
                      <div className="flex justify-between text-[11px] text-ink-muted">
                        <span className="truncate pr-2">{m.head}</span><span className="font-num">{m.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: BAND_COLOR[c.band] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </motion.div>

      </>}

      {/* A heat grid says when crime happens; it does not say which parade to weight. Below
          state level that translation is the whole value, so the shift plan leads. */}
      {tab === 'when' && tier !== 'state' && (
        <motion.div variants={rise}><ShiftPlan heat={stats?.heat} scopeName={scopeName} /></motion.div>
      )}
      {tab === 'when' && <OccasionPanels occ={occ} />}

      {tab === 'next' && <>
      {/* WHAT NEXT IS A TASKING BOARD, NOT A SECOND FORECAST (D2). This tab used to render the
          forecast chart again — the exact duplication the brief flagged. Forecast answers
          "what will the numbers do?"; this answers "what should we do about it?" Every task
          traces to a computed trigger (a zone, a forecast direction, an emerging hotspot, a
          statutory deadline) shown on the card, and the projection it responds to is a link
          away in Forecast rather than repeated here. */}
      <motion.div variants={rise}><TaskingBoard /></motion.div>
      </>}

    </motion.div>
  );
}

// The tasking board (D2 / P4-6). Tier-shaped: state gets a quarterly control strategy,
// district a two-week deployment plan, station this week's list. Each task is a card that
// names its trigger, the action, the area, the review date and the measure of success.
const PRIORITY: Record<string, { dot: string; label: string }> = {
  high: { dot: '#C0392B', label: 'High' }, medium: { dot: '#C9820A', label: 'Medium' }, low: { dot: '#3AA76D', label: 'Low' },
};
function TaskingBoard() {
  const nav = useNav();
  const { data, isLoading } = useTasking();
  if (isLoading) return <div className="card"><Skeleton rows={6} /></div>;
  if (!data) return <Empty title="No tasking available" />;
  const tone = data.tier === 'state' ? '#1A6FC4' : data.tier === 'district' ? '#E8871E' : '#2FA8A0';
  return (
    <div className="space-y-4">
      <div className="rounded-card border px-4 py-3 flex items-start gap-3" style={{ borderColor: `${tone}55`, background: `${tone}0f` }}>
        <Sparkles size={16} style={{ color: tone }} className="shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: tone }}>
            {data.horizonLabel}
            <span className="ml-2"><InfoDot>What Next is a tasking product, distinct from Forecast.
              Forecast projects the numbers; this turns the projection into action — areas, hours,
              units and a review date. Every task shows the computed trigger it came from, so
              nothing here is the model editorialising.</InfoDot></span>
          </div>
          <p className="text-[13px] text-ink leading-relaxed">{data.note}</p>
        </div>
      </div>

      {!data.tasks.length && <Empty title="Nothing needs tasking right now" hint="No zone, forecast, hotspot or deadline crossed a threshold in this scope." />}

      {/* A DISTRICT GETS A PLANNER, NOT A PILE. A tactical assessment becomes deployment only
          when it says which station, which week, which day and which window — and a fortnight's
          cover cannot start everywhere at once, so the weeks are separated rather than left for
          the reader to sequence. Each row carries the OWNER, because a task with no name against
          it is a wish. */}
      {data.tier === 'district' && data.tasks.some((t: any) => t.week) ? (
        <div className="space-y-4">
          {[1, 2].map((wk) => {
            const rows = data.tasks.filter((t: any) => t.week === wk);
            if (!rows.length) return null;
            return (
              <Section key={wk}
                title={<span className="flex items-center gap-2">
                  <CalendarDays size={15} style={{ color: tone }} /> Week {wk}
                  <span className="text-[11.5px] font-normal text-ink-muted">
                    {wk === 1 ? 'starts now — the stations furthest above their own baseline' : 'follows on — the remainder of the elevated stations'}
                  </span>
                </span>}>
                <div className="divide-y divide-line">
                  {/* Column headings, so the planner reads as a roster rather than prose. */}
                  <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_150px_140px_110px] gap-3 px-4 py-1.5
                    bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
                    <span>Task &amp; trigger</span><span>Window</span><span>Owner</span><span className="text-right">Review by</span>
                  </div>
                  {rows.map((t: any) => (
                    <div key={t.id} className="grid md:grid-cols-[minmax(0,1.4fr)_150px_140px_110px] gap-3 px-4 py-3 items-start">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: (PRIORITY[t.priority] || PRIORITY.medium).dot }} />
                          <span className="text-[14px] font-semibold text-kadi-navy truncate">{t.title}</span>
                        </div>
                        <div className="text-[12.5px] text-ink-muted mt-0.5">{t.trigger}</div>
                        <div className="text-[12.5px] text-ink mt-1">{t.action}</div>
                        <div className="text-[11.5px] text-ink-subtle mt-1">Success: {t.measure}</div>
                        {t.link && (
                          <button onClick={() => nav(t.link.to)} className="btn-outline text-xs mt-2 inline-flex items-center gap-1.5">
                            {t.link.label} <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                      <div className="text-[12.5px]">
                        <div className="md:hidden text-[10.5px] uppercase tracking-wide text-ink-muted">Window</div>
                        <b className="text-ink">{t.window || '—'}</b>
                        {t.windowShare != null && (
                          <div className="text-[11px] text-ink-muted">{t.windowShare}% of its incidents</div>
                        )}
                      </div>
                      <div className="text-[12.5px] text-ink">
                        <div className="md:hidden text-[10.5px] uppercase tracking-wide text-ink-muted">Owner</div>
                        {t.owner || '—'}
                      </div>
                      <div className="text-[12.5px] font-num text-ink-muted md:text-right">
                        <div className="md:hidden text-[10.5px] uppercase tracking-wide">Review by</div>
                        {t.reviewBy}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            );
          })}
        </div>
      ) : (
      <div className="grid md:grid-cols-2 gap-3">
        {data.tasks.map((t: any) => {
          const p = PRIORITY[t.priority] || PRIORITY.medium;
          return (
            <div key={t.id} className="card p-4 relative overflow-hidden flex flex-col">
              <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: tone }} />
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: p.dot }} />
                <span className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted">{t.horizon} · {p.label} priority</span>
              </div>
              <h3 className="text-[15px] font-semibold text-kadi-navy leading-snug">{t.title}</h3>
              <div className="mt-2 space-y-1.5 text-[12.5px]">
                <div className="flex gap-2"><span className="text-ink-muted w-16 shrink-0">Trigger</span><span className="text-ink">{t.trigger}</span></div>
                <div className="flex gap-2"><span className="text-ink-muted w-16 shrink-0">Action</span><span className="text-ink">{t.action}</span></div>
                <div className="flex gap-2"><span className="text-ink-muted w-16 shrink-0">Area</span><span className="text-ink">{t.area}</span></div>
                <div className="flex gap-2"><span className="text-ink-muted w-16 shrink-0">Success</span><span className="text-ink">{t.measure}</span></div>
                <div className="flex gap-2"><span className="text-ink-muted w-16 shrink-0">Review by</span><span className="text-ink font-num">{t.reviewBy}</span></div>
              </div>
              {t.link && (
                <button onClick={() => nav(t.link.to)} className="btn-outline text-xs mt-3 self-start inline-flex items-center gap-1.5">
                  {t.link.label} <ArrowRight size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}
      <div className="text-center">
        <button onClick={() => nav('/forecast')} className="text-xs link inline-flex items-center gap-1">
          The projections these respond to live in Forecast <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

// Near-repeat clusters (P4-2): where an incident is followed by another close by, soon after —
// the pattern that says "re-targeted", and converts a hotspot into a fortnight of patrol.
function NearRepeat({ data }: { data: any }) {
  if (!data) return null;
  const rows = data.clusters || [];
  return (
    <Section
      title={<span className="flex items-center gap-2"><MapPin size={15} className="text-danger" />
        Near-repeat clusters — where one incident predicts the next</span>}
      action={<InfoDot>{data.method}
        <span className="block mt-1.5 text-ink-muted">Near-repeat victimisation is one of the most
          replicated findings in crime science: after a burglary or theft, nearby addresses carry
          elevated risk for a short window. A high rate here means the location is being worked,
          not merely busy — and the response is a time-boxed patrol, not a permanent post.</span>
      </InfoDot>}>
      {!rows.length ? (
        <div className="p-4 text-[12.5px] text-ink-muted">
          No cluster in scope shows a near-repeat rate above chance right now — incidents here are
          spread, not chained. That is itself useful: these are places, not re-targeted addresses.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          <div className="text-[12.5px] text-ink-muted mb-1">
            Within <b>{data.radiusM} m</b> and <b>{data.windowDays} days</b> of a prior incident.
          </div>
          {rows.map((c: any) => (
            <div key={c.cellId} className="rounded-card border border-line bg-surface-2 px-3 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-[13px] text-ink flex-1 min-w-0 truncate">{c.districtName}</span>
              <span className="text-[12px] text-ink-muted">{c.incidents} incidents</span>
              {c.medianGapDays != null && <span className="text-[12px] text-ink-muted">median gap {c.medianGapDays}d</span>}
              <span className="font-num text-[13px] font-semibold text-danger">{c.repeatRatePct}% near-repeat</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// Reporting propensity (P4-3): the incident-to-FIR delay, per district — the confounder a rate
// comparison must clear. When it is uniform (as here), it CLEARS: the rate gaps are not an
// artefact of some districts reporting faster. Stating that is stronger than asserting a cause.
function ReportingPropensity({ data, socio }: { data: any; socio: any }) {
  const [sort, setSort] = useState<'delay' | 'sameDay' | 'name'>('delay');
  const rows = data?.districts || [];

  // THE TEST, NOT JUST THE CLAIM. The right half sat empty while the panel asserted that
  // reporting speed is not what drives the rate. That assertion is checkable: plot each
  // district's delay against its crime rate and correlate them. If speed explained the rate the
  // cloud would slope; a flat cloud near r = 0 is the confounder being ruled out in front of the
  // reader rather than on their behalf.
  const joined = useMemo(() => {
    const rate = new Map<string, any>((socio?.districts || []).map((d: any) => [String(d.districtId), d]));
    return rows.map((r: any) => {
      const d = rate.get(String(r.districtId));
      return d ? { name: r.districtName, x: r.medianDelayDays, y: d.ratePer100k, sameDay: r.sameDayPct } : null;
    }).filter(Boolean) as any[];
  }, [rows, socio]);

  const r = useMemo(() => {
    const n = joined.length;
    if (n < 3) return null;
    const mx = joined.reduce((a, p) => a + p.x, 0) / n;
    const my = joined.reduce((a, p) => a + p.y, 0) / n;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (const p of joined) { const dx = p.x - mx; const dy = p.y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (!sxx || !syy) return 0;
    return Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000;
  }, [joined]);

  const sorted = useMemo(() => {
    const c = [...rows];
    if (sort === 'delay') return c.sort((a: any, b: any) => b.medianDelayDays - a.medianDelayDays);
    if (sort === 'sameDay') return c.sort((a: any, b: any) => b.sameDayPct - a.sameDayPct);
    return c.sort((a: any, b: any) => String(a.districtName).localeCompare(String(b.districtName)));
  }, [rows, sort]);

  if (!data) return <div className="card"><Skeleton rows={6} /></div>;
  if (!rows.length) return null;
  const delays = rows.map((x: any) => x.medianDelayDays);
  const spread = Math.round((Math.max(...delays) - Math.min(...delays)) * 10) / 10;
  const uniform = spread <= 3;
  const maxDelay = Math.max(...delays, 1);

  return (
    <Section
      title={<span className="flex items-center gap-2"><Clock size={15} className="text-kadi-blue" />
        Reporting propensity — does the rate just reflect faster reporting?</span>}
      action={<InfoDot width="w-80">
        <b className="block mb-1 text-kadi-navy">The confounder every rate comparison must clear</b>
        {data.method}
        <span className="block mt-1.5 text-ink-muted">
          If it did not clear, the urbanisation reading would be partly an artefact: urban districts
          would look worse simply because more of what happens there gets reported.
        </span>
      </InfoDot>}>
      <div className="p-4 grid lg:grid-cols-2 gap-5">
        {/* LEFT — the verdict, then every district rather than the first eight. */}
        <div className="min-w-0">
          <div className={`rounded-card px-3 py-2.5 text-[13px] leading-relaxed border ${
            uniform ? 'bg-kadi-teal/10 border-kadi-teal/30' : 'bg-kadi-blue50/50 border-kadi-blue/25'}`}>
            {uniform ? (
              <>State median delay is <b className="font-num">{data.stateMedianDelayDays} days</b> and it barely
              moves across districts (range <b className="font-num">{spread}d</b>). The crime-rate differences
              are <b>not</b> an artefact of some districts reporting faster — reporting propensity is ruled
              out as the confounder here, which <b>strengthens</b> the urbanisation reading rather than
              undermining it.</>
            ) : (
              <>Delay ranges <b className="font-num">{Math.min(...delays)}–{Math.max(...delays)} days</b> across
              districts, so part of the rate difference may be reporting speed rather than underlying crime.
              Read the urbanisation correlation with that in mind.</>
            )}
          </div>

          <div className="flex items-center justify-between mt-3 mb-1.5 gap-2">
            <div className="label">All {rows.length} districts</div>
            <Select value={sort} onChange={(v) => setSort(v as any)} className="w-44"
              options={[
                { value: 'delay', label: 'Sort: slowest first' },
                { value: 'sameDay', label: 'Sort: same-day %' },
                { value: 'name', label: 'Sort: name' },
              ]} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_72px_60px] gap-x-3 px-1 pb-1
            text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
            <span>District</span><span className="text-right">Median</span><span className="text-right">Same day</span>
          </div>
          <div className="max-h-[290px] overflow-auto pr-1 space-y-1.5">
            {sorted.map((d: any) => (
              <div key={d.districtId} className="grid grid-cols-[minmax(0,1fr)_72px_60px] gap-x-3 items-center text-[12.5px]">
                <div className="min-w-0">
                  <div className="truncate text-ink">{d.districtName}</div>
                  <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mt-0.5">
                    <div className="h-full rounded-full bg-kadi-blue" style={{ width: `${(d.medianDelayDays / maxDelay) * 100}%` }} />
                  </div>
                </div>
                <span className="text-right font-num text-ink">{d.medianDelayDays}d</span>
                <span className="text-right font-num text-ink-muted">{d.sameDayPct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — the test itself, which is what the empty half was for. */}
        <div className="min-w-0">
          <div className="label mb-1">Does delay explain the rate?</div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%" key={joined.length}>
              <ScatterChart margin={{ top: 8, right: 14, bottom: 34, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" />
                <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} axisLine={{ stroke: '#D9E1EC' }}
                  domain={['dataMin - 0.5', 'dataMax + 0.5']}
                  label={{ value: 'Median reporting delay (days)', position: 'insideBottom', offset: -20, style: AXIS }} />
                <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} axisLine={false} width={46}
                  label={{ value: 'FIRs per 100k', angle: -90, position: 'insideLeft', style: AXIS }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }: any) => {
                  const p = payload?.[0]?.payload; if (!p) return null;
                  return (<div className="bg-surface border border-line rounded-ctl px-2.5 py-1.5 text-xs shadow-card">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-ink-muted">{p.x}d median · {p.sameDay}% same-day</div>
                    <div className="text-ink-muted">{p.y}/100k</div>
                  </div>);
                }} />
                <Scatter data={joined} isAnimationActive={false} fill="#1A6FC4" fillOpacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-card border border-line bg-surface-2 px-3 py-2.5 mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] uppercase tracking-wide text-ink-muted">Delay vs rate</span>
              {r != null && (
                <b className="text-lg font-num" style={{ color: Math.abs(r) < 0.3 ? '#1E874B' : '#C9820A' }}>
                  r = {r > 0 ? '+' : ''}{r}
                </b>
              )}
            </div>
            <p className="text-[12px] text-ink-muted mt-1 leading-relaxed">
              {r != null && Math.abs(r) < 0.3
                ? 'Effectively no relationship. Districts that report faster do not record higher rates — the cloud is flat, not sloped, and that is what "ruled out" means here.'
                : 'How fast a district reports does track with the rate it records, so part of the gap is reporting behaviour rather than offending.'}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

// THE THRESHOLD READING. The pipeline publishes, for every district and station, the exact rise
// that area needs to cross into Watch and into Pulsing — and nothing rendered it. That omission
// is precisely what zones.py warns about: an officer should be able to read that their own red
// line sits at +7 while Bengaluru City's sits at +98, instead of wondering why their station
// never lights up. Same statistical standard, very different absolute bars, and the bar is the
// thing an SHO actually needs to know.
function ThresholdReading({ zones, tier, unitId }: { zones: any; tier: string; unitId?: string | null }) {
  const row = useMemo(() => {
    if (!zones) return null;
    if (tier === 'station' && unitId) {
      return (zones.stations || []).find((r: any) => String(r.unitId) === String(unitId)) || null;
    }
    return (zones.districts || [])[0] || null;
  }, [zones, tier, unitId]);
  if (!row || !row.thresholds) return null;

  const t = row.thresholds;
  const name = row.unitName || row.districtName || 'This area';
  const band = ZONE_STYLE[row.zone] || ZONE_STYLE.normal;
  // Where the current month sits along its own scale, capped so a huge spike still renders.
  const span = Math.max(t.redAt * 1.35, (row.current ?? 0) - t.baseline, 1);
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / span) * 100))}%`;
  const rise = (row.current ?? 0) - t.baseline;

  return (
    <Section
      title={<span className="flex items-center gap-2"><Target size={15} style={{ color: band.dot }} />
        {name} — measured against its own history</span>}
      action={<InfoDot width="w-80">
        <b className="block mb-1 text-kadi-navy">Why your line is not someone else&rsquo;s</b>
        Every area is judged against its OWN twelve-month average and its own natural variation,
        never a shared cut-off. Monthly FIR counts behave like counts of independent events, so
        the expected month-to-month wobble is roughly the square root of the baseline. A station
        averaging 200 needs about +42 to pulse; one averaging 9 needs about +9.
        <span className="block mt-1.5 text-ink-muted">
          That is why a busy station does not sit permanently red and a quiet one is not
          permanently invisible — the standard is identical, the absolute bar is not.
        </span>
      </InfoDot>}>
      <div className="p-4">
        <div className="flex items-baseline gap-2 flex-wrap mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${band.ring || ''}`} style={{ background: band.dot }} />
          <b className="text-[15px]" style={{ color: band.dot }}>{band.label}</b>
          <span className="text-[13px] text-ink">
            <b className="font-num">{row.current}</b> this month against a baseline of{' '}
            <b className="font-num">{t.baseline}</b>
            {rise > 0 ? <> — <b className="font-num text-danger">+{Math.round(rise * 10) / 10}</b> above it</> : ' — at or below it'}
          </span>
        </div>

        {/* The scale itself: where Watch and Pulsing sit for THIS area, and where it stands now. */}
        <div className="relative h-9">
          <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: pos(Math.max(0, rise)), background: band.dot }} />
          </div>
          {[['Watch', t.yellowAt, '#C9820A'], ['Pulsing', t.redAt, '#C0392B']].map(([lab, v, c]: any) => (
            <div key={lab} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: pos(v) }}>
              <div className="w-px h-8 mx-auto" style={{ background: c }} />
              <div className="text-[10px] font-medium whitespace-nowrap" style={{ color: c }}>{lab} +{v}</div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-ink-muted mt-4">
          {name} needs <b className="text-ink font-num">+{t.yellowAt}</b> cases over its average to
          reach Watch and <b className="text-ink font-num">+{t.redAt}</b> to pulse.
          {row.z != null && <> It currently sits <b className="text-ink font-num">{row.z.toFixed(1)}σ</b> from its own mean.</>}
        </p>
      </div>
    </Section>
  );
}

// THE "WHY" FOR A DISTRICT OR A STATION. "Why is crime distributed like this across Karnataka"
// is a state question. An SP or an SHO asks something narrower and more useful: why does MY
// register look like this? The only honest answer is a comparison with the tier above, because
// a share with nothing beside it explains nothing — 60% property crime is unremarkable if the
// district is 60% too, and a briefing if the district is 40%.
function ScopeProfile({ data }: { data: any }) {
  if (!data) return <div className="card"><Skeleton rows={6} /></div>;
  if (!data.available) {
    return <div className="card p-4 text-[13px] text-ink-muted">{data.reason}</div>;
  }
  const over = data.headMix.filter((h: any) => h.lift && h.lift >= 1.25).slice(0, 3);
  const under = data.headMix.filter((h: any) => h.lift && h.lift <= 0.75).slice(0, 3);

  return (
    <div className="space-y-4">
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Building2 size={15} className="text-kadi-blue" />
            What makes {data.mineName} different from {data.parentName}</span>}
          action={<InfoDot width="w-80">{data.method}</InfoDot>}>
          <div className="p-4 space-y-4">
            <div className="rounded-card border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink">
              {data.mineName} holds <b className="font-num">{data.totals.mine.toLocaleString()}</b> FIRs
              — <b className="font-num">{data.totals.shareOfParent}%</b> of {data.parentName}&rsquo;s{' '}
              <span className="font-num">{data.totals.parent.toLocaleString()}</span>.
              {over.length > 0 && (
                <> Its register runs <b>heavier on {over.map((h: any) => h.head).join(', ')}</b> than the {data.parentLabel} does
                  {under.length > 0 && <> and <b>lighter on {under.map((h: any) => h.head).join(', ')}</b></>}.</>
              )}
              {!over.length && !under.length && <> Its crime mix closely tracks the {data.parentLabel}&rsquo;s — nothing here is unusual in composition.</>}
            </div>

            {/* Composition against the parent. Two bars per head, so over- and
                under-representation is visible rather than asserted. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="label">Crime mix vs the {data.parentLabel}</div>
                <div className="flex items-center gap-3 text-[10.5px] text-ink-muted">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-kadi-blue" />{data.mineLabel}</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-line" />{data.parentLabel}</span>
                </div>
              </div>
              <div className="space-y-2">
                {data.headMix.slice(0, 8).map((h: any) => {
                  const max = Math.max(...data.headMix.map((x: any) => Math.max(x.minePct, x.parentPct)), 1);
                  const hot = h.lift && h.lift >= 1.25;
                  const cold = h.lift && h.lift <= 0.75;
                  return (
                    <div key={h.head}>
                      <div className="flex items-center justify-between text-[12.5px] mb-0.5">
                        <span className="text-ink truncate">{h.head}</span>
                        <span className="font-num text-ink-muted shrink-0">
                          {h.minePct}% <span className="text-ink-subtle">vs {h.parentPct}%</span>
                          {h.lift != null && (
                            <b className={`ml-2 ${hot ? 'text-danger' : cold ? 'text-kadi-teal' : 'text-ink-muted'}`}>
                              {h.lift}×
                            </b>
                          )}
                        </span>
                      </div>
                      <div className="relative h-3">
                        <div className="absolute inset-x-0 top-0 h-1.5 rounded-full bg-surface-3">
                          <div className="h-full rounded-full" style={{ width: `${(h.minePct / max) * 100}%`, background: hot ? '#C0392B' : cold ? '#2FA8A0' : '#1A6FC4' }} />
                        </div>
                        <div className="absolute top-2 h-1 rounded-full bg-line" style={{ width: `${(h.parentPct / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>
      </motion.div>

      {/* The three comparisons an officer is actually judged on. */}
      <motion.div variants={rise}>
        <Section title={<span className="flex items-center gap-2"><Target size={15} className="text-kadi-blue" />
          How {data.mineName} performs against {data.parentName}</span>}
          action={<InfoDot>Each row is this scope&rsquo;s figure beside the tier above it. Green means
            better than the parent on that measure, red worse — and the direction of &ldquo;better&rdquo;
            differs by row, which is why it is stated rather than assumed.</InfoDot>}>
          <div className="p-4 grid sm:grid-cols-3 gap-3">
            {data.metrics.map((m: any) => {
              if (m.mine == null || m.parent == null) return null;
              const better = m.higherIsBetter ? m.mine > m.parent : m.mine < m.parent;
              const same = Math.abs(m.mine - m.parent) < 0.05;
              const tone = same ? '#5B6B7E' : better ? '#1E874B' : '#C0392B';
              return (
                <div key={m.key} className="rounded-card border border-line p-3">
                  <div className="text-[11px] uppercase tracking-wide text-ink-muted">{m.label}</div>
                  <div className="text-2xl font-num font-semibold mt-1" style={{ color: tone }}>{m.mine}{m.unit}</div>
                  <div className="text-[12px] text-ink-muted mt-0.5">
                    {data.parentName}: <b className="font-num text-ink">{m.parent}{m.unit}</b>
                    {!same && <span style={{ color: tone }}> · {better ? 'better' : 'worse'}</span>}
                    {same && ' · in line'}
                  </div>
                  <p className="text-[11.5px] text-ink-subtle mt-1.5">{m.note}</p>
                </div>
              );
            })}
          </div>
        </Section>
      </motion.div>
    </div>
  );
}

// THE SHIFT PLAN. A heat grid tells an SHO when crime happens; it does not tell them which
// parade to weight. Karnataka stations run standard reliefs, so the hours are folded into those
// shifts and ranked — that is the form the answer has to take before it can be acted on.
const SHIFT_BANDS: [string, string, number, number][] = [
  ['First (night)', '00:00–06:00', 0, 5],
  ['Second (day)', '06:00–14:00', 6, 13],
  ['Third (evening)', '14:00–22:00', 14, 21],
  ['Late night', '22:00–24:00', 22, 23],
];
function ShiftPlan({ heat, scopeName }: { heat?: any[]; scopeName: string }) {
  const rows = useMemo(() => {
    if (!heat?.length) return [];
    const total = heat.reduce((a, c) => a + c.count, 0) || 1;
    return SHIFT_BANDS.map(([label, window, from, to]) => {
      const n = heat.filter((c) => c.hour >= from && c.hour <= to).reduce((a, c) => a + c.count, 0);
      const hours = to - from + 1;
      return { label, window, n, pct: Math.round((n / total) * 1000) / 10, perHour: Math.round((n / hours) * 10) / 10 };
    }).sort((a, b) => b.perHour - a.perHour);
  }, [heat]);
  if (!rows.length) return null;
  const top = rows[0];

  return (
    <Section
      title={<span className="flex items-center gap-2"><Clock size={15} className="text-kadi-teal" /> Your shift plan</span>}
      action={<InfoDot width="w-80">
        <b className="block mb-1 text-kadi-navy">Ranked per hour, not per shift</b>
        A shift covering eight hours will always total more than one covering two, so ranking on
        the raw total would put the longest shift first every time regardless of risk. These are
        ranked by incidents PER HOUR, which is what decides where an extra pair of feet is worth
        most.
        <span className="block mt-1.5 text-ink-muted">
          Weighting cover toward a peak window is only worth doing if the visit is long enough to
          register and short enough to repeat — brief, frequent, unpredictable passes deter more
          than one long static posting.
        </span>
      </InfoDot>}>
      <div className="p-4 space-y-2">
        <div className="rounded-card border border-kadi-teal/30 bg-kadi-teal/10 px-3 py-2 text-[13px] text-ink mb-1">
          Weight cover toward <b>{top.label}</b> ({top.window}) — <b className="font-num">{top.perHour}</b> incidents
          an hour at {scopeName}, against {rows[rows.length - 1].perHour} on the quietest relief.
        </div>
        {rows.map((r, i) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-5 text-[11px] font-num text-ink-muted">{i + 1}</span>
            <span className="w-32 text-[13px] text-ink shrink-0">{r.label}</span>
            <span className="w-24 text-[11.5px] text-ink-muted font-num shrink-0">{r.window}</span>
            <span className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
              <span className="block h-full rounded-full" style={{ width: `${(r.perHour / (rows[0].perHour || 1)) * 100}%`, background: i === 0 ? '#C0392B' : i === 1 ? '#C9820A' : '#2FA8A0' }} />
            </span>
            <span className="w-24 text-right font-num text-[12px] text-ink">{r.perHour}/hr</span>
            <span className="w-14 text-right font-num text-[11.5px] text-ink-muted">{r.pct}%</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// WHERE THE CONCENTRATION ACTUALLY LIVES. "Which district is worst" is the question a count map
// answers, and it is the wrong one — the answer is always the most populous district. The
// strategic question underneath is at WHICH GRAIN the load is uneven, because that decides
// whether the lever is moving resources between areas or working differently inside them.
//
// The three curves disagree, and the disagreement is the finding.
function Concentration({ data }: { data: any }) {
  if (!data) return <div className="card"><Skeleton rows={5} /></div>;
  const grains = [
    { key: 'districts', label: 'Between districts', c: data.districts, unit: 'districts',
      note: 'Volume, uncorrected for population.' },
    { key: 'stations', label: 'Between stations', c: data.stations, unit: 'stations',
      note: 'Inside the administrative layer.' },
    { key: 'clusters', label: 'Within stations', c: data.clusters, unit: 'clusters',
      note: 'Spatial clusters, below station geography.' },
  ].filter((g) => g.c);
  if (!grains.length) return null;

  return (
    <Section
      title={<span className="flex items-center gap-2"><Target size={15} className="text-kadi-blue" />
        Where the concentration actually lives</span>}
      action={<InfoDot width="w-80">
        <b className="block mb-1 text-kadi-navy">How to read the Gini</b>
        0 means every unit at that grain carries the same load; 1 means one unit carries all of
        it. Each bar shows the share of recorded crime held by the busiest 10% of units.
        <b className="block mt-1.5 text-kadi-navy">Why three grains</b>
        Because they disagree, and that is the point. If districts look uneven but stations do
        not, the district-level skew is population rather than risk — and reallocating between
        stations on volume buys nothing. The lever is wherever the load is genuinely stacked.
        <span className="block mt-1.5 text-ink-muted">
          District volume is not population-corrected here; the per-capita ranking further down
          this tab is what separates size from risk.
        </span>
      </InfoDot>}>
      <div className="p-4 space-y-4">
        {data.reading && (
          <div className="rounded-card border border-kadi-blue/25 bg-kadi-blue50/40 px-3 py-2.5 text-[13px] text-ink leading-relaxed">
            {data.reading}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          {grains.map((g) => {
            const p10 = g.c.points.find((x: any) => x.topPct === 10);
            // An even grain is one where the busiest tenth carries roughly a tenth.
            const even = p10 && p10.sharePct < 15;
            const tone = even ? '#2FA8A0' : p10 && p10.sharePct > 30 ? '#C0392B' : '#C9820A';
            return (
              <div key={g.key} className="rounded-card border border-line p-3">
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">{g.label}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-num font-semibold" style={{ color: tone }}>{p10?.sharePct}%</span>
                  <span className="text-[11.5px] text-ink-muted">held by the busiest 10%</span>
                </div>
                <div className="mt-2 space-y-1">
                  {g.c.points.map((pt: any) => (
                    <div key={pt.topPct} className="flex items-center gap-2 text-[11px]">
                      <span className="w-10 text-ink-muted font-num">top {pt.topPct}%</span>
                      <span className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <span className="block h-full rounded-full" style={{ width: `${pt.sharePct}%`, background: tone }} />
                      </span>
                      <span className="w-10 text-right font-num text-ink">{pt.sharePct}%</span>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-ink-subtle mt-2">
                  Gini <b className="font-num text-ink-muted">{g.c.gini}</b> over {g.c.units} {g.unit} · {g.note}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-muted">{data.method}</p>
      </div>
    </Section>
  );
}

function HeroStat({ label, value, good }: { label: string; value: any; good?: boolean }) {
  return (
    <div className="rounded-ctl bg-white/10 px-3 py-2 min-w-[104px]">
      <div className="text-[11px] text-white/70">{label}</div>
      <div className={`text-lg font-semibold font-num ${good ? 'text-kadi-gold' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card"><Skeleton rows={2} /></div>
      <div className="card"><Skeleton rows={6} /></div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card"><Skeleton rows={6} /></div>
        <div className="card"><Skeleton rows={6} /></div>
      </div>
    </div>
  );
}
