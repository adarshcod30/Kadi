// The two tiers do different jobs, so they get different panels rather than the same panels
// with smaller numbers.
//
//   STATE     strategic  -- which districts need attention, where to move resources
//   DISTRICT  operational -- which of my stations, and what is reaching into my district
//
// Everything here is computed server-side by queries.stateCommand / districtCommand; these
// components only decide how to show it.
import { motion } from 'framer-motion';

import { Sparkles, MapPin, Building2, Share2, ArrowRight, AlertTriangle } from 'lucide-react';
import { Section, Skeleton } from './ui';
import { Hint, stagger, rise } from './viz';
import { useNav } from '../lib/useNav';

// Three bands now (D3): Red is retired — it was empty by construction — and the survivors are
// Pulsing (accelerating), Watch (elevated) and Normal. `red` is kept as an alias so a stale
// cached payload degrades gracefully rather than rendering an unknown zone.
const ZONE: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  red_pulsing: { dot: '#C0392B', label: 'Pulsing', pulse: true },
  red: { dot: '#C9820A', label: 'Watch' },
  yellow: { dot: '#C9820A', label: 'Watch' },
  normal: { dot: '#3AA76D', label: 'Normal' },
};

export function CommandInsight({ text, view }: { text?: string; view: string }) {
  if (!text) return null;
  return (
    <div className="rounded-card border border-kadi-blue/25 bg-kadi-blue50/40 px-4 py-3 flex items-start gap-2.5">
      <Sparkles size={15} className="text-kadi-blue shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-blue mb-0.5">
          {view === 'state' ? 'The state picture' : view === 'station' ? 'Your register today' : 'Your district today'}
        </div>
        <p className="text-[13px] text-ink leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

/** STATE: 31 districts ranked by concern, so "where do I put attention" is answerable. */
export function StateCommand({ data }: { data: any }) {
  const nav = useNav();
  if (!data) return <div className="card"><Skeleton rows={6} /></div>;
  const z = data.zoneSummary || {};
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><MapPin size={15} className="text-kadi-blue" />
            Districts, ordered by what needs attention</span>}
          action={<Hint text="Ordered by zone severity first, then by how far the district sits above its own baseline — not by volume, which would just re-rank by population." />}>
          <div className="p-2">
            <div className="flex flex-wrap gap-2 px-2 pb-2">
              {(['red_pulsing', 'yellow', 'normal'] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                  <span className={`w-2 h-2 rounded-full ${ZONE[k].pulse ? 'animate-pulse' : ''}`}
                    style={{ background: ZONE[k].dot }} />
                  {ZONE[k].label} <b className="text-ink font-num">{z[k] ?? 0}</b>
                </span>
              ))}
              {data.stationsPulsing?.length > 0 && (
                <span className="flex items-center gap-1.5 text-[12px] text-danger ml-auto">
                  <AlertTriangle size={13} /> {data.stationsPulsing.length} station(s) pulsing
                </span>
              )}
            </div>
            {/* Column headings, so the three bare numbers on each row say what they are at the
                point of reading — the footnote below described them, but a reader scanning the
                figures should not have to leave the table to find out what they mean. */}
            <div className="flex items-center gap-3 px-2 py-1.5 border-b border-line sticky top-0 bg-surface
              text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
              <span className="w-2 shrink-0" />
              <span className="flex-1">District</span>
              <span className="hidden md:block w-40">Driving the move</span>
              <span className="w-20 text-right">Total FIRs</span>
              <span className="w-16 text-right">Serious</span>
              <span className="w-16 text-right">vs base</span>
              <span className="w-[13px] shrink-0" />
            </div>
            <div className="max-h-[420px] overflow-auto">
              {(data.districts || []).map((d: any) => (
                <button key={d.districtId}
                  onClick={() => { const u = new URL(window.location.href);
                    u.searchParams.set('district', d.districtId); window.location.href = u.toString(); }}
                  className="w-full flex items-center gap-3 px-2 py-2 border-b border-line/60 last:border-0 hover:bg-kadi-blue50/50 text-left">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ZONE[d.zone]?.pulse ? 'animate-pulse' : ''}`}
                    style={{ background: ZONE[d.zone]?.dot || '#3AA76D' }} title={ZONE[d.zone]?.label} />
                  <span className="text-[13px] text-ink flex-1 truncate">{d.districtName}</span>
                  <span className="hidden md:block text-[11.5px] text-ink-muted w-40 truncate">{d.driverHead || ''}</span>
                  <span className="font-num text-[12.5px] text-ink w-20 text-right">{d.total?.toLocaleString()}</span>
                  <span className="font-num text-[12.5px] text-ink-muted w-16 text-right">{d.seriousFlags}</span>
                  <span className={`font-num text-[12.5px] w-16 text-right font-medium ${
                    d.changePct > 10 ? 'text-danger' : d.changePct < -5 ? 'text-kadi-teal' : 'text-ink-muted'}`}>
                    {d.changePct > 0 ? '+' : ''}{d.changePct}%
                  </span>
                  <ArrowRight size={13} className="text-ink-muted shrink-0" />
                </button>
              ))}
            </div>
            <p className="px-2 pt-2 text-[11.5px] text-ink-muted">
              <b>Serious</b> is high-severity health flags. <b>vs base</b> compares this month with the
              district&rsquo;s own 12-month baseline, not with other districts. Click any row to drill in.
            </p>
          </div>
        </Section>
      </motion.div>
    </motion.div>
  );
}

/** DISTRICT: my stations, and what is reaching in from outside — the silo-breaking view. */
export function DistrictCommand({ data }: { data: any }) {
  const nav = useNav();
  if (!data) return <div className="card"><Skeleton rows={6} /></div>;
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="grid lg:grid-cols-2 gap-4">
      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Building2 size={15} className="text-kadi-blue" />
            Stations in {data.districtName}</span>}
          action={<Hint text="Ordered by zone status, then volume. Zone compares each station with its own trailing baseline. Click a row to open that station's register." />}>
          {/* A real table with a header row, not three bare numbers behind tooltips (P1-9). The
              column meanings are stated once, at the top, where a reader looks for them. */}
          <div className="max-h-[420px] overflow-auto">
            <div className="grid grid-cols-[16px_1fr_auto_auto_auto] gap-3 px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold sticky top-0 bg-surface border-b border-line">
              <span />
              <span>Station</span>
              <span className="w-14 text-right">Cases</span>
              <span className="w-12 text-right">Open</span>
              <span className="w-12 text-right">Flagged</span>
            </div>
            {(data.stations || []).map((s: any) => (
              <button key={s.unitId}
                onClick={() => nav(`/cases?unit=${s.unitId}`)}
                className="w-full grid grid-cols-[16px_1fr_auto_auto_auto] gap-3 items-center px-3 py-2 border-b border-line/60 last:border-0 hover:bg-kadi-blue50/50 text-left">
                <span className={`w-2 h-2 rounded-full shrink-0 ${ZONE[s.zone]?.pulse ? 'animate-pulse' : ''}`}
                  style={{ background: ZONE[s.zone]?.dot || '#3AA76D' }} title={ZONE[s.zone]?.label} />
                <span className="text-[13px] text-ink truncate">{s.unitName}</span>
                <span className="font-num text-[12.5px] text-ink w-14 text-right">{s.total}</span>
                <span className="font-num text-[12.5px] text-ink-muted w-12 text-right">{s.open}</span>
                <span className="font-num text-[12.5px] text-saffron w-12 text-right">{s.flagged}</span>
              </button>
            ))}
          </div>
          <p className="px-3 pb-2 text-[11.5px] text-ink-muted">
            {data.stations?.length} stations · {data.stationsFlagged} above their own baseline ·
            this district carries {data.shareOfState}% of state volume
          </p>
        </Section>
      </motion.div>

      <motion.div variants={rise}>
        <Section
          title={<span className="flex items-center gap-2"><Share2 size={15} className="text-kadi-teal" />
            Reaching into {data.districtName} from elsewhere</span>}
          action={<Hint text="Cases registered in OTHER districts that share evidence with a case here. A station register cannot show this — it is the whole reason the platform exists." />}>
          <div className="px-3 pt-3">
            <div className="rounded-card bg-kadi-teal/10 border border-kadi-teal/30 px-3 py-2 mb-2">
              <span className="font-num text-xl text-kadi-navy">{data.linkedInTotal?.toLocaleString()}</span>
              <span className="text-[12.5px] text-ink-muted ml-2">
                cases outside this district are linked to one inside it
              </span>
            </div>
          </div>
          <div className="p-2 max-h-[360px] overflow-auto">
            {(data.linkedInFromOtherDistricts || []).map((c: any) => (
              <button key={c.caseMasterId} onClick={() => nav(`/graph?case=${c.caseMasterId}`)}
                className="w-full flex items-center gap-2 px-2 py-1.5 border-b border-line/60 last:border-0 hover:bg-kadi-blue50/50 text-left">
                <span className="font-mono text-[11.5px] text-kadi-blue shrink-0">{c.crimeNo}</span>
                <span className="text-[12.5px] text-ink flex-1 truncate">{c.crimeSubHead}</span>
                <span className="text-[11.5px] text-ink-muted w-28 truncate hidden sm:block">{c.districtName}</span>
                <span className="chip bg-surface-3 text-ink-muted text-[10.5px] shrink-0">
                  {String(c.edgeType).replace(/_/g, ' ')}
                </span>
              </button>
            ))}
          </div>
        </Section>
      </motion.div>
    </motion.div>
  );
}

/**
 * STATION: one register, and the exact size of what it cannot see.
 *
 * This view exists to be uncomfortable. Every other screen in KADI shows what an officer can
 * reach; this one leads with what they cannot -- the count of cases their own FIRs connect to
 * that sit outside this station entirely. That number is the argument for the whole platform,
 * and at station level it can be stated exactly instead of described.
 */
export function StationCommand({ data }: { data: any }) {
  const nav = useNav();
  if (!data) return <div className="card"><Skeleton rows={6} /></div>;
  const outsideShare = data.total ? Math.round((data.linkedOutTotal / data.total) * 10) / 10 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="FIRs on this register" value={data.total?.toLocaleString()} />
        <StatBox label="Still open" value={data.open?.toLocaleString()} />
        <StatBox label="Carrying a health flag" value={data.flagged?.toLocaleString()} accent="#C9820A" />
        <StatBox label="Heinous" value={data.heinous?.toLocaleString()} accent="#C0392B" />
      </div>

      {/* The finding. Deliberately the largest element on the page. */}
      <div className="rounded-card border-2 border-kadi-teal/40 bg-gradient-to-br from-kadi-teal/[0.07] to-transparent p-4">
        <div className="flex items-start gap-3">
          <Share2 size={18} className="text-kadi-teal shrink-0 mt-1" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-teal">
              What this register cannot see
            </div>
            <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-semibold font-num text-kadi-navy">
                {data.linkedOutTotal?.toLocaleString()}
              </span>
              <span className="text-[13.5px] text-ink">
                cases outside {data.unitName} that its own FIRs connect to
              </span>
            </div>
            <p className="text-[12.5px] text-ink-muted mt-1.5 leading-relaxed">
              {data.linkedWithinStation?.toLocaleString()} of your {data.total?.toLocaleString()} cases
              share an offender, co-accused, modus operandi, place, time window or act &amp; section
              with a case registered elsewhere — <b className="text-ink">{data.linkedOutOtherDistricts?.toLocaleString()}</b> of
              them in another district entirely. That is {outsideShare}× your own caseload sitting
              beyond your reach, and from this desk you cannot open any of it.
            </p>
            <button onClick={() => nav('/graph')}
              className="mt-2.5 btn-outline text-[12.5px] inline-flex items-center gap-1.5">
              See the connections <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value?: string; accent?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-2xl font-semibold font-num mt-0.5" style={accent ? { color: accent } : { color: '#0f2f44' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}
