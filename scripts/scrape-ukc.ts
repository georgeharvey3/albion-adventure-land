import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import sharp from 'sharp';
import { chromium, type BrowserContext, type Page, type Response } from 'playwright';
import { makeId, type RawRow, type CragPhotoCache } from '../src/data/ingest.ts';
import { type SiteImage } from '../src/data/types.ts';
import { scramblesMapping } from '../src/data/mappings/scrambles.ts';

// Build-time UKC picture scraper — the scramble equivalent of scrape-camra.ts.
// It reads the route rows in data/scrambles.csv, visits each route's UKClimbing
// CRAG page, and keeps the pictures that page loads. Results are cached on disk
// (data/ukc-photos.json + data/ukc-images/), so the app stays fully offline and
// the build never depends on this script: a fresh checkout without the cache
// gives scrambles with no pictures, exactly as before.
//
// Two things make this harder than the CAMRA scraper:
//
// 1. ukclimbing.com sits behind a Cloudflare challenge. plain fetch, curl and
//    HEADLESS Chrome all get 403 "Just a moment...". A real, headed Chrome
//    passes, so this script drives one through Playwright and needs a display
//    (DISPLAY, or an X server such as Xvfb). It must also start WITHOUT
//    Playwright's usual `--enable-automation` flag — see the launch options
//    below. Requests stay slow and serial anyway: this is somebody else's
//    website, and one page at a time is the polite way to read 100 of them.
// 2. img.ukclimbing.com refuses every request we make ourselves — with the
//    browser's own cookies, from the page's own JS, and as a top-level
//    navigation. Only the images the PAGE loads as subresources come back 200.
//    So we never request a picture: we let the crag page load, listen for its
//    image responses, and take the bytes out of them.
//
// Pictures therefore belong to the CRAG, not to the route: several scrambles
// share one crag, and a crag page offers one usable photo (its header shot).
// The per-route galleries live behind /logbook/crag_photos.php, which answers
// 403 even inside a cleared browser session, so a route's siblings share the
// crag picture rather than getting one each.
//
// Content belongs to UKClimbing and to the individual photographers; we store
// it for personal/offline use, and every scramble card links back to its UKC
// page. Re-run with --force to re-fetch all.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'data');
const OUT_FILE = resolve(OUT_DIR, 'ukc-photos.json');
const CSV_FILE = resolve(OUT_DIR, 'scrambles.csv');
// Chrome profile. Kept out of git: it holds the Cloudflare clearance cookie,
// which is what lets a second run start without another challenge.
const PROFILE_DIR = resolve(OUT_DIR, '.ukc-profile');

const IMG_DIR = resolve(OUT_DIR, 'ukc-images');
const IMG_BASE_URL = 'images/ukc';
const MAX_IMAGES = 3; // per crag, in page order; UKC usually offers one
const IMG_WIDTH = 720; // downscale ceiling, as for the pub pictures
const IMG_QUALITY = 75;
// Below this, a picture is a guidebook cover, an avatar or a table thumbnail
// (UKC serves those at w=85 and w=150) rather than a picture of the crag.
const MIN_SOURCE_WIDTH = 400;
const MIN_SOURCE_BYTES = 20_000;

const FORCE = process.argv.includes('--force');
const HEADLESS = process.argv.includes('--headless'); // for debugging; Cloudflare blocks it
// --interactive: when the challenge will not clear on its own, ask the person at
// the keyboard to tick "Verify you are human" in the Chrome window this script
// opened. Cloudflare's checkbox ignores a synthetic click (Playwright drives the
// browser through the debug protocol, and the widget only trusts real input), so
// a human is the only way past an interactive challenge.
const INTERACTIVE = process.argv.includes('--interactive');
const num = (flag: string, fallback: number) =>
  Number(
    new RegExp(`^--${flag}=(\\d+)$`).exec(process.argv.find((a) => a.startsWith(`--${flag}=`)) ?? '')?.[1] ??
      fallback,
  );
// --limit=N: stop after N crags. For trying the scraper out without a full run.
const LIMIT = num('limit', Infinity);
// --crag=<key>: fetch this one crag (e.g. `ben_nevis-16877`). For debugging a
// page that gave nothing.
const ONLY = /^--crag=(.+)$/.exec(process.argv.find((a) => a.startsWith('--crag=')) ?? '')?.[1];
// Politeness, and self-defence: fast serial page loads get the IP challenged.
const DELAY_MS = num('delay', 4000);
// How long to sit on a challenge page before giving up on one attempt.
const CHALLENGE_WAIT_MS = 25_000;
const ATTEMPTS = 2;
// How long to wait for a person to tick the checkbox, with --interactive.
const PROMPT_WAIT_MS = 180_000;
// A blocked page means the IP is flagged. Rest before the next one, and give up
// on the run after this many in a row — the cache makes a later re-run cheap.
const BLOCK_COOLDOWN_MS = 120_000;
const MAX_CONSECUTIVE_BLOCKS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Route {
  id: string; // stable site id, same derivation as ingest
  name: string;
  cragKey: string; // e.g. "the_cobbler-594"
  cragUrl: string;
}

