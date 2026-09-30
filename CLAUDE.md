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
2. **Visited / wishlist state** — turns a viewer into a collection. The Saved
   tab holds the wishlist, the visit log and the hidden sites.

If a feature doesn't serve "visit more, and more varied, sites," it's a candidate for cutting.

## Architecture (do not drift from this)

- **Client-only, except for Ethelred.** The app has one server, and it serves
  Ethelred only (issue #45, `docs/adr/0002-ethelred-server.md`). The server
  runs the agent loop and keeps no user state. No other feature can depend on
  it. Cross-device visited-state sync is still deferred until the friction is
  felt, and it is the only other thing a server can buy.
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
- Derivable things are derived, never stored as state. The parent category, the
  listing `parentId` and the categories a merged duplicate is findable under all
  follow this rule. **There is no rarity index and no completion statistics.**
  Both are torn out. A count of the sites that a filter shows is not a
  completion statistic, so the filter chips and the layer chips show one.
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
- `CAMRA.csv` holds all three CAMRA heritage grades: 3-star, 2-star and 1-star,
  about 1300 pubs. The grade is a source **tag** on the pub site, not a leaf
  category. One pin colour and one outing slot cover every pub; the grade
  narrows the pubs layer in the filter, and the pub's card shows it as a
  labelled row of three marks — `pubGrade` in `src/data/types.ts` derives it
  from the tag, like the parent category, and never stores it. A session opens
  with 3-star and 2-star picked (`DEFAULT_ACTIVE_TAGS` in `src/data/types.ts`),
  because the 1-star pubs are the largest group and they bury the rest.
- Pub enrichment is a separate, manual step: `npm run scrape:camra` reads each
  pub's page on the CAMRA site and writes the description, the source link and
  the first three gallery pictures to `data/camra-descriptions.json`, keyed by
  the stable pub id. The pictures are downscaled to 720 px and written to
  `data/camra-images/`; `npm run ingest` copies them to `public/images/camra/`.
  Pubs have no listing number, so they use this map instead of a companion
  images CSV. The scraper is resumable and the build never depends on it — a
  fresh checkout without the cache gives sparse pub cards. A full run reads
  about 1300 pub pages and takes more than one hour.
- A pub also carries facts that go stale: the opening times, the two dates CAMRA
  publishes (`Last surveyed`, `Last updated`) and the closure warning. These have
  their own script, `npm run refresh:camra`, and their own cache,
  `data/camra-status.json`, keyed by the same stable pub id. The split is the
  point. The scraper collects prose and pictures that are good for years and
  costs an hour; this script downloads no pictures, reads the same 1300 pages in
  about half an hour, and can run as often as the data deserves. Both read a page
  through `scripts/camra-page.ts`. Use `--stale=DAYS` to re-read only the entries
  that are older than DAYS. The build never depends on this cache either.
- **A site that the source says is shut leaves the app, but stays in the data.**
  A red closure banner on the pub page — CAMRA words it `Temporarily Closed`,
  `Permanently Closed` or `Closed Long Term`, and the banner, not the wording, is
  the rule — becomes `Site.closure`. `npm run ingest` still writes that site to
  `sites.json`, and the store drops it in one filter when the data loads
  (`src/state/store.ts`). One seam covers the map, the near-me list, search and
  the outing pool, and a pub that reopens comes back on the next refresh. About one pub in ten is shut at any time.
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
- Dedupe inside a source is by stable `id`, and that is all it can be. Two
  sources naming one place produce two different ids, so the cross-source merge
  is a separate, curated step that runs after every source — see
  **Cross-source duplicates** below.
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

## Cross-source duplicates (issue #37)

Two guidebooks describe one place. Tintern Abbey is a folklore row and a ruins
row. St Dyfnog's Well is a well and a wild swim. The names and the coordinates
differ by a word and a few metres, so the stable ids differ too, and the
per-source dedupe in ingest never sees the pair. One stone then gets two pins,
two visited ticks and two outing slots.

- A merge is **curated, never inferred**. `npm run dupes` proposes: it lists
  every pair from two different sources within 200 m, and the words the two
  names share. `data/duplicates.json` decides, and nothing else takes effect.
  No rule separates "Tintern Abbey / Tintern Abbey And St Mary's" (one abbey)
  from "Roman Baths / Ale House" (a pub 91 m from a Roman bath), or from
  "Mount Snowdon (summit) / Y Gribin" (a summit and the scramble up it).
- In each group the **first id keeps the pin**. That id's category decides the
  icon, the colour, the name on the card and the outing slot. It does *not*
  decide the filter layer — see the multi-category rule below. To change the
  choice, reorder the ids. The `note` field is for the human reader only.
- **No id changes, and nothing leaves the data.** The merged-away site keeps its
  row in `sites.json` and carries `duplicateOf`. The representative carries
  `duplicateIds` and `entries`. The store drops the merged rows in one filter
  when the data loads (`src/state/store.ts`) — the seam a closed pub goes
  through. That one seam covers the map, the near-me list, search and the outing
  pool.
- The site card shows **every source's write-up**, under a heading that names
  its layer: "Folklore entry", "Ruins entry". The sources say different things
  about one stone — one carries the legend, the other the fabric and the access —
  so a merge that picked a winner would throw half the visit away. The heading
  is derived from the entry's category and never stored.
- User state comes home in `foldDuplicateState`, once, as the data loads. It
  moves a visit, a wish or a hidden mark from a merged-away id to the
  representative, keeps the earlier visit date and keeps both notes. So the fold
  is safe to run again, and a change of representative cannot lose a visit.
  Every other reader still looks up one id and knows nothing about duplicates.
- **Tags are not merged.** A tag selection is scoped to the parent category it
  was picked under (`tagKey`), so a ruins tag on a folklore representative
  would invent a folklore chip that no folklore site carries.
- **One pin, every layer.** A merged place stays findable under each member's
  category. The representative carries the other rows' leaf categories in
  `alsoCategories`, and `categoriesOf(site)` in `src/data/types.ts` reads the
  full list. The filter matches any one of them, so Old Sarum answers both Ruins
  and Hillforts. All 33 groups in the data span two layers, so this is the
  normal case and not an edge case.
- **A merged place gets a hybrid pin.** Its fill is striped across every colour
  in `categoriesOf` — representative's first — so Old Sarum reads as ruins *and*
  hillfort under either filter, instead of wearing the other layer's colour
  while the hillforts filter is the one showing it. The stripes are drawn on the
  canvas renderer in `src/map/shapeMarker.ts` (`fillColors`), and the list dots
  mirror them with the same hard-edged 135° bands (`siteSwatch` in
  `src/data/types.ts`). Derived, never stored, like everything else here.
- The limits of that widening are deliberate. The representative's own
  `category` still decides the pin **shape**, the name, the type on the card and
  the outing slot — only the colour is shared. One place is one thing to visit
  and one thing to tick, so one stop can never fill both "a ruin" and "a
  hillfort" in an outing, and the shape stays the one honest answer to "what am
  I going to see".
- `matchesFilter` in `src/state/filter.ts` is the **one** definition of "is this
  site on the map now". The rendered list (`src/state/selectors.ts`) and
  `revealSite` (`src/state/store.ts`) both call it. When they had separate
  copies, the site finder could open a site that the map then refused to show.
- A filter chip counts the sites that the chip shows, so a merged place is
  counted under each of its categories. The chips therefore sum to more than the
  number of pins, by the number of merged places. A layer header counts sites,
  not chips. `siteLayers` in `src/state/layers.ts` makes the layer counts for
  the Filters tab and the layer chips.

## National glow (issue #74)

At national zoom, about 2,600 pins look like scattered crumbs. The map draws a
soft glow in each layer's colour under the pins, and the pins shrink to specks.

- The glow is hand-rolled on one canvas in `src/map/glowLayer.ts`. Do not add a
  heatmap library.
- The glow shows **no numbers**. It is a density, not a count, so the rule
  against completion statistics still holds.
- The glow gets the same `useFilteredSites` list as the pins, so it obeys
  `matchesFilter`. A glow that shows a layer the filter hides is wrong.
- The glow fades out between z6.5 and z8. At regional zoom the pins give all
  the information.
- **A pin with a ring is a pin you can tap.** Below 70% of full size
  (`SPECK_BELOW`), a pin loses its ring and takes no tap. A speck is smaller
  than a finger, so a tap on it opened a random card. The selected pin never
  shrinks. A tap within 20 px of a speck shows "Zoom in to tap a pin" for
  2.5 s. A tap on empty map shows nothing.
- The glow repaints only when a pan or a zoom ends. During the gesture, the
  canvas moves and scales with the map. Keep the pan free of work.

## Title card (issue #76)

A first visit opens with a title card over the map (`src/ui/TitleCard.tsx`).
It says what the app is, and nothing else.

- The card takes no taps. The first tap, pan, zoom or key press fades it out,
  and that gesture still reaches the map.
- It shows until the first dismissal. `titleSeen` in the view state
  (`src/state/viewState.ts`) records it, so a lost flag costs one more look.
- It is also the loading state on a first visit. The triskele in the logo turns
  and the hint reads "Loading sites…" until the site data is in. The app's own
  loading pill stays hidden while the card is up.
- `src/ui/LogoMark.tsx` draws the logo inline, so the triskele can turn alone.
  It copies `public/favicon.svg`, which stays the source for the PWA icons.
  Change both together.

## Painted plate

The watercolor map ships with the app. The plate is the box round every shown
site, plus 80 km. The map does not pan past it.

- The tiles are in `public/tiles/watercolor/`. They are the Stamen Watercolor
  archive at Cooper Hewitt (CC BY 3.0), z5–z10. `npm run plate` downloads them
  and writes the box and the tile ranges to `src/map/plate.json`. The output
  is committed, and `npm run build` does not run the script.
- Keep the watercolor off any metered provider. It came from Stadia Maps until
  September 2026. The Stadia free plan caps credits and forbids commercial use.
- Run `npm run plate` again when a source moves the edge of the pins, for
  example when a source leaves `HIDDEN_SOURCES`. `isShown` in
  `src/data/shown.ts` is the one rule for which sites the store and the plate
  use.
- The pan limit is `fenceToPlate` (`src/map/plate.ts`). Leaflet's own
  `maxBounds` breaks on an axis where the view is bigger than the bounds: a
  drag runs onto blank map and springs back. So the limit widens that axis to
  exactly the view at each zoom, and the axis cannot move.
- The fence reads `coveredInsets` (`src/map/insets.ts`), so the edge of the
  plate can go under the desktop strip, drawer or spread, but the part of the map that
  the user can see never shows past the plate.
- The zoom floor is the zoom where the whole plate fits the screen
  (`src/map/MapView.tsx`).
- Zoomed out on a wide screen, the view is bigger than the plate. So the tiles
  also cover a surround, sized for a 4K screen. `plateHasTile` asks Leaflet for
  shipped tiles only, so a missing tile is never a 404.

## Keys and hover (issue #88)

The app has one key handler. `src/state/keys.ts` holds the rules, and
`src/ui/useKeyLayer.ts` connects them to the window. Do not add a `keydown`
listener to a component. Register a key layer instead.

- Each layer has a rank in `KEY_RANK`. A key goes to the top rank first, and
  the first layer that handles it stops it. So `Esc` closes one layer per
  press: the basemap menu, the lightbox, the site card, search, then the sheet.
- In a text field, only `Esc` reaches the layers. On a button or a link,
  `Enter` and `Space` stay with the control. A key with Ctrl, Alt or Meta
  stays with the browser.
- The lightbox is a modal layer, so no key reaches the list under it. The
  title card is a passive layer: it sees every key and stops none.
- `j` and `k` move the cursor through the Nearby list, and `Enter` opens the
  cursor row. `/` opens the site finder. The arrow keys pan the map, as
  Leaflet does.
- In the desktop spread, the left and right arrow keys and `j` and `k` step
  to the previous and next site in the strip. `Esc` closes the spread first.

The store keeps one `lifted` site, and what lifted it: a pin, a row
or a key. A lifted site marks its pin and its row together. A pin lift or a
key lift also shows the peek over the pin (`src/map/pinPeek.ts`). A row lift
shows no peek, because the row already names the site.

- A lift acts only on a site that `matchesFilter` shows. The pins and the
  rows come from the filtered list, so a hidden site has nothing to lift.
- A speck takes no hover and no lift, and the peek hides below
  `SPECK_BELOW`. The keys still move the list at any zoom.
- Hover needs a mouse. On a touch screen, no hover effect occurs.
- The peek shows no numbers. A site with no picture gets a painted
  placeholder in its layer colour.

## The spread (issue #90)

On a desktop, a site opens in the spread on the right of the map. The phone
keeps the floating card.

- The spread wraps `SiteBody` with `variant="spread"`. `SiteBody` is a set of
  named parts, and `src/ui/siteBodyLayout.ts` lists where each layout puts
  them. A new part must go in the card layout and the spread layout.
  `tests/siteBody.test.ts` fails until it does.
- The pictures are the lead of the spread: a carousel across the top of the
  page, one picture at a time. A swipe, the ‹ › buttons and the thumbs move
  it. The arrow keys do not, because in the spread they step between sites.
- A lead picture never shows larger than its own size. The sources are 720 px
  wide at most, and a stretch to the page blurs them. The picture sits whole
  over a blurred, darkened copy of itself, and the lead is as tall as the
  tallest picture, from 280 px to 62% of the window.
- One CSS grid cannot make the two columns. A grid shares its row heights
  between the columns, so a long write-up moved the buttons apart.
- The spread is the covered inset on the right. The map pans the site to the
  centre of the part of the view that shows (`openCentre`), and keeps the zoom.
- Prev and Next step through the order of the strip (`stripNeighbours`). They
  stop at both ends, as `j` and `k` do.
- While the spread is open, the map reports no new view to the strip, so a
  step does not re-sort it. A drag, a zoom or a search move by the user ends
  this hold (`holdViewRef` in `src/map/MapView.tsx`).
- The strip stops at the left edge of the spread, so no frame is under it.
- From 1024 px to 1199 px, a spread closes the drawer.

## Phone finder (issue #109)

On a phone, the site finder and the layer chips float at the top of the map
(`src/ui/PhoneFinder.tsx`). The desktop card holds the same two parts. No tab
must open to find a site or to turn a layer on or off.

- One `LayerChips` component (`src/ui/LayerChips.tsx`) serves both shells.
  On a phone, the chips are one row that scrolls sideways.
- The results show under the pill, in place of the chips. A pick selects the
  site and moves the map to it.
- The Nearby tab has no finder. `/` ends browse mode and puts the cursor in
  the pill.
- The zoom and basemap controls are at the top right, under the chips.
  `PhoneFinder` writes its height to `--float-h` on the map area, and the CSS
  moves the corner down by that height.
- The Filters tab stays. It holds the leaf categories and the tags.
- The title card covers the pill on a first visit (`--z-float` is under
  `--z-title`).

## UI copy

The screen carries labels, not explanations. A string earns its place only
when the user needs it at that moment to act or to avoid a mistake. The
default for any new panel, button or state is no helper text.

- The reason for a design lives in code comments and in this file. The
  rationale in this file is for you, not for the user: keep it off the
  screen, even when it reassures.
- A control says what it does in two to four words. A status message says
  what happened in one short sentence.
- A warning appears at the point of risk, in the step where the risk occurs.
- UI strings are outside the `simple-english` skill. Cut them, then stop.
- Every string the app shows a user is in `src/copy.ts`, grouped by screen.
  A component reads `copy.backup.save`, not "Save a backup".
- To change a word, edit `src/copy.ts`. Read its diff before you open a pull
  request. Every added line must pass the test above.
- A string with a run-time value is a function in the copy module. If a
  sentence holds an icon or another element, split it into `before` and
  `after`.
- `npm test` fails when a prose string is outside the copy module.
  `npm run copy:check` lists each one with its file and line. The check is a
  heuristic, and a single word in plain code can pass it. Put that word in
  the copy module too.
- Site data is not copy. The category names in `src/data/types.ts`, the
  names in `src/map/mapLabels.ts` and the attributions stay where they are.
  `EXEMPT` in `scripts/ui-copy.ts` lists the files that the check skips.

Too much — the Backup panel once said:
"Restoring only ever adds — it never removes a visit, so loading the wrong
file, or the same one twice, costs nothing."
Right — the panel now has a heading and four buttons, and nothing else.

## Build order (each phase independently shippable)

- **Phase 1 (MVP): shipped** — ingest (2 sources) → map → two-level type filter
  → near-me (haversine) → visited/wishlist → directions handoff → PWA/offline.
- **Phase 2: built** — **outing mode v1** — pick ≥1 site types in a picker *independent of the map
  filter*; find the nearest cluster of **exactly one site per selected type**
  (scored anchor-outward seed scan, spec §7.2; raw haversine only; **no
  proximity cap and no padding** — the cost function balances nearness vs
  tightness and the spread is displayed; unvisited by default with an
  include-visited toggle) → order it with NN + 2-opt → multi-stop Maps
  handoff (hidden when the selection exceeds the waypoint cap).
- **Phase 3:** condition filters → site log (note + photo as IndexedDB blob) →
  user-state export/import. **Export/import shipped early** (Saved tab →
  Backup, `src/state/backup.ts`): on iOS a home-screen web app owns its storage
  container, so re-adding the icon — the only way to refresh a stale home-screen
  logo — starts an empty one. Without a file to carry the state out and back in,
  a routine reinstall costs the user every tick they have made. A restore MERGES
  and never deletes (earlier visit date wins, both notes kept, the same rules as
  `foldDuplicateState`), so loading the wrong file, or the same one twice, costs
  nothing. Photos are not in the format yet — add them with the site log.
- **Phase 4:** travel-time sort (cached road-time matrix) → orienteering subset
  selection → DBSCAN density discovery.
- **Cut, not deferred:** completion statistics (spec F6) and the rarity index
  that fed them. The code is deleted. The spec keeps the requirement numbers for
  the record only.

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
- Don't introduce a second backend, SSR, or a state-management framework
  heavier than Zustand without raising it first. Don't give the Ethelred server
  a second job without raising it first.
- When the spec lists an open decision (§11: outing cost function, tile
  provider, photo storage, routing engine, sync), surface it rather than
  silently picking.
