import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { haversine } from '../src/geo/haversine.ts';
import { parentOf, type Site, type SiteImage } from '../src/data/types.ts';
import {
  IMAGES_DIR,
  loadImageCache,
  saveImageCache,
  type ImageCache,
} from './image-cache.ts';

// Build-time site-photo resolver. Like geocode.ts / scrape-camra.ts this is the
// only place photos touch the network — results are cached on disk
// (data/image-cache.json, keyed by the stable site id) and the pixels are
// downloaded once into public/images/, normalized to ≤480px WebP, so the app
// stays fully offline and re-runs are cheap and resumable (interrupt freely;
// the cache is saved incrementally).
//
// Provider chain per site, first hit wins:
//   historic_pubs        → the pub's own CAMRA page (og:image), same
//                          personal-use + attribution posture as the scraped
//                          descriptions.
//   folklore / ruins     → Wikidata (named monuments: entity search near the
//                          site → its curated P18 image) → Commons geosearch.
//   everything else      → Commons geosearch (photos within a radius of the
//                          coordinates, ranked by name match + distance).
// Commons includes the ~1.7M-photo Geograph bulk import, so rural coverage is
// effectively Geograph's without needing their keyed API. Native Geograph and
// the Megalithic Portal are future providers behind the same Candidate shape.
//
// Run AFTER `npm run ingest` (reads public/data/sites.json), then re-run ingest
// to bake `image` into the emitted JSON. Flags:
//   --force      re-check sites already in the cache (including misses)
//   --limit N    stop after N lookups (trial runs)
//   --only P     restrict to one parent category (e.g. --only historic_pubs)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITES_FILE = resolve(root, 'public/data/sites.json');

// Overridable so the pipeline can be exercised against a local mock server.
const COMMONS_API = process.env.COMMONS_API ?? 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA_API = process.env.WIKIDATA_API ?? 'https://www.wikidata.org/w/api.php';

const UA = 'albion-adventure-land/0.1 (personal offline PWA; build-time image enrichment)';
const DELAY_MS = 150; // politeness gap between network calls
const THUMB_WIDTH = 480; // card is phone-width; 480 WebP ≈ 20–30 KB per site
const WEBP_QUALITY = 72;

const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- HTTP helpers ----------------------------------------------------------

async function fetchWithRetry(url: string, accept: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept } });
    // Back off on rate limiting / server hiccups; Wikimedia also signals
    // overload via maxlag which arrives as a 200 — handled by the caller.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt * 2;
      console.warn(`    ${res.status} from ${new URL(url).host}, waiting ${retryAfter}s…`);
      await sleep(retryAfter * 1000);
      continue;
    }
    return res;
  }
}

async function apiJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithRetry(url, 'application/json');
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    const json: any = await res.json();
    if (json?.error?.code === 'maxlag' && attempt < 3) {
      await sleep(5000);
      continue;
    }
    if (json?.error) throw new Error(`API error ${json.error.code}: ${json.error.info}`);
    return json;
  }
}

// --- Candidate scoring (pure; exported for tests) --------------------------

const STOPWORDS = new Set(['the', 'and', 'of', 'for', 'near', 'at']);

export function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Strip the HTML Commons wraps around Artist metadata ("<a …>Jim Bloggs</a>"). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// Files that are almost never a photograph of the place itself.
const TITLE_BLOCKLIST = /\b(map|plan|diagram|logo|coat of arms|blue plaque)\b/i;
const EXT_BLOCKLIST = /\.(svg|gif|tiff?|pdf|ogg|ogv|webm|stl)$/i;

export interface ScoredTitle {
  title: string;
  distM: number | null; // null = photo has no coordinates
}

/** Higher is better: each site-name token found in the file title is worth
 *  500 "metres" of nearness; unlocated photos are treated as radius-edge. */
export function scoreCandidate(siteName: string, c: ScoredTitle, radius: number): number {
  const t = c.title.toLowerCase();
  const matches = nameTokens(siteName).filter((tok) => t.includes(tok)).length;
  return matches * 500 - (c.distM ?? radius);
}

export function usableTitle(title: string): boolean {
  return !EXT_BLOCKLIST.test(title) && !TITLE_BLOCKLIST.test(title);
}

// --- Providers -------------------------------------------------------------

interface Candidate {
  thumbUrl: string; // downloadable image URL (already server-side resized)
  author?: string;
  license?: string;
  sourceUrl?: string;
  provider: SiteImage['provider'];
}