// --- Route list -----------------------------------------------------------

// The `url` column is the route's UKC logbook page; its crag segment is what we
// visit. A row without one (a handful of routes were sourced elsewhere) simply
// gets no picture — reported at the end, never dropped silently.
const CRAG_URL = /^(https:\/\/www\.ukclimbing\.com\/logbook\/crags\/([a-z0-9_]+-\d+))\//;

function readRoutes(): { routes: Route[]; noCragUrl: string[] } {
  const csv = readFileSync(CSV_FILE, 'utf8');
  const rows = Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: 'greedy' }).data;
  const cols = scramblesMapping.columns;
  const routes: Route[] = [];
  const noCragUrl: string[] = [];

  for (const row of rows) {
    const name = (row[cols.name!] ?? '').trim();
    const lat = Number((row[cols.lat!] ?? '').trim());
    const lng = Number((row[cols.lng!] ?? '').trim());
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue; // ingest reports these
    const m = CRAG_URL.exec((row[cols.sourceUrl!] ?? '').trim());
    if (!m) {
      noCragUrl.push(name);
      continue;
    }
    routes.push({ id: makeId(name, lat, lng), name, cragUrl: `${m[1]}/`, cragKey: m[2] });
  }
  return { routes, noCragUrl };
}

// --- Browser --------------------------------------------------------------

function isChallenge(title: string): boolean {
  return /just a moment|verify you are human|performing security verification/i.test(title);
}

/** Load a UKC page, waiting out the Cloudflare challenge. Returns false when the
 *  challenge never cleared — the caller moves on rather than hammering. */
async function open(page: Page, url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (err) {
      console.warn(`\n  ⚠ ${url} attempt ${attempt}: ${(err as Error).message.split('\n')[0]}`);
    }
    if (await cleared(page, CHALLENGE_WAIT_MS)) return true;
    // Flagged. Back off longer each time; the clearance is worth waiting for.
    await sleep(DELAY_MS * attempt * 2);
  }
  if (INTERACTIVE) {
    console.log(
      `\n  ⏸ Cloudflare is asking for a human. Tick "Verify you are human" in the ` +
        `Chrome window (${url}). Waiting up to ${PROMPT_WAIT_MS / 1000}s …`,
    );
    if (await cleared(page, PROMPT_WAIT_MS)) {
      console.log('  ▶ cleared, carrying on');
      return true;
    }
  }
  return false;
}

/** Wait for the challenge to go away, up to `ms`. */
async function cleared(page: Page, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isChallenge(await page.title())) return true;
    await sleep(1000);
  }
  return !isChallenge(await page.title());
}

interface Shot {
  photoId: string;
  width: number; // width the page asked for, not the decoded width
  bytes: Buffer;
}

/** Collect the pictures a page loads from img.ukclimbing.com. Only the page's
 *  own subresource requests get past Cloudflare, so this listener IS the
 *  download: we read the body out of each response as it arrives. */
