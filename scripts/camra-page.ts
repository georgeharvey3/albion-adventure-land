import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { makePubId, slug, type RawRow } from '../src/data/ingest.ts';
import { type Closure, type OpeningHours, type Weekday, WEEKDAYS } from '../src/data/types.ts';
import { normalizePostcode } from './geocode.ts';
import { camraMapping } from '../src/data/mappings/camra.ts';

// Shared reader for the CAMRA Heritage Pubs site. Two build-time scripts read
// the same pub pages for different halves of the same pub:
//
//   • scripts/scrape-camra.ts     — the write-up and the gallery pictures.
//     Durable: a pub's prose and photos change rarely, and the run is slow
//     because it downloads images.
//   • scripts/refresh-camra-status.ts — the opening times, the survey dates and
//     the closure warning. Transient: these go stale in weeks, so they get
//     their own fast script and their own cache file.
//
// Everything both scripts need to turn CAMRA.csv into a list of pub-page URLs,
// and everything either needs to read a field out of one of those pages, lives
// here. Neither script touches the network anywhere else, and the app never
// does — see CLAUDE.md.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LISTING_URL = 'https://camra.org.uk/heritage-pubs/national-inventory';
export const UA = 'Mozilla/5.0 (compatible; albion-adventure-land/0.1; build-time enrichment)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

export async function getBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

// --- HTML → text ----------------------------------------------------------

// Named entities seen in the CAMRA prose (typographic punctuation, £, accents),
// plus the structural few. Numeric entities (&#NNN; / &#xNN;) are handled below.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', ndash: '–', mdash: '—', pound: '£',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', uuml: 'ü',
};

export function decodeEntities(s: string): string {
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

// HTML fragment → plain text, preserving paragraph breaks. The build scripts
// own this (CLAUDE.md: parsers for CSV; the scraped HTML here is a small, stable
// structure so a targeted regex strip is adequate and dependency-free).
export function htmlToText(html: string): string {
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

// --- The listing table → pub-page URLs ------------------------------------

export interface ListingRow {
  name: string;
  postcode: string; // normalized
  url: string;
}

// Parse the National Inventory table into rows. Each <tr> has cells
// [grading, country, area, town, postcode, name-as-link]; we take every graded
// row with a pub link — the CSV holds all three grades (3-star, 2-star,
// 1-star), and the grade itself comes from the CSV, not from here.
export function parseListing(html: string): ListingRow[] {
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

export interface CsvPub {
  name: string;
  postcode: string;
}

/** The canonical pub list: the same CAMRA.csv rows ingest turns into sites,
 *  after the mapping's country exclusion. */
export function readPubCsv(): CsvPub[] {
  const csv = readFileSync(resolve(root, 'data/CAMRA.csv'), 'utf8');
  return Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: 'greedy' }).data
    .map((r) => ({
      name: (r[camraMapping.columns.name!] ?? '').trim(),
      postcode: (r[camraMapping.columns.postcode!] ?? '').trim(),
      country: (r['Country'] ?? '').trim(),
    }))
    .filter((p) => p.name && p.postcode)
    .filter((p) => !camraMapping.exclude?.values.includes(p.country)) // drop NI like ingest
    .map(({ name, postcode }) => ({ name, postcode }));
}

export interface PubPage {
  id: string; // stable pub id, same one ingest and the caches key on
  url: string;
  label: string; // "Name (POSTCODE)", for logs
}

/** Pair each CSV pub to its page on the CAMRA site.
 *
 *  Matching is easy because CAMRA.csv was itself derived from the National
 *  Inventory listing table, which carries the same Name/Postcode columns AND a
 *  link to each pub's page.
 *
 *  Name first, postcode second: a postcode can hold several heritage pubs, and
 *  taking a lone candidate whose name disagrees would attach one pub's page to
 *  another. The lone candidate is the fallback for the handful of pubs the
 *  listing and the CSV spell differently. */
export function matchPubPages(
  pubs: readonly CsvPub[],
  listing: readonly ListingRow[],
): { pages: PubPage[]; unmatched: string[] } {
  const byPostcode = new Map<string, ListingRow[]>();
  for (const row of listing) {
    const arr = byPostcode.get(row.postcode) ?? [];
    arr.push(row);
    byPostcode.set(row.postcode, arr);
  }

  const pages: PubPage[] = [];
  const unmatched: string[] = [];
  for (const pub of pubs) {
    const label = `${pub.name} (${pub.postcode})`;
    const candidates = byPostcode.get(normalizePostcode(pub.postcode)) ?? [];
    const match =
      candidates.find((c) => slug(c.name) === slug(pub.name)) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!match) {
      unmatched.push(label);
      continue;
    }
    pages.push({ id: makePubId(pub.name, pub.postcode), url: match.url, label });
  }
  return { pages, unmatched };
}

/** Fetch and pair in one step — what both scripts do first. */
export async function resolvePubPages(): Promise<{ pages: PubPage[]; unmatched: string[] }> {
  console.log('Fetching National Inventory listing …');
  const listing = parseListing(await getText(LISTING_URL));
  console.log(`  parsed ${listing.length} listing rows`);
  return matchPubPages(readPubCsv(), listing);
}

