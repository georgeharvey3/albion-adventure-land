import { haversine, type LatLng } from '../geo/haversine';
import { isSpeckZoom } from '../map/zoomScale';
import type { Site } from '../data/types';

// The strip (issue #89): the desktop shell's Nearby. It shows the sites that
// the map shows, in the part of the map the user can see, nearest first.
//
// Pure, so the rules are tested without a map:
// - The sites come from `matchesFilter` (the filtered list), so a hidden layer
//   is out of the strip as it is off the map.
// - The order is distance from the anchor. With no anchor, it is distance from
//   the centre of the view. That point is derived from the view on each call
//   and never stored, and the trip and the journey never see it.
// - Below the speck zoom a pin takes no tap, and the strip shows no frames.
// - With a destination, the strip is the journey list: the sites along the
//   way, in the journey order, at every zoom.

// The shapes of FilteredSiteView and SiteView (selectors.ts), spelt out here
// so this module stays free of the store and runs under `npm test`.
interface FilteredSiteView {
  site: Site;
  visited: boolean;
  wishlisted: boolean;
}

export interface SiteView extends FilteredSiteView {
  distance: number | null;
  detour: number | null;
  progress: number | null;
}

/** The part of the map the user can see, as the map last reported it on
 *  `moveend`. The box leaves out the covered insets. */
export interface Viewport {
  box: { south: number; west: number; north: number; east: number };
  centre: LatLng;
  zoom: number;
}

export type Strip =
  | { kind: 'zoomIn' }
  | {
      kind: 'sites';
      /** What the order is measured from. */
      from: 'anchor' | 'centre' | 'journey';
      views: SiteView[];
    };

export function stripSites({
  filtered,
  journey,
  anchor,
  viewport,
}: {
  filtered: readonly FilteredSiteView[];
  /** The along-the-way list when a destination is set, else null. */
  journey: SiteView[] | null;
  anchor: LatLng | null;
  viewport: Viewport | null;
}): Strip {
  if (journey) return { kind: 'sites', from: 'journey', views: journey };
  const from = anchor ? 'anchor' : 'centre';
  if (!viewport) return { kind: 'sites', from, views: [] };
  if (isSpeckZoom(viewport.zoom)) return { kind: 'zoomIn' };

  const { south, west, north, east } = viewport.box;
  const origin = anchor ?? viewport.centre;
  const inView: { view: FilteredSiteView; metres: number }[] = [];
  for (const view of filtered) {
    const { lat, lng } = view.site;
    if (lat < south || lat > north || lng < west || lng > east) continue;
    inView.push({ view, metres: haversine(origin, view.site) });
  }
  inView.sort((a, b) => a.metres - b.metres || a.view.site.name.localeCompare(b.view.site.name));
  return {
    kind: 'sites',
    from,
    views: inView.map(({ view, metres }) => ({
      ...view,
      // A distance from the map centre means nothing to the user.
      distance: anchor ? metres : null,
      detour: null,
      progress: null,
    })),
  };
}

/** Frames rendered at a time. A view at z7 can hold about 3000 sites, and a
 *  React render of all of them on each `moveend` is too slow. The strip adds
 *  one more window when the user scrolls near its end. */
export const STRIP_WINDOW = 60;

/** The number of frames to render so that frame `index` exists. */
export function windowToShow(index: number): number {
  return (Math.floor(index / STRIP_WINDOW) + 1) * STRIP_WINDOW;
}
