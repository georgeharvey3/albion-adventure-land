import { create } from "zustand";
import type { Site, SiteCategory, ParentCategory } from "../data/types";
import {
  SITE_TYPES,
  resolveOutingSlots,
  outingSlotResolver,
  parentOf,
  tagKey,
  DEFAULT_ACTIVE_TAGS,
} from "../data/types";
import { buildRarityIndex, type RarityIndex } from "../geo/rarity";
import {
  findNearestOuting,
  nearestPerSlot,
  ROUTE_SPREAD_WEIGHT,
  type SlotNearest,
} from "../geo/outing";
import { orderRoute } from "../geo/tsp";
import { haversine, type LatLng } from "../geo/haversine";
import { DEFAULT_DETOUR_BUDGET, detour } from "../geo/corridor";
import { prepareRoute, routeDetour, type PreparedRoute } from "../geo/route";
import { fetchRoute } from "../geo/osrm";
import {
  loadUserState,
  putVisit,
  deleteVisit,
  addWishlist,
  removeWishlist,
  addHidden,
  removeHidden,
  routeKey,
  loadCachedRoute,
  cacheRoute,
  type VisitLog,
} from "./db";
import { loadViewState, saveViewState } from "./viewState";
import type { SearchResult, SearchTarget } from "../search/types";

export interface Position {
  lat: number;
  lng: number;
  accuracy: number; // metres
  manual: boolean; // true if dropped by the user (geolocation fallback)
  /**
   * Set only when the anchor came from a search (issue #28) — "Aviemore"
   * rather than "Here". Its presence is what tells the journey bar it is
   * showing a planned-from place instead of the user's real position.
   *
   * Deliberately NOT persisted (see viewState): a searched origin surviving a
   * cold start would mean arriving in the field with the app still anchored to
   * last night's sofa plan. Every session opens on your real location.
   */
  label?: string;
}

// Journey anchor, part 2 (issue #14). `position` is the FROM end and keeps
// behaving exactly as it always has; adding a destination turns the anchor from
// a point into a corridor and every distance-aware surface reinterprets itself.
// A null destination means point mode — today's app, unchanged.
//
// Destinations come from a map tap, from a site already in the dataset, or —
// since issue #28 — from the search box. That last one revised the original
// rule here: free-text search is now served by a SHIPPED OFFLINE DICTIONARY
// (public/data/places.json), with a runtime geocoder layered on top purely as
// an enhancement. The architecture's "no runtime geocoding dependency" still
// holds; search simply no longer needs one. `siteId` records which site the
// destination came from, so the site card can show "✓ Destination".
export interface Destination {
  lat: number;
  lng: number;
  label: string;
  siteId?: string;
}

