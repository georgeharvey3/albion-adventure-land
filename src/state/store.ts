import { create } from 'zustand';
import type { Site, SiteCategory, ParentCategory } from '../data/types';
import { SITE_TYPES, resolveOutingSlots, outingSlotResolver } from '../data/types';
import { buildRarityIndex, type RarityIndex } from '../geo/rarity';
import { findNearestOuting, nearestPerSlot, type SlotNearest } from '../geo/outing';
import { orderRoute } from '../geo/tsp';
import { haversine } from '../geo/haversine';
import {
  loadUserState,
  putVisit,
  deleteVisit,
  addWishlist,
  removeWishlist,
  type VisitLog,
} from './db';

export interface Position {
  lat: number;
  lng: number;
  accuracy: number; // metres
  manual: boolean; // true if dropped by the user (geolocation fallback)
}

// Outing mode v1 (spec §6 F12/F14/F16). The result stores ids, not Site
// objects — sites are the read-only source of truth and are looked up on
// render. `stopIds` is already in route order (NN + 2-opt from the anchor).
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
  userLoaded: boolean;

  // Filters.
  activeTypes: Set<SiteCategory>;

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

  // Geolocation.
  position: Position | null;
  geoError: string | null;

  // UI: the site shown in the detail card (map popup / list tap).
  selectedSiteId: string | null;

  // Actions.
  init: () => Promise<void>;
  setSelected: (siteId: string | null) => void;
  toggleType: (category: SiteCategory) => void;
  setTypesActive: (categories: SiteCategory[], on: boolean) => void;
  setAllTypes: (on: boolean) => void;
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
  setPosition: (pos: Position | null) => void;
  setLivePosition: (pos: Position) => void;
  setGeoError: (msg: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  sites: [],
  rarity: null,
  dataLoaded: false,
  dataError: null,

  visited: {},
  wishlist: new Set(),
  userLoaded: false,

  activeTypes: new Set(SITE_TYPES),

  outingTypes: new Set(),
  outingAnyParents: new Set(),
  outingIncludeVisited: false,
  outing: null,
  outingFailure: null,
  outingShownIds: [],

  position: null,
  geoError: null,

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
      .then(({ visited, wishlist }) => {
        set({ visited, wishlist: new Set(wishlist), userLoaded: true });
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
    const { sites, visited, position, outingTypes, outingAnyParents, outingIncludeVisited, outingShownIds } =
      get();
    const slots = resolveOutingSlots(outingTypes, outingAnyParents);
    if (!position || slots.size === 0) return; // UI disables the button

    const resolve = outingSlotResolver(slots);
    const slotOf = (s: Site) => resolve(s.category) ?? s.category;
    const pool = sites.filter(
      (s) => resolve(s.category) !== undefined && (outingIncludeVisited || !(s.id in visited)),
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

    const stops = orderRoute(position, cluster.members);
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
  // mix. Re-optimises from the current position on every add (NN + 2-opt), so
  // the route stays tight as it grows. Position-gated: the UI disables the card
  // button until there's a location to order from. `edited` flips true, and the
  // cluster's "find another" history is dropped — it no longer describes this
  // hand-built route.
  addToTrip: (siteId) => {
    const { sites, position, outing } = get();
    if (!position) return; // UI disables the card button without a position
    const byId = new Map(sites.map((s) => [s.id, s]));
    const currentIds = outing?.stopIds ?? [];
    if (currentIds.includes(siteId) || !byId.has(siteId)) return;
    const members = [...currentIds, siteId].map((id) => byId.get(id)!).filter(Boolean);
    const stops = orderRoute(position, members);
    set({
      outing: {
        stopIds: stops.map((s) => s.id),
        distanceFromAnchor: haversine(position, stops[0]),
        edited: true,
      },
      outingFailure: null,
      outingShownIds: [],
    });
  },

  // Drop a stop; re-optimise the remainder. Emptying the trip clears the outing.
  removeFromTrip: (siteId) => {
    const { sites, position, outing } = get();
    if (!outing) return;
    const remaining = outing.stopIds.filter((id) => id !== siteId);
    if (remaining.length === 0) {
      set({ outing: null, outingFailure: null, outingShownIds: [] });
      return;
    }
    const byId = new Map(sites.map((s) => [s.id, s]));
    const members = remaining.map((id) => byId.get(id)!).filter(Boolean);
    // Re-order only if we have an anchor; otherwise keep the current relative
    // order (position is normally present, since adding required it).
    const stops = position ? orderRoute(position, members) : members;
    set({
      outing: {
        stopIds: stops.map((s) => s.id),
        distanceFromAnchor: position ? haversine(position, stops[0]) : 0,
        edited: true,
      },
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
}));
