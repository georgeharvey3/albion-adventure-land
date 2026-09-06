# Britain Sites — Implementation Spec

*A personal, offline-first PWA (“Albion Adventure Land”) for visiting curated
location pins across Britain.*

Rewritten July 2026 to reflect the shipped MVP and to define the next phase —
**completion stats + outing mode v1** — precisely. Where this spec and the code
disagree, fix whichever is wrong rather than letting them drift.

---

## Status at a glance

| Area | State |
|---|---|
| Ingest (2 sources: folklore CSV + CAMRA pubs, build-time geocoding + scrape enrichment) | ✅ Built — 1,192 sites in `public/data/sites.json` |
| Map, pins by type, live location + manual “I am here” pin | ✅ Built |
| Two-level type filter (Folklore → 13 leaves; Historic pubs) | ✅ Built |
| Near-me list (haversine) | ✅ Built |
| Visited / wishlist (IndexedDB) | ✅ Built |
| Site detail card, directions handoff, pub place-link | ✅ Built |
| PWA / offline (Workbox precache + OSM tile cache), GitHub Pages deploy | ✅ Built |
| **Completion stats (F6)** | ✅ Built — Stats tab consumes the rarity index |
| **Outing mode v1 (F12/F14/F16)** | ✅ Built — nearest full-house cluster, route, multi-stop handoff |
| Site log (note + photo), condition filters, export/import | ❌ Not built (Phase 3) |
| Travel-time matrix, orienteering, DBSCAN discovery | ❌ Not built (Phase 4) |

---

## 1. Goal and non-goals

**Goal.** Turn a set of curated location CSVs (folkloric/magical sites, historic
pubs, wild swimming spots, …) into a *visiting companion* — a tool that
maximises engagement with the collection and the number of sites actually
visited, rather than just storing pins on a map.

The product exists because Google My Maps and travel-tracker apps store and
display pins well but cannot do the active field loop: *“I’m here now — what’s
nearby, which have I not done, and how do I chain several into one outing.”*

**Non-goals.**
- Not a navigation engine. Turn-by-turn is delegated to Google Maps via deep links.
- Not a pin *authoring* tool. Data is curated externally (CSV) and treated as
  read-only; the app layers personal state on top.
- Not multi-user or social. Single user, single owner of the data.
- Not a backend-heavy service. The architecture is client-only (§3). A backend
  is an optional later addition for cross-device sync only.

---

## 2. Core principle

Everything is anchored to **engagement** and **completion**. Two features carry
that weight and must never be cut:

1. **Near me now** — live location, every site sorted by distance (later:
   travel time), filterable by type, one tap to directions.
2. **Visited / wishlist state with completion stats** — the mechanism that
   turns a viewer into a collection with a shape and a finish line.

**Outing mode** is the headline differentiator built on top of these: pick the
*kinds* of day you want (a pub, a holy well, a stone circle), and the app finds
the nearest place where that whole day exists. If a feature doesn’t serve
“visit more, and more varied, sites,” it’s a candidate for cutting.

---

## 3. Architecture

**Client-only PWA, offline-first. No backend.** Deployed as static files to
GitHub Pages (repo-subpath base, see `vite.config.ts`).

```
┌─────────────────────────────────────────────┐
│  PWA (single-page app, installable)          │
│                                               │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │ Site data   │   │ User state           │  │
│  │ (read-only) │   │ (visited, wishlist,  │  │
│  │ CSVs →      │   │  later: notes,       │  │
│  │ build-time  │   │  photos, matrices)   │  │
│  │ ingest →    │   │ → IndexedDB          │  │
│  │ sites.json  │   └──────────────────────┘  │
│  └─────────────┘                              │
│                                               │
│  Map (Leaflet) · Geolocation · Service Worker │
└─────────────────────────────────────────────┘
            │                       │
            ▼                       ▼
      OSM raster tiles      Google Maps deep link
      (cached offline)      (directions handoff)
```

Why client-only: the dataset is small (~1.2k points), the user is the only
consumer, and offline operation in no-signal rural Britain is a hard
requirement. The *only* thing a backend buys later is visited-state sync across
devices — deferred until that friction is actually felt (cheap insurance:
export/import in Phase 3).

