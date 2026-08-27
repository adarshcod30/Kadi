// InfoDot — the one place explanatory copy lives.
//
// Methodology notes, fairness statements and provenance footers were printed inline on every
// surface that needed them. Each was worth saying once, but rendered permanently they pushed
// the actual findings down the page and turned each screen into a wall of small grey text --
// and the reader who most needed the explanation had already scrolled past it.
//
// So the copy moves behind an (i): present on the element it describes, silent until asked,
// and never competing with the data for the same space.
//
// HOVER REVEALS, A CLICK PINS. Brushing past shows the note and moving away takes it back.
// Clicking keeps it until you dismiss it, because a note you deliberately opened is one you
// intend to read -- and several of these are long enough to want a second pass, or contain a
// figure worth selecting.
//
// The panel is portalled (see Popover), which is the fix for the failure that made these
// unreliable: the note is nearly always attached to a card header, and half the cards in the
// app are overflow-hidden. Inside a collapsed intelligence band -- a strip about forty pixels
// tall -- the note was being clipped to a sliver of its first line. It looked like the note
// was broken; the box around it was.
import { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, usePopover } from '../lib/Popover';

type Align = 'left' | 'right' | 'center';
const ALIGN = { left: 'start', right: 'end', center: 'center' } as const;

export function InfoDot({ children, align = 'right', size = 13, className = '', label = 'More information', width = 'w-72' }: {
  children: ReactNode;
  align?: Align;
  size?: number;
  className?: string;
  label?: string;
  width?: string;
}) {
  const p = usePopover();

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button type="button" aria-label={label} aria-expanded={p.open} tabIndex={0}
        ref={p.anchorRef as React.RefObject<HTMLButtonElement>}
        {...p.hoverProps}
        onFocus={p.openNow} onBlur={p.scheduleClose}
        // stopPropagation because several of these sit inside a row or header that is itself
        // clickable, and asking what a column means should not also navigate away.
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); p.toggle(); }}
        className="inline-flex items-center text-ink-muted hover:text-kadi-blue focus:text-kadi-blue outline-none cursor-help">
        <Info size={size} />
      </button>
      <Popover open={p.open} anchorRef={p.anchorRef} panelRef={p.panelRef}
        side="bottom" align={ALIGN[align]} {...p.panelProps}
        className={`pop-in ${width} card p-2.5 shadow-xl text-[12px] leading-relaxed text-ink
          font-normal normal-case tracking-normal text-left`}>
        {children}
      </Popover>
    </span>
  );
}

// The fairness note, stated identically wherever it appears. It was written out by hand on
// six different surfaces and had already drifted into three different wordings.
export function FairnessInfo({ className = '' }: { className?: string }) {
  return (
    <InfoDot className={className} label="How fairness is enforced">
      <b className="block mb-1 text-kadi-navy">Behaviour and evidence only</b>
      Links and risk scores are built from what happened and what was recorded — prior cases,
      offence gravity, recency, co-offending, location and time.
      <b className="block mt-1.5 text-kadi-navy">Never used</b>
      Caste, religion and occupation. These columns exist in the KSP schema and are excluded
      from every model by construction, not by convention — a unit test fails the build if one
      appears in a feature set.
    </InfoDot>
  );
}

// Provenance for anything the model wrote. The distinction it draws is the one people ask
// about first, so it needs to be reachable from the panel itself rather than documented away.
export function AiProvenanceInfo({ source, className = '' }: { source?: string; className?: string }) {
  return (
    <InfoDot className={className} label="How this was produced">
      <b className="block mb-1 text-kadi-navy">The figures are not AI-generated</b>
      Every number, name and percentage here is computed from the records in the current view
      by deterministic code, then handed to the model as text.
      <b className="block mt-1.5 text-kadi-navy">The wording is</b>
      The model is asked only how to say it, never what is true, so it cannot invent an FIR
      number or a statistic{source ? ` · ${source}` : ''}.
      <span className="block mt-1.5 text-ink-muted">
        Findings are recomputed whenever the filter changes, so this always describes what is
        on screen.
      </span>
    </InfoDot>
  );
}
