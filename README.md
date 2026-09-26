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
- **Visited / wishlist** — turn a pile of pins into a collection. The Saved tab
  holds the wishlist, the visit log and the sites you have hidden.
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
| 2 — Outing mode v1 | Nearest "full house" cluster of selected types (raw distance, no proximity cap) · route (NN + 2-opt) · multi-stop Maps handoff | Built |
| 3 — Personal record | Condition filters · visit note + photo · user-state export/import | Not started |
| 4 — Travel time | Cached road-time matrix · time-budgeted (orienteering) outings · DBSCAN discovery | Not started |

## Tech stack

Vite · TypeScript · React · Leaflet · Papa Parse · IndexedDB (`idb`) · Workbox ·
Zustand. Geometry and routing are hand-rolled and dependency-free so everything
runs fully offline.

## Architecture in one breath

Client-only single-page PWA. Read-only **site data** (CSV → normalized JSON)
plus read-write **user state** (visited, wishlist, notes, photos, cached travel
matrices) in IndexedDB. Map tiles from OSM/MapTiler, cached offline. Turn-by-turn
navigation is delegated to Google Maps via deep links. The app has one server,
for Ethelred only (`docs/adr/0002-ethelred-server.md`). No other feature
depends on it.

## Data

- `magical_britain_master.csv` — folklore/magical sites (West Penwith / North
  Wales). CSVs are heterogeneous and messy (multi-line descriptions, per-source
  columns), so ingest uses a per-source mapping config and Papa Parse.
- `CAMRA.csv` — heritage pubs of all three CAMRA grades (3-star, 2-star,
  1-star), postcode-only. The rows are geocoded at build time (cached in
  `data/geocode-cache.json`), with optional scraped descriptions and pictures
  (`npm run scrape:camra`). The grade rides along as a filter tag, and a session
  opens on the 3-star and 2-star pubs.
- User state is kept strictly separate from site data and keyed on a stable,
  derived site `id`, so re-importing a CSV never loses your visit history.

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

## Ethelred server

Ethelred is the travel agent. It answers questions in plain language from the
site data. The server is in `server/`. It runs the agent loop and three tools:
`resolve_place`, `find_sites` and `read_sites`. It sends each answer back as
server-sent events. The server keeps no user state. The app does not use it
yet (issue #63).

The model is behind one OpenAI-compatible adapter. By default, the server uses
vLLM at `http://localhost:8000/v1` with `Qwen/Qwen3.5-4B`.

```bash
npm run ethelred:index   # build the semantic index (the server also builds it if it is stale)
npm run ethelred         # start the server on http://localhost:8787
npm run ask "Any swims on the way from Sheffield to Winchester?"
npm run eval             # run the golden set, 3 runs for each case
npm test                 # unit tests
```

These environment variables change the model:

| Variable | Default |
|---|---|
| `ETHELRED_MODEL_URL` | `http://localhost:8000/v1` |
| `ETHELRED_MODEL` | `Qwen/Qwen3.5-4B` |
| `ETHELRED_API_KEY` | none |
| `ETHELRED_MODEL_EXTRA` | none. A JSON object that the server adds to each request body. |
| `ETHELRED_MODEL_TIMEOUT_MS` | `120000` |
| `ETHELRED_PORT` | `8787` |

The eval replaces Photon, postcodes.io and OSRM with the responses in
`server/evals/recordings.json`. A run then depends only on the model, and it
works offline. If the report lists network calls with no recording, run
`npm run eval -- --record`.

On a laptop GPU with 8 GB, this command starts a model that fits:

```bash
vllm serve Qwen/Qwen3.5-4B --quantization fp8 --max-model-len 16384 --max-num-seqs 4 \
  --gpu-memory-utilization 0.92 --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --reasoning-parser qwen3 --language-model-only
```
