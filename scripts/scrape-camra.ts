import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { type PubEnrichment } from '../src/data/ingest.ts';
import { type SiteImage } from '../src/data/types.ts';
import {
  decodeEntities,
  extractDescription,
  getBytes,
  getText,
  resolvePubPages,
  sleep,
} from './camra-page.ts';

// Build-time CAMRA scraper. Enriches the sparse pub rows in CAMRA.csv with the
// general "Description" write-up from each pub's page on the CAMRA Heritage Pubs
// site (NOT the Historic Interest tab), plus a link back to that page
// (attribution). Like geocode.ts this is the
// only place the build touches the network — results are cached on disk
// (data/camra-descriptions.json), keyed by the STABLE pub id, so the app stays
// fully offline and re-runs are cheap and resumable.
//
// This script writes the DURABLE half of a pub: prose and pictures, which change
// rarely and cost an hour to fetch. The transient half — opening times, survey
// dates, closure — has its own script and its own cache, so refreshing it never
// re-downloads a picture: see scripts/refresh-camra-status.ts. The page reader
// both share is scripts/camra-page.ts.
//
// The CSV holds all three CAMRA heritage grades (3-star, 2-star, 1-star), so a
// full run is ~1300 pub pages plus their pictures — over an hour at the delay
// below. It is resumable: a cached pub is skipped, so an interrupted run
// continues where it stopped.
//
// It also takes the first few gallery pictures from the same page, downscales
// them and writes them to data/camra-images/ — the pub equivalent of the
// guidebook picture folders. Pubs have no listing number, so the pictures are
// recorded in this cache (keyed by the stable pub id) instead of a companion
// images CSV; scripts/ingest.ts copies the files into public/images/camra/.
//
// Content belongs to CAMRA and to the individual photographers; we store it for
// personal/offline use and always link back to the source page. Re-run with
// --force to re-fetch all.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'data');
const OUT_FILE = resolve(OUT_DIR, 'camra-descriptions.json');
const DELAY_MS = 400; // be polite between pub-page fetches
const FORCE = process.argv.includes('--force');
// --limit=N: stop after N pubs. For trying the scraper out without a full run.
const LIMIT = Number(/^--limit=(\d+)$/.exec(process.argv.find((a) => a.startsWith('--limit=')) ?? '')?.[1] ?? Infinity);

// Pictures. IMG_DIR is source material (like data/mb-images/); ingest copies it
// to public/IMG_BASE_URL/, which is what SiteImage.url points at.
const IMG_DIR = resolve(OUT_DIR, 'camra-images');
const IMG_BASE_URL = 'images/camra';
const MAX_IMAGES = 3; // first three of the pub's gallery, in page order
const IMG_WIDTH = 720; // downscale ceiling; most CAMRA originals are wider
const IMG_QUALITY = 75;
// The two hosts the pub galleries serve photos from. Anything else on the page
// (promo banners, guide covers, beer artwork) is not a picture of this pub.
const PHOTO_HOSTS = /^https:\/\/(?:camra-phg\.s3-eu-west-1\.amazonaws\.com|d2s8km3brsjp0y\.cloudfront\.net)\//;

// --- Gallery pictures ------------------------------------------------------

