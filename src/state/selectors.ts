import { useMemo } from 'react';
import type { Site } from '../data/types';
import { parseTagKey, parentOf } from '../data/types';
import { haversine, type LatLng } from '../geo/haversine';
import { corridorMetrics } from '../geo/corridor';
import { useStore, type Position, type RouteSort } from './store';

export interface FilteredSiteView {
  site: Site;
  visited: boolean;
  wishlisted: boolean;
}

export interface SiteView extends FilteredSiteView {
  distance: number | null; // metres from current position, null if unknown
  // Route mode only (a destination is set). Both null in point mode, so a
  // consumer can branch on `detour !== null` to know which mode it is in.
  detour: number | null; // extra metres versus driving straight through
  progress: number | null; // 0–1 along the journey
}

/** Sites passing the active type filter, annotated with visited/wishlist state.
 *  Deliberately position-independent: the map's markers consume this, so live
 *  GPS ticks never invalidate it (rebuilding thousands of markers per fix is
 *  what made mobile unusable). */
export function useFilteredSites(): FilteredSiteView[] {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const activeTags = useStore((s) => s.activeTags);
  const visited = useStore((s) => s.visited);
  const wishlist = useStore((s) => s.wishlist);
  const hidden = useStore((s) => s.hidden);

  return useMemo(() => {
    // Tag picks are grouped by the layer they belong to, so each site is only
    // ever tested against its own layer's tags. A layer absent from this map has
    // no tag picked and is therefore unnarrowed.
    const tagsByParent = new Map<string, Set<string>>();
    for (const key of activeTags) {
      const { parent, tag } = parseTagKey(key);
      const set = tagsByParent.get(parent);
      if (set) set.add(tag);
      else tagsByParent.set(parent, new Set([tag]));
    }

    const views: FilteredSiteView[] = [];
    for (const site of sites) {
      if (!activeTypes.has(site.category)) continue;
      if (hidden.has(site.id)) continue; // user-hidden: off the map and lists
      const wanted = tagsByParent.get(parentOf(site.category));
      // Any one of the layer's picked tags is enough (OR). A site with no tags
      // cannot match, so it drops out while its layer is narrowed.
      if (wanted && !site.tags?.some((t) => wanted.has(t))) continue;
      views.push({
        site,
        visited: site.id in visited,
        wishlisted: wishlist.has(site.id),
      });
    }
    return views;
  }, [sites, activeTypes, activeTags, visited, wishlist, hidden]);
}

/** The filtered sites annotated with distance, sorted nearest-first when a
 *  position is known (else alphabetically). Built on top of useFilteredSites
 *  so only the cheap annotate+sort layer recomputes on a position change.
 *
 *  With a destination set (issue #14) the same hook reinterprets itself as a
 *  corridor query: only sites within the detour budget survive, and they come
 *  back in travel order (or least-detour order) annotated with both corridor
 *  numbers. With no destination this is byte-for-byte the old behaviour. */
export function useVisibleSites(): SiteView[] {
  const filtered = useFilteredSites();
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const detourBudget = useStore((s) => s.detourBudget);
  const routeSort = useStore((s) => s.routeSort);

  return useMemo(() => {
    if (!position || !destination) return annotateAndSort(filtered, position);
    return corridorSites(filtered, position, destination, detourBudget, routeSort);
  }, [filtered, position, destination, detourBudget, routeSort]);
}

function annotateAndSort(filtered: FilteredSiteView[], position: Position | null): SiteView[] {
  const views: SiteView[] = filtered.map((v) => ({
    ...v,
    distance: position ? haversine(position, v.site) : null,
    detour: null,
    progress: null,
  }));
  views.sort((a, b) => {
    if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
    return a.site.name.localeCompare(b.site.name);
  });
  return views;
}

// Route mode: keep the sites the journey can afford, in the order you would
// drive past them. Three haversines per site and no allocation beyond the
// survivors — the same cost profile as the point-mode sort, so the list stays
// live while the budget slider moves.
function corridorSites(
  filtered: FilteredSiteView[],
  from: LatLng,
  to: LatLng,
  budget: number,
  sort: RouteSort,
): SiteView[] {
  const views: SiteView[] = [];
  for (const v of filtered) {
    const { detour, progress } = corridorMetrics(v.site, from, to);
    if (detour > budget) continue;
    views.push({ ...v, distance: haversine(from, v.site), detour, progress });
  }
  views.sort((a, b) =>
    sort === 'detour'
      ? a.detour! - b.detour! || a.progress! - b.progress!
      : a.progress! - b.progress! || a.detour! - b.detour!,
  );
  return views;
}
