import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import {
  ingest,
  ingestPubs,
  parseImages,
  type Geocoder,
  type RawRow,
  type PubEnrichment,
} from '../src/data/ingest.ts';
import { magicalBritainMapping, type SourceMapping } from '../src/data/mappings/magical_britain.ts';
import { camraMapping } from '../src/data/mappings/camra.ts';
import { wildSwimsMapping } from '../src/data/mappings/wild_swims.ts';
import { ruinsMapping } from '../src/data/mappings/ruins.ts';
import { magicalFranceMapping } from '../src/data/mappings/magical_france.ts';
import { scramblesMapping } from '../src/data/mappings/scrambles.ts';
import { geocodePostcodes, normalizePostcode } from './geocode.ts';
import { SITE_TYPE_LABELS, type Site, type SiteImage } from '../src/data/types.ts';

// Build-time ingest (spec §5.2, §12 step 2). Reads the real CSV with Papa Parse
// (NOT naive splitting — descriptions contain embedded commas/newlines), applies
// the source mapping, and emits normalized JSON into public/data for the app to
// fetch. Logs validation rejections and skipped navigation-aid rows.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface SourceSpec {
  csv: string;
  mapping: SourceMapping;
}

const SOURCES: SourceSpec[] = [
  { csv: 'data/magical_britain_master.csv', mapping: magicalBritainMapping },
  { csv: 'data/CAMRA.csv', mapping: camraMapping },
  { csv: 'data/swims.csv', mapping: wildSwimsMapping },
  { csv: 'data/ruins.csv', mapping: ruinsMapping },
  { csv: 'data/scrambles.csv', mapping: scramblesMapping },
  { csv: 'data/MF-north.csv', mapping: magicalFranceMapping },
];

function parseCsv(text: string): RawRow[] {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (result.errors.length) {
    for (const e of result.errors) {
      console.warn(`  csv parse warning (row ${e.row}): ${e.message}`);
    }
  }
  return result.data;
}

// Resolve the postcode column to coordinates and return a Geocoder closure.
async function buildGeocoder(rows: RawRow[], mapping: SourceMapping): Promise<Geocoder> {
  const postcodeCol = mapping.columns.postcode;
  const postcodes = rows
    .map((r) => (postcodeCol ? (r[postcodeCol] ?? '').trim() : ''))
    .filter(Boolean);
  const resolved = await geocodePostcodes(postcodes);
  return (postcode: string) => resolved.get(normalizePostcode(postcode)) ?? null;
}

// Optional pub enrichment (descriptions + source links) scraped by
// scripts/scrape-camra.ts. Absent on a fresh checkout — pubs just stay sparse
// until `npm run scrape:camra` is run, so the build never depends on it.
function loadPubEnrichment(): Record<string, PubEnrichment> {
  const file = resolve(root, 'data/camra-descriptions.json');
  if (!existsSync(file)) {
    console.log('  (no data/camra-descriptions.json — run `npm run scrape:camra` to enrich pubs)');
    return {};
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, PubEnrichment>;
}

// A source's companion pictures CSV, when it declares one. Absent file is a
// hard error, not a silent skip: the mapping named it, so a missing file is a
// mistake worth failing the build over.
function loadImages(mapping: SourceMapping): Map<string, SiteImage[]> {
  if (!mapping.images) return new Map();
  const file = resolve(root, mapping.images.csv);
  if (!existsSync(file)) {
    throw new Error(`${mapping.source}: images CSV not found at ${mapping.images.csv}`);
  }
  return parseImages(parseCsv(readFileSync(file, 'utf8')), mapping);
}

// Copy the picture files a source references out of data/ (source material) and
// into public/ (what the app serves and Workbox precaches). Same direction as
// sites.json: data/ is the input, public/ is generated. A referenced file that
// is not on disk is reported, not skipped silently — the CSV and the folder are
// meant to agree.
function copyImages(mapping: SourceMapping, byListing: ReadonlyMap<string, SiteImage[]>): void {
  if (!mapping.images || !byListing.size) return;
  const srcDir = resolve(root, mapping.images.dir);
  const outDir = resolve(root, 'public', mapping.images.baseUrl);
  mkdirSync(outDir, { recursive: true });

  let copied = 0;
  const missing: string[] = [];
  for (const images of byListing.values()) {
    for (const image of images) {
      const fileName = image.url.slice(image.url.lastIndexOf('/') + 1);
      const from = resolve(srcDir, fileName);
      if (!existsSync(from)) {
        missing.push(fileName);
        continue;
      }
      copyFileSync(from, resolve(outDir, fileName));
      copied++;
    }
  }

  console.log(`  copied ${copied} picture files → public/${mapping.images.baseUrl}/`);
  if (missing.length) {
    console.warn(`  ⚠ ${missing.length} picture file(s) named in the CSV are not in ${mapping.images.dir}:`);
    for (const f of missing) console.warn(`    - ${f}`);
  }
}

async function main(): Promise<void> {
  const allSites: Site[] = [];
  const seen = new Set<string>();
  let totalRejected = 0;
  let totalSkipped = 0;
  const pubEnrichment = loadPubEnrichment();

  for (const { csv, mapping } of SOURCES) {
    console.log(`\nIngesting ${csv} …`);
    const text = readFileSync(resolve(root, csv), 'utf8');
    const rows = parseCsv(text);
    const images = loadImages(mapping);
    copyImages(mapping, images);
    const { sites, rejected, skippedNonCollectible } =
      mapping.coords === 'geocode_postcode'
        ? ingestPubs(rows, mapping, await buildGeocoder(rows, mapping), pubEnrichment)
        : ingest(rows, mapping, images);

    for (const s of sites) {
      if (seen.has(s.id)) continue; // cross-source dedupe by stable id
      seen.add(s.id);
      allSites.push(s);
    }

    console.log(`  ${rows.length} rows → ${sites.length} sites`);
    if (images.size) {
      const attached = sites.filter((s) => s.images?.length);
      const total = attached.reduce((n, s) => n + (s.images?.length ?? 0), 0);
      console.log(`  ${total} pictures on ${attached.length} of ${images.size} listings`);
      // A listing whose pictures found no `main` point is a data mismatch, not a
      // silent drop — name it so the CSVs can be corrected.
      const matched = new Set(attached.map((s) => s.listingId));
      for (const listingId of images.keys()) {
        if (!matched.has(listingId)) {
          console.warn(`  ⚠ pictures for listing ${listingId} matched no main point`);
        }
      }
    }
    if (skippedNonCollectible) {
      console.log(`  skipped ${skippedNonCollectible} non-collectible/excluded rows`);
    }
    if (rejected.length) {
      totalRejected += rejected.length;
      console.warn(`  ⚠ ${rejected.length} rows REJECTED (not dropped silently):`);
      for (const r of rejected) {
        console.warn(`    - ${r.reason}: ${JSON.stringify(r.row).slice(0, 120)}`);
      }
    }
    totalSkipped += skippedNonCollectible;
  }

  // Type-frequency summary (rarity is derived at load in the app, not stored).
  const byCategory: Record<string, number> = {};
  for (const s of allSites) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  console.log('\nSites by inferred type:');
  for (const [type, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${SITE_TYPE_LABELS[type as Site['category']]}: ${n}`);
  }

  const outDir = resolve(root, 'public/data');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'sites.json');
  writeFileSync(outFile, JSON.stringify(allSites, null, 0));

  console.log(
    `\n✓ Wrote ${allSites.length} sites to public/data/sites.json ` +
      `(${totalSkipped} skipped, ${totalRejected} rejected)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
