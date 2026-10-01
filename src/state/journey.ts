// How much of the journey a phone's pill shows (issue #126).
//
// The bar used to sit in the sheet head at every height, and most of the time
// it said "My location → Optional", two lines that told the user nothing. On a
// phone it is now the pill at the top of the map, in place of the layer
// chips, and it shows by state:
//
// - none:    live GPS, no destination, no armed map tap. The pill reads
//            "Search here", and its route button opens the full bar, so
//            either end can still be searched for or picked on the map.
// - compact: a destination, or an origin that is not live GPS. One line that
//            opens the full bar. An overridden origin must never hide: the
//            near-me list sorts from it, and a forgotten dropped pin would
//            make the list quietly wrong in the field.
// - full:    an armed map tap (the bar is its own cancel), or the user opened
//            the bar with the route button or the compact line. The bar
//            opens inside the pill, where it was tapped.
//
// The side panel and the desktop have room, and always show the full bar.

export type JourneyBarMode = 'none' | 'compact' | 'full';

export interface JourneyState {
  /** The origin is a searched place or a dropped pin, not live GPS. */
  overriddenOrigin: boolean;
  hasDestination: boolean;
  /** The map waits for a tap to fill one end. */
  picking: boolean;
}

/** Whether the journey differs from "near me now". */
export function journeyActive(s: JourneyState): boolean {
  return s.overriddenOrigin || s.hasDestination || s.picking;
}

export function journeyBarMode(
  s: JourneyState,
  phone: boolean,
  expanded: boolean,
): JourneyBarMode {
  if (!phone || s.picking) return 'full';
  if (expanded) return 'full';
  return journeyActive(s) ? 'compact' : 'none';
}
