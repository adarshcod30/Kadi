// One dropdown for the whole app.
//
// The three popovers in the shell close on hover-out, but every filter control on every page
// was a native <select> -- and a native select's popup is drawn by the operating system, not
// the page. No JavaScript can dismiss it, so it stays open until the OS decides otherwise.
// That is why only "a few dropdowns" behaved: the rest were never ours to control.
//
// This is a drop-in replacement with the same value/onChange/options shape, rendered in the
// page so it obeys the same dismissal rules as everything else -- hover-out, outside click,
// Escape -- and looks identical across macOS, Windows and Linux instead of inheriting three
// different native widgets.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useDismiss } from '../lib/useDismiss';

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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { ref, hoverProps } = useDismiss<HTMLDivElement>(open, () => setOpen(false), { closeOnLeave: true });

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? '';

  const openMenu = () => {
    // Flip upward when there is not enough room below. A filter row near the bottom of a long
    // register would otherwise open a 31-district list off the edge of the screen.
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setDropUp(window.innerHeight - r.bottom < Math.min(264, options.length * 34 + 16));
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelectorAll('[data-opt]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const commit = (v: string) => { onChange(v); setOpen(false); btnRef.current?.focus(); };

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
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={ref} {...hoverProps}>
      <button ref={btnRef} type="button" title={title || label} disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())} onKeyDown={onKeyDown}
        aria-haspopup="listbox" aria-expanded={open}
        className={`input w-full flex items-center gap-2 text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
          open ? 'border-kadi-blue' : ''}`}>
        <span className={`truncate flex-1 min-w-0 ${selected && selected.value ? 'text-ink' : 'text-ink-muted'}`}>{label}</span>
        <ChevronDown size={14} className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div ref={listRef} role="listbox" tabIndex={-1}
          className={`absolute left-0 z-50 min-w-full w-max max-w-[min(20rem,80vw)] max-h-64 overflow-auto
            bg-surface border border-line rounded-card shadow-lg py-1 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
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
        </div>
      )}
    </div>
  );
}
