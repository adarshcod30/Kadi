// InfoDot — the one place explanatory copy lives.
//
// Methodology notes, fairness statements and provenance footers were printed inline on every
// surface that needed them. Each was worth saying once, but rendered permanently they pushed
// the actual findings down the page and turned each screen into a wall of small grey text --
// and the reader who most needed the explanation had already scrolled past it.
//
// So the copy moves behind an (i): present on the element it describes, silent until asked,
// and never competing with the data for the same space. Hover reveals, moving away hides,
// keyboard focus works the same way.
import { ReactNode, useRef, useState } from 'react';
import { Info } from 'lucide-react';

type Align = 'left' | 'right' | 'center';

export function InfoDot({ children, align = 'right', size = 13, className = '', label = 'More information', width = 'w-72' }: {
  children: ReactNode;
  align?: Align;
  size?: number;
  className?: string;
  label?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    // Flip above the icon when it sits low in the viewport, or the panel opens off-screen --
    // which is exactly where these end up, since they annotate footers and table headers.
    const r = ref.current?.getBoundingClientRect();
    if (r) setUp(window.innerHeight - r.bottom < 200);
    setOpen(true);
  };

  const pos = align === 'left' ? 'left-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0';

  return (
    <span ref={ref} className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} tabIndex={0}
        onFocus={show} onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open) setOpen(false); else show(); }}
        className="inline-flex items-center text-ink-muted hover:text-kadi-blue focus:text-kadi-blue outline-none cursor-help">
        <Info size={size} />
      </button>
      {open && (
        <span
          className={`absolute z-50 ${pos} ${up ? 'bottom-6' : 'top-6'} ${width} card p-2.5 shadow-lg
            text-[12px] leading-relaxed text-ink font-normal normal-case tracking-normal text-left`}>
          {children}
        </span>
      )}
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
