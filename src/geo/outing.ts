import type { Site, OutingSlot } from '../data/types';
import { haversine, type LatLng } from './haversine';

// Outing search (spec §7.2): find the nearest "full house" — exactly one site
// of each selected slot. A slot is a leaf type or a whole-parent group (e.g.
// "any folklore"); `slotOf` maps a site to the slot it fills for this search,
// so the algorithm never needs to know which kind it is. There is NO proximity
// cap: as long as each selected slot has an available site, a cluster exists.
// The cluster returned minimises
// (proximity of the seed + SPREAD_WEIGHT · spread around the seed), so tight
// nearby groups beat sprawling ones without any hard cutoff. Spread is weighted
// above proximity so the search prefers stops that are close *together* even
// when that means a longer first leg from the user's location. Pure and
// dependency-free so it runs offline and is testable without a DOM. O(|pool|²)
// worst case — trivial at ~1.2k sites.
//
// ROUTE MODE (issue #16) is the same search with a different notion of "near".
// With a destination pinned, "how far away is this outing" stops meaning
// distance from the user and starts meaning EXTRA DRIVING — so the caller
// injects `detour` from corridor.ts as the proximity function, pre-filters the
// pool to the corridor, and re-weights spread (see ROUTE_SPREAD_WEIGHT). Those
// are the only two knobs: slot resolution, the outward-scan early exit, the id
// tie-breaks and the failure states are all written against `proximity` rather
// than against haversine, so they carry over untouched.

/**
 * How heavily cluster tightness (Σ seed→member spread) outweighs proximity of
 * the outing's start to the user. 1 = equal weight (spread and start-distance
 * traded one-for-one); higher favours tighter clusters at the cost of a longer
 * drive out to them. See spec §11 open decision on the cost function.
 */
export const SPREAD_WEIGHT = 3;

/**
 * The same knob for route mode — tuned to zero, which is a real answer rather
 * than a disabled feature. Spread exists to stop a point-mode outing sprawling
 * across a county; on a corridor the detour budget already does that job, since
 * every candidate is within `budget` of the line by construction. What spread
 * charges for on top of that is distance ALONG the route — which is driving you
 * were doing anyway, and therefore free.
 *
 * Measured on the real dataset (a swim + a ruin + a pub, 20 km budget, extra
 * driving over the direct route):
 *
 *   Glasgow → Portree   W=0: +5.8 km at 10/24/37%   W=1: +22.4 km at 0/2/3%
 *   London → Bristol    W=0: +2.8 km at 12/23/33%   W=1:  +1.7 km at 2/2/2%
 *   Manchester → York   W=0: +23.0 km at 0/21/35%   W=1: +20.4 km at 35/34/39%
 *   Exeter → Penzance   W=0: +7.4 km at 80/83/86%   W=1:  +4.9 km at 80/82/82%
 *
 * The percentages are the giveaway. Any W ≥ ~0.5 saturates (W=1, 2 and 3 return
 * the same clusters) and collapses the trip into a knot wherever the corridor is
 * densest — on the Skye run, three stops inside Glasgow's suburbs followed by
 * 200 km of unbroken driving. W=0 strings the stops along the journey, which is
 * what "on the way" means. See spec §11.1: a per-member detour cost scores
 * better still, and is the thing to decide after a real road trip.
 */
export const ROUTE_SPREAD_WEIGHT = 0;

/**
 * "How far off my way is this site", in metres. Straight-line distance from the
 * anchor in point mode; extra driving (`detour`) in route mode. Must be ≥ 0 and
 * finite — the scan's early exit depends on it.
 */
export type ProximityFn = (site: LatLng) => number;

export interface OutingSearchOptions {
  /** Defaults to straight-line distance from the anchor (point mode). */
  proximity?: ProximityFn;
  /** Defaults to SPREAD_WEIGHT; pass ROUTE_SPREAD_WEIGHT in route mode. */
  spreadWeight?: number;
  /** "Find another": skip any cluster sharing a member with one already shown. */
  excludeMemberIds?: ReadonlySet<string>;
}

export interface OutingCluster {
  seed: Site;
  /** Exactly one site per selected slot — the nearest of each around the
   *  seed, which is itself a member. Unordered — route order comes from
   *  tsp.ts. */
  members: Site[];
  /** haversine(anchor, seed) — the "how far is this outing" number. Always a
   *  straight-line distance, in both modes: route mode's headline is total
   *  added driving (computed live from the ordered route), not this. */
  distanceFromAnchor: number;
  /** Max seed→member distance — the cluster's spread, shown to the user so a
   *  sprawling result is visible for what it is. */
  radiusM: number;
}

