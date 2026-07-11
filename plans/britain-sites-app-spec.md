# Britain Sites — Implementation Spec

*Working title. A personal, offline-first PWA for visiting curated location pins across Britain.*

---

## 1. Goal and non-goals

**Goal.** Turn a set of curated location CSVs (folkloric/magical sites, wild swimming spots, etc.) into a *visiting companion* — a tool that maximises engagement with the collection and the number of sites actually visited, rather than just storing pins on a map.

The product exists because Google My Maps and the travel-tracker apps store and display pins well but cannot do the active field loop: *"I'm here now — what's nearby, which have I not done, and how do I chain several into one outing."*

**Non-goals.**
- Not a navigation engine. Turn-by-turn is delegated to Google Maps via deep links.
- Not a pin *authoring* tool primarily. Data is curated externally (CSV) and treated as read-only; the app layers personal state on top.
- Not multi-user or social. Single user, single owner of the data.
- Not a backend-heavy service. Default architecture is client-only (see §3). A backend is an optional later addition for cross-device sync.

---

## 2. Core principle

Everything is anchored to **engagement** and **completion**. Two features carry that weight and must never be cut:

1. **Near me now** — live location, every site sorted by *distance* (later: travel time), filterable by type, one tap to directions.
2. **Visited / wishlist state with completion stats** — the mechanism that turns a viewer into a collection with a shape and a finish line.

Cluster/outing mode and rarity weighting build on these. If a feature doesn't serve "visit more, and more varied, sites," it's a candidate for cutting.

---

## 3. Architecture

**Client-only PWA, offline-first.** No backend required for the full MVP and Phase 2.

```
┌─────────────────────────────────────────────┐
│  PWA (single-page app, installable)          │
│                                               │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │ Site data   │   │ User state           │  │
│  │ (read-only) │   │ (visited, wishlist,  │  │
│  │ from CSV →  │   │  notes, photos,      │  │
│  │ normalized  │   │  cached matrices)    │  │
│  │ JSON        │   │ → IndexedDB          │  │
│  └─────────────┘   └──────────────────────┘  │
│                                               │
│  Map (Leaflet) · Geolocation · Service Worker │
└─────────────────────────────────────────────┘
            │                       │
            ▼                       ▼
   OSM/MapTiler tiles      Google Maps deep link
   (cached offline)        (directions handoff)
```

Why client-only: the dataset is small (hundreds to low thousands of points), the user is the only consumer, and offline operation in no-signal rural Britain is a hard requirement. A server would add ops burden for no functional gain at MVP. The *only* thing a backend buys later is visited-state sync across phone + laptop — deferred until that friction is actually felt.

---

## 4. Tech stack

| Concern | Choice | Rationale / alternative |
|---|---|---|
| Build/dev | Vite + TypeScript | Fast, zero-config PWA story. |
| UI | React | Familiar; pick **Svelte** if you want lighter bundle + less ceremony. The app is small enough that either is fine. |
| Map | Leaflet | Mature, light, great offline-tile ecosystem. MapLibre GL if you want vector tiles/rotation later. |
| Tiles | OSM raster via a keyed provider (MapTiler/Thunderforest) | OSM detail suits rural footpaths. Outdoor/topo styles are worth the key. |
| CSV ingest | Papa Parse | Robust, streaming, handles messy real-world CSVs. |
| Persistence | IndexedDB via `idb` | localStorage is too small once photos + cached matrices land. Use IndexedDB from day one. |
| Service worker | Workbox | Precache app shell + runtime-cache tiles and data. |
| State | Zustand (or Svelte stores) | Lightweight; avoid Redux ceremony. |
| Geometry/routing | Hand-rolled (haversine, NN, 2-opt, DBSCAN) | Small, dependency-free, fully offline. See §7. |

Keep it a single SPA. No SSR, no routing framework beyond a tiny hash router if needed.

---

## 5. Data model

