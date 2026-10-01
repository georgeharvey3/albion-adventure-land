// The phone's picture row (issue #111). At the low height of the sheet, one
// row of frames floats over the bottom of the map, one wide frame in the
// middle and its neighbours at the edges. The frame in the middle lifts its
// pin, and the lift follows the swipe. The owner chose this layout from a
// prototype (variant A, the branch `prototype/111-phone-strip`).
//
// At the low height the middle card is the selected site: there is no peek
// there. A card tap opens the site at the middle height. The owner chose this
// from a second prototype (variant N, the branch `prototype/111-no-peek`),
// because a peek under the row showed one site twice.
//
// What the row holds, and in what order, is the desktop strip's rule
// (src/state/strip.ts). The rules here are only the phone's: which frame is
// in the middle, when a swipe selects a site, and when the map must pan. They
// are pure, so the tests load them without a DOM.

import type { SheetHeight } from './sheet';

/** How far, in px, a lifted pin must be inside the part of the map that
 *  shows. Nearer the edge, the map pans it in. */
export const PIN_MARGIN = 24;

/** The id of the frame whose centre is nearest the middle of the row. The
 *  frames are measured in the row's scroll coordinates. */
export function middleFrame(
  frames: readonly { id: string; left: number; width: number }[],
  scrollLeft: number,
  rowWidth: number,
): string | null {
  const middle = scrollLeft + rowWidth / 2;
  let best: string | null = null;
  let bestGap = Infinity;
  for (const f of frames) {
    const gap = Math.abs(f.left + f.width / 2 - middle);
    if (gap < bestGap) {
      bestGap = gap;
      best = f.id;
    }
  }
  return best;
}

/** Whether the row shows: on a phone, at the low height, with a site
 *  selected or not. The list or the open site covers the map at the other
 *  heights. The row stays through a drag, under the rising sheet, so the
 *  covered inset changes only when the sheet rests. */
export function rowShown(s: { phone: boolean; sheet: SheetHeight }): boolean {
  return s.phone && s.sheet === 'low';
}

/** The site that a swipe selects when it comes to rest: the middle card's.
 *  At the low height the middle card is the selected site, so a swipe steps
 *  the selection, as Prev and Next do in the desktop spread. A scroll that
 *  the row made itself (to bring a card to the middle) selects nothing. */
export function swipeSelects(s: {
  middle: string | null;
  selected: string | null;
  byUser: boolean;
}): string | null {
  if (!s.byUser || !s.middle || s.middle === s.selected) return null;
  return s.middle;
}

/** Whether a pin at `at` (map container px) shows between the floating row at
 *  the top and the band at the bottom, with PIN_MARGIN to spare. A lift from
 *  the row pans the map only when this is false. */
export function pinInSight(
  at: { x: number; y: number },
  view: { x: number; y: number },
  clear: { top: number; bottom: number },
): boolean {
  return (
    at.x >= PIN_MARGIN &&
    at.x <= view.x - PIN_MARGIN &&
    at.y >= clear.top + PIN_MARGIN &&
    at.y <= view.y - clear.bottom - PIN_MARGIN
  );
}