/**
 * Find the nearest full-house cluster: exactly one site of each selected
 * slot. `pool` must already reflect the visited/unvisited choice — and, in
 * route mode, the corridor; this function additionally filters to sites whose
 * `slotOf` is a selected slot. `excludeMemberIds` implements "find another":
 * any candidate cluster sharing a member with a previously shown cluster is
 * skipped.
 *
 * Every candidate seed is scored as
 *   cost = proximity(seed)
 *        + spreadWeight · Σ haversine(seed, nearest-of-each-slot)
 * and the cheapest wins (id tie-break, so results are deterministic). With the
 * defaults that is exactly the point-mode score: haversine from the anchor,
 * weighted 3× against spread. Returns null only when a selected slot has
 * nothing in the pool (see nearestPerSlot for the per-slot diagnostics) or
 * "find another" has run out of disjoint alternatives.
 */
export function findNearestOuting(
  anchor: LatLng,
  slots: ReadonlySet<OutingSlot>,
  slotOf: (site: Site) => OutingSlot,
  pool: Site[],
  options: OutingSearchOptions = {},
): OutingCluster | null {
  const {
    proximity = (site: LatLng) => haversine(anchor, site),
    spreadWeight = SPREAD_WEIGHT,
    excludeMemberIds = new Set<string>(),
  } = options;

  const candidates = pool
    .filter((s) => slots.has(slotOf(s)))
    .map((site) => ({ site, slot: slotOf(site), p: proximity(site) }))
    .sort((a, b) => a.p - b.p || a.site.id.localeCompare(b.site.id));

  // A slot with nothing available means no seed can ever cover the selection.
  const present = new Set(candidates.map((c) => c.slot));
  for (const t of slots) if (!present.has(t)) return null;

  let best: { seed: Site; members: Site[]; cost: number } | null = null;

  for (const { site: seed, p } of candidates) {
    // Outward order gives an exact cutoff. The scan is sorted by `proximity`
    // and the cost is proximity + a non-negative spread term, so once a seed's
    // own proximity exceeds the best total cost, no later seed can win — every
    // later one has proximity at least as large. This holds for ANY proximity
    // function that is ≥ 0, which is why detour (clamped at 0, and monotonic
    // outward along this scan order because the scan is sorted by it) drops
    // straight in. Strict, so a zero-spread tie can still take the id
    // tie-break.
    if (best && p > best.cost) break;

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
    const cost = p + spreadWeight * spread;
    if (!best || cost < best.cost || (cost === best.cost && seed.id < best.seed.id)) {
      best = { seed, members, cost };
    }
  }

  if (!best) return null;

  const { seed, members } = best;
  const radiusM = Math.max(...members.map((m) => haversine(seed, m)));
  return { seed, members, distanceFromAnchor: haversine(anchor, seed), radiusM };
}

export interface SlotNearest {
  slot: OutingSlot;
  /** Closest pool site filling this slot; null when the pool has none at all
   *  (e.g. every one is already visited). */
  site: Site | null;
  /** That site's `proximity`: straight-line metres from the anchor in point
   *  mode, extra metres of driving in route mode. Null when there is no site. */
  distance: number | null;
}

/** Per-slot diagnostics for the failure state: which selected slots have
 *  nothing available (site: null), and how far off the closest thing is.
 *
 *  In route mode, call this with the pool BEFORE the corridor filter and with
 *  the corridor's proximity function: a slot whose closest site sits beyond the
 *  detour budget is the route-mode failure, and its `distance` is the number
 *  the user needs to widen the budget past. */
export function nearestPerSlot(
  anchor: LatLng,
  slots: ReadonlySet<OutingSlot>,
  slotOf: (site: Site) => OutingSlot,
  pool: Site[],
  proximity: ProximityFn = (site: LatLng) => haversine(anchor, site),
): SlotNearest[] {
  const result: SlotNearest[] = [];
  for (const slot of slots) {
    let best: Site | null = null;
    let bestD = Infinity;
    for (const site of pool) {
      if (slotOf(site) !== slot) continue;
      const d = proximity(site);
      if (d < bestD) {
        best = site;
        bestD = d;
      }
    }
    result.push({ slot, site: best, distance: best ? bestD : null });
  }
  return result;
}