### 5.1 Normalized Site (read-only, derived from CSVs)

```ts
type SiteType =
  | 'holy_well' | 'standing_stone' | 'stone_circle' | 'hillfort'
  | 'ancient_cross' | 'barrow' | 'folklore' | 'wild_swim' | 'other';

interface Site {
  id: string;            // stable, derived: slug(name)+rounded(lat,lng)
  name: string;
  type: SiteType;        // controlled vocabulary (mapped at ingest)
  lat: number;           // WGS84
  lng: number;           // WGS84
  description?: string;
  county?: string;
  source: string;        // which CSV / guidebook chapter this came from

  // Condition / access metadata (all optional, sparse in practice)
  access?: string;       // free text
  tideDependent?: boolean;
  seasonal?: boolean;
  needsWalk?: boolean;
  cost?: 'free' | 'paid';
  openingHours?: string;
}
```

`rarity` is **not stored** — it's derived at load time from the frequency of each `type` across the dataset (see §7.4).

### 5.2 CSV ingest / normalization

The CSVs are heterogeneous (different guidebooks, different column names, some with OS grid refs rather than lat/lng). Handle this with a **per-source mapping config**, not bespoke parsers:

```ts
interface SourceMapping {
  source: string;
  columns: {                      // CSV header → Site field
    name: string;
    lat?: string; lng?: string;   // if already WGS84
    gridRef?: string;             // if OSGB — convert at ingest
    type?: string;
    [k: string]: string | undefined;
  };
  typeMap: Record<string, SiteType>;  // raw type string → controlled vocab
}
```

Ingest pipeline: read CSV → apply mapping → (convert OSGB grid ref → WGS84 if needed) → validate (lat/lng present and in-range) → dedupe by `id` → emit normalized JSON bundled with the app (or loaded at runtime). Log rows that fail validation rather than dropping silently.

> Note: Megalithic-Portal-style data uses OS grid references. If any source CSV carries grid refs, add an OSGB→WGS84 step (e.g. via a small `proj4`/`OSGridRef` helper). Flag unnamed/uncoordinated rows — that's the classic import failure mode.

### 5.3 User state (read-write, IndexedDB)

```ts
interface VisitLog {
  siteId: string;
  visitedAt: string;   // ISO date
  note?: string;
  photoBlobKey?: string;  // IndexedDB blob store key
}

interface UserState {
  visited: Record<string, VisitLog>;  // keyed by siteId
  wishlist: Set<string>;               // siteIds
  // cachedMatrices handled separately, see §7.5
}
```

Strict separation: site data is replaceable/regenerable; user state is precious. Never key user state on anything that changes when a CSV is re-imported — hence the stable `id` derivation.

---

## 6. Features by phase

Build in this order. Each phase is independently useful and shippable.

### Phase 1 — MVP (≈ a weekend)

The whole engagement loop, with straight-line distance and naive routing absent.

- **F1. Ingest** one or more CSVs via the mapping config → normalized sites.
- **F2. Map view** — Leaflet map, pins coloured by type, user location dot + accuracy ring.
- **F3. Type filter** — toggle site types on/off; affects both map and list.
- **F4. Near me now** — list of sites sorted by *haversine* distance from current location, respecting active type filters. Shows distance; tap-through to detail.
- **F5. Visited / wishlist** — mark any site visited (with date) or wishlisted; visual state on map and list (e.g. greyed + tick for visited).
- **F6. Completion stats** — total visited / total, plus per-type and per-county breakdown. A "rarest type you haven't seen" nudge.
- **F7. Directions handoff** — single-site → open Google Maps directions deep link to that pin.
- **F8. PWA / offline** — installable; app shell, data, and viewed map tiles cached; visited state persists in IndexedDB and survives offline.

**Acceptance:** with location spoofed to a point in Cornwall and one real CSV loaded, the near-me list orders correctly, type filters work, a site can be marked visited and the stat updates, directions open in Google Maps, and the app loads and shows pins with the network disabled.

