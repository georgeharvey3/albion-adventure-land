import { create } from 'zustand';
import type { Site, SiteCategory, ParentCategory } from '../data/types';
import { SITE_TYPES, resolveOutingSlots, outingSlotResolver, tagKey } from '../data/types';
import { buildRarityIndex, type RarityIndex } from '../geo/rarity';
import { findNearestOuting, nearestPerSlot, type SlotNearest } from '../geo/outing';
import { orderRoute } from '../geo/tsp';
import { haversine } from '../geo/haversine';
import { DEFAULT_DETOUR_BUDGET } from '../geo/corridor';
import {
  loadUserState,
  putVisit,
  deleteVisit,
  addWishlist,
  removeWishlist,
  addHidden,
  removeHidden,
  type VisitLog,
} from './db';

export interface Position {
  lat: number;
  lng: number;
  accuracy: number; // metres
  manual: boolean; // true if dropped by the user (geolocation fallback)
}

// Journey anchor, part 2 (issue #14). `position` is the FROM end and keeps
// behaving exactly as it always has; adding a destination turns the anchor from
// a point into a corridor and every distance-aware surface reinterprets itself.
// A null destination means point mode — today's app, unchanged.
//
// Destinations come from a map tap or from a site already in the dataset:
// runtime geocoding is off the table (CLAUDE.md — build-time and cached only),
// so there is no free-text "Fort William" box. `siteId` records which site the
// destination came from, so the site card can show "✓ Destination".
export interface Destination {
  lat: number;
  lng: number;
  label: string;
  siteId?: string;
}

/** Route-mode list order: travel order along the journey, or least detour. */
export type RouteSort = 'progress' | 'detour';

// Outing mode v1 (spec §6 F12/F14/F16). The result stores ids, not Site
// objects — sites are the read-only source of truth and are looked up on
// render. `stopIds` is already in route order (NN + 2-opt from the anchor, and
// to the journey's destination when one is pinned — issue #15).
//
// The SAME result is populated two ways: the cluster algorithm ("Find outing")
// and hand-picking ("Add to trip", spec: trip = today's ordered subset). A
// hand-built route has no seed/cluster, so `seedId`/`radiusM` are cluster-only
// (undefined for a trip) and `edited` is true — which gates the "replace your
// trip?" confirm before a fresh Find overwrites hand-picked stops.
export interface OutingResult {
  seedId?: string;
  stopIds: string[];
  distanceFromAnchor: number; // metres, anchor → first stop (≈ seed for a cluster)
  radiusM?: number; // cluster spread (max seed → member); undefined for a hand-built trip
  edited: boolean; // true once hand-picked/removed — a trip, not a pristine cluster
}

// A search can only fail when a selected slot has nothing available (all
// visited / none in the dataset) or "find another" runs out of disjoint
// alternatives — there is no proximity cap.
export type OutingFailure =
  | { kind: 'missing-types'; nearest: SlotNearest[] }
  | { kind: 'no-more' };

interface AppState {
  // Site data (read-only).
  sites: Site[];
  rarity: RarityIndex | null;
  dataLoaded: boolean;
  dataError: string | null;

  // User state (mirrors IndexedDB).
  visited: Record<string, VisitLog>;
  wishlist: Set<string>;
  hidden: Set<string>;
  userLoaded: boolean;

  // Filters.
  activeTypes: Set<SiteCategory>;
  // Tag refinement (spec F3, second level). Keyed by `tagKey(parent, tag)`, so a
  // tag only ever narrows the layer it was picked under. EMPTY MEANS NO
  // NARROWING: a layer with no tag picked shows all of its sites, and a layer
  // with tags picked shows only sites carrying at least one of them (OR within
  // a layer, AND across layers is meaningless — each layer filters itself).
  activeTags: Set<string>;

  // Outing mode. The slot selection is a QUERY, deliberately independent of
  // the map filter (a display concern) — spec §6 F12.
  //
  // The picker is stored as two pieces that `resolveOutingSlots` combines into
  // the actual slots the search matches:
  //   • `outingTypes` — the leaf types the user has ticked;
  //   • `outingAnyParents` — parents switched to "Any of these" mode, where the
  //     ticked leaves of that parent collapse into ONE stop (a union slot), or
  //     — with none ticked — mean "any of the whole category". A parent NOT in
  //     this set keeps "one of each": every ticked leaf is its own stop.
  outingTypes: Set<SiteCategory>;
  outingAnyParents: Set<ParentCategory>;
  outingIncludeVisited: boolean;
  outing: OutingResult | null;
  outingFailure: OutingFailure | null;
  // Member ids of clusters already shown this search, so "find another" skips
  // anything overlapping them (spec §7.2).
  outingShownIds: string[];

