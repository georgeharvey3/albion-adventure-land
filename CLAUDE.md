# CLAUDE.md

Guidance for working in this repo. The authoritative design document is
[`britain-sites-app-spec.md`](./britain-sites-app-spec.md) — read it before making
non-trivial decisions. This file captures the conventions and invariants that
the spec implies but doesn't spell out for day-to-day work.

## What this is

An offline-first, client-only **PWA** for visiting curated location pins across
Britain (folkloric/magical sites, wild swimming, etc.). It is a *visiting
companion*, not a pin-authoring or navigation tool. The whole point is the field
loop: "I'm here now — what's nearby, which have I not done, and how do I chain
several into one outing."

The two features that must never be cut (the product's core principle):

1. **Near me now** — live location, every site sorted by distance, type-filterable, one tap to directions.
2. **Visited / wishlist state with completion stats** — turns a viewer into a collection with a finish line.

If a feature doesn't serve "visit more, and more varied, sites," it's a candidate for cutting.

## Architecture (do not drift from this)

- **Client-only. No backend** for the full MVP and Phase 2. A server buys *only*
  cross-device visited-state sync, and that is deferred until the friction is felt.
- **Offline-first is a hard requirement**, not a nice-to-have — the target use is
  no-signal rural Britain. The mental test: after one online session covering a
  region, the app must be fully functional in airplane mode for that region.
- Single SPA. No SSR, no heavy router (a tiny hash router at most).

## Tech stack

Vite + TypeScript · React (settled — do not revisit) · Leaflet (direct, no
react-leaflet) · Papa Parse (CSV) · IndexedDB via `idb` · Workbox via
`vite-plugin-pwa` · Zustand (state). Geometry/routing is **hand-rolled and
dependency-free** (haversine; outing seed scan + NN/2-opt next) so it runs
fully offline. See spec §4 and §7.

## Data model — the critical invariant

**Site data is replaceable; user state is precious. Keep them strictly separated.**

- `Site` is read-only, derived from CSV → normalized JSON. Its `id` is **stable
  and derived**: `slug(name) + rounded(lat,lng)` for coordinate sources, and
  `slug(name) + slug(postcode)` for geocoded sources (pubs) — deliberately not
  coordinate-based there, so re-geocoding never changes the id. Never key user
  state on anything that changes when a CSV is re-imported.
- `UserState` (visited, wishlist, notes, photos, cached matrices) lives in
  IndexedDB, keyed by the stable site `id`. This is the data we must never lose.
- `rarity` is **not stored** — it is derived at load time from category
  frequency across the dataset (spec §7.4). Same rule for the parent category
  and listing `parentId`: derivable things are derived, never stored as state.
- `SiteCategory` (leaf) is a controlled vocabulary mapped at ingest, *not* a raw
  CSV value; the two-level taxonomy (Folklore → leaves; Historic pubs) lives in
  `src/data/types.ts`.

## CSV ingest — read before touching `data/`

- CSVs are heterogeneous (different guidebooks, column names, some with OS grid
  refs instead of lat/lng). Handle this with a **per-source `SourceMapping`
  config**, not bespoke parsers. One mapping file per CSV under
  `src/data/mappings/`. Postcode-only sources (CAMRA) are geocoded at build time
  (`scripts/geocode.ts`, cached in `data/geocode-cache.json`) — **ingest never
  geocodes at runtime.** (Location search does call a geocoder at runtime, but
  only ever to *add* results on top of a shipped offline dictionary — see below.
  Site data is still built offline, always.)
- **Use Papa Parse, never naive splitting.** The real data has multi-line
  description fields with embedded commas and newlines — `cut`/`split(',')` will
  corrupt rows. (You can see this in `magical_britain_master.csv`.)
- In `magical_britain_master.csv`, `point_type` encodes the *structural role* of
  a row (`main`, `trailhead`, `trailhead_parking`, `nearby_feature`), and the
  human site name is in `point_name`. This is **not** the `SiteType` vocab — map
  accordingly. A `listing` groups a main point with its trailheads/features.
- Pipeline: read → apply mapping → (OSGB grid ref → WGS84 if needed) → validate
  (lat/lng present and in range) → dedupe by `id` → emit normalized JSON.
  **Log rows that fail validation; never drop them silently.** Unnamed /
  uncoordinated rows are the classic import failure — flag them.
- Pub enrichment is a separate, manual step: `npm run scrape:camra` reads each
  pub's page on the CAMRA site and writes the description, the source link and
  the first three gallery pictures to `data/camra-descriptions.json`, keyed by
  the stable pub id. The pictures are downscaled to 720 px and written to
  `data/camra-images/`; `npm run ingest` copies them to `public/images/camra/`.
  Pubs have no listing number, so they use this map instead of a companion
  images CSV. The scraper is resumable and the build never depends on it — a
  fresh checkout without the cache gives sparse pub cards.
- Scramble pictures are the same kind of step: `npm run scrape:ukc` visits each
  route's crag page on UKClimbing, downscales the pictures to 720 px, and writes
  them to `data/ukc-images/`. The index is `data/ukc-photos.json`, keyed by the
  stable site id. Two facts about UKClimbing drive the design. It sits behind a
  Cloudflare challenge that plain `fetch` and headless Chrome never pass, so the
  scraper drives a real, headed Chrome through Playwright and needs a display
  (`DISPLAY`, or Xvfb). That Chrome must also start without Playwright's usual
  `--enable-automation` flag: the flag sets `navigator.webdriver`, and that one
  value decides whether the page loads or an interactive checkbox appears that
  no synthetic click can tick. `img.ukclimbing.com` also refuses every request the
  script makes itself, so the script takes the bytes out of the image responses
  that the crag page loads. Pictures belong to the crag, not to the route, and
  routes at one crag share a picture — the per-route galleries sit behind
  `/logbook/crag_photos.php`, which answers 403. The scraper is resumable, keeps
  its Chrome profile in `data/.ukc-profile/` for the clearance cookie, and reads
  one page at a time with a delay: this is somebody else's website. `npm run ingest` copies the
  files to `public/images/ukc/`, and the build never depends on the cache.
- Only build the OSGB→WGS84 step if a source actually needs it (this CSV carries
  both lat/lng and `os_grid_ref`, so ingest still doesn't need it). It now exists
  anyway, in `src/geo/osgb.ts`, because **location search** accepts typed grid
  references — but ingest does not use it.

## Location search (issue #28)

Search is **offline-first in the same way the rest of the app is**, and the
layering is the feature — don't collapse it:

- `public/data/places.json` is a **shipped, precached dictionary** (~250 KB:
  GB settlements, national parks, landmarks, and outward postcode codes), built
  by `npm run gazetteer` and **committed**. It is not rebuilt by `npm run build`.
- `searchLocal()` answers from that dictionary + the site data + typed
  coordinates/grid refs. **It never touches the network, and it is the whole
  feature offline.**
- `searchOnline()` (Photon, postcodes.io) is a **pure enhancement**: every
  failure path returns `[]`, never throws, and never blocks a render. Results it
  finds are cached to IndexedDB so the offline set grows with use.
- The rule to preserve: **losing signal must change how many results appear,
  never whether search works.** If a change would make search depend on the
  network, it's wrong.
- Place data is GeoNames (CC BY 4.0). The attribution string is baked into
  `places.json` and rendered in the overlay — don't strip it.

## Build order (each phase independently shippable)

- **Phase 1 (MVP): shipped** — ingest (2 sources) → map → two-level type filter
  → near-me (haversine) → visited/wishlist → directions handoff → PWA/offline.
  Completion stats (F6) was *not* built with it and moved to Phase 2.
- **Phase 2: built** — completion stats (F6, consumes the rarity index) +
  **outing mode v1** — pick ≥1 site types in a picker *independent of the map
  filter*; find the nearest cluster of **exactly one site per selected type**
  (scored anchor-outward seed scan, spec §7.2; raw haversine only; **no
  proximity cap and no padding** — the cost function balances nearness vs
  tightness and the spread is displayed; unvisited by default with an
  include-visited toggle) → order it with NN + 2-opt → multi-stop Maps
  handoff (hidden when the selection exceeds the waypoint cap).
- **Phase 3:** condition filters → site log (note + photo as IndexedDB blob) →
  user-state export/import.
- **Phase 4:** travel-time sort (cached road-time matrix) → orienteering subset
  selection (rarity-weighted) → DBSCAN density discovery.

Build in order; each phase has explicit acceptance criteria in spec §6. Travel
time is deliberately deferred — outing mode v1 ships on raw distance.

## Conventions

- Suggested layout is in spec §10 (`src/{data,state,geo,map,ui,links}`,
  `public/data`). Follow it unless there's a concrete reason not to.
- Abstract the routing engine behind one `getMatrix(points): Promise<number[][]>`
  so it's swappable (ORS / OSRM / Google). Cache matrices in IndexedDB keyed by
  the rounded coordinate set.
- Google Maps handoff is deep-link only (no embedded directions). Verify the
  current multi-waypoint cap before relying on it; chunk if a route exceeds it.

## Working agreements

- Keep dependencies minimal — the offline/bundle-size story is a feature.
- Don't introduce a backend, SSR, or a state-management framework heavier than
  Zustand without raising it first.
- When the spec lists an open decision (§11: outing cost function, tile
  provider, photo storage, routing engine, sync), surface it rather than
  silently picking.
