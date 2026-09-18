import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import sharp from 'sharp';
import { makePubId, slug, type RawRow, type PubEnrichment } from '../src/data/ingest.ts';
import { type SiteImage } from '../src/data/types.ts';
import { normalizePostcode } from './geocode.ts';
import { camraMapping } from '../src/data/mappings/camra.ts';

// Build-time CAMRA scraper. Enriches the sparse pub rows in CAMRA.csv with the
// general "Description" write-up from each pub's page on the CAMRA Heritage Pubs
// site (NOT the Historic Interest tab), plus a link back to that page
// (attribution). Like geocode.ts this is the
// only place the build touches the network — results are cached on disk
// (data/camra-descriptions.json), keyed by the STABLE pub id, so the app stays
// fully offline and re-runs are cheap and resumable.
//
// The CSV holds all three CAMRA heritage grades (3-star, 2-star, 1-star), so a
// full run is ~1300 pub pages plus their pictures — over an hour at the delay
// below. It is resumable: a cached pub is skipped, so an interrupted run
// continues where it stopped.
//
// Matching is easy because CAMRA.csv was itself derived from the National
// Inventory listing table, which carries the same Name/Postcode columns AND a
// link to each pub's page. We parse that table, pair our CSV rows to it by
// postcode (+ name when a postcode is shared), then fetch each pub page.
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
const LISTING_URL = 'https://camra.org.uk/heritage-pubs/national-inventory';
const UA = 'Mozilla/5.0 (compatible; albion-adventure-land/0.1; build-time enrichment)';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

async function getBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

// Named entities seen in the CAMRA prose (typographic punctuation, £, accents),
// plus the structural few. Numeric entities (&#NNN; / &#xNN;) are handled below.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', ndash: '–', mdash: '—', pound: '£',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', uuml: 'ü',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code] ?? m;
  });
}

// HTML fragment → plain text, preserving paragraph breaks. The build script
// owns this (CLAUDE.md: parsers for CSV; the scraped HTML here is a small, stable
// structure so a targeted regex strip is adequate and dependency-free).
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ListingRow {
  name: string;
  postcode: string; // normalized
  url: string;
}

// Parse the National Inventory table into rows. Each <tr> has cells
// [grading, country, area, town, postcode, name-as-link]; we take every graded
// row with a pub link — the CSV holds all three grades (3-star, 2-star,
// 1-star), and the grade itself comes from the CSV, not from here.
function parseListing(html: string): ListingRow[] {
  const rows: ListingRow[] = [];
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const tr = m[1];
    if (!/[123]-star/.test(tr)) continue;
    const link = /href="(https:\/\/camra\.org\.uk\/pubs\/[^"]+)"[^>]*title="View ([^"]+)"/.exec(tr);
    if (!link) continue;
    const pc = /\b([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})\b/.exec(tr);
    if (!pc) continue;
    rows.push({
      url: link[1],
      name: decodeEntities(link[2]).trim(),
      postcode: normalizePostcode(`${pc[1]} ${pc[2]}`),
    });
  }
  return rows;
}

// We want the general "Description" tab only — NOT the "Historic Interest" tab
// (Grade II / architectural detail). The page is an Alpine.js tabset: the
// description panel is `activeTab === 0`, the historic-interest one `=== 2`. Each
// panel's prose sits in a `keep-formatting` div, so we take the block whose
// immediately preceding markup marks it as the description panel. (The
// description tab has no "read full" expander — this block is the full text.)
const KEEP_FMT = /<div class="keep-formatting[^"]*">([\s\S]*?)<\/div>/g;
const DESC_PANEL = 'activeTab === 0';

function extractDescription(html: string): string {
  KEEP_FMT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEEP_FMT.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 260), m.index);
    if (before.includes(DESC_PANEL)) {
      const text = htmlToText(m[1]);
      if (text) return text;
    }
  }
  return '';
}

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
  // 1. Read the canonical pub list (same rows ingest turns into sites).
  const csv = readFileSync(resolve(root, 'data/CAMRA.csv'), 'utf8');
  const pubs = Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: 'greedy' }).data
    .map((r) => ({
      name: (r[camraMapping.columns.name!] ?? '').trim(),
      postcode: (r[camraMapping.columns.postcode!] ?? '').trim(),
      country: (r['Country'] ?? '').trim(),
    }))
    .filter((p) => p.name && p.postcode)
    .filter((p) => !camraMapping.exclude?.values.includes(p.country)); // drop NI like ingest

  // 2. Fetch + parse the listing table → postcode index of {name, url}.
  console.log(`Fetching National Inventory listing …`);
  const listing = parseListing(await getText(LISTING_URL));
  console.log(`  parsed ${listing.length} listing rows`);
  const byPostcode = new Map<string, ListingRow[]>();
  for (const row of listing) {
    const arr = byPostcode.get(row.postcode) ?? [];
    arr.push(row);
    byPostcode.set(row.postcode, arr);
  }

  // 3. Match each CSV pub to a listing row → resolve its pub-page URL.
  const cache = loadCache();
  const unmatched: string[] = [];
  const toFetch: { id: string; url: string; label: string }[] = [];
  for (const pub of pubs) {
    const id = makePubId(pub.name, pub.postcode);
    const candidates = byPostcode.get(normalizePostcode(pub.postcode)) ?? [];
    // Name first, postcode second: a postcode can hold several heritage pubs,
    // and taking a lone candidate whose name disagrees would attach one pub's
    // write-up and pictures to another. The lone candidate is the fallback for
    // the handful of pubs the listing and the CSV spell differently.
    const match =
      candidates.find((c) => slug(c.name) === slug(pub.name)) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!match) {
      unmatched.push(`${pub.name} (${pub.postcode})`);
      continue;
    }
    // Resume: skip a pub only when we already have both halves of the
    // enrichment. Entries cached before pictures existed are re-fetched once.
    if (!FORCE && cache[id]?.description && cache[id]?.images) continue;
    toFetch.push({ id, url: match.url, label: `${pub.name} (${pub.postcode})` });
  }

  if (Number.isFinite(LIMIT)) toFetch.length = Math.min(toFetch.length, LIMIT);

  console.log(
    `\n${pubs.length} pubs · ${pubs.length - unmatched.length} matched · ` +
      `${unmatched.length} unmatched · ${toFetch.length} to fetch` +
      `${FORCE ? ' (--force)' : ''}`,
  );

  // 4. Fetch each pub page, extract the description and the first pictures.
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

  // 5. Report. Never silent: unmatched and empty pubs are listed so they can be
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
