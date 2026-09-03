// Regenerate the PWA app icons from public/favicon.svg.
//
// Run this only when the logo changes — the PNGs it writes are committed, so
// neither the build nor CI depends on it. Playwright is deliberately NOT a
// project dependency (the offline/bundle story is the point); run it ad hoc:
//
//   npx playwright install chromium && node scripts/render-icons.mjs
//
// Outputs, all into public/:
//   icon-192.png / icon-512.png   manifest `any` — keeps the SVG's rounded
//                                 corners, so they need a transparent ground
//   icon-maskable-512.png         manifest `maskable` — full-bleed square, the
//                                 launcher applies its own mask
//   apple-touch-icon.png          iOS home screen — square, and opaque because
//                                 iOS composites alpha onto black
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const rounded = readFileSync(resolve(publicDir, 'favicon.svg'), 'utf8');
// The motif sits inside the maskable safe zone (the centre 80% circle), so the
// only change needed for a full-bleed variant is dropping the corner radius.
const square = rounded.replace('rx="96" ', '');

const targets = [
  { file: 'icon-192.png', size: 192, svg: rounded, alpha: true },
  { file: 'icon-512.png', size: 512, svg: rounded, alpha: true },
  { file: 'icon-maskable-512.png', size: 512, svg: square, alpha: false },
  { file: 'apple-touch-icon.png', size: 180, svg: square, alpha: false },
];

const browser = await chromium.launch();
for (const { file, size, svg, alpha } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: alpha,
  });
  writeFileSync(resolve(publicDir, file), png);
  console.log(`${file}  ${size}x${size}  ${png.length} bytes`);
  await page.close();
}
await browser.close();