### Phase 2 — Make it accurate and personal

- **F9. Travel-time sort** — replace/augment haversine with cached road travel times (see §7.5). Near-me list sorts by minutes, not crow-flies. (This is what makes the Cornwall estuary problem go away.)
- **F10. Condition filters** — filter by `tideDependent`, `seasonal`, `needsWalk`, `cost`, opening hours.
- **F11. Site detail + log** — per-site page: metadata, your visit date, a note, an optional photo (stored as IndexedDB blob). This is the "personal record" Google My Maps can't be.

**Acceptance:** with a pre-fetched matrix cached, two sites that are close as the crow flies but far by road sort by the road time; a photo+note attached to a visited site persists offline and across reload.

### Phase 3 — Cluster / outing mode

The headline differentiator. Two separable sub-problems — **grouping** and **routing** — kept apart (see §7).

- **F12. Anchor-based grouping** — pick an anchor (current location or a chosen base) + a range (radius or, better, travel-time budget); collect matching sites.
- **F13. Density grouping (discovery)** — run DBSCAN over the whole dataset once; surface natural regions as suggested day-outs, outliers left unclustered.
- **F14. Route within a group** — nearest-neighbour seed + 2-opt cleanup, fixed start, optional closed loop. Output an ordered itinerary.
- **F15. Subset selection (orienteering)** — when the candidate set exceeds the time budget, choose the subset that fits and maximises value; default value = count, upgrade to **rarity-weighted** so under-visited types get preference. "Pin as must-include" override.
- **F16. Multi-stop handoff** — send the whole ordered route to Google Maps as a multi-waypoint directions URL in one tap.

**Acceptance:** from a chosen base with a 6-hour budget, the app proposes an ordered loop that fits the budget, prefers unvisited and rarer types, respects any pinned must-includes, and exports as a single Google Maps URL that opens with all stops in order.

---

## 7. Key algorithms

### 7.1 Distance — haversine (MVP, offline, free)
Great-circle distance between two lat/lng. Correct for "as the crow flies," wrong on the ground — acceptable for MVP ordering, replaced by road time in Phase 2 for routing decisions.

### 7.2 Routing — nearest-neighbour + 2-opt
For a day's outing N is small (< ~15), so no need for anything heavy.
- NN: from the fixed start, repeatedly hop to the nearest unvisited node → initial tour.
- 2-opt: repeatedly reverse tour segments where doing so shortens total length, until no improvement. Removes the crossings NN leaves behind; gets within a whisker of optimal at this N.
- (Held–Karp gives provably optimal up to ~15 nodes if ever wanted, but 2-opt is the better effort/payoff.)

### 7.3 Grouping — DBSCAN
Density-based, so you don't pre-specify cluster count and outliers stay unclustered (unlike k-means, which is the wrong tool here).
- Distance: haversine.
- `eps`: tune to terrain — start ~5–8 km for "a day's region."
- `minPts`: 2–3, so a pair/triple of sites can form a cluster.
- Run once on load (or on data change); cache the labels.

### 7.4 Rarity scoring
At load, compute `count[type]` across all sites. `rarity(type) = 1 / count[type]` (or `log` -dampened). A site's selection value in §7.5 = base × rarity multiplier × (unvisited ? 1 : 0 or a low factor). This directly serves "visit as many *different* things as possible" and reuses completion data.

### 7.5 Orienteering (subset selection)
When candidate travel cost > budget: greedily add the site with the best value/marginal-cost ratio while the tour still fits, then 2-opt the chosen set. Honour pinned must-includes first. Greedy or simple branch-and-bound is plenty at this N.

