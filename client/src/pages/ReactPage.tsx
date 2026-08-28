// React — the day's agenda: what carries a clock, and whose desk it sits on.
//
// The page this replaces merged every health flag in scope into one ranked list. State-wide
// that was 26,212 items with 16,136 marked urgent, ordered by how far each case had run past
// the median for its own type. Three things were wrong with it, and none of them were fixable
// by restyling:
//
//   * it could never be finished, so it was a report wearing a queue's clothes;
//   * it could never change, because days-past-peer pins the same sixty ancient files to the
//     top for ever — nothing an officer did moved the list;
//   * it ignored rank, handing a DGP individual case numbers to open. A DGP does not open
//     case files. The state's response to a failing investigation is to press the officer who
//     owns it, which is a different object entirely.
//
// The rule now: an item appears here only if it has a DATE by which it must be done and one
// POST responsible for doing it. Everything else is Health (which case is unhealthy), Cases
// (the register) or Insights (why the ground behaves this way). Health is a diagnosis and
// never empties; React is a diary and clears.
//
// So the three ranks get three SHAPES rather than three filters of one list —
// station reads cases, district reads stations, state reads districts — and drilling changes
// the shape, because looking at a district means reading the district's agenda.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Zap, Sparkles, ArrowRight, CheckCircle2, ChevronRight, Clock, ClipboardCopy,
  Building2, MapPin, ShieldAlert, CalendarClock,
} from 'lucide-react';
import { useAgenda, useMe } from '../api/hooks';
import { Skeleton, Empty, Section, TierChip } from '../components/ui';
import { InfoDot, AiProvenanceInfo } from '../components/InfoDot';

// The four tones a due date can carry. Deliberately not a severity scale: "past" is not more
// important than "now", it is less actionable, and colouring it loudest is how a page teaches
// people to ignore its loudest colour.
const TONE: Record<string, { fg: string; bg: string; bd: string }> = {
  past: { fg: '#C0392B', bg: '#FDECEA', bd: '#F1C7C1' },
  now: { fg: '#B4690E', bg: '#FDF3E3', bd: '#F0DCB6' },
  soon: { fg: '#1A6FC4', bg: '#EAF2FB', bd: '#C9DDF3' },
  open: { fg: '#5B6B7F', bg: '#F1F4F8', bd: '#DCE3EC' },
};

const BLOCK_ICON: Record<string, any> = {
  due: CalendarClock, fresh: Clock, ground: MapPin, reaching: ArrowRight,
  visit: Building2, clock: CalendarClock, recover: ShieldAlert, refer: ArrowRight,
  call: Building2, coordinate: ShieldAlert, systemic: MapPin,
};

function WhenPill({ when }: { when: any }) {
  if (!when) return null;
  const t = TONE[when.tone] || TONE.open;
  return (
    <span className="text-[11px] font-medium rounded-full px-2 py-0.5 border whitespace-nowrap font-num"
      style={{ color: t.fg, background: t.bg, borderColor: t.bd }}>
      {when.label}
    </span>
  );
}

// One agenda row. The order of the parts is the argument: WHEN it is due, WHAT it is, WHO
// owes it, WHY, then the instruction. A queue that says what is wrong but not what to do is
// a report with extra steps, so `action` is never optional.
function Row({ item, onOpen, drill }: { item: any; onOpen: (l: any) => void; drill?: () => void }) {
  return (
    <div className="px-4 py-3 hover:bg-surface-3/50 transition-colors">
      <div className="flex items-start gap-3 flex-wrap">
        <WhenPill when={item.when} />
        <div className="min-w-0 flex-1">
          <button onClick={() => (drill ? drill() : onOpen(item.link))}
            className="text-left text-[13.5px] font-medium text-ink hover:text-kadi-blue transition-colors">
            {item.title}
          </button>
          <div className="text-[11.5px] text-ink-subtle mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{item.where}</span>
            {item.owner && <><span className="text-line">·</span><span className="text-ink-muted font-medium">{item.owner}</span></>}
          </div>
          <p className="text-[12.5px] text-ink-muted mt-1 leading-relaxed">{item.why}</p>

          {/* The three files to ask about when you get there. A visit instruction without the
              specific crime numbers is a suggestion; with them it is an agenda. */}
          {item.refs?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.refs.map((r: any) => (
                <button key={r.crimeNo} onClick={() => onOpen({ page: 'case', id: r.id })}
                  className="text-[11px] rounded-ctl border border-line bg-surface-2 px-2 py-1 hover:border-kadi-blue hover:bg-kadi-blue50 transition-colors text-left">
                  <span className="font-num text-ink">{r.crimeNo}</span>
                  <span className="text-ink-subtle"> · {r.subHead} · IO {r.io} · due {r.due}</span>
                </button>
              ))}
            </div>
          )}

          <div className="text-[12.5px] text-kadi-navy700 mt-1.5 flex items-start gap-1.5">
            <ArrowRight size={12} className="mt-0.5 shrink-0 text-kadi-blue" />
            <span>{item.action}</span>
          </div>
          {drill && (
            <button onClick={drill}
              className="mt-1.5 text-[12px] text-kadi-blue hover:underline flex items-center gap-1">
              See this agenda <ChevronRight size={12} />
            </button>
          )}
        </div>
        {item.metric && (
          <span className="text-[11px] font-num bg-surface-3 text-ink-muted rounded-full px-2 py-0.5 whitespace-nowrap">
            {item.metric}
          </span>
        )}
      </div>
    </div>
  );
}

