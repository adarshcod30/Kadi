import { useEffect, useRef } from 'react';

// Close-on-outside-click / Escape for popovers.
//
// Every dropdown in the shell was a bare useState toggle, so the only way to close one was to
// click the exact button that opened it. Open the role menu, then the alerts panel, then the
// district switcher, and all three stayed on screen stacked over the page. Worse, clicking a
// menu item navigated but left the menu hanging over the new view.
//
// Attach the returned ref to the element that wraps BOTH the trigger and the panel -- if it
// wraps only the panel, the click that opens it registers as an outside click on the way back
// up and the menu closes instantly on open.
export function useDismiss<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  // Held in a ref so an inline `() => setOpen(false)` does not re-subscribe on every render.
  const cb = useRef(onClose);
  cb.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cb.current(); };
    // mousedown, not click: a click fires after the press completes, which loses the race
    // against a menu item that navigates away on its own click handler.
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return ref;
}
