// The phone's picture row (issue #111). At the low height of the sheet, one
// row of frames floats over the bottom of the map, one wide frame in the
// middle and its neighbours at the edges. The frame in the middle lifts its
// pin, and the lift follows the swipe. The owner chose this layout from a
// prototype (variant A, the branch `prototype/111-phone-strip`).
//
// What the row holds, and in what order, is the desktop strip's rule
// (src/state/strip.ts). The rules here are only the phone's: which frame is
// in the middle, what a pin tap does, and when the map must pan. They are
// pure, so the tests load them without a DOM. This module imports nothing.

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

/** Whether the row shows: on a phone, at the low height, with no site open.
 *  An open site's peek takes the low height, and the list covers the map at
 *  the other heights. */
export function rowShown(s: {
  phone: boolean;
  sheet: SheetHeight;
  dragging: boolean;
  siteOpen: boolean;
}): boolean {
  return s.phone && s.sheet === 'low' && !s.dragging && !s.siteOpen;
}

/** A pin tap while the row shows. The first tap lifts the pin and brings its
 *  frame to the middle. A tap on the lifted pin opens the site. A pin with no
 *  frame, or a tap while the row is away, opens the site as before. */
export function pinTap(s: {
  sheet: SheetHeight;
  siteOpen: boolean;
  /** Whether the row has a frame for this pin. */
  inRow: boolean;
  lifted: string | null;
  id: string;
}): 'lift' | 'open' {
  if (s.sheet !== 'low' || s.siteOpen || !s.inRow) return 'open';
  return s.lifted === s.id ? 'open' : 'lift';
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