### 7.6 Distance-matrix caching (the offline reconciliation)
Road times need a routing engine, but you don't need road data *while driving* — you need it *while planning*, typically the night before on wifi.
- When a candidate set is assembled, fetch the **N×N travel-time matrix** once from a routing engine (OSRM `table`, Openrouteservice matrix, or Google Distance Matrix).
- Cache it in IndexedDB keyed by the rounded coordinate set.
- All TSP/orienteering math runs locally against the cached matrix forever after — fully offline.
- A day's set is ~15×15 ≈ 200 entries: trivial to fetch and store.

---

## 8. External integrations

- **Geolocation:** browser `navigator.geolocation.watchPosition` for the live dot. Handle permission-denied and low-accuracy gracefully (fall back to a manually dropped "I am here" pin).
- **Routing engine (matrix only):** pick one of OSRM (self-host or public demo — rate-limited), Openrouteservice (free key, has a matrix endpoint), or Google Distance Matrix (paid, accurate). Abstract behind one `getMatrix(points): Promise<number[][]>` interface so it's swappable.
- **Google Maps directions:**
  - Single: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`
  - Multi-stop: `https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=<lat,lng>|<lat,lng>|...`
  - ⚠️ The consumer URL scheme caps intermediate waypoints (historically ~9). That's comfortably more than a sane day, but **verify the current limit** before relying on it, and chunk if a route ever exceeds it.

---

## 9. Offline strategy

- **App shell:** Workbox precache (HTML/JS/CSS/icons).
- **Site data:** bundled with the build, or runtime-cached on first load.
- **Tiles:** runtime cache-first with a generous expiration; optionally a "download this region" action that pre-warms tiles for a bounding box before a trip.
- **User state + matrices:** IndexedDB (always available offline).
- **Mental test:** after one online session covering a region, the app must be fully functional in airplane mode for that region — map, pins, near-me, visited, and any pre-fetched route matrices.

---

## 10. Suggested repo layout

```
src/
  data/
    ingest.ts          // CSV → normalized Site[]
    mappings/          // one SourceMapping per CSV
    osgb.ts            // grid-ref → WGS84 (if needed)
  state/
    store.ts           // Zustand store
    db.ts              // IndexedDB (idb) wrappers: state, photos, matrices
  geo/
    haversine.ts
    tsp.ts             // NN + 2-opt
    dbscan.ts
    orienteering.ts
    rarity.ts
    matrix.ts          // getMatrix() + cache
  map/
    MapView.tsx        // Leaflet map + pins + location
  ui/
    NearMeList.tsx
    Filters.tsx
    SiteDetail.tsx
    Stats.tsx
    OutingPlanner.tsx
  links/
    googleMaps.ts      // deep-link builders
  sw.ts                // Workbox service worker
public/
  data/                // normalized site JSON, icons, manifest
```

---

## 11. Open decisions (for you to settle)

1. **Cross-device sync.** Stay client-only (manual export/import of user state as JSON) or add a thin backend later? Recommend deferring; ship an export/import button in Phase 2 as the cheap insurance.
2. **Routing engine** for the matrix — ORS free key is the path of least resistance to start; OSRM self-host if you outgrow rate limits.
3. **Coordinate source** — confirm which CSVs are lat/lng vs OSGB grid ref; only build the conversion if a source needs it.
4. **Photo storage** — IndexedDB blobs (recommended, offline-safe) vs object-URL references (lighter but fragile). 
5. **React vs Svelte** — pick once; both fit. Svelte if bundle size / simplicity matters more than ecosystem familiarity.

---

## 12. First steps

1. Scaffold Vite + TS + (React|Svelte) + Workbox PWA template; confirm it installs and runs offline with a placeholder shell.
2. Build the ingest pipeline against **one** real CSV; eyeball the normalized JSON.
3. Render the map with those pins, coloured by type.
4. Add the geolocation dot + haversine near-me list.
5. Add visited/wishlist + IndexedDB persistence, then the stats panel.
6. Wire the single-site Google Maps deep link.

That's the MVP. Stop, use it on a real outing, and let the specific annoyances tell you whether Phase 2 (road times) or Phase 3 (clustering) comes next.