**Offline mental test:** after one online session covering a region, the app
must be fully functional in airplane mode for that region — map, pins, near-me,
visited state, and outing mode (which is all local math).

---

## 4. Tech stack (settled)

| Concern | Choice | Notes |
|---|---|---|
| Build/dev | Vite + TypeScript | `npm run build` = ingest → typecheck → PWA build. |
| UI | **React 18** | Decided (was open React-vs-Svelte). Leaflet used directly, no react-leaflet. |
| Map | Leaflet | Circle markers for folklore, square DivIcons for pubs. |
| Tiles | Keyless OSM raster | Swap to a keyed provider (MapTiler/Thunderforest) for topo styles — still open (§11). |
| CSV ingest | Papa Parse (build-time, via `tsx`) | Never naive splitting — descriptions embed commas/newlines. |
| Persistence | IndexedDB via `idb` | Versioned schema; photos/matrices land as new stores without losing state. |
| Service worker | Workbox via `vite-plugin-pwa` | Precache shell + `sites.json`; runtime cache-first OSM tiles. |
| State | Zustand | Single store: sites, user state mirror, filters, position, selection. |
| Geometry/routing | **Hand-rolled, dependency-free** | haversine today; outing search + NN/2-opt in Phase 2. Fully offline. |

Single SPA, no SSR, no router. Keep dependencies minimal — the offline/bundle
story is a feature.

---

## 5. Data model

### 5.1 Normalized Site (read-only, derived from CSVs)

The type system is a **two-level taxonomy**, not the flat enum of the original
design. The *leaf* category drives pin colour, filters, rarity, and stats; the
*parent* groups leaves in the filter UI and is **derived, never stored**.

```ts
type SiteCategory =            // leaf — controlled vocabulary
  | 'historic_pubs'
  | 'wells' | 'natural_water_features' | 'wild_places'
  | 'hills' | 'hillforts' | 'earthworks'
  | 'burial_chambers' | 'standing_stones' | 'stone_circles'
  | 'natural_stones' | 'sacred_buildings' | 'caves' | 'other';

type ParentCategory = 'folklore' | 'historic_pubs';
// parentOf(category) — derived, like rarity. 'historic_pubs' is its own leaf
// and parent (no subdivision).

interface Site {
  id: string;            // STABLE, derived — see below
  name: string;
  lat: number;           // WGS84
  lng: number;
  category: SiteCategory;
  description?: string;
  county?: string;       // region/area from the source
  postcode?: string;     // postcode-keyed sources (pubs); used in id + Maps query
  source: string;        // which CSV this came from
  sourceUrl?: string;    // attribution link (e.g. CAMRA pub page)

  // Listing grouping (folklore source): a `listing` groups a `main` point with
  // its nearby features. Derived at ingest, never user state.
  listingId?: string;
  listingTitle?: string;
  parentId?: string;     // sub-feature → its listing's main point

  // Condition/access metadata (sparse; drives Phase 3 filters).
  access?: string;
  tideDependent?: boolean;
  seasonal?: boolean;
  needsWalk?: boolean;
  cost?: 'free' | 'paid';
  openingHours?: string;
}
```

**Stable ids — the critical invariant.** User state is keyed on `id` and must
survive CSV re-import:
- Coordinate sources: `slug(name)_lat.toFixed(4)_lng.toFixed(4)` (`makeId`) —
  ~11 m rounding absorbs CSV jitter.
- Postcode sources (pubs): `slug(name)_slug(postcode)` (`makePubId`) —
  deliberately *not* coordinate-based, so re-geocoding never changes the id.

`rarity` is **not stored** — derived at load from leaf-category frequency
(§7.4). Same rule for `parentOf` and listing `parentId` resolution: anything
derivable is derived, so user state can never depend on it.

### 5.2 CSV ingest (build-time, `npm run ingest`)

CSVs are heterogeneous. Each source gets a `SourceMapping` config (one file per
CSV under `src/data/mappings/`), not a bespoke parser:

