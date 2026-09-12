import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Client-only, offline-first PWA. Workbox (via vite-plugin-pwa) precaches the
// app shell and the bundled site data, and runtime-caches map tiles so a region
// viewed once online stays usable in airplane mode. See spec §9.
//
// Deployed to GitHub Pages under a repo subpath, so production assets are served
// from `/albion-adventure-land/`. The dev server stays at root. Override the
// build base with BASE_PATH if the repo (and therefore the Pages URL) is renamed.
// Note: the path is case-sensitive and must match the repo name exactly.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.BASE_PATH ?? '/albion-adventure-land/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precached explicitly: `globPatterns` below deliberately excludes PNGs
      // (guidebook pictures), so the app icons need naming here.
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
      ],
      manifest: {
        name: 'Albion Adventure Land',
        short_name: 'Albion',
        description: 'Offline-first companion for visiting curated sites across Britain.',
        theme_color: '#216448',
        background_color: '#f2f6f4',
        display: 'standalone',
        // All manifest URLs are left relative so they resolve against the
        // manifest's own location (the Pages subpath), not the domain root.
        // That applies to the icon `src` values below too — the plugin emits
        // them verbatim rather than prefixing `base`.
        start_url: '.',
        scope: '.',
        // PNGs rendered from favicon.svg (see scripts/render-icons.mjs). Android
        // wants 192 and 512; the maskable variant is full-bleed and square so
        // the launcher's own mask does the rounding instead of double-rounding
        // the SVG's corners. iOS uses the apple-touch-icon link in index.html.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell and bundled site JSON. Guidebook pictures are
        // deliberately NOT precached: they are ~33 MB and would all download on
        // first load. They are runtime-cached instead (see below), so a picture
        // stays offline after it is seen once. The app is fully functional
        // without them.
        // woff2 is in the list because the serif and mono faces are self-hosted
        // (src/fonts). Without it a device with no signal falls back to its own
        // serif and monospace defaults, which is a different page.
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        // sites.json is the whole dataset and must be precached for offline-first
        // (see spec §9) — it has already grown past Workbox's 2 MiB default as
        // sources were added. Raise the ceiling with headroom for dataset growth.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Guidebook pictures — cache-first, so a listing seen online keeps
            // its pictures in airplane mode. Kept out of the precache above.
            urlPattern: /\/images\/.*\.(?:jpg|jpeg|png|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'site-pictures',
              expiration: { maxEntries: 2500, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // OSM raster tiles — cache-first with generous expiry (offline tiles).
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}));