// --- Fields on a pub page -------------------------------------------------

// We want the general "Description" tab only — NOT the "Historic Interest" tab
// (Grade II / architectural detail). The page is an Alpine.js tabset: the
// description panel is `activeTab === 0`, the historic-interest one `=== 2`. Each
// panel's prose sits in a `keep-formatting` div, so we take the block whose
// immediately preceding markup marks it as the description panel. (The
// description tab has no "read full" expander — this block is the full text.)
//
// The class has to match from the start of the attribute: a closed pub's page
// opens the same panel with a `text-xs keep-formatting` div holding nothing but
// "This Pub is Permanently Closed", and that is a closure, not a description.
const KEEP_FMT = /<div class="keep-formatting[^"]*">([\s\S]*?)<\/div>/g;
const DESC_PANEL = 'activeTab === 0';

export function extractDescription(html: string): string {
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

// A shut pub carries a red alert above the page, and CAMRA uses `bg-red-700`
// for nothing else — an open pub's page has no such alert at all. So the
// BANNER, not its wording, is what marks a pub closed: CAMRA's vocabulary today
// is "Temporarily Closed", "Permanently Closed" and "Closed Long Term", and a
// rule that enumerated those would silently pass a fourth one through.
const CLOSURE_BANNER =
  /<div class="alert alert-row bg-red-700[^"]*"[^>]*>\s*<div class="[^"]*">([\s\S]*?)<\/div>/;
// The same page states the status again as a short heading in the description
// panel, which is where the tidy label comes from.
const CLOSURE_LABEL = /<p><strong>\s*This Pub is ([^<]+?)\s*<\/strong><\/p>/;

export function extractClosure(html: string): Closure | undefined {
  const banner = CLOSURE_BANNER.exec(html);
  if (!banner) return undefined;
  const note = htmlToText(banner[1]).replace(/\s*\n\s*/g, ' ');
  const label = CLOSURE_LABEL.exec(html)?.[1];
  return {
    // No heading to read is not a reason to drop a closure we can see. The
    // banner is the fact; the label is only how it is worded on a chip.
    label: label ? decodeEntities(label) : 'Closed',
    note,
  };
}

// Opening times come from the page's schema.org JSON-LD, which carries exactly
// the periods the visible weekday table shows (verified against both) without
// any of its markup or its "Noon"/"Midnight" prose. A day the pub is shut is
// simply absent, here and in what we store.
const HOURS_SPEC = /"openingHoursSpecification"\s*:\s*(\[[\s\S]*?\])\s*[,}]/;
const WEEKDAY_SET: ReadonlySet<string> = new Set(WEEKDAYS);

export function extractHours(html: string): OpeningHours[] {
  const m = HOURS_SPEC.exec(html);
  if (!m) return [];
  let spec: unknown;
  try {
    spec = JSON.parse(m[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(spec)) return [];

  const hours: OpeningHours[] = [];
  for (const entry of spec) {
    const e = entry as { dayOfWeek?: unknown; opens?: unknown; closes?: unknown };
    const day = String(e.dayOfWeek ?? '').toLowerCase();
    const opens = String(e.opens ?? '');
    const closes = String(e.closes ?? '');
    // Anything that is not a weekday with two HH:MM times is not something the
    // card can render, so it does not become data.
    if (!WEEKDAY_SET.has(day)) continue;
    if (!/^\d{2}:\d{2}$/.test(opens) || !/^\d{2}:\d{2}$/.test(closes)) continue;
    hours.push({ day: day as Weekday, opens, closes });
  }
  // Source order is Monday-first in practice but nothing guarantees it, and the
  // card reads the array straight through.
  hours.sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.opens.localeCompare(b.opens));
  return hours;
}

// The "Additional information" tab's definition list. "Last updated" is when
// CAMRA last edited the entry; "Last surveyed" is when a member last stood in
// the pub. They differ, often by years, and the card shows both — one says how
// fresh the write-up is, the other how fresh the FACTS are.
function dlField(html: string, term: string): string | undefined {
  const re = new RegExp(`<dt[^>]*>\\s*${term}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`);
  const m = re.exec(html);
  return m ? htmlToText(m[1]) : undefined;
}

/** CAMRA writes these as dd/mm/yyyy (the `Last updated` one also carries a
 *  machine-readable `<time datetime>`, which htmlToText drops). ISO is what a
 *  Site stores, so an unparseable value becomes no value rather than a string
 *  the card would have to guess at. */
export function toIsoDate(ddmmyyyy: string | undefined): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((ddmmyyyy ?? '').trim());
  if (!m) return undefined;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

export function extractSurveyDates(html: string): {
  lastSurveyed?: string;
  lastUpdated?: string;
} {
  return {
    lastSurveyed: toIsoDate(dlField(html, 'Last surveyed')),
    lastUpdated: toIsoDate(dlField(html, 'Last updated')),
  };
}
