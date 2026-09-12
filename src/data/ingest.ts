import { type Site, type SiteImage, normalizeCategory } from './types';
import { type SourceMapping } from './mappings/magical_britain';

// Pure ingest logic (spec §5.2). Runtime-agnostic so it runs in the Node build
// script and is unit-testable. Pipeline: apply mapping → validate → dedupe by id.
// Rows that fail validation are returned in `rejected`, never dropped silently.

export type RawRow = Record<string, string>;

export interface RejectedRow {
  row: RawRow;
  reason: string;
}

export interface IngestResult {
  sites: Site[];
  rejected: RejectedRow[];
  /** Rows intentionally not turned into sites: navigation aids (trailheads/
   *  parking) or rows dropped by the mapping's `exclude` rule. Not data errors. */
  skippedNonCollectible: number;
}

const UK_BOUNDS = { minLat: 49, maxLat: 61, minLng: -9, maxLng: 2 };

export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (ê, û, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Convert an ALL-CAPS source title to normal title case (some guidebooks shout
// their names). Capitalises the first letter of each word — where a "word" starts
// at the string start or after whitespace/brackets/slash/dash/opening-quote — and
// lowercases the rest. Apostrophes are deliberately NOT word separators, so
// possessives stay lowercase ("BAKER'S" → "Baker's", not "Baker'S"). Single-letter
// tokens (e.g. "R" for River) simply become a lone capital, which is correct.
export function toTitleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s(\[/\-–—‘“"])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

// Stable, derived id. Coordinates rounded to ~11 m so tiny CSV jitter on
// re-import doesn't break user state, while distinct nearby sites stay distinct.
export function makeId(name: string, lat: number, lng: number): string {
  return `${slug(name)}_${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

// Stable id for postcode-keyed sources (pubs). Built from name + postcode, both
// of which come straight from the CSV — so re-geocoding (which can nudge the
// coordinates) never changes the id, and user state survives. NOT coordinate-
// based, deliberately, unlike makeId.
export function makePubId(name: string, postcode: string): string {
  return `${slug(name)}_${slug(postcode)}`;
}

// Sanity bounds for a row's coordinates. A source declares its own window when
// it is not British (magical France); everything else falls back to the UK box.
// The check exists to catch swapped or mistyped lat/lng, not to gate a region.
function inBounds(lat: number, lng: number, mapping: SourceMapping): boolean {
  const b = mapping.bounds ?? UK_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

function col(row: RawRow, key: string | undefined): string {
  if (!key) return '';
  return (row[key] ?? '').trim();
}

// Free-text source tags. The column holds a JSON array in one cell
// (`["Waterfall", "Walk in"]`). Parsing is deliberately lenient: tags are a
// filter convenience, so a malformed cell yields no tags rather than rejecting
// an otherwise-good row. A comma-separated cell is accepted as a fallback.
// `UNKNOWN:<char>` entries are artefacts of the source's own tag conversion and
// carry no meaning — they are dropped so they never reach a filter chip.
export function parseTags(raw: string): string[] {
  if (!raw) return [];
  let values: unknown[];
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : [];
    } catch {
      values = [];
    }
  } else {
    values = raw.split(',');
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const tag = v.trim();
    if (!tag || tag.startsWith('UNKNOWN:') || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

// Rows dropped by the mapping's `exclude` rule (e.g. Northern Ireland pubs).
function isExcluded(row: RawRow, mapping: SourceMapping): boolean {
  const ex = mapping.exclude;
  if (!ex) return false;
  return ex.values.includes(col(row, ex.column));
}

export function mapRow(row: RawRow, mapping: SourceMapping): Site | RejectedRow {
  const rawName = col(row, mapping.columns.name);
  if (!rawName) {
    return { row, reason: 'missing name' };
  }
  // Title-case ALL-CAPS source titles when the mapping asks. Safe for the stable
  // id: makeId slugifies (lowercases) the name, so casing never affects it.
  const name = mapping.titleCaseName ? toTitleCase(rawName) : rawName;

  // Coordinates come either from separate lat/lng columns or a single combined
  // "lat, lng" column (split here), depending on the source.
  let latRaw: string;
  let lngRaw: string;
  if (mapping.columns.location) {
    const [a, b] = col(row, mapping.columns.location).split(',');
    latRaw = (a ?? '').trim();
    lngRaw = (b ?? '').trim();
  } else {
    latRaw = col(row, mapping.columns.lat);
    lngRaw = col(row, mapping.columns.lng);
  }
  if (!latRaw || !lngRaw) {
    return { row, reason: 'missing lat/lng (OSGB conversion not enabled for this source)' };
  }

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { row, reason: `unparseable coordinates "${latRaw},${lngRaw}"` };
  }
  if (!inBounds(lat, lng, mapping)) {
    return { row, reason: `coordinates outside the source's bounds (${lat},${lng})` };
  }

  const description = col(row, mapping.columns.description) || undefined;
  const sourceUrl = col(row, mapping.columns.sourceUrl) || undefined;
  const county = col(row, mapping.columns.county) || undefined;
  const access = col(row, mapping.columns.access) || undefined;
  const walkTime = col(row, mapping.columns.walkTime) || undefined;
  const category = mapping.fixedCategory ?? normalizeCategory(col(row, mapping.columns.category));
  const tags = parseTags(col(row, mapping.columns.tags));

  // Listing grouping (derived). `listingId` keys every collectible point in the
  // listing; built from region + listing number so it's stable across re-imports.
  // `parentId` is resolved in a second pass in ingest(), once the main point's id
  // for each listing is known.
  const listingNo = col(row, mapping.columns.listingNo);
  const listingId = listingNo ? `${slug(county ?? '')}__l${listingNo}` : undefined;
  const listingTitle = listingId ? col(row, mapping.columns.listingTitle) || undefined : undefined;

  return {
    id: makeId(name, lat, lng),
    name,
    lat,
    lng,
    description,
    county,
    source: mapping.source,
    access,
    category,
    ...(walkTime ? { walkTime } : {}),
    ...(tags.length ? { tags } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(listingId ? { listingId, listingTitle } : {}),
  };
}

// --- Companion pictures CSV ----------------------------------------------
// A source can ship a sidecar `*-images.csv` listing its guidebook pictures.
// Its schema is fixed (we author it, unlike the guidebook CSVs), so it needs no
// per-source column mapping — only the file path and the folder the pictures are
// served from, declared in `mapping.images`.
//
// The join key is the same `region + listing_no` pair that builds `listingId` in
// mapRow, so a picture row lands on the listing whatever the point is called.
// Pictures are ordered by `image_no`, and rows with no `image_file` are ignored.
const IMAGE_COLUMNS = {
  region: 'region',
  listingNo: 'listing_no',
  file: 'image_file',
  imageNo: 'image_no',
  width: 'width',
  height: 'height',
  caption: 'caption',
} as const;

/** Build `listingId → pictures` from a source's companion images CSV. Returns an
 *  empty map when the mapping declares no pictures. */
export function parseImages(rows: RawRow[], mapping: SourceMapping): Map<string, SiteImage[]> {
  const byListing = new Map<string, SiteImage[]>();
  if (!mapping.images) return byListing;

  const base = mapping.images.baseUrl.replace(/^\/+|\/+$/g, '');
  const ordered: { listingId: string; order: number; image: SiteImage }[] = [];

  for (const row of rows) {
    const file = col(row, IMAGE_COLUMNS.file);
    const listingNo = col(row, IMAGE_COLUMNS.listingNo);
    if (!file || !listingNo) continue;

    const listingId = `${slug(col(row, IMAGE_COLUMNS.region))}__l${listingNo}`;
    const width = Number(col(row, IMAGE_COLUMNS.width));
    const height = Number(col(row, IMAGE_COLUMNS.height));
    const caption = col(row, IMAGE_COLUMNS.caption) || undefined;
    const order = Number(col(row, IMAGE_COLUMNS.imageNo));

    ordered.push({
      listingId,
      order: Number.isFinite(order) ? order : 0,
      image: {
        url: `${base}/${file}`,
        ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { height } : {}),
        ...(caption ? { caption } : {}),
      },
    });
  }

  ordered.sort((a, b) => a.order - b.order);
  for (const { listingId, image } of ordered) {
    const list = byListing.get(listingId);
    if (list) list.push(image);
    else byListing.set(listingId, [image]);
  }
  return byListing;
}

export function ingest(
  rows: RawRow[],
  mapping: SourceMapping,
  imagesByListing: ReadonlyMap<string, SiteImage[]> = new Map(),
): IngestResult {
  const rejected: RejectedRow[] = [];
  let skippedNonCollectible = 0;

  // Pass 1: map every collectible row, remembering its structural role so the
  // listing's `main` point can be identified afterwards.
  const entries: { site: Site; role: string }[] = [];
  for (const row of rows) {
    if (isExcluded(row, mapping)) {
      skippedNonCollectible++;
      continue;
    }

    const role = col(row, mapping.columns.role);
    if (role && !mapping.collectibleRoles.includes(role)) {
      skippedNonCollectible++;
      continue;
    }

    const mapped = mapRow(row, mapping);
    if ('reason' in mapped) {
      rejected.push(mapped);
      continue;
    }
    entries.push({ site: mapped, role });
  }

  // Resolve the `main` point's stable id for each listing, so sub-features can
  // link back to the full write-up (and a main can list its features). A source
  // with no structural role column (e.g. the swims CSV) has one point per
  // listing, so that point is the listing's main point.
  const flat = !mapping.columns.role;
  const mainIdByListing = new Map<string, string>();
  for (const { site, role } of entries) {
    if (!site.listingId || mainIdByListing.has(site.listingId)) continue;
    if (role === 'main' || flat) mainIdByListing.set(site.listingId, site.id);
  }

  // Pass 2: attach parentId (only to non-main points whose listing has a main)
  // and the listing's pictures (only to the main point, so a listing's pictures
  // are not repeated on each of its sub-features), then dedupe by stable id.
  const sites: Site[] = [];
  const seen = new Set<string>();
  for (const { site } of entries) {
    if (seen.has(site.id)) {
      continue; // dedupe by stable id
    }
    seen.add(site.id);
    const mainId = site.listingId ? mainIdByListing.get(site.listingId) : undefined;
    const isMain = !!site.listingId && mainId === site.id;
    const images = isMain ? imagesByListing.get(site.listingId!) : undefined;
    sites.push({
      ...site,
      ...(mainId && mainId !== site.id ? { parentId: mainId } : {}),
      ...(images?.length ? { images } : {}),
    });
  }

  return { sites, rejected, skippedNonCollectible };
}

// --- Postcode-keyed sources (pubs) ---------------------------------------

export interface Coords {
  lat: number;
  lng: number;
}

/** Resolves a postcode to coordinates, or null if it can't be geocoded. */
export type Geocoder = (postcode: string) => Coords | null;

/** Build-time enrichment for a pub (scraped once, cached, baked into JSON).
 *  Keyed by the stable pub id so it survives re-geocoding. See scripts/scrape-camra.ts. */
export interface PubEnrichment {
  description?: string;
  sourceUrl?: string;
}

export function mapPubRow(
  row: RawRow,
  mapping: SourceMapping,
  geocode: Geocoder,
  enrich?: Record<string, PubEnrichment>,
): Site | RejectedRow {
  const name = col(row, mapping.columns.name);
  if (!name) {
    return { row, reason: 'missing name' };
  }

  const postcode = col(row, mapping.columns.postcode);
  if (!postcode) {
    return { row, reason: 'missing postcode' };
  }

  // Coordinates come from build-time geocoding, not the CSV. A null result
  // (terminated or mistyped postcode) is a rejection, never a silent drop —
  // these surface in the ingest log so the postcode can be fixed and re-run.
  const coords = geocode(postcode);
  if (!coords) {
    return { row, reason: `postcode "${postcode}" did not geocode` };
  }
  if (!inBounds(coords.lat, coords.lng, mapping)) {
    return { row, reason: `geocoded coords outside the source's bounds (${coords.lat},${coords.lng}) for "${postcode}"` };
  }

  const id = makePubId(name, postcode);
  const extra = enrich?.[id];
  return {
    id,
    name,
    lat: coords.lat,
    lng: coords.lng,
    postcode,
    source: mapping.source,
    category: 'historic_pubs',
    ...(extra?.description ? { description: extra.description } : {}),
    ...(extra?.sourceUrl ? { sourceUrl: extra.sourceUrl } : {}),
  };
}

export function ingestPubs(
  rows: RawRow[],
  mapping: SourceMapping,
  geocode: Geocoder,
  enrich?: Record<string, PubEnrichment>,
): IngestResult {
  const sites: Site[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let skippedNonCollectible = 0;

  for (const row of rows) {
    if (isExcluded(row, mapping)) {
      skippedNonCollectible++;
      continue;
    }

    const mapped = mapPubRow(row, mapping, geocode, enrich);
    if ('reason' in mapped) {
      rejected.push(mapped);
      continue;
    }
    if (seen.has(mapped.id)) {
      continue; // dedupe by stable id
    }
    seen.add(mapped.id);
    sites.push(mapped);
  }

  return { sites, rejected, skippedNonCollectible };
}
