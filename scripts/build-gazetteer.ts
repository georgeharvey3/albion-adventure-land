import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaceKind, PlaceRegion, Gazetteer, PlaceTuple, OutcodeTuple } from '../src/search/gazetteerFormat.ts';

// Build-time gazetteer builder (issue #28). Emits the OFFLINE place dictionary
// the search box falls back to when there is no signal, into
// public/data/places.json — where Workbox precaches it alongside sites.json.
//
// Like scripts/geocode.ts, this is the only place that touches the network, it
// never runs at app runtime, and its OUTPUT IS COMMITTED. `npm run build` does
// NOT run it (unlike ingest): the dictionary changes when the world does, not
// when the code does, so rebuilding it is a deliberate act —
//
//   npm run gazetteer
//
// SOURCES, in the order each input is looked for:
//
//   1. An extracted file under data/gazetteer/ (gitignored — these are tens of
//      megabytes). Put one there to build with no network at all.
//   2. The `cities-with-1000` npm package, if it happens to be installed. It
//      ships GeoNames' cities1000.txt verbatim.
//   3. A download from download.geonames.org, unzipped via the `unzip` binary.
//
// LICENCE: the settlement and postcode data is GeoNames, CC BY 4.0. The
// attribution string is baked into the emitted JSON and rendered in the app —
// do not strip it. (OS Open Names, the other candidate, is better-populated for
// tiny GB hamlets but carries no population figures, which the ranking needs to
// tell Newport, Gwent from Newport, Isle of Wight.)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(root, 'data/gazetteer');
const OUT_FILE = resolve(root, 'public/data/places.json');

const ATTRIBUTION = 'Place names © GeoNames, CC BY 4.0';

// Settlements below this are noise for a driving-distance search — and the
// GeoNames cities1000 set is already floored at 1,000 anyway. Entries with an
// unknown population (0) are kept: GeoNames only lists them at all because they
// are named places, and several are Highland villages we very much want.
const MIN_POPULATION = 0;

interface Source {
  /** File name once extracted. */
  file: string;
  /** Path inside the npm package that ships it, if any. */
  npm?: string;
  /** Download URL of the zip it lives in. */
  url: string;
}

// Settlements, densest source first. cities500 reaches the Highland and Dales
// villages this app exists to send people to — Kinlochleven (~900 people) and
// Malham (~150) are below the cities1000 floor but are exactly the sort of
// place someone types into this box. cities1000 is the fallback, and the npm
// package is a third path for builds with no network at all.
const CITY_SOURCES: Source[] = [
  { file: 'cities500.txt', url: 'https://download.geonames.org/export/dump/cities500.zip' },
  {
    file: 'cities1000.txt',
    npm: 'node_modules/cities-with-1000/cities1000.txt',
    url: 'https://download.geonames.org/export/dump/cities1000.zip',
  },
];

const POSTAL: Source = {
  file: 'GB.txt',
  url: 'https://download.geonames.org/export/zip/GB.zip',
};

