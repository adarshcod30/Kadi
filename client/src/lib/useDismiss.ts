import { useEffect, useRef } from 'react';

// Close-on-hover-out / outside-click / Escape for popovers.
//
// Every dropdown in the shell was a bare useState toggle, so the only way to close one was to
// click the exact button that opened it. Open the role menu, then the alerts panel, then the
// district switcher, and all three stayed on screen stacked over the page.
//
// Attach `ref` to the element that wraps BOTH the trigger and the panel -- if it wraps only
// the panel, the click that opens it registers as an outside click on the way back up and the
// menu closes instantly on open. Spread `hoverProps` onto that same element.
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  { closeOnLeave = false, leaveDelay = 260 }: { closeOnLeave?: boolean; leaveDelay?: number } = {},
) {
  const ref = useRef<T>(null);
  // Held in a ref so an inline `() => setOpen(false)` does not re-subscribe on every render.
  const cb = useRef(onClose);
  cb.current = onClose;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  useEffect(() => {
    if (!open) { cancel(); return undefined; }
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

  // Stop a pending close from firing after the component goes away.
  useEffect(() => cancel, []);

  // Closing the instant the pointer leaves is too twitchy to use: the panel sits a few pixels
  // clear of its trigger, so travelling from the button to the menu crosses dead space and
  // would dismiss the menu on the way to it. The short grace period covers that crossing --
  // re-entering cancels the pending close -- while still shutting the menu the moment the
  // pointer genuinely moves away.
  //
  // Hover is a mouse affordance only. Touch fires no mouseleave, so outside-tap (above)
  // remains the way these close on a phone.
  const hoverProps = closeOnLeave
    ? {
      onMouseEnter: cancel,
      onMouseLeave: () => {
        cancel();
        timer.current = setTimeout(() => cb.current(), leaveDelay);
      },
    }
    : {};

  return { ref, hoverProps, cancelClose: cancel };
}