```ts
interface SourceMapping {
  source: string;
  coords: 'in_row' | 'geocode_postcode';  // how coordinates arrive
  columns: { name: string; lat?; lng?; postcode?; category?; description?;
             county?; access?; role?; listingNo?; listingTitle?; ... };
  collectibleRoles: string[];  // structural roles that are destinations
  exclude?: { column: string; values: string[] };  // product-decision drops
}
```

Two pipelines share validation/dedupe logic in `src/data/ingest.ts` (pure,
runtime-agnostic, unit-testable):

- **`in_row`** (`magical_britain_master.csv`): `point_type` is the *structural
  role* of a row — `main` and `nearby_feature` are collectible; `trailhead` /
  `trailhead_parking` are navigation aids, skipped (counted, not rejected).
  The leaf category comes from the CSV’s `category` column (slugified;
  unrecognised → `'other'`). Listings are resolved in a second pass
  (`parentId` → the listing’s main point).
- **`geocode_postcode`** (`CAMRA.csv`): rows carry only name + postcode.
  Postcodes are geocoded at build time (postcodes.io, cached in
  `data/geocode-cache.json`) and baked into the JSON — runtime stays offline.
  Optional enrichment (`data/camra-descriptions.json`, produced by
  `npm run scrape:camra`) adds descriptions + attribution URLs, keyed by the
  stable pub id. Northern Ireland rows are excluded by product decision.

Shared rules: validate (name present, coords parse and fall inside UK bounds),
**log every rejected row with a reason — never drop silently**, dedupe by
stable id within and across sources, emit `public/data/sites.json`.

OSGB grid-ref conversion remains unbuilt on purpose: no current source needs it
(the folklore CSV carries both lat/lng and `os_grid_ref`). Build it only when a
grid-ref-only source lands.

### 5.3 User state (read-write, IndexedDB `albion` v1)

```ts
interface VisitLog {
  siteId: string;
  visitedAt: string;      // ISO date
  note?: string;          // plumbing exists; UI arrives Phase 3
  photoBlobKey?: string;  // Phase 3
}
// stores: 'visited' (keyed siteId → VisitLog), 'wishlist' (keyed siteId)
```

Strict separation: site data is replaceable/regenerable; user state is
precious. Marking a site visited removes it from the wishlist. The Zustand
store mirrors IndexedDB in memory; the app still works read-only if IndexedDB
is unavailable.

---

## 6. Features by phase

Feature numbers are stable across rewrites (code comments cite them). Phases
are re-cut around what’s actually built and what’s next.

### Phase 1 — MVP ✅ SHIPPED (except F6, moved to Phase 2)

- **F1. Ingest** — two sources via mapping configs (§5.2). ✅
- **F2. Map view** — pins coloured by leaf type (squares for pubs), location
  dot + accuracy ring, manual “I am here” drop-pin fallback. ✅
- **F3. Type filter** — two-level: parent switches (Folklore / Historic pubs)
  + leaf chips with select/deselect-all; affects map and list. ✅
- **F4. Near me now** — haversine-sorted list respecting filters. ✅
- **F5. Visited / wishlist** — persisted, visual state on map and list. ✅
- **F7. Directions handoff** — single-site Google Maps deep link; pubs also get
  a place-lookup link (name + postcode → the pub’s Maps listing). ✅
- **F8. PWA / offline** — installable, shell + data precached, tiles
  runtime-cached, deployed to GitHub Pages. ✅

### Phase 2 — ✅ BUILT: Completion stats + Outing mode v1

Two deliverables. Stats first (small, pays off a core-principle debt); then
outing mode, the headline feature, on **raw haversine distance only** — travel
time is explicitly Phase 4.

- **F6. Completion stats** — visited/total overall, per-leaf-type and
  per-county breakdowns, and a “rarest type you haven’t seen” nudge (consumes
  the already-built rarity index). A fourth sheet tab; updates live as sites
  are marked.