/** Find a source file locally, or fetch and unzip it. Returns null if unavailable. */
function loadSource(src: Source, label: string): string | null {
  const local = resolve(SRC_DIR, src.file);
  if (existsSync(local)) {
    console.log(`  ${label}: using ${local}`);
    return readFileSync(local, 'utf8');
  }

  if (src.npm) {
    const viaNpm = resolve(root, src.npm);
    if (existsSync(viaNpm)) {
      console.log(`  ${label}: using ${src.npm}`);
      return readFileSync(viaNpm, 'utf8');
    }
  }

  console.log(`  ${label}: downloading ${src.url}…`);
  try {
    mkdirSync(SRC_DIR, { recursive: true });
    const zip = resolve(SRC_DIR, `${label}.zip`);
    execFileSync('curl', ['-sSfL', '--max-time', '300', '-o', zip, src.url]);
    execFileSync('unzip', ['-o', '-q', zip, src.file, '-d', SRC_DIR]);
    return readFileSync(local, 'utf8');
  } catch (err) {
    console.warn(
      `  ⚠ ${label}: unavailable (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

// GeoNames admin1 codes for the four UK countries. Anything else under the GB
// country code is a crown dependency or overseas oddity we don't want.
const REGIONS: Record<string, PlaceRegion> = {
  ENG: 'ENG',
  SCT: 'SCT',
  WLS: 'WLS',
  NIR: 'NIR',
};

// GeoNames feature codes, mapped to the three sizes the UI labels. PPLC/PPLA are
// capitals and first-order admin seats; PPLA2/PPLA3 are county/district seats.
// Everything else falls through to "village", and population does the real work
// in the ranking anyway.
function settlementKind(featureCode: string, population: number): PlaceKind {
  if (featureCode === 'PPLC' || featureCode === 'PPLA' || population >= 100000) return 'city';
  if (featureCode === 'PPLA2' || featureCode === 'PPLA3' || population >= 10000) return 'town';
  return 'village';
}

/** Round to 4 decimal places — ~11 m, far finer than a settlement centroid means. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function buildSettlements(tsv: string): PlaceTuple[] {
  const places: PlaceTuple[] = [];
  let skipped = 0;

  for (const line of tsv.split('\n')) {
    if (!line) continue;
    // GeoNames dump columns: 0 id, 1 name, 2 ascii, 3 altnames, 4 lat, 5 lng,
    // 6 feature class, 7 feature code, 8 country, 9 cc2, 10 admin1, … 14 pop.
    const f = line.split('\t');
    if (f[8] !== 'GB') continue;

    const region = REGIONS[f[10]];
    if (!region) {
      skipped++;
      continue;
    }

    const lat = Number(f[4]);
    const lng = Number(f[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn(`  ⚠ bad coordinates, skipping: ${f[1]}`);
      continue;
    }

    const population = Number(f[14]) || 0;
    if (population < MIN_POPULATION) continue;

    // Aliases earn their bytes only when they're a name someone might type:
    // GeoNames carries Cyrillic, Chinese and abbreviation forms for British
    // towns, none of which help here. Keep ASCII forms that differ from the
    // name, capped at two.
    const aliases = (f[3] ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a && a !== f[1] && /^[\x20-\x7e]+$/.test(a) && a.length > 2)
      .slice(0, 2);

    const tuple: PlaceTuple = [
      f[1],
      round(lat),
      round(lng),
      population,
      region,
      settlementKind(f[7], population),
    ];
    if (aliases.length) tuple[6] = aliases;
    places.push(tuple);
  }

  if (skipped) console.log(`  (${skipped} GB rows outside the four countries, skipped)`);
  return places;
}

// National parks and the handful of landmarks people name as a destination
// ("meet me at Ben Nevis"). cities1000 is populated places only, so these would
// otherwise be missing entirely — and they are exactly the sort of thing this
// app's users type. Coordinates are plain facts, hand-entered, no licence
// attaches. Population is 0 and sorts them below real towns of the same name.
const LANDMARKS: { name: string; lat: number; lng: number; region: PlaceRegion; aliases?: string[] }[] = [
  // National parks — England
  { name: 'Lake District', lat: 54.4609, lng: -3.0886, region: 'ENG' },
  { name: 'Peak District', lat: 53.3403, lng: -1.8149, region: 'ENG' },
  { name: 'Yorkshire Dales', lat: 54.2333, lng: -2.15, region: 'ENG' },
  { name: 'North York Moors', lat: 54.3833, lng: -0.8833, region: 'ENG' },
  { name: 'Northumberland National Park', lat: 55.3, lng: -2.2, region: 'ENG' },
  { name: 'Dartmoor', lat: 50.5717, lng: -3.9216, region: 'ENG' },
  { name: 'Exmoor', lat: 51.1333, lng: -3.65, region: 'ENG' },
  { name: 'New Forest', lat: 50.8667, lng: -1.6, region: 'ENG' },
  { name: 'South Downs', lat: 50.9167, lng: -0.5, region: 'ENG' },
  { name: 'The Broads', lat: 52.6667, lng: 1.5, region: 'ENG', aliases: ['Norfolk Broads'] },
  // National parks — Wales. Both carry their English names as aliases: the
  // official name changed, the way people type it largely hasn't.
  { name: 'Eryri', lat: 53.0685, lng: -3.9, region: 'WLS', aliases: ['Snowdonia'] },
  { name: 'Bannau Brycheiniog', lat: 51.8833, lng: -3.4333, region: 'WLS', aliases: ['Brecon Beacons'] },
  { name: 'Pembrokeshire Coast', lat: 51.8833, lng: -5.0667, region: 'WLS' },
  // National parks — Scotland
  { name: 'Cairngorms', lat: 57.0833, lng: -3.6667, region: 'SCT' },
  { name: 'Loch Lomond and the Trossachs', lat: 56.2333, lng: -4.6, region: 'SCT', aliases: ['Loch Lomond'] },
  // Mountains, waters and the handful of landmarks people name as a destination
  { name: 'Ben Nevis', lat: 56.7969, lng: -5.0036, region: 'SCT' },
  { name: 'Yr Wyddfa', lat: 53.0685, lng: -4.0764, region: 'WLS', aliases: ['Snowdon'] },
  { name: 'Scafell Pike', lat: 54.4542, lng: -3.2115, region: 'ENG' },
  { name: 'Helvellyn', lat: 54.527, lng: -3.0165, region: 'ENG' },
  { name: 'Ben Macdui', lat: 57.0704, lng: -3.669, region: 'SCT' },
  { name: 'Cadair Idris', lat: 52.6994, lng: -3.9083, region: 'WLS' },
  { name: 'Pen y Fan', lat: 51.8842, lng: -3.4366, region: 'WLS' },
  { name: 'Loch Ness', lat: 57.3229, lng: -4.4244, region: 'SCT' },
  { name: 'Glen Coe', lat: 56.6667, lng: -5.0333, region: 'SCT', aliases: ['Glencoe'] },
  { name: 'Isle of Skye', lat: 57.4, lng: -6.2, region: 'SCT', aliases: ['Skye'] },
  { name: 'Cheddar Gorge', lat: 51.2833, lng: -2.7667, region: 'ENG' },
  { name: 'Land\u2019s End', lat: 50.0664, lng: -5.7147, region: 'ENG', aliases: ['Lands End'] },
  { name: 'John o\u2019 Groats', lat: 58.6373, lng: -3.0689, region: 'SCT', aliases: ['John o Groats'] },
  { name: 'Stonehenge', lat: 51.1789, lng: -1.8262, region: 'ENG' },
  { name: 'Hadrian\u2019s Wall', lat: 55.0247, lng: -2.2861, region: 'ENG', aliases: ['Hadrians Wall'] },
  { name: 'Giant\u2019s Causeway', lat: 55.2408, lng: -6.5116, region: 'NIR', aliases: ['Giants Causeway'] },
];

function buildLandmarks(): PlaceTuple[] {
  return LANDMARKS.map(({ name, lat, lng, region, aliases }) => {
    const tuple: PlaceTuple = [name, round(lat), round(lng), 0, region, 'landmark'];
    if (aliases?.length) tuple[6] = aliases;
    return tuple;
  });
}

// Outward codes ("PH22"), from the GeoNames GB postal file — which is outward
// codes only, since the full Royal Mail postcode set is not open data. That is
// exactly the granularity worth shipping offline: 3k entries, and an outward
// code already pins you to a few square miles. A FULL postcode typed offline
// degrades to its outward code (see src/search/postcode.ts); online it is
// resolved exactly by postcodes.io.
function buildOutcodes(tsv: string): OutcodeTuple[] {
  // Postal columns: 0 country, 1 postcode, 2 place, 3 admin1, … 9 lat, 10 lng.
  // The file repeats an outward code once per place inside it, so average the
  // points rather than taking whichever happened to come first.
  const acc = new Map<string, { lat: number; lng: number; n: number }>();

  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    const code = (f[1] ?? '').trim().toUpperCase();
    const lat = Number(f[9]);
    const lng = Number(f[10]);
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const cur = acc.get(code);
    if (cur) {
      cur.lat += lat;
      cur.lng += lng;
      cur.n++;
    } else {
      acc.set(code, { lat, lng, n: 1 });
    }
  }

  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, { lat, lng, n }]) => [code, round(lat / n), round(lng / n)]);
}

function main(): void {
  console.log('Building offline gazetteer…');

  let citiesTsv: string | null = null;
  let citiesFrom = '';
  for (const src of CITY_SOURCES) {
    citiesTsv = loadSource(src, src.file.replace('.txt', ''));
    if (citiesTsv) {
      citiesFrom = src.file;
      break;
    }
  }
  if (!citiesTsv) {
    console.error(
      '\n✗ No settlement source available. Either allow network access to\n' +
        `  ${CITY_SOURCES[0].url}, or extract one of ` +
        `${CITY_SOURCES.map((s) => s.file).join(' / ')} into data/gazetteer/.`,
    );
    process.exit(1);
  }

  const settlements = buildSettlements(citiesTsv);
  const landmarks = buildLandmarks();

  const postalTsv = loadSource(POSTAL, 'GB-postal');
  const outcodes = postalTsv ? buildOutcodes(postalTsv) : [];
  if (!outcodes.length) {
    // Not fatal: postcode search still works online, and every other kind of
    // search still works offline. But offline postcode lookup is gone, so say
    // so rather than shipping a silently degraded dictionary.
    console.warn(
      '\n  ⚠ No outward postcodes in this build — offline postcode search will\n' +
        '    be unavailable. Re-run with network access to fix.',
    );
  }

  const gazetteer: Gazetteer = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    attribution: ATTRIBUTION,
    places: [...settlements, ...landmarks],
    outcodes,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(gazetteer));

  const kb = Math.round(readFileSync(OUT_FILE).byteLength / 1024);
  console.log(
    `\n✓ Wrote ${settlements.length} settlements (from ${citiesFrom}), ` +
      `${landmarks.length} landmarks and ${outcodes.length} outward codes ` +
      `to public/data/places.json (${kb} KB)`,
  );
}

main();
