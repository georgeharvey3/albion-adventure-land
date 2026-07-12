---
name: verify
description: Build, launch and drive this app headless to verify changes at runtime.
---

# Verifying albion-adventure-land

Client-only Vite + React PWA (Leaflet map of ~2,650 site pins + bottom-sheet tabs).

## Launch

```bash
npm run dev -- --port 5199 &   # serves at http://localhost:5199/ in ~2s
```

No ingest needed unless `public/data/sites.json` is missing (`npm run ingest`).

## Drive (Playwright)

Install `playwright` in the scratchpad (`npm i playwright`) and launch with
`channel: 'chrome'` — the playwright-managed chromium builds in
`~/.cache/ms-playwright` are version-mismatched, but system Chrome works.

Mock a phone in the Lake District (dense site area):

```js
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  geolocation: { latitude: 54.428, longitude: -2.963, accuracy: 15 },
  permissions: ['geolocation'],
});
// Simulate movement mid-session:
await ctx.setGeolocation({ latitude: 54.44, longitude: -2.99, accuracy: 12 });
```

## Gotchas

- **Default tab is "Filters"**, not "Near me" — click
  `.tabs button:has-text("Near me")` before asserting on `.list ul li` rows.
- Site pins are **canvas-drawn** (no marker DOM). To "click a pin", select a
  site from the list first (map pans to it), then click the map centre — or
  click known pixel coords. Assert selection via `.list ul li.selected`.
- The `SiteDetail` card overlays the top of the map once a site is selected —
  clicks/dblclicks at the map centre may hit the card instead.
- Marking visited writes IndexedDB, but the Playwright context is ephemeral,
  so no cleanup needed.
- Collect `pageerror` + console errors — Leaflet failures are often silent
  otherwise.

## Flows worth driving

1. Map loads, pins render (screenshot), list shows "N sites near you".
2. GPS jitter (<25 m moves) must NOT change list distances (movement gate in
   `setLivePosition`); a >25 m move must re-sort the list.
3. Tap list row → map pans, row `.selected`; tap map pin → selects site.
4. Filters tab: toggle a top-level category off → its shape disappears from
   the map and the list count drops.
5. "Mark visited" → pin greys, row gets `is-visited`, detail shows ✓ Visited.
6. Near-me list caps at 150 rows; "Show N more" button appends a page.