// The scoreboard shape. A supervisor comparing stations is not reading prose, they are
// reading a column — so this stays a table, with the one derived figure (share past window)
// drawn against the parent's own rate rather than an absolute nobody agreed to.
function Board({ block, onOpen, drill }: { block: any; onOpen: (l: any) => void; drill?: (i: any) => void }) {
  const max = Math.max(1, ...block.items.map((i: any) => i.cells[3]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wide text-ink-subtle border-b border-line">
            {block.columns.map((c: string, i: number) => (
              <th key={c} className={`px-4 py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</th>
            ))}
            <th className="px-4 py-2 font-medium text-left w-[26%]">Share past window</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {block.items.map((i: any) => (
            <tr key={i.id} className="hover:bg-surface-3/50 transition-colors">
              <td className="px-4 py-2.5">
                <button onClick={() => (drill ? drill(i) : onOpen(i.link))}
                  className="text-left font-medium text-ink hover:text-kadi-blue transition-colors">
                  {i.title}
                </button>
                <div className="text-[11px] text-ink-subtle">{i.owner}</div>
              </td>
              <td className="px-4 py-2.5 text-right font-num font-semibold" style={{ color: i.cells[0] ? '#B4690E' : undefined }}>
                {i.cells[0]}
              </td>
              <td className="px-4 py-2.5 text-right font-num">{i.cells[1]}</td>
              <td className="px-4 py-2.5 text-right font-num text-ink-muted">{i.cells[2].toLocaleString()}</td>
              <td className="px-4 py-2.5 text-right font-num text-ink-muted">{i.cells[3].toLocaleString()}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[60px]">
                    <div className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, i.breachRate)}%`,
                        background: i.breachRate > i.districtRate ? '#C0392B' : '#2FA8A0',
                      }} />
                  </div>
                  <span className="font-num text-[11.5px] text-ink-muted whitespace-nowrap">
                    {i.breachRate}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11.5px] text-ink-subtle border-t border-line">
        Bars are each row's share of open cases already past their window, drawn against the
        parent scope's own {block.items[0]?.districtRate}%. Teal is at or below it; red is above.
        {' '}Ordered by what falls due soonest, not by size — the largest register is always the
        largest, and visiting it every day is a habit rather than supervision.
        {' '}Max in view: {max.toLocaleString()} past window.
      </p>
    </div>
  );
}

export default function ReactPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { data: me } = useMe();
  const unit = sp.get('unit') || '';
  const district = sp.get('district') || '';
  const { data, isLoading } = useAgenda(unit ? { unit } : {});

  const caps = me?.capabilities;
  const tier: 'state' | 'district' | 'station' = data?.tier || 'state';
  const delegate = data?.framing === 'delegate';

  // The drill path, spelled out so the breadcrumb and the buttons cannot disagree about it.
  // A state officer may stand at any of the three; a district officer at two; a station
  // officer at exactly one, which is the whole point of that tier.
  const drillDistrict = (id: string) => {
    const next = new URLSearchParams(sp);
    next.set('district', id); next.delete('unit');
    setSp(next);
  };
  const drillUnit = (id: string) => {
    const next = new URLSearchParams(sp);
    next.set('unit', id);
    setSp(next);
  };
  const up = (level: 'state' | 'district') => {
    const next = new URLSearchParams(sp);
    next.delete('unit');
    if (level === 'state') next.delete('district');
    setSp(next);
  };

  const open = (l: any) => {
    if (!l) return;
    if (l.page === 'case') nav(`/cases/${l.id}`);
    else if (l.page === 'offender') nav(`/offenders/${l.id}`);
    else if (l.page === 'graph') nav(`/graph?case=${l.id}`);
    else if (l.page === 'district') drillDistrict(String(l.id));
    else if (l.page === 'map') nav('/map');
    else if (l.page === 'cases') nav(`/cases?${new URLSearchParams(l.query || {}).toString()}`);
  };

  // A plain-text brief. Police work runs on the morning crime review, and an agenda that
  // cannot leave the screen does not reach the meeting where the decisions are actually made.
  const brief = useMemo(() => {
    if (!data) return '';
    const lines = [
      `KADI — agenda for ${data.scopeName}, as at ${data.asOf}`,
      `${data.dueWeek} charge-sheets fall due within 7 days. ${data.clock.breached.toLocaleString()} cases are past their window (${data.clock.breachRate}%).`,
      '',
    ];
    for (const b of data.blocks) {
      if (!b.items?.length) continue;
      lines.push(`${b.title.toUpperCase()}`);
      for (const i of b.items) {
        lines.push(`  - [${i.when?.label || ''}] ${i.title}${i.owner ? ` (${i.owner})` : ''}`);
        lines.push(`      ${i.action}`);
        if (i.refs?.length) lines.push(`      Files: ${i.refs.map((r: any) => r.crimeNo).join(', ')}`);
        if (i.cells) lines.push(`      due 7d ${i.cells[0]} · due 21d ${i.cells[1]} · past ${i.cells[2]}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }, [data]);

  if (isLoading) return <div className="card"><Skeleton rows={10} /></div>;
  if (!data) return <Empty title="Nothing to show" hint="The agenda could not be built for this scope." />;

  const running = data.clock.critical + data.clock.soon + data.clock.ok;
  const scopeWord = tier === 'station' ? 'this register' : tier === 'district' ? 'this district' : 'the state';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Header. The breadcrumb is not decoration -- it is the only thing on the page that
          says whether you are reading your own ground or somebody else's, and the whole
          delegate framing below depends on the reader knowing which. */}
      {/* The scope badge sits at the far right of the header row, beside the page's other
          control, the way Health does it — next to the title it read as part of the title. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {(district || unit) && caps?.canViewWholeState && (
            <div className="text-[12px] text-ink-muted mb-1 flex items-center gap-1 flex-wrap">
              <button onClick={() => up('state')} className="hover:text-kadi-blue hover:underline">Karnataka</button>
              {district && <><ChevronRight size={12} className="text-line" />
                <button onClick={() => up('district')} className={unit ? 'hover:text-kadi-blue hover:underline' : 'text-ink font-medium'}>
                  {caps?.districtName || 'district'}
                </button></>}
              {unit && <><ChevronRight size={12} className="text-line" />
                <span className="text-ink font-medium">{data.scopeName}</span></>}
            </div>
          )}
          <h1 className="text-xl font-semibold text-kadi-navy flex items-center gap-2 flex-wrap">
            <Zap size={19} className="text-kadi-gold" /> React
            <InfoDot label="What this page is" align="left" width="w-96">
              <b className="block mb-1 text-kadi-navy">A diary, not a report</b>
              An item earns a place here only if it has a date by which it must be done and one
              post responsible for doing it. Everything without both lives on Health (which case
              is unhealthy), Cases (the register) or Insights (why this ground behaves as it does).
              <b className="block mt-1.5 text-kadi-navy">Why it looks different at each rank</b>
              A station reads cases, because that is the post that investigates. A district reads
              stations, because a supervisor visits one a day and reviews what is found there. The
              state reads districts, because its response to a failing investigation is to press
              the officer who owns it — not to open the file.
              <b className="block mt-1.5 text-kadi-navy">The clock</b>
              {' '}The charge-sheet window is inferred from recorded gravity: Heinous 90 days,
              otherwise 60. It runs from the earliest recorded arrest, and from registration where
              no arrest is on the file — which is every open case in this corpus. An indicator of
              the BNSS custody test, not legal advice.
              <b className="block mt-1.5 text-kadi-navy">Nothing here is predicted</b>
              All of it is recorded fact. Projections live on Forecast.
            </InfoDot>
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {delegate
              ? `What ${data.scopeName} owes this week — addressed to the officer who holds it, not to you.`
              : `What falls due in ${scopeWord}, and who owes it.`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <TierChip tier={tier} label={data.scopeName} />
          <button onClick={() => navigator.clipboard?.writeText(brief)}
            className="flex items-center gap-1.5 text-[12.5px] rounded-ctl border border-line bg-surface px-3 py-1.5 hover:bg-kadi-blue50 hover:border-kadi-blue transition-colors">
            <ClipboardCopy size={13} className="text-kadi-blue" /> Copy today's agenda
          </button>
        </div>
      </div>

      {/* The clock, as three numbers rather than one total. The old page led with 26,212 --
          a figure that measures the corpus, not the day. These three are each bounded and
          each mean something different to the officer reading them. */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4 border-l-[3px]" style={{ borderLeftColor: '#B4690E' }}>
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle">Falls due within 7 days</div>
          <div className="text-2xl font-semibold font-num text-ink mt-0.5">{data.clock.critical.toLocaleString()}</div>
          <div className="text-[12px] text-ink-muted mt-0.5">
            The work of this week. {data.clock.soon.toLocaleString()} more fall due within 21 days.
          </div>
        </div>
        <div className="card p-4 border-l-[3px]" style={{ borderLeftColor: '#2FA8A0' }}>
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle">Still inside the window</div>
          <div className="text-2xl font-semibold font-num text-ink mt-0.5">{running.toLocaleString()}</div>
          <div className="text-[12px] text-ink-muted mt-0.5">
            Of {data.clock.total.toLocaleString()} under investigation. These are the ones effort can still save.
          </div>
        </div>
        <div className="card p-4 border-l-[3px]" style={{ borderLeftColor: '#9AA8B8' }}>
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle">Past the window</div>
          <div className="text-2xl font-semibold font-num text-ink-muted mt-0.5">{data.clock.breached.toLocaleString()}</div>
          <div className="text-[12px] text-ink-muted mt-0.5">
            {data.clock.breachRate}% of open cases — a standing debt, deliberately not counted as today's work.
          </div>
        </div>
      </div>

      {data.insight && (
        <div className="rounded-card border border-kadi-blue/25 bg-kadi-blue50/40 px-4 py-3 flex items-start gap-2.5">
          <Sparkles size={15} className="text-kadi-blue shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-kadi-blue mb-0.5 flex items-center gap-1.5">
              Today, in one paragraph <AiProvenanceInfo source={data.insightSource} />
            </div>
            <p className="text-[13px] text-ink leading-relaxed">{data.insight}</p>
          </div>
        </div>
      )}

      {data.blocks.map((b: any) => {
        const Icon = BLOCK_ICON[b.key] || Zap;
        const empty = !b.items?.length;
        // Station and district rows drill rather than navigate: reading a district means
        // reading the district's agenda, which is exactly what the reader asked for by
        // clicking a district.
        const drillFor = (i: any) => {
          if (b.kind === 'station' && i.link?.query?.unit) return () => drillUnit(String(i.link.query.unit));
          if (b.kind === 'district' && i.link?.page === 'district') return () => drillDistrict(String(i.link.id));
          return undefined;
        };
        return (
          <Section key={b.key}
            title={<span className="flex items-center gap-2"><Icon size={15} className="text-kadi-blue" />{b.title}</span>}
            action={!empty && <span className="text-[11.5px] text-ink-subtle font-num">{b.total} item{b.total === 1 ? '' : 's'}</span>}
          >
            <p className="px-4 pt-3 text-[12.5px] text-ink-muted leading-relaxed">{b.subtitle}</p>
            {empty ? (
              <div className="px-4 py-5 flex items-start gap-2 text-[13px] text-ink-muted">
                <CheckCircle2 size={15} className="text-kadi-teal shrink-0 mt-0.5" />
                <span>{b.clearedNote}</span>
              </div>
            ) : b.kind === 'board' ? (
              <div className="mt-3">
                <Board block={b} onOpen={open}
                  drill={tier === 'district' ? (i: any) => drillUnit(String(i.link.query.unit))
                    : tier === 'state' ? (i: any) => drillDistrict(String(i.link.id)) : undefined} />
              </div>
            ) : (
              <div className="divide-y divide-line mt-2">
                {b.items.map((i: any) => (
                  <Row key={i.id} item={i} onOpen={open} drill={drillFor(i)} />
                ))}
              </div>
            )}
          </Section>
        );
      })}

      <p className="text-[11.5px] text-ink-subtle leading-relaxed">{data.basis}</p>
    </motion.div>
  );
}
