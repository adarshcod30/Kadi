// One dropdown for the whole app.
//
// The three popovers in the shell close on hover-out, but every filter control on every page
// was a native <select> -- and a native select's popup is drawn by the operating system, not
// the page. No JavaScript can dismiss it, so it stays open until the OS decides otherwise.
// That is why only "a few dropdowns" behaved: the rest were never ours to control.
//
// This is a drop-in replacement with the same value/onChange/options shape, rendered in the
// page so it obeys the same dismissal rules as everything else -- outside click, Escape -- and
// looks identical across macOS, Windows and Linux instead of inheriting three native widgets.
//
// The list is portalled. Filter rows live inside cards, and half the cards in this app are
// overflow-hidden, so a 31-district list opened inside one was being cut off at the card's
// edge. It also means the list stays open once clicked: it is pinned until you choose an
// option, click outside, or press Escape, rather than closing because the pointer drifted.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, usePopover } from '../lib/Popover';

export type Option = { value: string; label: string };

export function Select({ value, onChange, options, className = '', placeholder, title, disabled }: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const p = usePopover();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? '';

  // Flipping and clamping are Popover's job now -- it measures the real panel rather than
  // guessing its height from the option count, which is what this had to do from here.
  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    p.toggle();
  };
  const open = p.open;

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    if (!open || !p.panelRef.current) return;
    p.panelRef.current.querySelectorAll('[data-opt]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open, p.panelRef]);

  const commit = (v: string) => { onChange(v); p.close(); btnRef.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) commit(options[active].value); }
    else if (e.key === 'Tab') p.close();
  };

  return (
    <div className={className}>
      <button ref={mergeRefs(btnRef, p.anchorRef)} type="button" title={title || label} disabled={disabled}
        onClick={openMenu} {...p.holdProps} onKeyDown={onKeyDown}
        aria-haspopup="listbox" aria-expanded={open}
        className={`input w-full flex items-center gap-2 text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
          open ? 'border-kadi-blue' : ''}`}>
        <span className={`truncate flex-1 min-w-0 ${selected && selected.value ? 'text-ink' : 'text-ink-muted'}`}>{label}</span>
        <ChevronDown size={14} className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <Popover open={open} anchorRef={p.anchorRef} panelRef={p.panelRef}
        side="bottom" align="start" gap={4} matchAnchorWidth {...p.panelProps}
        role="listbox" tabIndex={-1}
        className="pop-in w-max max-w-[min(20rem,80vw)] bg-surface border border-line rounded-card shadow-xl py-1"
        style={{ maxHeight: 256 }}>
        <>
          {options.map((o, i) => {
            const isSel = o.value === value;
            return (
              <button key={o.value} data-opt type="button" role="option" aria-selected={isSel}
                onClick={() => commit(o.value)} onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                  i === active ? 'bg-kadi-blue50' : ''} ${isSel ? 'text-kadi-blue font-medium' : 'text-ink'}`}>
                <span className="truncate flex-1">{o.label}</span>
                {isSel && <Check size={13} className="shrink-0" />}
              </button>
            );
          })}
        </>
      </Popover>
    </div>
  );
}

// The trigger is both the keyboard-focus target and the popover's measuring anchor, and those
// are two different refs wanting the same element.
function mergeRefs<T>(...refs: (React.MutableRefObject<T | null> | React.RefObject<T>)[]) {
  return (node: T | null) => {
    refs.forEach((r) => { (r as React.MutableRefObject<T | null>).current = node; });
  };
}
