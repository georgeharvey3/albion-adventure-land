import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { ingest, ingestPubs, type Geocoder, type RawRow, type PubEnrichment } from '../src/data/ingest.ts';
import { magicalBritainMapping, type SourceMapping } from '../src/data/mappings/magical_britain.ts';
import { camraMapping } from '../src/data/mappings/camra.ts';
import { wildSwimsMapping } from '../src/data/mappings/wild_swims.ts';
import { ruinsMapping } from '../src/data/mappings/ruins.ts';
import { geocodePostcodes, normalizePostcode } from './geocode.ts';
import { SITE_TYPE_LABELS, type Site } from '../src/data/types.ts';

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
    const { sites, rejected, skippedNonCollectible } =
      mapping.coords === 'geocode_postcode'
        ? ingestPubs(rows, mapping, await buildGeocoder(rows, mapping), pubEnrichment)
        : ingest(rows, mapping);

    for (const s of sites) {
      if (seen.has(s.id)) continue; // cross-source dedupe by stable id
      seen.add(s.id);
      allSites.push(s);
    }

    console.log(`  ${rows.length} rows → ${sites.length} sites`);
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
