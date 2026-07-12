import type { Site, OutingSlot } from '../data/types';
import { haversine, type LatLng } from './haversine';

// Outing search (spec §7.2): find the nearest "full house" — exactly one site
// of each selected slot. A slot is a leaf type or a whole-parent group (e.g.
// "any folklore"); `slotOf` maps a site to the slot it fills for this search,
// so the algorithm never needs to know which kind it is. There is NO proximity
// cap: as long as each selected slot has an available site, a cluster exists.
// The cluster returned minimises
// (distance from anchor + SPREAD_WEIGHT · spread around the seed), so tight
// nearby groups beat sprawling ones without any hard cutoff. Spread is weighted
// above anchor distance so the search prefers stops that are close *together*
// even when that means a longer first leg from the user's location. Pure and
// dependency-free so it runs offline and is testable without a DOM. O(|pool|²)
// worst case — trivial at ~1.2k sites.

/**
 * How heavily cluster tightness (Σ seed→member spread) outweighs proximity of
 * the outing's start to the user. 1 = equal weight (spread and start-distance
 * traded one-for-one); higher favours tighter clusters at the cost of a longer
 * drive out to them. See spec §11 open decision on the cost function.
 */
export const SPREAD_WEIGHT = 3;

export interface OutingCluster {
  seed: Site;
  /** Exactly one site per selected slot — the nearest of each around the
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
 * slot. `pool` must already reflect the visited/unvisited choice; this
 * function additionally filters to sites whose `slotOf` is a selected slot.
 * `excludeMemberIds` implements "find another": any candidate cluster sharing a
 * member with a previously shown cluster is skipped.
 *
 * Every candidate seed is scored as
 *   cost = haversine(anchor, seed)
 *        + SPREAD_WEIGHT · Σ haversine(seed, nearest-of-each-slot)
 * and the cheapest wins (id tie-break, so results are deterministic). Returns
 * null only when a selected slot has nothing in the pool (see nearestPerSlot
 * for the per-slot diagnostics) or "find another" has run out of disjoint
 * alternatives.
 */
export function findNearestOuting(
  anchor: LatLng,
  slots: ReadonlySet<OutingSlot>,
  slotOf: (site: Site) => OutingSlot,
  pool: Site[],
  excludeMemberIds: ReadonlySet<string> = new Set(),
): OutingCluster | null {
  const candidates = pool
    .filter((s) => slots.has(slotOf(s)))
    .map((site) => ({ site, slot: slotOf(site), d: haversine(anchor, site) }))
    .sort((a, b) => a.d - b.d || a.site.id.localeCompare(b.site.id));

  // A slot with nothing available means no seed can ever cover the selection.
  const present = new Set(candidates.map((c) => c.slot));
  for (const t of slots) if (!present.has(t)) return null;

  let best: { seed: Site; d: number; members: Site[]; cost: number } | null = null;

  for (const { site: seed, d } of candidates) {
    // Anchor-outward order gives an exact cutoff: spread cost is ≥ 0, so a
    // seed farther away than the best total cost can never win (strict, so a
    // zero-spread tie can still take the id tie-break).
    if (best && d > best.cost) break;

    // Nearest site of each selected slot to this seed (the seed covers its
    // own slot at distance 0). Deterministic via distance-then-id tie-break.
    const perSlot = new Map<OutingSlot, { site: Site; ds: number }>();
    for (const { site, slot } of candidates) {
      const ds = haversine(seed, site);
      const cur = perSlot.get(slot);
      if (!cur || ds < cur.ds || (ds === cur.ds && site.id < cur.site.id)) {
        perSlot.set(slot, { site, ds });
      }
    }

    const members = [...perSlot.values()].map((m) => m.site);
    if (members.some((m) => excludeMemberIds.has(m.id))) continue;

    const spread = [...perSlot.values()].reduce((sum, m) => sum + m.ds, 0);
    const cost = d + SPREAD_WEIGHT * spread;
    if (!best || cost < best.cost || (cost === best.cost && seed.id < best.seed.id)) {
      best = { seed, d, members, cost };
    }
  }

  if (!best) return null;

  const { seed, d, members } = best;
  const radiusM = Math.max(...members.map((m) => haversine(seed, m)));
  return { seed, members, distanceFromAnchor: d, radiusM };
}

export interface SlotNearest {
  slot: OutingSlot;
  /** Nearest pool site filling this slot, to the anchor; null when the pool has
   *  none at all (e.g. every one is already visited). */
  site: Site | null;
  distance: number | null;
}

/** Per-slot diagnostics for the failure state: which selected slots have
 *  nothing available (site: null) — the only way a search can fail. */
export function nearestPerSlot(
  anchor: LatLng,
  slots: ReadonlySet<OutingSlot>,
  slotOf: (site: Site) => OutingSlot,
  pool: Site[],
): SlotNearest[] {
  const result: SlotNearest[] = [];
  for (const slot of slots) {
    let best: Site | null = null;
    let bestD = Infinity;
    for (const site of pool) {
      if (slotOf(site) !== slot) continue;
      const d = haversine(anchor, site);
      if (d < bestD) {
        best = site;
        bestD = d;
      }
    }
    result.push({ slot, site: best, distance: best ? bestD : null });
  }
  return result;
}
