import { create } from 'zustand';
import type { Site, SiteCategory } from '../data/types';
import { SITE_TYPES } from '../data/types';
import { buildRarityIndex, type RarityIndex } from '../geo/rarity';
import { findNearestOuting, nearestPerType, type TypeNearest } from '../geo/outing';
import { orderRoute } from '../geo/tsp';
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
export interface OutingResult {
  seedId: string;
  stopIds: string[];
  distanceFromAnchor: number; // metres, anchor → seed
  radiusM: number; // cluster spread (max seed → member), surfaced in the UI
}

// A search can only fail when a selected type has nothing available (all
// visited / none in the dataset) or "find another" runs out of disjoint
// alternatives — there is no proximity cap.
export type OutingFailure =
  | { kind: 'missing-types'; nearest: TypeNearest[] }
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

  // Outing mode. The type selection is a QUERY, deliberately independent of
  // the map filter (a display concern) — spec §6 F12.
  outingTypes: Set<SiteCategory>;
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
  setOutingIncludeVisited: (on: boolean) => void;
  findOuting: (another?: boolean) => void;
  clearOuting: () => void;
  markVisited: (siteId: string, note?: string) => Promise<void>;
  unmarkVisited: (siteId: string) => Promise<void>;
  toggleWishlist: (siteId: string) => Promise<void>;
  setPosition: (pos: Position | null) => void;
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
  // screen that no longer matches the chips would be misleading.
  toggleOutingType: (category) => {
    const next = new Set(get().outingTypes);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    set({ outingTypes: next, outing: null, outingFailure: null, outingShownIds: [] });
  },

  setOutingIncludeVisited: (on) => {
    set({ outingIncludeVisited: on, outing: null, outingFailure: null, outingShownIds: [] });
  },

  findOuting: (another = false) => {
    const { sites, visited, position, outingTypes, outingIncludeVisited, outingShownIds } = get();
    if (!position || outingTypes.size === 0) return; // UI disables the button

    const pool = sites.filter(
      (s) => outingTypes.has(s.category) && (outingIncludeVisited || !(s.id in visited)),
    );
    const exclude = new Set(another ? outingShownIds : []);
    const cluster = findNearestOuting(position, outingTypes, pool, exclude);

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
                nearest: nearestPerType(position, outingTypes, pool),
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
      },
      outingShownIds: [
        ...(another ? outingShownIds : []),
        ...cluster.members.map((s) => s.id),
      ],
      outingFailure: null,
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
  setGeoError: (geoError) => set({ geoError }),
  setSelected: (selectedSiteId) => set({ selectedSiteId }),
}));
