import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useVisibleSites } from '../state/selectors';
import { siteStep, swipeStep } from '../state/siteStep';

// The step between open sites in the phone sheet (issue #113): a swipe, or
// the arrows in the peek. The rules are in state/siteStep.ts. This component
// holds the frozen order, tells the app the sites either side for the arrows,
// and feeds the swipe rule the finger.
//
// It listens on the whole sheet, so the peek and the body both take the
// swipe, at every height. It leaves a touch alone that starts on a picture,
// on a field, or on anything else that scrolls sideways: those own the
// sideways move. useSheetDrag already leaves a sideways touch to the list, so
// the two never take the same gesture.
//
// It is a component that renders nothing, mounted while a site is open. So
// the sort of the Nearby list on each GPS fix re-renders it alone and not the
// whole app, and the order it freezes on mount is the order when the site
// opened.

/** A touch that starts in one of these is never a step. */
const OWN_SWIPE = ['.spread-lead', 'input', 'textarea', 'select', '[contenteditable]'].join(',');

/** Whether the touch target owns a sideways move: a picture, a field, or
 *  anything up to the sheet that scrolls sideways. */
function ownsSwipe(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(OWN_SWIPE)) return true;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflow = getComputedStyle(el).overflowX;
    if (overflow === 'auto' || overflow === 'scroll') return true;
  }
  return false;
}

export function SiteSwipe({
  sheetRef,
  siteId,
  onNeighbours,
  onSwipe,
}: {
  sheetRef: RefObject<HTMLElement | null>;
  siteId: string;
  /** The sites a step goes to, for the arrows in the peek. Null at an end. */
  onNeighbours: (prev: string | null, next: string | null) => void;
  /** A swipe: 1 for the next site, -1 for the previous one. */
  onSwipe: (dir: 1 | -1) => void;
}): null {
  const views = useVisibleSites();
  const shown = useMemo(() => new Set(views.map((v) => v.site.id)), [views]);

  // The order, frozen when the site opened. A step keeps it, so the list
  // never re-sorts under the user.
  const [order] = useState(() => views.map((v) => v.site.id));

  const prev = siteStep(order, shown, siteId, -1);
  const next = siteStep(order, shown, siteId, 1);
  useEffect(() => onNeighbours(prev, next), [prev, next, onNeighbours]);

  // The listener is added once, so it reads this through a ref.
  const live = useRef(onSwipe);
  live.current = onSwipe;

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;

    const onStart = (e: TouchEvent) => {
      start =
        e.touches.length === 1 && !ownsSwipe(e.target, el)
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() }
          : null;
    };
    const onMove = (e: TouchEvent) => {
      // A second finger is a pinch, not a swipe.
      if (e.touches.length !== 1) start = null;
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dir = swipeStep({ dx: t.clientX - s.x, dy: t.clientY - s.y, ms: performance.now() - s.t });
      if (dir) live.current(dir);
    };
    const onCancel = () => {
      start = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [sheetRef]);

  return null;
}
