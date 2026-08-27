// Popover — one positioning and dismissal primitive for every floating panel in the app.
//
// WHY A PORTAL, AND NOT A BIGGER Z-INDEX.
//
// Every popover here used to be `position: absolute` inside its trigger's own subtree, which
// loses to its ancestors twice over and cannot be argued out of either loss:
//
//   OVERFLOW CLIPS.  `main` is overflow-auto and six cards are overflow-hidden. The clearest
//   case was the intelligence band: collapsed, that card is about forty pixels tall with
//   overflow-hidden on it, so its (i) panel was guillotined to a sliver. Expand the band and
//   the same panel worked, because the box around it had grown. Nothing was ever wrong with
//   the panel.
//
//   STACKING CONTEXTS SCOPE Z-INDEX.  z-50 means "fiftieth among my siblings, inside my
//   stacking context" -- not "above the page". A z-50 panel inside a z-20 header can never
//   paint over a z-30 element outside it, and raising the number changes nothing. The header
//   here is a flex item with z-20, which is a stacking context even though it is not
//   positioned, and that is not obvious from reading the markup.
//
// Rendering into document.body sidesteps both: no ancestor left to clip it, one stacking
// context left to sort in. The cost is that the panel is no longer a DOM descendant of its
// trigger, so hover and outside-click have to be taught that the two are one region -- which
// is what usePopover does below, and is also the fix for menus vanishing as you reach for them.
import { ReactNode, MutableRefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Above the shell's header (z-20) and everything any page sets. One number, one place, so the
// next panel does not start another bidding war.
export const POPOVER_Z = 9000;

type Side = 'top' | 'bottom';
type Align = 'start' | 'end' | 'center';

/**
 * Open state, both refs, and the dismissal rules shared by every floating panel.
 *
 * TWO WAYS OPEN, AND THEY BEHAVE DIFFERENTLY. Hovering opens a panel loosely: leave and it
 * goes. CLICKING PINS IT -- after a click the pointer is free to go anywhere, and only an
 * outside click, Escape, or clicking the trigger again will close it. That distinction is the
 * whole point: a panel you deliberately opened should still be there when you reach for what
 * is inside it, and one you merely brushed past should not linger.
 *
 * The grace period covers the dead space between a trigger and its panel. Panels sit a few
 * pixels clear of their triggers, so travelling from one to the other crosses ground that
 * belongs to neither, and closing on the instant of leaving dismisses the menu on the way to
 * it. Entering either element cancels a pending close, which is the part that was broken:
 * the account menu spread its hover handlers and then overwrote onMouseEnter with its own,
 * so nothing ever cancelled the timer and the menu closed a quarter-second after you reached
 * for Sign out.
 */
export function usePopover({ leaveDelay = 300 }: { leaveDelay?: number } = {}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(false);
  const openRef = useRef(false);
  openRef.current = open;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const close = useCallback(() => {
    cancel(); pinned.current = false; setOpen(false);
  }, [cancel]);

  const openNow = useCallback(() => { cancel(); setOpen(true); }, [cancel]);

  const scheduleClose = useCallback(() => {
    if (pinned.current) return;   // deliberately opened: the pointer leaving means nothing
    cancel();
    timer.current = setTimeout(() => setOpen(false), leaveDelay);
  }, [cancel, leaveDelay]);

  // Closed -> open and pinned. Open by hover -> pinned, and stays. Open and pinned -> closed.
  const toggle = useCallback(() => {
    cancel();
    if (openRef.current && pinned.current) { pinned.current = false; setOpen(false); }
    else { pinned.current = true; setOpen(true); }
  }, [cancel]);

  useEffect(() => {
    if (!open) { cancel(); return undefined; }
    // BOTH refs count as inside. The panel is portalled to body, so without the second check
    // every click on a menu item would read as an outside click and close the menu before the
    // item's own handler ran.
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // mousedown rather than click: click fires after the press completes and loses the race
    // against a menu item that navigates away.
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, cancel]);

  useEffect(() => cancel, [cancel]);

  return {
    open,
    anchorRef,
    panelRef,
    toggle,
    close,
    openNow,
    scheduleClose,
    isPinned: () => pinned.current,
    /** For a trigger that opens on hover. */
    hoverProps: { onMouseEnter: openNow, onMouseLeave: scheduleClose },
    /** For a trigger that opens on click: hovering it must still hold an open panel. */
    holdProps: { onMouseEnter: cancel, onMouseLeave: scheduleClose },
    /** Always on the panel, so the pointer moving into it counts as staying. */
    panelProps: { onMouseEnter: cancel, onMouseLeave: scheduleClose },
  };
}

/**
 * The panel itself: fixed-position, measured against the anchor, rendered into document.body.
 *
 * Flips to the other side of the anchor when the preferred side has no room, and is clamped
 * into the viewport on both axes -- these annotate table headers and footer rows, which is
 * exactly where a panel opens off the edge of the screen.
 */
export function Popover({
  open, anchorRef, panelRef, side = 'bottom', align = 'end', gap = 6,
  matchAnchorWidth = false, className = '', style, children, ...rest
}: {
  open: boolean;
  anchorRef: MutableRefObject<HTMLElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  side?: Side;
  align?: Align;
  gap?: number;
  matchAnchorWidth?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const [box, setBox] = useState<{ top: number; left: number; maxHeight: number; minWidth: number } | null>(null);

  const place = useCallback(() => {
    const a = anchorRef.current?.getBoundingClientRect();
    const p = panelRef.current;
    if (!a || !p) return;
    const M = 8;                                   // never touch the window edge
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = p.offsetWidth;
    const ph = p.offsetHeight;
    const roomBelow = vh - a.bottom - gap - M;
    const roomAbove = a.top - gap - M;

    // Flip only when the preferred side genuinely cannot hold the panel AND the other side is
    // roomier. Flipping on the first pixel of overflow makes panels jump about while reading.
    const preferTop = side === 'top';
    const cramped = preferTop ? roomAbove < ph : roomBelow < ph;
    const otherBetter = preferTop ? roomBelow > roomAbove : roomAbove > roomBelow;
    const useTop = preferTop !== (cramped && otherBetter);

    const maxHeight = Math.max(140, useTop ? roomAbove : roomBelow);
    const h = Math.min(ph, maxHeight);
    let top = useTop ? a.top - gap - h : a.bottom + gap;
    top = Math.max(M, Math.min(top, vh - M - h));

    const w = matchAnchorWidth ? Math.max(pw, a.width) : pw;
    let left = align === 'start' ? a.left
      : align === 'center' ? a.left + a.width / 2 - w / 2
        : a.right - w;
    left = Math.max(M, Math.min(left, vw - M - w));

    setBox((b) => (b && b.top === top && b.left === left && b.maxHeight === maxHeight && b.minWidth === w
      ? b : { top, left, maxHeight, minWidth: matchAnchorWidth ? a.width : 0 }));
  }, [align, gap, side, matchAnchorWidth, anchorRef, panelRef]);

  useLayoutEffect(() => {
    if (!open) { setBox(null); return undefined; }
    place();
    // Capture phase, because the scroll that moves these is usually `main`'s and not the
    // window's -- a bubbling listener on window never hears it.
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    // Content that arrives late (an async panel) changes the height after the first measure.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
    };
  }, [open, place, panelRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{
        position: 'fixed',
        top: box?.top ?? 0,
        left: box?.left ?? 0,
        maxHeight: box?.maxHeight,
        minWidth: box?.minWidth || undefined,
        overflowY: 'auto',
        zIndex: POPOVER_Z,
        // Hidden for the one frame between mounting (so it can be measured) and being placed.
        // Without this it flashes at the top-left corner of the window first.
        visibility: box ? 'visible' : 'hidden',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