  // Geolocation (the journey's FROM end).
  position: Position | null;
  geoError: string | null;

  // Journey (issue #14). Null destination === point mode, i.e. today's app.
  destination: Destination | null;
  detourBudget: number; // metres of extra driving a stop may cost
  routeSort: RouteSort;
  // True while the map is armed to take the next tap as the destination.
  pickingDestination: boolean;

  // UI: the site shown in the detail card (map popup / list tap).
  selectedSiteId: string | null;

  // Actions.
  init: () => Promise<void>;
  setSelected: (siteId: string | null) => void;
  toggleType: (category: SiteCategory) => void;
  setTypesActive: (categories: SiteCategory[], on: boolean) => void;
  setAllTypes: (on: boolean) => void;
  toggleTag: (parent: ParentCategory, tag: string) => void;
  clearTags: (parent: ParentCategory) => void;
  toggleOutingType: (category: SiteCategory) => void;
  setOutingTypesActive: (categories: SiteCategory[], on: boolean) => void;
  setOutingParentAny: (parent: ParentCategory, any: boolean) => void;
  setOutingIncludeVisited: (on: boolean) => void;
  findOuting: (another?: boolean) => void;
  addToTrip: (siteId: string) => void;
  removeFromTrip: (siteId: string) => void;
  clearOuting: () => void;
  markVisited: (siteId: string, note?: string) => Promise<void>;
  unmarkVisited: (siteId: string) => Promise<void>;
  toggleWishlist: (siteId: string) => Promise<void>;
  toggleHidden: (siteId: string) => Promise<void>;
  setPosition: (pos: Position | null) => void;
  setLivePosition: (pos: Position) => void;
  setGeoError: (msg: string | null) => void;
  setDestination: (dest: Destination | null) => void;
  setDestinationFromSite: (siteId: string) => void;
  setDetourBudget: (metres: number) => void;
  setRouteSort: (sort: RouteSort) => void;
  setPickingDestination: (on: boolean) => void;
}

// Re-order an outing's stops against the CURRENT journey and refresh the
// derived anchor distance (issue #15). Point mode orders an open path from the
// anchor, exactly as it always has; route mode pins the destination as a fixed
// terminal node, so the route is A → stops → B and can't double back past B.
//
// A site pinned as the destination is already the final stop, so it is dropped
// from the vias rather than visited twice. Returns null when nothing is left.
function reorderOuting(
  outing: OutingResult,
  stopIds: string[],
  sites: Site[],
  position: Position | null,
  destination: Destination | null,
): OutingResult | null {
  const byId = new Map(sites.map((s) => [s.id, s]));
  const members = stopIds
    .filter((id) => id !== destination?.siteId)
    .map((id) => byId.get(id))
    .filter((s): s is Site => !!s);
  if (members.length === 0) return null;
  // Re-order only if we have an anchor; otherwise keep the current relative
  // order (position is normally present, since adding required it).
  const stops = position ? orderRoute(position, members, destination) : members;
  return {
    ...outing,
    stopIds: stops.map((s) => s.id),
    distanceFromAnchor: position ? haversine(position, stops[0]) : 0,
  };
}

// A hand-picked trip has no seed or cluster spread — those fields describe a
// found cluster only — and `edited` gates the "replace your trip?" confirm.
const EMPTY_TRIP: OutingResult = { stopIds: [], distanceFromAnchor: 0, edited: true };

