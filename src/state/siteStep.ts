// The step between open sites on a phone (issue #113). The desktop spread has
// Prev and Next; the phone sheet has a sideways swipe.
//
// - A swipe on a picture moves the picture (the carousel owns it). A swipe on
//   any other part of the open site steps to the next or the previous site.
//   A swipe to the left goes to the next site, as a page turns.
// - The order is the phone's Nearby list: nearest first, or the journey order
//   with a destination. The phone has no strip since #111 was reverted.
// - The order is frozen when a site opens, so live GPS does not re-sort the
//   list under the user. The steps stop at both ends, as on the desktop.
// - A step goes only to a site the filter shows now, so a layer turned off
//   while a site is open drops out of the steps.
//
// Pure, and it imports nothing, so the tests load it without a DOM.

/** How far, in px, a finger travels sideways before a swipe counts. */
export const SWIPE_MIN = 56;

/** A swipe must be this many times wider than it is tall, so a scroll that
 *  drifts sideways never steps. */
export const SWIPE_RATIO = 2;

/** A drag slower than this, in ms, is a read or a text selection, not a
 *  swipe. */
export const SWIPE_MAX_MS = 800;

/** The step a finished touch asks for: 1 for the next site, -1 for the
 *  previous one, or null. `dx` and `dy` are the travel from the touch start
 *  to its end, in px. */
export function swipeStep(touch: { dx: number; dy: number; ms: number }): 1 | -1 | null {
  const { dx, dy, ms } = touch;
  if (ms > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN) return null;
  if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}

/** The site a step goes to, or null at an end. `order` is the list frozen
 *  when the site opened; `shown` is what the filter shows now. A site that
 *  is not in the order, one that the map search opened, steps into it at the
 *  first site, as `stripNeighbours` does. */
export function siteStep(
  order: readonly string[],
  shown: ReadonlySet<string>,
  current: string,
  dir: 1 | -1,
): string | null {
  const ids = order.filter((id) => id === current || shown.has(id));
  const index = ids.indexOf(current);
  if (index < 0) return dir === 1 ? (ids[0] ?? null) : null;
  return ids[index + dir] ?? null;
}
