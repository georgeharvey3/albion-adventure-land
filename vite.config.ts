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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Albion Adventure Land',
        short_name: 'Albion',
        description: 'Offline-first companion for visiting curated sites across Britain.',
        theme_color: '#1f6b4f',
        background_color: '#f7f5f0',
        display: 'standalone',
        // Relative so they resolve against the manifest's location (the Pages
        // subpath), not the domain root. vite-plugin-pwa prefixes icon `src`
        // with `base` automatically.
        start_url: '.',
        scope: '.',
        // SVG app icon (no PNG toolchain yet). Modern browsers accept this for
        // install; swap in 192/512 PNGs when an icon pipeline lands.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell and bundled site JSON.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,json}'],
        // sites.json is the whole dataset and must be precached for offline-first
        // (see spec §9) — it has already grown past Workbox's 2 MiB default as
        // sources were added. Raise the ceiling with headroom for dataset growth.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
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