function collectShots(page: Page): { shots: Shot[]; stop: () => void } {
  const shots: Shot[] = [];
  const onResponse = async (res: Response) => {
    const url = res.url();
    if (!/^https:\/\/img\.ukclimbing\.com\/i\//.test(url)) return;
    if (!res.ok()) return;
    if (!/^image\//.test(res.headers()['content-type'] ?? '')) return;
    let bytes: Buffer;
    try {
      bytes = await res.body();
    } catch {
      return; // body already discarded (navigated away) — not worth reporting
    }
    const photoId = /\/i\/(\d+)/.exec(url)?.[1] ?? url;
    const width = Number(/[?&]w=(\d+)/.exec(url)?.[1] ?? 0);
    if (width && width < MIN_SOURCE_WIDTH) return;
    if (bytes.length < MIN_SOURCE_BYTES) return;
    shots.push({ photoId, width, bytes });
  };
  const listener = (res: Response) => void onResponse(res);
  page.on('response', listener);
  // The listener must come off again: one is added per crag, and a page that
  // keeps them all would go on filling the arrays of crags already written.
  return { shots, stop: () => page.off('response', listener) };
}

// Some crag pages carry a header picture in their Open Graph tags but never load
// it themselves (the page shows a map instead). We cannot fetch it — only the
// page's own requests get past Cloudflare — so we ask the page to load it, by
// adding an <img> to it and letting the response listener take the bytes.
// `/i/0` is UKC's "no picture" placeholder and is skipped.
async function loadHeaderPicture(page: Page): Promise<void> {
  const og = await page
    .$eval('meta[property="og:image"]', (el) => el.getAttribute('content') ?? '')
    .catch(() => '');
  if (!og || /\/i\/0\?/.test(og)) return;
  await page
    .evaluate(
      (url: string) =>
        new Promise<boolean>((done) => {
          // The scripts here are typed for Node, which has no DOM: reach the
          // page's own globals through globalThis rather than pull the DOM
          // library into the build for one <img>.
          const dom = globalThis as unknown as {
            Image: new () => { onload: () => void; onerror: () => void; src: string };
            document: { body: { appendChild: (node: unknown) => void } };
          };
          const img = new dom.Image();
          img.onload = () => done(true);
          img.onerror = () => done(false);
          img.src = url;
          dom.document.body.appendChild(img);
        }),
      og,
    )
    .catch(() => false);
  await page.waitForTimeout(2000);
}

/** Visit one crag page and give it a moment to load its pictures. Scrolling
 *  matters: the header shot loads at once, but anything further down the page
 *  is lazy. */
async function visitCrag(page: Page, url: string): Promise<Shot[] | null> {
  const { shots, stop } = collectShots(page);
  try {
    if (!(await open(page, url))) return null;
    await page.waitForTimeout(2500);
    await page.keyboard.press('End').catch(() => {}); // lazy pictures further down the page
    await page.waitForTimeout(2500);
    if (!shots.length) await loadHeaderPicture(page);
    // Biggest rendition per photo, page order preserved by first appearance.
    const best = new Map<string, Shot>();
    for (const shot of shots) {
      const seen = best.get(shot.photoId);
      if (!seen || shot.bytes.length > seen.bytes.length) best.set(shot.photoId, shot);
    }
    return [...best.values()].slice(0, MAX_IMAGES);
  } finally {
    stop();
  }
}

// --- Pictures on disk -----------------------------------------------------

/** Downscale and write data/ukc-images/<cragKey>_<n>.jpg. Named by crag, not by
 *  route: the routes at a crag share the file. */
async function writeImages(cragKey: string, shots: Shot[]): Promise<SiteImage[]> {
  const images: SiteImage[] = [];
  mkdirSync(IMG_DIR, { recursive: true });

  for (const shot of shots) {
    const fileName = `${cragKey}_${images.length + 1}.jpg`;
    try {
      const out = await sharp(shot.bytes)
        .rotate() // honour EXIF orientation before it is stripped
        .resize({ width: IMG_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: IMG_QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      writeFileSync(resolve(IMG_DIR, fileName), out.data);
      images.push({ url: `${IMG_BASE_URL}/${fileName}`, width: out.info.width, height: out.info.height });
    } catch (err) {
      console.warn(`\n  ⚠ ${cragKey}: unreadable picture skipped (${(err as Error).message})`);
    }
  }

  // A re-run that finds fewer pictures than last time must not leave the extras
  // behind: the JSON would no longer name them, but ingest copies by name.
  for (let n = images.length + 1; n <= MAX_IMAGES; n++) {
    rmSync(resolve(IMG_DIR, `${cragKey}_${n}.jpg`), { force: true });
  }
  return images;
}

// --- Cache ----------------------------------------------------------------

function loadCache(): CragPhotoCache {
  if (!existsSync(OUT_FILE)) return { crags: {}, routes: {} };
  try {
    const parsed = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as CragPhotoCache;
    return { crags: parsed.crags ?? {}, routes: parsed.routes ?? {} };
  } catch {
    console.warn('  ⚠ existing ukc-photos.json unreadable, starting fresh');
    return { crags: {}, routes: {} };
  }
}

function save(cache: CragPhotoCache): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const sortKeys = <T>(o: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const k of Object.keys(o).sort()) out[k] = o[k];
    return out;
  };
  writeFileSync(
    OUT_FILE,
    JSON.stringify({ crags: sortKeys(cache.crags), routes: sortKeys(cache.routes) }, null, 2) + '\n',
  );
}

// --- Main -----------------------------------------------------------------

async function main(): Promise<void> {
  const { routes, noCragUrl } = readRoutes();
  const byCrag = new Map<string, Route[]>();
  for (const route of routes) {
    const arr = byCrag.get(route.cragKey) ?? [];
    arr.push(route);
    byCrag.set(route.cragKey, arr);
  }

  const cache = loadCache();
  // The route → crag map is free to rebuild every run: it comes from the CSV,
  // not from the network, so a renamed or re-coordinated route is picked up
  // without re-fetching anything.
  cache.routes = {};
  for (const route of routes) cache.routes[route.id] = route.cragKey;

  const todo = [...byCrag.keys()].filter(
    (key) => (ONLY ? key === ONLY : true) && (FORCE || ONLY === key || !cache.crags[key]),
  );
  if (Number.isFinite(LIMIT)) todo.length = Math.min(todo.length, LIMIT);

  console.log(
    `${routes.length} routes · ${byCrag.size} crags · ${todo.length} to fetch` +
      `${FORCE ? ' (--force)' : ''}`,
  );
  save(cache); // the route map alone is worth writing before any fetching
  if (!todo.length) {
    console.log('Nothing to fetch. Use --force to re-fetch every crag.');
    return;
  }
  if (!HEADLESS && !process.env.DISPLAY) {
    console.warn(
      '  ⚠ no DISPLAY set. UKC blocks headless Chrome, so this needs an X display ' +
        '(e.g. `xvfb-run -a npm run scrape:ukc`).',
    );
  }

  mkdirSync(PROFILE_DIR, { recursive: true });
  let ctx: BrowserContext;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: HEADLESS,
      viewport: { width: 1280, height: 900 },
      // The two options that decide whether UKC serves the page or the
      // challenge. Playwright starts Chrome with `--enable-automation`, which
      // sets `navigator.webdriver` and is what Cloudflare reads: with the flag,
      // every page load lands on an interactive checkbox that no synthetic
      // click can tick; without it, the same machine and IP load the page.
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    console.error(
      `Could not start Chrome: ${(err as Error).message.split('\n')[0]}\n` +
        'Install one with `npx playwright install chrome`.',
    );
    process.exit(1);
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  let pictures = 0;
  let inARow = 0; // consecutive blocked pages
  let gaveUp = false;
  const blocked: string[] = [];
  const empty: string[] = [];
  for (let i = 0; i < todo.length; i++) {
    const cragKey = todo[i];
    const crag = byCrag.get(cragKey)!;
    const label = `${cragKey} (${crag.length} route${crag.length > 1 ? 's' : ''})`;
    try {
      const shots = await visitCrag(page, crag[0].cragUrl);
      if (shots === null) {
        blocked.push(label);
        inARow++;
      } else {
        inARow = 0;
        const images = await writeImages(cragKey, shots);
        pictures += images.length;
        if (images.length) cache.crags[cragKey] = { url: crag[0].cragUrl, images };
        else empty.push(label);
      }
    } catch (err) {
      console.warn(`\n  ⚠ failed ${label}: ${(err as Error).message.split('\n')[0]}`);
    }
    save(cache); // incremental — a crash or a Cloudflare block never loses progress
    process.stdout.write(`\r  ${i + 1}/${todo.length} crags · ${pictures} pictures  `);
    if (inARow >= MAX_CONSECUTIVE_BLOCKS) {
      gaveUp = true;
      console.warn(
        `\n  ⛔ ${inARow} pages blocked in a row — the IP is flagged. Stopping here; ` +
          'the cache means a re-run later starts where this one left off.',
      );
      break;
    }
    if (i < todo.length - 1) await sleep(inARow ? BLOCK_COOLDOWN_MS : DELAY_MS);
  }
  await ctx.close();

  const withPictures = routes.filter((r) => cache.crags[r.cragKey]?.images.length).length;
  console.log(`\n\n✓ ${Object.keys(cache.crags).length} crags cached in data/ukc-photos.json`);
  console.log(`  ${pictures} pictures written to data/ukc-images/ this run`);
  console.log(`  ${withPictures} of ${routes.length} routes now have a picture`);
  if (empty.length) {
    console.warn(`  ⚠ ${empty.length} crag page(s) served no usable picture:`);
    for (const e of empty) console.warn(`    - ${e}`);
  }
  if (blocked.length) {
    console.warn(
      `  ⚠ ${blocked.length} crag page(s) stayed on the Cloudflare challenge. ` +
        'Wait a while and re-run — cached crags are skipped. ' +
        'With --interactive the script pauses for you to tick the checkbox:',
    );
    for (const b of blocked) console.warn(`    - ${b}`);
  }
  if (gaveUp) {
    console.warn(`  ⚠ the run stopped early. Re-run to continue.`);
  }
  if (noCragUrl.length) {
    console.warn(`  ⚠ ${noCragUrl.length} route(s) have no UKC crag URL to visit:`);
    for (const n of noCragUrl) console.warn(`    - ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
