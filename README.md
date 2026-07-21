# Albion Adventure Land

An offline-first, installable PWA for **visiting** curated location pins across
Britain — folkloric and magical sites, holy wells, stone circles, wild swimming
spots, and more.

It is a *visiting companion*, not another pin store. Google My Maps and
travel-tracker apps display pins fine but can't do the active field loop this app
is built around:

> *"I'm here now — what's nearby, which have I not done, and how do I chain
> several into one outing?"*

## Why it exists

The collection lives as curated CSVs. This app layers the engagement loop on top:

- **Near me now** — your live location with every site sorted by distance,
  filterable by type, one tap to directions.
- **Visited / wishlist + completion stats** — turn a pile of pins into a
  collection with a shape and a finish line, including a nudge toward the rarer
  types you haven't seen yet.
- **Outing mode** — pick the kinds of day you want (a historic pub, a holy
  well, a stone circle…) and the app finds the nearest cluster containing one
  of each, orders it into a route, and exports it to Google Maps in one tap.

Built to work in **airplane mode** in no-signal rural Britain: after one online
session covering a region, the whole app keeps working offline for that region.

## Status

MVP shipped and deployed; outing mode is the current focus.

| Phase | Scope | State |
|---|---|---|
| 1 — MVP | Ingest (2 sources) · map · two-level type filter · near-me (haversine) · visited/wishlist · directions handoff · PWA/offline | Built |
| 2 — Stats + Outing mode v1 | Completion stats · nearest "full house" cluster of selected types (raw distance, no proximity cap) · route (NN + 2-opt) · multi-stop Maps handoff | Built |
| 3 — Personal record | Condition filters · visit note + photo · user-state export/import | Not started |
| 4 — Travel time | Cached road-time matrix · time-budgeted (orienteering) outings · rarity weighting · DBSCAN discovery | Not started |

## Tech stack

Vite · TypeScript · React · Leaflet · Papa Parse · IndexedDB (`idb`) · Workbox ·
Zustand. Geometry and routing are hand-rolled and dependency-free so everything
runs fully offline.

## Architecture in one breath

Client-only single-page PWA. Read-only **site data** (CSV → normalized JSON)
plus read-write **user state** (visited, wishlist, notes, photos, cached travel
matrices) in IndexedDB. Map tiles from OSM/MapTiler, cached offline. Turn-by-turn
navigation is delegated to Google Maps via deep links. No backend.

## Data

- `magical_britain_master.csv` — folklore/magical sites (West Penwith / North
  Wales). CSVs are heterogeneous and messy (multi-line descriptions, per-source
  columns), so ingest uses a per-source mapping config and Papa Parse.
- `CAMRA.csv` — heritage pubs, postcode-only; geocoded at build time (cached in
  `data/geocode-cache.json`) with optional scraped descriptions
  (`npm run scrape:camra`).
- User state is kept strictly separate from site data and keyed on a stable,
  derived site `id`, so re-importing a CSV never loses your visit history.
- **Site photos** (optional): `npm run fetch:images` resolves one photo per site
  at build time — pubs from their CAMRA page, named monuments via Wikidata,
  everything else via Wikimedia Commons geosearch (which includes the ~1.7M-photo
  Geograph import, so rural coverage is good). Results are cached in
  `data/image-cache.json` and normalized to ≤480px WebP in `public/images/`;
  re-run `npm run ingest` afterwards to bake them into `sites.json`. The run is
  resumable — interrupt it freely. Attribution (author · license · source link)
  is stored per photo and shown on the site card.

## Documentation

- [`britain-sites-app-spec.md`](./britain-sites-app-spec.md) — full implementation
  spec (the source of truth: goals, data model, algorithms, phases).
- [`CLAUDE.md`](./CLAUDE.md) — working conventions and invariants for contributors.

## Getting started

```bash
npm install
npm run ingest   # CSV → public/data/sites.json (re-run when the CSV changes)
npm run dev      # dev server
npm run build    # ingest + typecheck + production PWA build
npm run preview  # serve the production build
```

`npm run dev` opens the app: a Leaflet map of all sites coloured by type and a
bottom sheet with **Near me** (haversine-sorted), **Filters** (two-level type
toggles), **Outing** (nearest cluster with one of each selected type, routed
and exportable to Google Maps), and **Stats** (completion counts + rarest-
unvisited nudge). Tap a pin or list row for the site card — mark visited/wishlist or hand off to Google
Maps directions. If GPS is denied, use the 📍 button on the map to drop a manual
"I am here" pin. Visited/wishlist state persists in IndexedDB and survives
offline and reload.

> Tiles use keyless OSM raster for now; swap in a keyed provider (MapTiler /
> Thunderforest) in `src/map/MapView.tsx` for outdoor/topo styles.