/** Route-mode list order: travel order along the journey, or least detour. */
export type RouteSort = "progress" | "detour";

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
//
// Route mode adds one more way to come up empty: a type with nothing inside the
// detour budget. `budget` is the metres that were on offer (null in point mode,
// which has no budget), and each `nearest` entry's distance is a detour rather
// than a straight-line distance — so the UI can say how much wider the budget
// would have to be.
export type OutingFailure =
  | { kind: "missing-types"; nearest: SlotNearest[]; budget: number | null }
  | { kind: "no-more" };

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
  // A session does NOT start empty: it starts at DEFAULT_ACTIVE_TAGS, which
  // opens the pubs layer on its 3-star and 2-star grades (see ../data/types).
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
  // The last real GPS fix, recorded even while a manual pin or a searched
  // anchor is in charge of `position`. It is what "Back to my location"
  // restores, instantly — see useMyLocation.
  livePosition: Position | null;

  // Journey (issue #14). Null destination === point mode, i.e. today's app.
  destination: Destination | null;
  detourBudget: number; // metres of extra driving a stop may cost
  routeSort: RouteSort;

  // The resolved ROAD route for the journey (issue #29), projected ready for
  // measuring. Null means the corridor falls back to the detour ellipse — no
  // signal, a service that is down, or two ends with no road between them.
  // Nothing gates on it: null is a complete answer, not a broken one.
  route: PreparedRoute | null;
  // Which end of the journey the map is armed to take the next tap as, if any.
  // ONE picker, not two: dropping an "I am here" pin and picking a destination
  // are the same gesture aimed at different ends, and while they were separate
  // (a store flag for one, a ref inside MapView for the other) each had to
  // remember to disarm the other. `picking` can only name one end at a time,
  // so a tap can only ever mean one thing.
  picking: SearchTarget | null;

  // Location search (issue #28). Non-null means the search overlay is open and
  // filling THAT end of the journey — which is why picking a result needs no
  // "start or destination?" follow-up question.
  searchTarget: SearchTarget | null;

  // A one-shot request for the map to move somewhere, consumed by MapView.
  // `nonce` exists so picking the same result twice still moves the map.
  focus: { lat: number; lng: number; zoom?: number; nonce: number } | null;

  // UI: the site shown in the detail card (map popup / list tap). In browse
  // mode this same id is the row expanded in place, so leaving browse mode
  // hands the map the site you were just reading about.
  selectedSiteId: string | null;
  // UI: browse mode hides the map and gives the near-me list the whole screen,
  // for reading through sites rather than working a map. Ephemeral, like the
  // selection — a session always opens on the map.
  browse: boolean;

  // Actions.
  init: () => Promise<void>;
  setSelected: (siteId: string | null) => void;
  setBrowse: (browse: boolean) => void;
  toggleType: (category: SiteCategory) => void;
  setTypesActive: (categories: SiteCategory[], on: boolean) => void;
  setAllTypes: (on: boolean) => void;
  revealSite: (siteId: string) => void;
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
  // Re-resolve the journey's road route when the ends have moved enough to
  // warrant it (issue #29). Fire-and-forget: it never throws, never blocks a
  // render, and a failure simply leaves `route` null.
  syncRoute: () => void;
  setPicking: (target: SearchTarget | null) => void;
  openSearch: (target: SearchTarget) => void;
  closeSearch: () => void;
  applySearchResult: (result: SearchResult) => void;
  useMyLocation: () => void;
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

// ---------------------------------------------------------------------------
// Road-route resolution (issue #29).
//
// WHY THE MOVEMENT GATE. The origin is normally the LIVE GPS FIX, which moves
// continuously while you drive. Re-resolving on every accepted fix would mean a
// network request every few seconds, which blows through the demo server's
// one-per-second policy on a single user and re-draws the map for nothing: the
// road ahead does not change because you advanced 100 m along it.
//
// So a resolved route is kept until the origin moves RESOLVE_MOVE_M from the
// point it was resolved at, or the destination changes. Two kilometres is well
// under the distance at which a British road network offers a genuinely
// different route, and well over GPS drift plus normal in-town movement.
//
// The same gate is what stops an offline failure from retrying forever: a null
// result records its attempt like a successful one, so the next try waits for
// real movement — by which time the signal may well be back.
const RESOLVE_MOVE_M = 2000;

// Module-level rather than store state: this is bookkeeping for the resolver,
// not something any component renders, and putting it in the store would wake
// every subscriber on each GPS tick.
let lastAttempt: { from: LatLng; to: LatLng } | null = null;