export const useStore = create<AppState>((set, get) => ({
  sites: [],
  rarity: null,
  dataLoaded: false,
  dataError: null,

  visited: {},
  wishlist: new Set(),
  hidden: new Set(),
  userLoaded: false,

  activeTypes: new Set(SITE_TYPES),
  activeTags: new Set(),

  outingTypes: new Set(),
  outingAnyParents: new Set(),
  outingIncludeVisited: false,
  outing: null,
  outingFailure: null,
  outingShownIds: [],

  position: null,
  geoError: null,

  destination: null,
  detourBudget: DEFAULT_DETOUR_BUDGET,
  routeSort: 'progress',
  pickingDestination: false,

  selectedSiteId: null,

  init: async () => {
    // Load site data and user state in parallel; they're independent.
    const sitesPromise = fetch(`${import.meta.env.BASE_URL}data/sites.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Site[]>;
      })
      .then((sites) => {
        set({ sites, rarity: buildRarityIndex(sites), dataLoaded: true });
      })
      .catch((err: unknown) => {
        set({ dataError: err instanceof Error ? err.message : String(err), dataLoaded: true });
      });

    const userPromise = loadUserState()
      .then(({ visited, wishlist, hidden }) => {
        set({
          visited,
          wishlist: new Set(wishlist),
          hidden: new Set(hidden),
          userLoaded: true,
        });
      })
      .catch(() => {
        // Fresh state if IndexedDB is unavailable; app still works read-only.
        set({ userLoaded: true });
      });

    await Promise.all([sitesPromise, userPromise]);
  },

  toggleType: (category) => {
    const next = new Set(get().activeTypes);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    set({ activeTypes: next });
  },

  // Bulk-toggle a group of leaf types (used by the parent-category toggle).
  setTypesActive: (categories, on) => {
    const next = new Set(get().activeTypes);
    for (const c of categories) {
      if (on) next.add(c);
      else next.delete(c);
    }
    set({ activeTypes: next });
  },

  setAllTypes: (on) => {
    set({ activeTypes: on ? new Set(SITE_TYPES) : new Set() });
  },

  toggleTag: (parent, tag) => {
    const next = new Set(get().activeTags);
    const key = tagKey(parent, tag);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set({ activeTags: next });
  },

  // Drop every tag picked under one layer (its "Clear tags" control), leaving
  // the other layers' tag selections alone.
  clearTags: (parent) => {
    const next = new Set<string>();
    for (const key of get().activeTags) {
      if (!key.startsWith(`${parent}::`)) next.add(key);
    }
    set({ activeTags: next });
  },

  // Changing the query invalidates the current result — keeping a cluster on
  // screen that no longer matches the chips would be misleading. Toggling a leaf
  // is now a plain add/remove; whether the parent's leaves combine into one stop
  // or stay separate is governed by `outingAnyParents`, not by the leaf set.
  toggleOutingType: (category) => {
    const next = new Set(get().outingTypes);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    set({ outingTypes: next, outing: null, outingFailure: null, outingShownIds: [] });
  },

  // Bulk-tick a parent's leaves (the Select all / Deselect all controls).
  setOutingTypesActive: (categories, on) => {
    const next = new Set(get().outingTypes);
    for (const c of categories) {
      if (on) next.add(c);
      else next.delete(c);
    }
    set({ outingTypes: next, outing: null, outingFailure: null, outingShownIds: [] });
  },

  // Switch a parent between "Any of these" (its ticked leaves — or the whole
  // category if none are ticked — become one stop) and "one of each".
  setOutingParentAny: (parent, any) => {
    const next = new Set(get().outingAnyParents);
    if (any) next.add(parent);
    else next.delete(parent);
    set({ outingAnyParents: next, outing: null, outingFailure: null, outingShownIds: [] });
  },

  setOutingIncludeVisited: (on) => {
    set({ outingIncludeVisited: on, outing: null, outingFailure: null, outingShownIds: [] });
  },

  findOuting: (another = false) => {
    const { sites, visited, hidden, position, outingTypes, outingAnyParents, outingIncludeVisited, outingShownIds } =
      get();
    const slots = resolveOutingSlots(outingTypes, outingAnyParents);
    if (!position || slots.size === 0) return; // UI disables the button

    const resolve = outingSlotResolver(slots);
    const slotOf = (s: Site) => resolve(s.category) ?? s.category;
    const pool = sites.filter(
      (s) =>
        resolve(s.category) !== undefined &&
        !hidden.has(s.id) &&
        (outingIncludeVisited || !(s.id in visited)),
    );
    const exclude = new Set(another ? outingShownIds : []);
    const cluster = findNearestOuting(position, slots, slotOf, pool, exclude);

    if (!cluster) {
      // Failure is a first-class outcome (spec §6 F12): keep the current
      // result when "find another" runs dry; otherwise name the types that
      // have nothing available (the only way a fresh search can fail).
      set(
        another
          ? { outingFailure: { kind: 'no-more' } }
          : {
              outing: null,
              outingShownIds: [],
              outingFailure: {
                kind: 'missing-types',
                nearest: nearestPerSlot(position, slots, slotOf, pool),
              },
            },
      );
      return;
    }

    const stops = orderRoute(position, cluster.members, get().destination);
    set({
      outing: {
        seedId: cluster.seed.id,
        stopIds: stops.map((s) => s.id),
        distanceFromAnchor: cluster.distanceFromAnchor,
        radiusM: cluster.radiusM,
        edited: false,
      },
      outingShownIds: [
        ...(another ? outingShownIds : []),
        ...cluster.members.map((s) => s.id),
      ],
      outingFailure: null,
    });
  },

  // Hand-pick a stop into the shared outing (spec: trip = today's ordered
  // subset). No type constraint — unlike the cluster search, a trip can hold any
  // mix. Re-optimises against the journey on every add (NN + 2-opt), so the
  // route stays tight as it grows. Position-gated: the UI disables the card
  // button until there's a location to order from. `edited` flips true, and the
  // cluster's "find another" history is dropped — it no longer describes this
  // hand-built route.
  addToTrip: (siteId) => {
    const { sites, position, destination, outing } = get();
    if (!position) return; // UI disables the card button without a position
    const currentIds = outing?.stopIds ?? [];
    if (currentIds.includes(siteId)) return;
    const trip = reorderOuting(EMPTY_TRIP, [...currentIds, siteId], sites, position, destination);
    if (!trip) return; // unknown id, or the site is already the pinned destination
    set({ outing: trip, outingFailure: null, outingShownIds: [] });
  },

  // Drop a stop; re-optimise the remainder. Emptying the trip clears the outing.
  removeFromTrip: (siteId) => {
    const { sites, position, destination, outing } = get();
    if (!outing) return;
    const remaining = outing.stopIds.filter((id) => id !== siteId);
    set({
      outing: reorderOuting(EMPTY_TRIP, remaining, sites, position, destination),
      outingFailure: null,
      outingShownIds: [],
    });
  },

  clearOuting: () => set({ outing: null, outingFailure: null, outingShownIds: [] }),

  markVisited: async (siteId, note) => {
    const log: VisitLog = {
      siteId,
      visitedAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    await putVisit(log);
    set({ visited: { ...get().visited, [siteId]: log } });
    // Marking visited clears it from the wishlist.
    if (get().wishlist.has(siteId)) {
      await removeWishlist(siteId);
      const w = new Set(get().wishlist);
      w.delete(siteId);
      set({ wishlist: w });
    }
  },

  unmarkVisited: async (siteId) => {
    await deleteVisit(siteId);
    const visited = { ...get().visited };
    delete visited[siteId];
    set({ visited });
  },

  toggleWishlist: async (siteId) => {
    const w = new Set(get().wishlist);
    if (w.has(siteId)) {
      await removeWishlist(siteId);
      w.delete(siteId);
    } else {
      await addWishlist(siteId);
      w.add(siteId);
    }
    set({ wishlist: w });
  },

  // Hide/unhide a site: user state (persisted), keyed by stable id. Hidden sites
  // are dropped from the map, the near-me list, and the outing search pool — but
  // stay selectable (Saved tab → Hidden) so they can be restored.
  toggleHidden: async (siteId) => {
    const h = new Set(get().hidden);
    if (h.has(siteId)) {
      await removeHidden(siteId);
      h.delete(siteId);
    } else {
      await addHidden(siteId);
      h.add(siteId);
    }
    set({ hidden: h });
  },

  setPosition: (position) => set({ position, geoError: null }),
  // Live-location updates from watchPosition. A manual "I am here" pin is an
  // explicit override (spec §8) — don't let a GPS fix silently clobber it. The
  // user resumes live location by dropping a new pin (which routes through
  // setPosition, not here).
  //
  // Movement gate: high-accuracy watchPosition fires ~every second with metres
  // of jitter, and every accepted fix re-sorts and re-renders everything
  // downstream (near-me list, distances). Ignore fixes that moved less than
  // 25 m — a threshold below anything that changes a displayed distance.
  setLivePosition: (position) => {
    const current = get().position;
    if (current?.manual) return;
    if (current && haversine(current, position) < 25) return;
    set({ position, geoError: null });
  },
  setGeoError: (geoError) => set({ geoError }),
  setSelected: (selectedSiteId) => set({ selectedSiteId }),

  // Setting or clearing the destination always disarms the map's picker: the
  // tap that set it is spent, and clearing while armed would leave the map in
  // crosshair mode with nothing to pick.
  //
  // It also re-orders any live trip (issue #15): gaining an end turns the route
  // into A → stops → B, and losing one turns it back into an open path, so the
  // order that was optimal a moment ago generally isn't any more.
  setDestination: (destination) => {
    const { sites, position, outing } = get();
    set({
      destination,
      pickingDestination: false,
      outing: outing ? reorderOuting(outing, outing.stopIds, sites, position, destination) : null,
    });
  },

  // "Set as destination" from a site card — the common road-trip case ("I'm
  // driving to this castle, what's on the way?").
  setDestinationFromSite: (siteId) => {
    const site = get().sites.find((s) => s.id === siteId);
    if (!site) return;
    get().setDestination({ lat: site.lat, lng: site.lng, label: site.name, siteId: site.id });
  },

  setDetourBudget: (detourBudget) => set({ detourBudget }),
  setRouteSort: (routeSort) => set({ routeSort }),
  setPickingDestination: (pickingDestination) => set({ pickingDestination }),
}));
