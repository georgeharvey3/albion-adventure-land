import type { Site, SiteCategory } from '../data/types';
import { haversine, type LatLng } from './haversine';

// Outing search (spec §7.2): find the nearest "full house" — exactly one site
// of each selected type. There is NO proximity cap: as long as each selected
// type has an available site, a cluster exists. The cluster returned minimises
// (distance from anchor + spread around the seed), so tight nearby groups beat
// sprawling ones without any hard cutoff. Pure and dependency-free so it runs
// offline and is testable without a DOM. O(|pool|²) worst case — trivial at
// ~1.2k sites.

export interface OutingCluster {
  seed: Site;
  /** Exactly one site per selected type — the nearest of each around the
   *  seed, which is itself a member. Unordered — route order comes from
   *  tsp.ts. */
  members: Site[];
  /** haversine(anchor, seed) — the "how far is this outing" number. */
  distanceFromAnchor: number;
  /** Max seed→member distance — the cluster's spread, shown to the user so a
   *  sprawling result is visible for what it is. */
  radiusM: number;
}

/**
 * Find the nearest full-house cluster: exactly one site of each selected
 * type. `pool` must already reflect the visited/unvisited choice; this
 * function additionally filters to `types`. `excludeMemberIds` implements
 * "find another": any candidate cluster sharing a member with a previously
 * shown cluster is skipped.
 *
 * Every candidate seed is scored as
 *   cost = haversine(anchor, seed) + Σ haversine(seed, nearest-of-each-type)
 * and the cheapest wins (id tie-break, so results are deterministic). Returns
 * null only when a selected type has nothing in the pool (see nearestPerType
 * for the per-type diagnostics) or "find another" has run out of disjoint
 * alternatives.
 */
export function findNearestOuting(
  anchor: LatLng,
  types: ReadonlySet<SiteCategory>,
  pool: Site[],
  excludeMemberIds: ReadonlySet<string> = new Set(),
): OutingCluster | null {
  const candidates = pool
    .filter((s) => types.has(s.category))
    .map((site) => ({ site, d: haversine(anchor, site) }))
    .sort((a, b) => a.d - b.d || a.site.id.localeCompare(b.site.id));

  // A type with nothing available means no seed can ever cover the selection.
  const present = new Set(candidates.map((c) => c.site.category));
  for (const t of types) if (!present.has(t)) return null;

  let best: { seed: Site; d: number; members: Site[]; cost: number } | null = null;

  for (const { site: seed, d } of candidates) {
    // Anchor-outward order gives an exact cutoff: spread cost is ≥ 0, so a
    // seed farther away than the best total cost can never win (strict, so a
    // zero-spread tie can still take the id tie-break).
    if (best && d > best.cost) break;

    // Nearest site of each selected type to this seed (the seed covers its
    // own type at distance 0). Deterministic via distance-then-id tie-break.
    const perType = new Map<SiteCategory, { site: Site; ds: number }>();
    for (const { site } of candidates) {
      const ds = haversine(seed, site);
      const cur = perType.get(site.category);
      if (!cur || ds < cur.ds || (ds === cur.ds && site.id < cur.site.id)) {
        perType.set(site.category, { site, ds });
      }
    }

    const members = [...perType.values()].map((m) => m.site);
    if (members.some((m) => excludeMemberIds.has(m.id))) continue;

    const cost = d + [...perType.values()].reduce((sum, m) => sum + m.ds, 0);
    if (!best || cost < best.cost || (cost === best.cost && seed.id < best.seed.id)) {
      best = { seed, d, members, cost };
    }
  }

  if (!best) return null;

  const { seed, d, members } = best;
  const radiusM = Math.max(...members.map((m) => haversine(seed, m)));
  return { seed, members, distanceFromAnchor: d, radiusM };
}

export interface TypeNearest {
  type: SiteCategory;
  /** Nearest pool site of this type to the anchor; null when the pool has
   *  none at all (e.g. every one is already visited). */
  site: Site | null;
  distance: number | null;
}

/** Per-type diagnostics for the failure state: which selected types have
 *  nothing available (site: null) — the only way a search can fail. */
export function nearestPerType(
  anchor: LatLng,
  types: ReadonlySet<SiteCategory>,
  pool: Site[],
): TypeNearest[] {
  const result: TypeNearest[] = [];
  for (const type of types) {
    let best: Site | null = null;
    let bestD = Infinity;
    for (const site of pool) {
      if (site.category !== type) continue;
      const d = haversine(anchor, site);
      if (d < bestD) {
        best = site;
        bestD = d;
      }
    }
    result.push({ type, site: best, distance: best ? bestD : null });
  }
  return result;
}