// Big landscape features photograph well from further away than a well or stone.
const WIDE_CATEGORIES = new Set(['hills', 'hillforts', 'scrambles', 'wild_places', 'earthworks']);
const radiusFor = (site: Site) => (WIDE_CATEGORIES.has(site.category) ? 1000 : 500);

interface CommonsPage {
  title: string;
  coordinates?: { lat: number; lon: number }[];
  imageinfo?: {
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

function candidateFromPage(page: CommonsPage, provider: Candidate['provider']): Candidate | null {
  const info = page.imageinfo?.[0];
  const thumbUrl = info?.thumburl ?? info?.url;
  if (!thumbUrl) return null;
  const meta = info?.extmetadata ?? {};
  return {
    thumbUrl,
    author: meta.Artist?.value ? stripHtml(meta.Artist.value) : undefined,
    license: meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : undefined,
    sourceUrl: info?.descriptionurl,
    provider,
  };
}

/** Photos geotagged within `radius` metres of the site, best-scored first. */
async function commonsGeoProvider(site: Site): Promise<Candidate | null> {
  const radius = radiusFor(site);
  const url =
    `${COMMONS_API}?action=query&format=json&formatversion=2&maxlag=5` +
    `&generator=geosearch&ggscoord=${site.lat}%7C${site.lng}&ggsradius=${radius}` +
    `&ggslimit=50&ggsnamespace=6&prop=imageinfo%7Ccoordinates&coprimary=all` +
    `&iiprop=url%7Cextmetadata&iiurlwidth=800`;
  const json = await apiJson(url);
  const pages: CommonsPage[] = json?.query?.pages ?? [];

  let best: { page: CommonsPage; score: number } | null = null;
  for (const page of pages) {
    if (!usableTitle(page.title)) continue;
    if (!page.imageinfo?.[0]?.thumburl && !page.imageinfo?.[0]?.url) continue;
    const co = page.coordinates?.[0];
    const distM = co ? haversine(site, { lat: co.lat, lng: co.lon }) : null;
    const score = scoreCandidate(site.name, { title: page.title, distM }, radius);
    if (!best || score > best.score) best = { page, score };
  }
  return best ? candidateFromPage(best.page, 'commons') : null;
}

/** Commons imageinfo for one known file title (Wikidata's P18 image). */
async function commonsFileInfo(fileTitle: string): Promise<Candidate | null> {
  const url =
    `${COMMONS_API}?action=query&format=json&formatversion=2&maxlag=5` +
    `&titles=${encodeURIComponent(`File:${fileTitle}`)}` +
    `&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=800`;
  const json = await apiJson(url);
  const page: CommonsPage | undefined = json?.query?.pages?.[0];
  return page ? candidateFromPage(page, 'wikidata') : null;
}

/** Named-monument lookup: entity search on the site name, sanity-checked to be
 *  within 2 km of our coordinates, then its curated image (P18). */
async function wikidataProvider(site: Site): Promise<Candidate | null> {
  const searchUrl =
    `${WIKIDATA_API}?action=wbsearchentities&format=json&language=en&type=item` +
    `&limit=5&maxlag=5&search=${encodeURIComponent(site.name)}`;
  const search = await apiJson(searchUrl);
  const ids: string[] = (search?.search ?? []).map((s: any) => s.id).filter(Boolean);
  if (!ids.length) return null;

  await sleep(DELAY_MS);
  const entUrl =
    `${WIKIDATA_API}?action=wbgetentities&format=json&props=claims&maxlag=5` +
    `&ids=${ids.join('%7C')}`;
  const ent = await apiJson(entUrl);

  for (const id of ids) {
    const claims = ent?.entities?.[id]?.claims;
    const coord = claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    const image = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!coord || !image) continue;
    if (haversine(site, { lat: coord.latitude, lng: coord.longitude }) > 2000) continue;
    if (!usableTitle(image)) continue;
    await sleep(DELAY_MS);
    return commonsFileInfo(image);
  }
  return null;
}

/** The pub's photo from its own CAMRA page (sourceUrl was matched by
 *  scrape-camra.ts). og:image first — the theme sets it to the hero shot —
 *  with a content-image fallback. */
async function camraProvider(site: Site): Promise<Candidate | null> {
  if (!site.sourceUrl) return null;
  const res = await fetchWithRetry(site.sourceUrl, 'text/html');
  if (!res.ok) {
    console.warn(`    CAMRA page ${res.status} for ${site.name}`);
    return null;
  }
  const html = await res.text();
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  let src = og?.[1];
  if (!src) {
    const img = html.match(/<img[^>]+src=["']([^"']*wp-content\/uploads[^"']+)["']/i);
    src = img?.[1];
  }
  if (!src || /logo|icon|placeholder|avatar/i.test(src)) return null;
  return {
    thumbUrl: new URL(src, site.sourceUrl).href,
    author: 'CAMRA Heritage Pubs',
    sourceUrl: site.sourceUrl,
    provider: 'camra',
  };
}

function providersFor(site: Site): ((s: Site) => Promise<Candidate | null>)[] {
  const parent = parentOf(site.category);
  if (parent === 'historic_pubs') return [camraProvider];
  if (parent === 'folklore' || parent === 'ruins') return [wikidataProvider, commonsGeoProvider];
  return [commonsGeoProvider];
}

// --- Download + normalize --------------------------------------------------

/** Download and normalize to ≤480px WebP under public/images/. Returns the
 *  filename, or null if the payload wasn't a decodable image. */
async function downloadThumb(siteId: string, thumbUrl: string): Promise<string | null> {
  const res = await fetchWithRetry(thumbUrl, 'image/*');
  if (!res.ok) {
    console.warn(`    image download ${res.status}: ${thumbUrl}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `${siteId}.webp`;
  try {
    await sharp(buf)
      .rotate() // honour EXIF orientation before stripping metadata
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(resolve(IMAGES_DIR, file));
  } catch (err) {
    console.warn(`    not a decodable image (${(err as Error).message}): ${thumbUrl}`);
    return null;
  }
  return file;
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(SITES_FILE)) {
    console.error('public/data/sites.json not found — run `npm run ingest` first.');
    process.exit(1);
  }
  const sites: Site[] = JSON.parse(readFileSync(SITES_FILE, 'utf8'));
  const cache: ImageCache = loadImageCache();
  mkdirSync(IMAGES_DIR, { recursive: true });

  let pending = sites.filter((s) => (ONLY ? parentOf(s.category) === ONLY : true));
  if (!FORCE) {
    pending = pending.filter((s) => {
      const entry = cache[s.id];
      if (!entry) return true;
      // Cached hit whose file vanished (fresh checkout): re-download below
      // without re-searching.
      return !!entry.image && !existsSync(resolve(IMAGES_DIR, entry.image.file));
    });
  }
  console.log(`${sites.length} sites, ${pending.length} to check (${Object.keys(cache).length} cached).`);

  let done = 0;
  let found = 0;
  let dirty = 0;
  for (const site of pending) {
    if (done >= LIMIT) break;
    done++;

    try {
      const cached = cache[site.id];
      let candidate: Candidate | null = null;

      if (!FORCE && cached?.image?.thumbUrl) {
        candidate = cached.image as Candidate; // just the re-download path
      } else {
        for (const provider of providersFor(site)) {
          candidate = await provider(site);
          await sleep(DELAY_MS);
          if (candidate) break;
        }
      }

      if (candidate) {
        const file = await downloadThumb(site.id, candidate.thumbUrl);
        await sleep(DELAY_MS);
        cache[site.id] = {
          image: file
            ? {
                file,
                thumbUrl: candidate.thumbUrl,
                provider: candidate.provider,
                ...(candidate.author ? { author: candidate.author } : {}),
                ...(candidate.license ? { license: candidate.license } : {}),
                ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
              }
            : null,
          checkedAt: new Date().toISOString(),
        };
        if (file) found++;
      } else {
        cache[site.id] = { image: null, checkedAt: new Date().toISOString() };
      }
    } catch (err) {
      // Leave the site uncached so the next run retries it.
      console.warn(`  ⚠ ${site.name} (${site.id}): ${(err as Error).message}`);
    }

    if (++dirty >= 20) {
      saveImageCache(cache);
      dirty = 0;
    }
    if (done % 50 === 0) console.log(`  …${done}/${Math.min(pending.length, LIMIT)} checked, ${found} photos`);
  }

  saveImageCache(cache);
  const hits = Object.values(cache).filter((e) => e.image).length;
  console.log(
    `\n✓ ${done} sites checked this run (${found} new photos). ` +
      `Cache now covers ${Object.keys(cache).length} sites, ${hits} with a photo.\n` +
      `Re-run \`npm run ingest\` to bake images into sites.json.`,
  );
}

// Only run when executed directly (tests import the pure helpers).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