- **F12. Outing search — “nearest full house”.** The user picks **one or more
  leaf types** in a picker *independent of the map filter* (the map filter is a
  display concern; this is a query). The app finds the nearest cluster of
  **exactly one site per selected type**, relative to the anchor (live
  location or manual pin). **There is no proximity cap** — as long as each
  selected type has an available site, a cluster exists; nearness and
  tightness are traded off by the scoring in §7.2, and the result shows its
  own spread so a sprawling cluster is visible for what it is. No padding:
  the stop count always equals the number of selected types.
  - Candidate pool = sites of the selected types, **unvisited only by
    default**, with an “include visited” toggle (for revisits / showing
    someone around).
  - Algorithm: scored anchor-outward seed scan, §7.2.
  - Result: the **single nearest cluster**, highlighted on the map (numbered
    stops + route polyline) with a route-ordered stop list; tapping a stop
    opens the site card. A “find another” action continues the scan, skipping
    clusters that share members with ones already shown.
  - Failure is a first-class outcome and can only mean one thing: a selected
    type has nothing available (all visited, or absent from the dataset).
    Name the offending types and suggest dropping them or including visited.

- **F14. Route within the cluster** — nearest-neighbour from the anchor +
  2-opt cleanup over haversine (§7.3). Open path (start at anchor; no return
  leg in v1).

- **F16. Multi-stop handoff** — one tap exports the ordered route as a Google
  Maps multi-waypoint directions URL (origin = anchor, waypoints = stops
  1..n−1, destination = last stop). Stops = selected-type count, so a very
  large selection (11+ types) exceeds the ~9-waypoint consumer cap — the UI
  hides the export then (per-stop directions still work); re-verify the live
  cap before relying on it.

**Acceptance (Phase 2):**
1. Marking a site visited updates the stats totals, its type/county rows, and
   the rarest-unvisited nudge, live and offline.
2. With the anchor in West Penwith and several folklore types selected, the
   app returns the nearest group with ≥1 of each, ordered sensibly (no obvious
   crossings), and one tap opens a Google Maps URL with all stops in the
   computed order.
3. Visited sites are excluded by default; flipping “include visited” can
   change the result.
4. A selection whose types only co-occur far away (e.g. heritage pubs +
   folklore from Penzance, where the nearest such pub is ~33 km out) still
   returns the best cluster, with its distance and spread displayed so the
   user can judge it — never a hard failure.
5. A selected type with nothing available (all visited / absent) produces the
   explanatory failure state naming that type.
6. All of the above works in airplane mode (the search and routing are pure
   local math).

### Phase 3 — Personal record & practical filters

- **F10. Condition filters** — `tideDependent`, `seasonal`, `needsWalk`,
  `cost`, opening hours (data is sparse; UI must tolerate unknowns).
- **F11. Site log** — visit note + photo (IndexedDB blob store; schema bump to
  v2). The DB fields and `markVisited(note)` plumbing already exist.
- **F17. User-state export/import** — JSON download/restore of visited +
  wishlist (+ notes/photo refs). The cheap insurance that defers a sync
  backend indefinitely.

**Acceptance:** a note + photo attached to a visited site persists offline and
across reload; exported state re-imports cleanly into a fresh browser profile.

### Phase 4 — Travel time & smarter selection

- **F9. Travel-time sort** — cached road-time matrix (§7.5) replaces haversine
  for near-me ordering and outing routing/tightness. This is what fixes the
  Cornwall-estuary problem. Requires picking a matrix provider (§11).
- **F15. Orienteering subset selection** — time-budgeted outings: choose the
  subset that fits the budget and maximises value; **rarity-weighted** so
  under-visited types get preference; “pin as must-include” override.
- **F13. Density discovery (DBSCAN)** — offline suggestion of natural regions
  as day-outs, complementing the query-driven outing search.

---

## 7. Key algorithms

All hand-rolled, dependency-free, pure functions under `src/geo/` — they must
run offline and be unit-testable without a DOM.

### 7.1 Distance — haversine ✅ built
Great-circle metres between WGS84 points (`src/geo/haversine.ts`), plus
`formatDistance`. Correct as the crow flies, wrong on the ground — acceptable
for ordering until Phase 4.