function sameEnd(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/**
 * A journey's road route: the IndexedDB cache first, the network only on a
 * miss. Returns null when there is no route to be had, which is a complete
 * answer — the caller falls back to the detour ellipse.
 */
async function resolveRoute(from: LatLng, to: LatLng): Promise<PreparedRoute | null> {
  const key = routeKey(from, to);

  const cached = await loadCachedRoute(key);
  if (cached) {
    const prepared = prepareRoute({
      points: cached.points,
      distance: cached.distance,
      duration: cached.duration,
    });
    if (prepared) return prepared;
  }

  const route = await fetchRoute(from, to);
  if (!route) return null;

  const prepared = prepareRoute(route);
  if (!prepared) return null;

  // Best-effort and deliberately not awaited: the route is already in hand, and
  // a blocked or full store must not hold up the map.
  void cacheRoute({
    key,
    points: route.points,
    distance: route.distance,
    duration: route.duration,
  });
  return prepared;
}

// A hand-picked trip has no seed or cluster spread — those fields describe a
// found cluster only — and `edited` gates the "replace your trip?" confirm.
const EMPTY_TRIP: OutingResult = {
  stopIds: [],
  distanceFromAnchor: 0,
  edited: true,
};

// --- Cross-source duplicates (issue #37) ---------------------------------
// Two guidebooks describe one place, so the data holds two rows with two stable
// ids. The merge is done at ingest (src/data/duplicates.ts): the representative
// carries `duplicateIds` and the other rows carry `duplicateOf`. The app drops
// those rows in ONE filter as the data loads — the seam every surface is behind,
// so the map, the near-me list, search, the outing pool, the rarity index and
// the stats all see one site without knowing duplicates exist.

/** merged-away id → representative id, read off the representatives that
 *  survived the filter. */
function aliasMap(sites: readonly Site[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const site of sites) {
    for (const id of site.duplicateIds ?? []) out.set(id, site.id);
  }
  return out;
}

/**
 * Move user state off merged-away ids and onto their representative.
 *
 * A visit ticked before the merge — or ticked on the other guidebook's row — is
 * keyed on an id the app no longer shows, and would read as unvisited. Folding
 * it here, once as the data loads, is what lets every other reader keep looking
 * up a single id and know nothing about duplicates.
 *
 * The fold only ever MOVES a tick to the representative, keeps the EARLIER
 * visit date and keeps both notes, so running it again — or changing which
 * member of a group represents it — can never lose a visit. Returns null when
 * there was nothing to move, which is the normal case.
 */
async function foldDuplicateState(
  sites: readonly Site[],
  visited: Record<string, VisitLog>,
  wishlist: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
): Promise<Pick<AppState, "visited" | "wishlist" | "hidden"> | null> {
  const alias = aliasMap(sites);
  if (!alias.size) return null;

  const nextVisited = { ...visited };
  const nextWishlist = new Set(wishlist);
  const nextHidden = new Set(hidden);
  let changed = false;

  for (const [oldId, repId] of alias) {
    const stale = nextVisited[oldId];
    if (stale) {
      const own = nextVisited[repId];
      const note = [own?.note, stale.note].filter(Boolean).join("\n\n");
      const log: VisitLog = {
        siteId: repId,
        visitedAt: own && own.visitedAt < stale.visitedAt ? own.visitedAt : stale.visitedAt,
        ...(note ? { note } : {}),
      };
      await putVisit(log);
      await deleteVisit(oldId);
      nextVisited[repId] = log;
      delete nextVisited[oldId];
      changed = true;
    }

    if (nextWishlist.delete(oldId)) {
      await removeWishlist(oldId);
      // A visited site is never on the wishlist (see markVisited), so a folded
      // wish on an already-visited representative is dropped, not moved.
      if (!nextVisited[repId]) {
        await addWishlist(repId);
        nextWishlist.add(repId);
      }
      changed = true;
    }

    if (nextHidden.delete(oldId)) {
      await removeHidden(oldId);
      await addHidden(repId);
      nextHidden.add(repId);
      changed = true;
    }
  }

  return changed ? { visited: nextVisited, wishlist: nextWishlist, hidden: nextHidden } : null;
}

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
  activeTags: new Set(DEFAULT_ACTIVE_TAGS),

  outingTypes: new Set(),
  outingAnyParents: new Set(),
  outingIncludeVisited: false,
  outing: null,
  outingFailure: null,
  outingShownIds: [],

  position: null,
  geoError: null,
  livePosition: null,

  destination: null,
  detourBudget: DEFAULT_DETOUR_BUDGET,
  routeSort: "progress",
  route: null,
  picking: null,

  searchTarget: null,
  focus: null,

  // Restored from the last session so reopening the app brings back the card
  // you were reading. Set synchronously here, before the map mounts: that keeps
  // the map's pan-to-selection effect a no-op (the site list is still empty),
  // so the restored viewport is not overridden by a recentre on the pin.
  selectedSiteId: loadViewState().selectedSiteId,
  browse: false,

  init: async () => {
    // Load site data and user state in parallel; they're independent.
    const sitesPromise = fetch(`${import.meta.env.BASE_URL}data/sites.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Site[]>;
      })
      .then((all) => {
        // THE seam. Two kinds of row leave the app here, before anything
        // derives from the list, and every other consumer — the map, the
        // near-me list, search, the outing pool, the rarity index and the
        // completion stats — reads what comes out and knows about neither.
        //
        // A site the source says is shut is not a place you can visit. It stays
        // in sites.json, so the next `npm run refresh:camra` can clear the
        // closure and bring it back.
        //
        // A site merged into another (issue #37) is the same place under a
        // second guidebook's name. It stays in sites.json too, so the merge can
        // be widened or undone in a JSON file and no user state is orphaned.
        const sites = all.filter((s) => !s.closure && !s.duplicateOf);
        set({ sites, rarity: buildRarityIndex(sites), dataLoaded: true });
        // A restored selection is only a remembered id: drop it if a CSV
        // re-import has since removed that site, rather than leaving the store
        // pointing at nothing. An id that has since been merged away is not
        // gone, though — it is now part of another site, so follow it there.
        const { selectedSiteId } = get();
        if (selectedSiteId && !sites.some((s) => s.id === selectedSiteId)) {
          const repId = aliasMap(sites).get(selectedSiteId) ?? null;
          saveViewState({ selectedSiteId: repId });
          set({ selectedSiteId: repId });
        }
      })
      .catch((err: unknown) => {
        set({
          dataError: err instanceof Error ? err.message : String(err),
          dataLoaded: true,
        });
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

    // Both halves are in hand, so any user state left on a merged-away id can
    // come home. Best-effort: a failure here leaves the state where it is and
    // the app still works — it just reads one duplicate's tick as unvisited.
    try {
      const { sites, visited, wishlist, hidden } = get();
      const folded = await foldDuplicateState(sites, visited, wishlist, hidden);
      if (folded) set(folded);
    } catch {
      // IndexedDB unavailable — there is nothing to fold into.
    }
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

  // Make one site visible again when the user asked for it BY NAME in the site
  // finder. A filter is an ambient choice about a type; typing a name is an
  // explicit instruction about one site, and the explicit act wins — otherwise
  // the finder answers with a site the map and the list then refuse to show.
  //
  // Two things can be hiding it, and both have to give: its leaf type being
  // switched off, and a tag narrowing on its layer that it doesn't match. A
  // user-HIDDEN site is not one of them — hiding is a decision about that site
  // rather than about a type, so it is never overruled here (and the finder
  // never returns one).
  revealSite: (siteId) => {
    const { sites, activeTypes, activeTags } = get();
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    const patch: Partial<Pick<AppState, "activeTypes" | "activeTags">> = {};

    if (!activeTypes.has(site.category)) {
      patch.activeTypes = new Set(activeTypes).add(site.category);
    }

    // Only this site's own layer is unnarrowed, and only when its tags miss —
    // clearing every layer's tags would undo far more than the reveal needs.
    const parent = parentOf(site.category);
    const prefix = `${parent}::`;
    const narrowed = [...activeTags].filter((k) => k.startsWith(prefix));
    if (narrowed.length) {
      const wanted = new Set(narrowed.map((k) => k.slice(prefix.length)));
      if (!site.tags?.some((t) => wanted.has(t))) {
        patch.activeTags = new Set(
          [...activeTags].filter((k) => !k.startsWith(prefix)),
        );
      }
    }

    if (patch.activeTypes || patch.activeTags) set(patch);
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
    set({
      outingTypes: next,
      outing: null,
      outingFailure: null,
      outingShownIds: [],
    });
  },

  // Bulk-tick a parent's leaves (the Select all / Deselect all controls).
  setOutingTypesActive: (categories, on) => {
    const next = new Set(get().outingTypes);
    for (const c of categories) {
      if (on) next.add(c);
      else next.delete(c);
    }
    set({
      outingTypes: next,
      outing: null,
      outingFailure: null,
      outingShownIds: [],
    });
  },

  // Switch a parent between "Any of these" (its ticked leaves — or the whole
  // category if none are ticked — become one stop) and "one of each".
  setOutingParentAny: (parent, any) => {
    const next = new Set(get().outingAnyParents);
    if (any) next.add(parent);
    else next.delete(parent);
    set({
      outingAnyParents: next,
      outing: null,
      outingFailure: null,
      outingShownIds: [],
    });
  },

  setOutingIncludeVisited: (on) => {
    set({
      outingIncludeVisited: on,
      outing: null,
      outingFailure: null,
      outingShownIds: [],
    });
  },

  // "Find one for me". In point mode this is the nearest full-house cluster
  // around the user. With a destination pinned (issue #16) the same search
  // becomes "one of each, on my way": proximity stops meaning distance from the
  // user and starts meaning extra driving, and the pool is pre-filtered to the
  // corridor. Everything else — slot resolution, the outward scan, "find
  // another", the failure states — is shared, not forked.
  findOuting: (another = false) => {
    const {
      sites,
      visited,
      hidden,
      position,
      destination,
      detourBudget,
      route,
      outingTypes,
      outingAnyParents,
      outingIncludeVisited,
      outingShownIds,
    } = get();
    const slots = resolveOutingSlots(outingTypes, outingAnyParents);
    if (!position || slots.size === 0) return; // UI disables the button

    const resolve = outingSlotResolver(slots);
    const slotOf = (s: Site) => resolve(s.category) ?? s.category;
    // The site pinned as the destination is already the end of the route, so it
    // must never also be picked as a stop — in route mode it has a detour of
    // zero and would otherwise win its slot outright. In point mode there is no
    // destination and this term is inert.
    const eligible = sites.filter(
      (s) =>
        resolve(s.category) !== undefined &&
        !hidden.has(s.id) &&
        s.id !== destination?.siteId &&
        (outingIncludeVisited || !(s.id in visited)),
    );

    // Route mode: score by extra driving, weight spread accordingly, and search
    // only what the journey can afford.
    // Both are undefined in point mode, where findNearestOuting falls back to
    // haversine-from-the-anchor and SPREAD_WEIGHT — the pre-#16 search exactly.
    //
    // The choice between the road route and the ellipse is the SAME choice the
    // near-me list makes (issue #29). If the two disagreed, a site could read
    // "+3 km detour" in the list and still be invisible to "find one for me",
    // which is the same corridor asked a different way.
    const proximity = destination
      ? route
        ? (s: LatLng) => routeDetour(s, route)
        : (s: LatLng) => detour(s, position, destination)
      : undefined;
    const spreadWeight = destination ? ROUTE_SPREAD_WEIGHT : undefined;
    const pool = proximity
      ? eligible.filter((s) => proximity(s) <= detourBudget)
      : eligible;

    const cluster = findNearestOuting(position, slots, slotOf, pool, {
      proximity,
      spreadWeight,
      excludeMemberIds: new Set(another ? outingShownIds : []),
    });

    if (!cluster) {
      // Failure is a first-class outcome (spec §6 F12): keep the current
      // result when "find another" runs dry; otherwise name the types that
      // have nothing available. Diagnostics run over `eligible`, NOT the
      // corridor-filtered pool, so route mode can distinguish "there is no such
      // site left" from "the closest one is +34 km off your route" and offer a
      // wider budget for the second.
      set(
        another
          ? { outingFailure: { kind: "no-more" } }
          : {
              outing: null,
              outingShownIds: [],
              outingFailure: {
                kind: "missing-types",
                nearest: nearestPerSlot(
                  position,
                  slots,
                  slotOf,
                  eligible,
                  proximity,
                ),
                budget: destination ? detourBudget : null,
              },
            },
      );
      return;
    }

    const stops = orderRoute(position, cluster.members, destination);
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
    const trip = reorderOuting(
      EMPTY_TRIP,
      [...currentIds, siteId],
      sites,
      position,
      destination,
    );
    if (!trip) return; // unknown id, or the site is already the pinned destination
    set({ outing: trip, outingFailure: null, outingShownIds: [] });
  },

  // Drop a stop; re-optimise the remainder. Emptying the trip clears the outing.
  removeFromTrip: (siteId) => {
    const { sites, position, destination, outing } = get();
    if (!outing) return;
    const remaining = outing.stopIds.filter((id) => id !== siteId);
    set({
      outing: reorderOuting(
        EMPTY_TRIP,
        remaining,
        sites,
        position,
        destination,
      ),
      outingFailure: null,
      outingShownIds: [],
    });
  },

  clearOuting: () =>
    set({ outing: null, outingFailure: null, outingShownIds: [] }),

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

  // The tap that set the origin is spent, so the picker disarms — the mirror
  // of what setDestination does for the other end.
  setPosition: (position) => {
    set({ position, geoError: null, picking: null });
    get().syncRoute();
  },
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
    const { position: current, livePosition } = get();
    // Movement gate, measured against the last recorded FIX rather than the
    // displayed anchor, so it still works while a manual pin is in charge.
    if (livePosition && haversine(livePosition, position) < 25) return;

    // Record the real fix unconditionally. A manual pin or a searched anchor
    // suppresses it from `position`, but "Back to my location" needs something
    // to go back TO — without this it could only clear the anchor and wait for
    // the next fix, which on a stationary device may be a long time coming.
    set({ livePosition: position });

    if (current?.manual) return;
    set({ position, geoError: null });
    // The gate inside syncRoute is what keeps this from becoming a request per
    // fix — it only resolves once the origin has genuinely moved on.
    get().syncRoute();
  },
  setGeoError: (geoError) => set({ geoError }),
  setSelected: (selectedSiteId) => {
    saveViewState({ selectedSiteId });
    set({ selectedSiteId });
  },
  setBrowse: (browse) => set({ browse }),

  // Setting or clearing the destination always disarms the map's picker: the
  // tap that set it is spent, and clearing while armed would leave the map in
  // crosshair mode with nothing to pick.
  //
  // It also re-orders any live trip (issue #15): gaining an end turns the route
  // into A → stops → B, and losing one turns it back into an open path, so the
  // order that was optimal a moment ago generally isn't any more.
  //
  // The stops survive — a trip is the user's, not the search's — but the
  // finder's state does not: a failure message and a "find another" history
  // describe a search over the old corridor (issue #16), so both are dropped.
  setDestination: (destination) => {
    const { sites, position, outing } = get();
    set({
      destination,
      picking: null,
      outing: outing
        ? reorderOuting(outing, outing.stopIds, sites, position, destination)
        : null,
      outingFailure: null,
      outingShownIds: [],
    });
    get().syncRoute();
  },

  // "Set as destination" from a site card — the common road-trip case ("I'm
  // driving to this castle, what's on the way?").
  setDestinationFromSite: (siteId) => {
    const site = get().sites.find((s) => s.id === siteId);
    if (!site) return;
    get().setDestination({
      lat: site.lat,
      lng: site.lng,
      label: site.name,
      siteId: site.id,
    });
  },

  // Widening the budget is the documented answer to a route-mode "nothing of
  // that type on your way", so it has to clear the failure that said so — and
  // the "find another" history, which enumerated a narrower corridor. The trip
  // itself is kept: the stops are the user's, and a stop outside the new budget
  // is still a stop they chose.
  setDetourBudget: (detourBudget) =>
    set({ detourBudget, outingFailure: null, outingShownIds: [] }),
  setRouteSort: (routeSort) => set({ routeSort }),

  syncRoute: () => {
    const { position, destination } = get();

    // No journey, no route. Clearing the destination puts the app back into
    // point mode, and a stale road line must not outlive it.
    if (!position || !destination) {
      lastAttempt = null;
      if (get().route) set({ route: null });
      return;
    }

    // Already resolved (or already tried) for ends close enough to these.
    if (
      lastAttempt &&
      sameEnd(lastAttempt.to, destination) &&
      haversine(lastAttempt.from, position) < RESOLVE_MOVE_M
    ) {
      return;
    }

    const from = { lat: position.lat, lng: position.lng };
    const to = { lat: destination.lat, lng: destination.lng };
    const previous = lastAttempt;
    lastAttempt = { from, to };

    // A CHANGED DESTINATION invalidates the old line at once — drawing
    // yesterday's road to today's destination is worse than drawing nothing,
    // and the ellipse takes over for the moment it takes to resolve. Moving
    // along an unchanged journey does not: that route is still the right road,
    // so it keeps answering until a better one arrives.
    if (previous && !sameEnd(previous.to, to)) set({ route: null });

    void resolveRoute(from, to).then((route) => {
      // The journey may have moved on while the request was in flight. Only the
      // ends this result was asked for may accept it.
      const now = get();
      if (!now.position || !now.destination) return;
      if (!sameEnd(now.destination, to)) return;
      if (haversine(now.position, from) >= RESOLVE_MOVE_M) return;
      set({ route });
    });
  },
  setPicking: (picking) => set({ picking }),

  // Opening search disarms the map picker: they are two ways of answering the
  // same question, and leaving the map in crosshair mode behind the search
  // panel would strand it there.
  openSearch: (searchTarget) => set({ searchTarget, picking: null }),
  closeSearch: () => set({ searchTarget: null }),

  // Apply a picked result to whichever end the search was opened for. The
  // target is what makes this unambiguous — there is no prompt after the fact.
  applySearchResult: (result) => {
    const { searchTarget } = get();
    if (!searchTarget) return;

    if (searchTarget === "destination") {
      get().setDestination({
        lat: result.lat,
        lng: result.lng,
        label: result.label,
        ...(result.siteId ? { siteId: result.siteId } : {}),
      });
    } else {
      // manual: true pins it against watchPosition, exactly like a dropped pin —
      // a GPS fix must not silently drag the anchor off the place you are
      // planning around. accuracy 0 because this is an exact chosen point, not
      // a measurement with error.
      get().setPosition({
        lat: result.lat,
        lng: result.lng,
        accuracy: 0,
        manual: true,
        label: result.label,
      });
    }

    // A site result sets the end AND opens its card: one tap, both intents, and
    // the only way to look a site up by name without the box needing a mode.
    if (result.siteId) get().setSelected(result.siteId);

    set({
      searchTarget: null,
      focus: { lat: result.lat, lng: result.lng, zoom: 12, nonce: Date.now() },
    });
  },

  // Undo a searched or dropped anchor and go back to the real one.
  //
  // Restores the last recorded fix SYNCHRONOUSLY rather than clearing the
  // anchor and waiting: dropping to null would put the bar into "Locating…"
  // until the next fix, and watchPosition only reports when something changes —
  // so a stationary phone, or a getCurrentPosition that times out, would strand
  // the user there. Clearing `manual` also reopens the gate in setLivePosition,
  // so subsequent fixes flow again; the one-shot request below just refreshes
  // it sooner, and costs nothing if it fails.
  useMyLocation: () => {
    set({ position: get().livePosition, geoError: null });
    get().syncRoute();
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        get().setLivePosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          manual: false,
        }),
      () =>
        get().setGeoError(
          "Location unavailable — drop a pin or search for a place.",
        ),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  },
}));
