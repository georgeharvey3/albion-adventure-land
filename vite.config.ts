import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { IOS_SCREENS, splashFile, splashMedia } from './scripts/ios-screens.ts';

// iOS needs one `apple-touch-startup-image` per screen size, each with an exact
// media query, or it shows a blank launch screen. Generating the tags from the
// same table `scripts/icons.ts` renders from keeps the two in lockstep.
//
// `href` is deliberately document-relative: these tags are injected after Vite's
// own asset-URL rewriting, so an absolute `/icons/...` would miss the GitHub
// Pages base path. `icons/...` resolves against the document either way.
function iosSplashLinks(): Plugin {
  return {
    name: 'ios-splash-links',
    transformIndexHtml() {
      return IOS_SCREENS.map((screen) => ({
        tag: 'link',
        attrs: {
          rel: 'apple-touch-startup-image',
          media: splashMedia(screen),
          href: `icons/splash/${splashFile(screen)}`,
        },
        injectTo: 'head' as const,
      }));
    },
  };
}

// Client-only, offline-first PWA. Workbox (via vite-plugin-pwa) precaches the
// app shell and the bundled site data, and runtime-caches map tiles so a region
// viewed once online stays usable in airplane mode. See spec §9.
//
// Deployed to GitHub Pages under a repo subpath, so production assets are served
// from `/albion-adventure-land/`. The dev server stays at root. Override the
// build base with BASE_PATH if the repo (and therefore the Pages URL) is renamed.
// Note: the path is case-sensitive and must match the repo name exactly.
//
// `vite preview` gets the build base too, otherwise it serves a bundle whose
// asset URLs point at the subpath from the domain root and every request 404s.
// Preview is the only way to exercise the service worker and the installed-app
// behaviour locally, so it needs to match production exactly.
export default defineConfig(({ command, isPreview }) => ({
  base:
    command === 'build' || isPreview ? process.env.BASE_PATH ?? '/albion-adventure-land/' : '/',
  plugins: [
    react(),
    iosSplashLinks(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Albion Adventure Land',
        short_name: 'Albion',
        description: 'Offline-first companion for visiting curated sites across Britain.',
        lang: 'en-GB',
        theme_color: '#1f6b4f',
        // Matches the iOS launch images, so a cold start is one continuous
        // brand-green screen rather than green → white flash → app.
        background_color: '#1f6b4f',
        display: 'standalone',
        categories: ['travel', 'navigation'],
        // Relative so they resolve against the manifest's location (the Pages
        // subpath), not the domain root. vite-plugin-pwa prefixes icon `src`
        // with `base` automatically.
        start_url: '.',
        scope: '.',
        // Rendered by `npm run icons` (scripts/icons.ts) and committed. The
        // maskable variant is a separate file because it needs the emblem shrunk
        // into the 80% safe circle — reusing the `any` icon there gets it cropped.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache the app shell and bundled site JSON.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        // iOS fetches launch images itself when the app is added to the home
        // screen; the service worker never serves them, so keeping ~250 kB of
        // them out of the precache is free.
        globIgnores: ['**/node_modules/**/*', '**/icons/splash/**'],
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
