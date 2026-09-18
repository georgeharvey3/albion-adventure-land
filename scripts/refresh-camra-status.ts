import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type PubStatus } from '../src/data/ingest.ts';
import {
  extractClosure,
  extractHours,
  extractSurveyDates,
  getText,
  resolvePubPages,
  sleep,
} from './camra-page.ts';

// Build-time refresh of the TRANSIENT pub facts: opening times, the two dates
// CAMRA publishes (last updated, last surveyed) and the closure warning.
//
// These are the facts that rot. A pub's write-up and photographs are good for
// years; its opening times are good for months and its closure notice for
// weeks. So they live apart from the durable enrichment:
//
//   npm run scrape:camra   → data/camra-descriptions.json (prose + pictures)
//   npm run refresh:camra  → data/camra-status.json       (this script)
//
// The split is the point. This script downloads no pictures, so a full refresh
// of ~1300 pubs takes about half an hour (~45 pubs a minute) instead of the
// scraper's hour and more, and it can be re-run as often as the data deserves
// without touching anything that took an hour to collect. Both read the same pages through scripts/camra-page.ts.
//
// Like every other network step in this repo it is build-time only and cached
// on disk, keyed by the STABLE pub id: the app itself never calls CAMRA.
//
// A pub that has reopened simply comes back without a `closure`, which is how
// it returns to the app — see the closure filter in src/state/store.ts.
//
// Flags:
//   --limit=N     stop after N pubs (for trying it out)
//   --stale=DAYS  only re-read pubs last read more than DAYS ago (resume a
//                 part-finished run, or top up after a few weeks)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'data');
const OUT_FILE = resolve(OUT_DIR, 'camra-status.json');
const DELAY_MS = 400; // be polite between pub-page fetches

const arg = (name: string): string | undefined =>
  new RegExp(`^--${name}=(.+)$`).exec(process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '')?.[1];

const LIMIT = Number(arg('limit') ?? Infinity);
const STALE_DAYS = Number(arg('stale') ?? NaN);

const today = new Date().toISOString().slice(0, 10);

function loadCache(): Record<string, PubStatus> {
  if (!existsSync(OUT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Record<string, PubStatus>;
  } catch {
    console.warn('  ⚠ existing camra-status.json unreadable, starting fresh');
    return {};
  }
}

function save(data: Record<string, PubStatus>): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const ordered: Record<string, PubStatus> = {};
  for (const key of Object.keys(data).sort()) ordered[key] = data[key];
  // Pretty JSON, except that each opening period goes on one line. This file is
  // meant to be re-read often and committed each time; spread over five lines a
  // period turns a pub changing one closing time into a 40-line diff, and the
  // file into 50,000 lines. One line per period keeps the diff readable.
  const json = JSON.stringify(ordered, null, 2).replace(
    /\{\s*"day": ("\w+"),\s*"opens": ("[\d:]+"),\s*"closes": ("[\d:]+")\s*\}/g,
    (_m, day, opens, closes) => `{ "day": ${day}, "opens": ${opens}, "closes": ${closes} }`,
  );
  writeFileSync(OUT_FILE, json + '\n');
}

/** Days between an ISO date and today. A missing or unreadable date counts as
 *  infinitely old, so it is always re-read. */
function ageInDays(iso: string | undefined): number {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

async function main(): Promise<void> {
  const { pages, unmatched } = await resolvePubPages();

  const cache = loadCache();
  const toFetch = Number.isFinite(STALE_DAYS)
    ? pages.filter((p) => ageInDays(cache[p.id]?.checkedAt) > STALE_DAYS)
    : pages;
  const fetching = Number.isFinite(LIMIT) ? toFetch.slice(0, LIMIT) : toFetch;

  console.log(
    `\n${pages.length + unmatched.length} pubs · ${pages.length} matched · ` +
      `${unmatched.length} unmatched · ${fetching.length} to read` +
      `${Number.isFinite(STALE_DAYS) ? ` (older than ${STALE_DAYS} days)` : ''}`,
  );

  let read = 0;
  let closed = 0;
  let reopened = 0;
  const noHours: string[] = [];
  const noDates: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < fetching.length; i++) {
    const { id, url, label } = fetching[i];
    try {
      const html = await getText(url);
      const closure = extractClosure(html);
      const hours = extractHours(html);
      const { lastSurveyed, lastUpdated } = extractSurveyDates(html);

      // A pub that WAS closed and no longer is: the entry is rewritten without
      // a closure, so the app shows it again. Worth counting — it is the whole
      // reason to re-run this.
      if (cache[id]?.closure && !closure) reopened++;
      if (closure) closed++;
      if (!hours.length && !closure) noHours.push(label); // a shut pub having no hours is expected
      if (!lastSurveyed && !lastUpdated) noDates.push(label);

      // Written whole, never merged into the old entry: a field the page has
      // dropped must disappear here too, or the card would keep showing an
      // opening time CAMRA has withdrawn.
      cache[id] = {
        ...(closure ? { closure } : {}),
        ...(hours.length ? { hours } : {}),
        ...(lastSurveyed ? { lastSurveyed } : {}),
        ...(lastUpdated ? { lastUpdated } : {}),
        checkedAt: today,
      };
      read++;
      process.stdout.write(`\r  read ${i + 1}/${fetching.length}  `);
    } catch (err) {
      // The old entry stays. Stale is better than absent: it still carries the
      // survey dates that say how old it is.
      failed.push(`${label}: ${(err as Error).message}`);
    }
    save(cache); // incremental — a crash never loses progress
    if (i < fetching.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n\n✓ ${read} pubs written to data/camra-status.json`);
  console.log(`  ${closed} closed (hidden in the app until they reopen) · ${reopened} reopened since the last run`);
  console.log(`  total cached: ${Object.keys(cache).length}`);
  if (noHours.length) {
    console.warn(`  ⚠ ${noHours.length} open pubs published no opening times:`);
    for (const n of noHours) console.warn(`    - ${n}`);
  }
  if (noDates.length) {
    console.warn(`  ⚠ ${noDates.length} pages carried neither date:`);
    for (const n of noDates) console.warn(`    - ${n}`);
  }
  if (failed.length) {
    console.warn(`  ⚠ ${failed.length} pages could not be read (previous entry kept):`);
    for (const f of failed) console.warn(`    - ${f}`);
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