### 7.2 Outing search — scored anchor-outward seed scan ✅ built (`src/geo/outing.ts`)

Inputs: `anchor`, selected types `T`, pool `P` (selected types, minus visited
unless included).

There is **no proximity cap** and **no padding** — the cluster is exactly one
site per selected type. Every pool site is a candidate seed; each seed’s
cluster is the nearest site of each selected type to it (the seed covers its
own type at distance 0), and seeds are scored so that *near and tight* beats
*near but sprawling*:

```
if some t ∈ T has no site in P: return null       // the only failure mode
sort P by proximity(·) ascending                   // stable; tie-break by id
for each seed in P:
  if best exists and proximity(seed) > best.cost: break            // exact cutoff
  members = nearest-to-seed site of each t ∈ T    // |members| = |T|
  cost    = proximity(seed) + W · Σ haversine(seed, member)
  keep the cheapest (id tie-break)
return { seed, members, distanceFromAnchor, radiusM }   // radiusM = spread
```

`proximity` and `W` are the only things route mode changes (issue #16), and
they are injected, not branched on:

| | `proximity(S)` | `W` | pool `P` |
|---|---|---|---|
| **Point** (no destination) | `haversine(anchor, S)` | 3 | selected types, minus visited |
| **Route** (destination set) | `detour(S, from, to)` (§7.4b) | 0 (§11.1) | …and minus anything outside the detour budget |

Properties worth preserving:
- The cost function is the balance knob: proximity plus the summed seed→member
  legs approximates the day’s travel. A seed whose *own* proximity exceeds the
  current best *total* cost can never win (the spread term is ≥ 0 and the scan
  is sorted by proximity), which makes the outward scan’s early exit exact —
  for any proximity function that is ≥ 0, detour included.
- One stop per type, always: a single-type query returns exactly the nearest
  site of that type; stop count = |T|, so the Maps export must respect the
  waypoint cap (F16).
- Deterministic for a given pool/anchor (stable sort + id tie-breaks).
- O(|P|²) worst case — trivial at ~1.2k sites; no indexing needed. Don’t add a
  spatial index until profiling says so.
- “Find another” = re-run with clusters overlapping previously returned
  members excluded; exhaustion returns null (“no more”). This is why the
  member choice must stay seed-*dependent* — see §11.1.
- Shown to the user: `distanceFromAnchor` (anchor → seed) and `radiusM`
  (spread), so a sprawling result is legible. In route mode neither is the
  headline: total added driving is (§6 F16 / issue #15).
- Failure diagnostics (`nearestPerSlot`) run over the pool *before* the
  corridor filter, so route mode can tell “there is no such site left” from
  “the nearest one is +34 km off your route” — the second is fixed by widening
  the budget, and the message says so.

### 7.3 Routing — NN + 2-opt ✅ built (`src/geo/tsp.ts`)
N ≤ `MAX_STOPS`, so nothing heavy: nearest-neighbour from the fixed anchor
seeds the tour; 2-opt reverses segments until no improvement. Open path in v1
(closed-loop option can come with Phase 4 budgets). Distance function is a
parameter — haversine now, matrix lookups in Phase 4 with no algorithm change.

### 7.4 Rarity scoring ✅ built
At load: `rarity(type) = 1 / log2(count[type] + 1)` (`src/geo/rarity.ts`).
Consumers: the F6 rarest-unvisited nudge (Stats tab), then rarity-weighted
selection value in F15 (Phase 4).

### 7.4b Journey corridor — detour + progress ✅ built (`src/geo/corridor.ts`)

The road-trip anchor. Every other distance surface hangs off a single *point*
(`position`); route discovery needs a **corridor**: “I’m driving A → B, what’s
worth stopping for on the way?” Three haversines per site, nothing else:

- `detour(S) = d(A,S) + d(S,B) − d(A,B)` — the extra ground covered by stopping
  at S instead of driving straight through.
- `progress(S)` — S projected onto the A→B line, normalised to 0–1, via the law
  of cosines on those same three legs. Gives travel order.
- Corridor membership is `detour <= budget`.

Thresholding *detour* (rather than distance-to-line) traces an **ellipse with A
and B as its foci** — naturally fat in the middle of the drive and pinched at
both ends, which is what people mean by “on my way”. It also settles the “how
wide is a corridor?” question in the only unit a driver cares about: extra
kilometres. `corridorEllipse` returns that ring for the map overlay (drawn on a
local plane — presentation only; membership is always decided on real haversine
distances).

Point mode is the special case `destination === null`, where every surface
behaves exactly as it did before route mode existed.

### 7.5 Distance-matrix caching (Phase 4)
Road times need a routing engine, but only *while planning* (on wifi), not
while driving. Fetch the N×N matrix once (OSRM `table` / ORS matrix / Google),
cache in IndexedDB keyed by the rounded coordinate set, and run all local math
against the cache forever after. Abstract behind
`getMatrix(points): Promise<number[][]>` so the provider is swappable.

### 7.6 DBSCAN (Phase 4)
Haversine metric, `eps` ≈ 5–8 km, `minPts` 2–3, run once per data change,
cache labels. Discovery (“what regions exist”), not query (“what’s near me
now”) — the outing search (§7.2) deliberately replaced it for the query case
because the type selection changes per query and anchoring matters.

---

## 8. External integrations

- **Geolocation** ✅ — `watchPosition` with high accuracy; on denial/failure
  the map’s 📍 control drops a manual “I am here” pin (`manual: true`), which
  the near-me list, directions origin, and outing anchor all respect.
- **Google Maps deep links** ✅ (`src/links/googleMaps.ts`):
  - Directions: `…/maps/dir/?api=1&destination=lat,lng` (+ `origin` when the
    anchor is a manual pin).
  - Place lookup (pubs): `…/maps/search/?api=1&query=<name> <postcode>` —
    lands on the pub’s listing (photos, hours) to borrow Google’s rich data.
  - Multi-stop: `…/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b|c` —
    built and guarded at 9 waypoints; **verify the live cap** when F16 ships.
- **Geocoding (build-time only)** ✅ — postcodes.io for pub postcodes, cached
  in-repo; never called at runtime.
- **Routing matrix (Phase 4)** — provider undecided (§11).

---

## 9. Offline strategy ✅ implemented

- **App shell + data:** Workbox precache via `vite-plugin-pwa`
  (`globPatterns` includes `sites.json`); `registerType: 'autoUpdate'`.
- **Tiles:** runtime cache-first on `*.tile.openstreetmap.org` (2,000 entries,
  60-day expiry). A “download this region” pre-warm action remains future work.
- **User state (+ future matrices/photos):** IndexedDB.
- Phase 2 adds no new offline surface: stats and outing mode are pure local
  computation over already-cached data.

---

## 10. Repo layout (actual)

```
scripts/
  ingest.ts            // build-time CSV → public/data/sites.json
  geocode.ts           // postcode → coords via postcodes.io, cached
  scrape-camra.ts      // optional pub descriptions → data/camra-descriptions.json
data/
  geocode-cache.json   // committed geocode cache (build determinism)
  camra-descriptions.json
src/
  data/
    ingest.ts          // pure mapping/validation/dedupe logic
    mappings/          // one SourceMapping per CSV (magical_britain, camra)
    types.ts           // Site, SiteCategory taxonomy, labels, colours
  state/
    store.ts           // Zustand store (sites, user state, filters, position)
    db.ts              // idb wrappers: visited, wishlist
    selectors.ts       // useVisibleSites (filter + distance + sort)
    useGeolocation.ts
  geo/
    haversine.ts
    rarity.ts
    outing.ts          // §7.2 scored seed scan
    tsp.ts             // NN + 2-opt
  map/MapView.tsx      // Leaflet direct; pins, location, drop-pin, route overlay
  ui/
    App.tsx            // sheet tabs: Near me · Filters · Outing · Stats
    NearMeList.tsx  Filters.tsx  SiteDetail.tsx
    Stats.tsx          // F6
    Outing.tsx         // F12/F14/F16
  links/googleMaps.ts  // directions, place lookup, multi-stop builders
public/data/sites.json // generated — never hand-edit
```

---

## 11. Open decisions

Settled since the original spec: **React** (not Svelte); **no OSGB conversion**
needed for current sources; outing-mode semantics (full-house clusters, scored
anchor-outward scan, raw distance, **no proximity cap** — nearness/tightness
balanced by the cost function, spread always displayed — unvisited-by-default
with toggle, independent type picker, single-answer UI with “find another”,
route + multi-stop handoff in v1).

Still open — surface these rather than silently picking:

1. **Outing cost function** — v1 scores clusters by anchor distance + summed
   seed→member legs. After real outings, decide whether tightness needs more
   or less weight (or a user-facing knob).

   *Route mode (issue #16) has already forced half of this.* The finder
   generalises to a corridor by injecting `detour` as the proximity term, and
   the spread weight had to be re-tuned from 3 to **0** to stop it collapsing
   every road trip into one knot of sites: on a corridor the budget already
   bounds sprawl, so spread only ends up charging for distance *along* the
   route, which is driving you were doing anyway. Measured (swim + ruin + pub,
   20 km budget, extra driving over the direct route):

   | Journey | W=0 | W=1 (≈W=2≈W=3) |
   |---|---|---|
   | Glasgow → Portree | +5.8 km, at 10/24/37% of the way | +22.4 km, at 0/2/3% |
   | London → Bristol | +2.8 km, at 12/23/33% | +1.7 km, at 2/2/2% |
   | Manchester → York | +23.0 km, at 0/21/35% | +20.4 km, at 35/34/39% |
   | Exeter → Penzance | +7.4 km, at 80/83/86% | +4.9 km, at 80/82/82% |

   **Still open, and the more interesting half:** scoring each member by its own
   detour rather than by its distance from the seed does better again (+0.8 /
   +0.0 / +24.9 / +1.2 km on the same four journeys — near the floor, and
   naturally spaced along the drive). It was *not* adopted, because it makes
   member choice seed-independent: every seed then yields the same cluster, so
   “find another” has nothing disjoint to offer and dies after one result.
   Making it work needs a different exclusion rule — drop shown members from the
   candidate pool instead of rejecting whole clusters — which would change point
   mode too. Field-test route mode first; if the stops it picks feel like
   detours rather than discoveries, that's the change to make.
2. **Tile provider** — keyless OSM works; a keyed MapTiler/Thunderforest
   outdoor style would suit rural footpaths. Costs a key + attribution change.
3. **Photo storage (Phase 3)** — IndexedDB blobs (recommended, offline-safe)
   vs object-URL references.
4. **Routing matrix provider (Phase 4)** — ORS free key vs self-hosted OSRM vs
   Google.
5. **Cross-device sync** — stay client-only with export/import (F17), revisit
   only if the friction is real.
6. **Free-text destination entry (route mode)** — settled *for now* by the
   architecture, not by preference: runtime geocoding is out (build-time and
   cached only), so a destination comes from a map tap or from a site already
   in the dataset (“Set as destination” on any site card). That covers the
   road-trip intent. Typing “Fort William” would need either a coarse offline
   place index (a few hundred GB towns is small — the realistic option) or an
   online-only lookup, which breaks the airplane-mode guarantee. Revisit after
   a real road trip: if tapping the map for a destination is the friction,
   ship the offline index.
7. **Detour budget on a short journey** — the budget is absolute, so a 20 km
   budget on a 2 km drive traces an ellipse far larger than the journey. It is
   geometrically correct and the user asked for it, but it may want a cap
   relative to journey length. Field-test before adding policy.

---

## 12. Next steps

Phase 2 is code-complete (stats + outing mode v1, verified against the real
dataset with typecheck, build, and algorithm acceptance checks). What remains:

1. **Field test** — use outing mode on a real outing. Watch two things in
   particular: whether the cost function’s nearness/tightness balance feels
   right (§11.1), and whether the Maps multi-waypoint cap still holds at 8
   stops.
2. Let the annoyances pick between Phase 3 (notes/photos, condition filters,
   export/import) and Phase 4 (travel time).