// The gallery is server-rendered three times over (thumbnail strip, grid,
// lightbox carousel), all in the same order. We read the thumbnail strip, whose
// `data-slide-index` makes the order explicit, and fall back to the grid's
// `data-photo-origin` items if the markup ever changes shape. Duplicates and
// off-gallery pictures (guide covers, banners) are filtered out.
const THUMB_IMG = /data-slide-index="\d+"[\s\S]{0,400}?src="([^"]+)"/g;
const GRID_IMG = /data-photo-origin="[^"]*"[\s\S]{0,500}?src="([^"]+)"/g;

function matchAll(re: RegExp, html: string): string[] {
  re.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = decodeEntities(m[1]);
    if (PHOTO_HOSTS.test(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

function parseGallery(html: string): string[] {
  const thumbs = matchAll(THUMB_IMG, html);
  const urls = thumbs.length ? thumbs : matchAll(GRID_IMG, html);
  return urls.slice(0, MAX_IMAGES);
}

// WhatPub photos are served by an image-resizing CloudFront distribution whose
// path is a base64 request: {bucket, key, edits}. Asking it for the width we
// actually want saves downloading an 800×600 crop we are about to shrink — and
// `fit: inside` keeps the original aspect ratio, which the site's own `cover`
// crop does not. Any surprise in the payload → return the URL untouched.
function requestSmaller(url: string): string {
  const m = /^(https:\/\/d2s8km3brsjp0y\.cloudfront\.net\/)([A-Za-z0-9+/=_-]+)$/.exec(url);
  if (!m) return url;
  try {
    const spec = JSON.parse(Buffer.from(m[2], 'base64').toString('utf8')) as {
      bucket?: string;
      key?: string;
      edits?: Record<string, unknown>;
    };
    if (!spec.bucket || !spec.key) return url;
    // withoutEnlargement matters: the service answers 404 when asked to upscale
    // a photo whose original is narrower than IMG_WIDTH.
    spec.edits = {
      ...spec.edits,
      resize: { width: IMG_WIDTH, fit: 'inside', withoutEnlargement: true },
    };
    return m[1] + Buffer.from(JSON.stringify(spec)).toString('base64').replace(/=+$/, '');
  } catch {
    return url;
  }
}

// Fetch → downscale → write data/camra-images/<pubId>_<n>.jpg. Re-encoding is
// worth it even for the already-small CAMRA originals: several are 400px wide
// but weigh over 100 KB. No caption is stored — these are for looking at.
async function fetchImages(id: string, html: string): Promise<SiteImage[]> {
  const urls = parseGallery(html);
  const images: SiteImage[] = [];

  for (const url of urls) {
    // One unavailable photo must not cost the pub its other pictures.
    let bytes: Buffer;
    try {
      bytes = await getBytes(requestSmaller(url));
    } catch {
      try {
        bytes = await getBytes(url); // the resize request failed — take it as served
      } catch (err) {
        console.warn(`\n  ⚠ skipped a picture: ${(err as Error).message}`);
        continue;
      }
    }

    const fileName = `${id}_${images.length + 1}.jpg`;
    const out = await sharp(bytes)
      .rotate() // honour EXIF orientation before it is stripped
      .resize({ width: IMG_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: IMG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    mkdirSync(IMG_DIR, { recursive: true });
    writeFileSync(resolve(IMG_DIR, fileName), out.data);
    images.push({
      url: `${IMG_BASE_URL}/${fileName}`,
      width: out.info.width,
      height: out.info.height,
    });
    if (images.length < urls.length) await sleep(DELAY_MS);
  }

  // A re-run that finds fewer pictures than last time must not leave the extras
  // behind: the JSON would no longer name them, but ingest copies by name.
  for (let n = images.length + 1; n <= MAX_IMAGES; n++) {
    rmSync(resolve(IMG_DIR, `${id}_${n}.jpg`), { force: true });
  }

  return images;
}

function loadCache(): Record<string, PubEnrichment> {
  if (!existsSync(OUT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Record<string, PubEnrichment>;
  } catch {
    console.warn('  ⚠ existing camra-descriptions.json unreadable, starting fresh');
    return {};
  }
}

function save(data: Record<string, PubEnrichment>): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const ordered: Record<string, PubEnrichment> = {};
  for (const key of Object.keys(data).sort()) ordered[key] = data[key];
  writeFileSync(OUT_FILE, JSON.stringify(ordered, null, 2) + '\n');
}

async function main(): Promise<void> {
  // 1. Read the canonical pub list and resolve each pub's page URL.
  const { pages, unmatched } = await resolvePubPages();

  // 2. Work out what still needs fetching.
  const cache = loadCache();
  const toFetch = pages.filter(
    // Resume: skip a pub only when we already have both halves of the
    // enrichment. Entries cached before pictures existed are re-fetched once.
    (p) => FORCE || !(cache[p.id]?.description && cache[p.id]?.images),
  );

  if (Number.isFinite(LIMIT)) toFetch.length = Math.min(toFetch.length, LIMIT);

  console.log(
    `\n${pages.length + unmatched.length} pubs · ${pages.length} matched · ` +
      `${unmatched.length} unmatched · ${toFetch.length} to fetch` +
      `${FORCE ? ' (--force)' : ''}`,
  );

  // 3. Fetch each pub page, extract the description and the first pictures.
  let ok = 0;
  let pictures = 0;
  const empty: string[] = [];
  const noPictures: string[] = [];
  for (let i = 0; i < toFetch.length; i++) {
    const { id, url, label } = toFetch[i];
    try {
      const html = await getText(url);
      const desc = extractDescription(html);
      // Pictures are independent of the description: a page can carry one
      // without the other, and a picture failure must not lose the prose.
      let images: SiteImage[] = [];
      try {
        images = await fetchImages(id, html);
      } catch (err) {
        console.warn(`\n  ⚠ pictures failed for ${label}: ${(err as Error).message}`);
      }
      if (!images.length) noPictures.push(label);
      pictures += images.length;

      if (!desc && !images.length) {
        delete cache[id]; // re-fetched and found nothing → drop any stale entry
        empty.push(label);
      } else {
        if (!desc) empty.push(label);
        cache[id] = {
          ...(desc ? { description: desc } : {}),
          sourceUrl: url,
          images,
        };
        ok++;
      }
      process.stdout.write(`\r  fetched ${i + 1}/${toFetch.length}  `);
    } catch (err) {
      console.warn(`\n  ⚠ failed ${label}: ${(err as Error).message}`);
    }
    save(cache); // incremental — a crash never loses progress
    if (i < toFetch.length - 1) await sleep(DELAY_MS);
  }

  // 4. Report. Never silent: unmatched and empty pubs are listed so they can be
  // chased up; they simply keep the sparse card meanwhile.
  console.log(`\n\n✓ ${ok} pubs written to data/camra-descriptions.json`);
  console.log(`  ${pictures} pictures written to data/camra-images/`);
  console.log(`  total cached: ${Object.keys(cache).length}`);
  if (empty.length) {
    console.warn(`  ⚠ ${empty.length} pages had no interior description:`);
    for (const e of empty) console.warn(`    - ${e}`);
  }
  if (noPictures.length) {
    console.warn(`  ⚠ ${noPictures.length} pages had no gallery pictures:`);
    for (const n of noPictures) console.warn(`    - ${n}`);
  }
  if (unmatched.length) {
    console.warn(`  ⚠ ${unmatched.length} pubs not found in the listing table:`);
    for (const u of unmatched) console.warn(`    - ${u}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
