import { useMemo } from 'react';
import type { Site } from '../data/types';
import { haversine } from '../geo/haversine';
import { useStore, type Position } from './store';

export interface FilteredSiteView {
  site: Site;
  visited: boolean;
  wishlisted: boolean;
}

export interface SiteView extends FilteredSiteView {
  distance: number | null; // metres from current position, null if unknown
}

/** Sites passing the active type filter, annotated with visited/wishlist state.
 *  Deliberately position-independent: the map's markers consume this, so live
 *  GPS ticks never invalidate it (rebuilding thousands of markers per fix is
 *  what made mobile unusable). */
export function useFilteredSites(): FilteredSiteView[] {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const visited = useStore((s) => s.visited);
  const wishlist = useStore((s) => s.wishlist);

  return useMemo(() => {
    const views: FilteredSiteView[] = [];
    for (const site of sites) {
      if (!activeTypes.has(site.category)) continue;
      views.push({
        site,
        visited: site.id in visited,
        wishlisted: wishlist.has(site.id),
      });
    }
    return views;
  }, [sites, activeTypes, visited, wishlist]);
}

/** The filtered sites annotated with distance, sorted nearest-first when a
 *  position is known (else alphabetically). Built on top of useFilteredSites
 *  so only the cheap annotate+sort layer recomputes on a position change. */
export function useVisibleSites(): SiteView[] {
  const filtered = useFilteredSites();
  const position = useStore((s) => s.position);

  return useMemo(() => annotateAndSort(filtered, position), [filtered, position]);
}

function annotateAndSort(filtered: FilteredSiteView[], position: Position | null): SiteView[] {
  const views: SiteView[] = filtered.map((v) => ({
    ...v,
    distance: position ? haversine(position, v.site) : null,
  }));
  views.sort((a, b) => {
    if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
    return a.site.name.localeCompare(b.site.name);
  });
  return views;
}
