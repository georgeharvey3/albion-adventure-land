// Per-source mapping config (spec §5.2). One file per CSV. This source
// (magical_britain_master.csv) carries the controlled vocabulary directly in its
// `category` column, so SiteType comes straight from that (slugified via
// normalizeCategory) — no name-keyword guessing. `point_type` is the structural
// role of a row (main / trailhead / nearby_feature); the human site name is in
// `point_name`. Coordinates are already WGS84, so no OSGB conversion is needed.

export interface SourceMapping {
  source: string;
  // How this source gets its coordinates. 'in_row' = lat/lng are columns in the
  // CSV (this source). 'geocode_postcode' = the CSV has only a postcode, so
  // coordinates are resolved at build time and baked in (see scripts/geocode.ts).
  coords: 'in_row' | 'geocode_postcode';
  columns: {
    name: string;
    lat?: string;
    lng?: string;
    location?: string; // single "lat, lng" column (split at ingest) — alternative to lat/lng
    gridRef?: string;
    postcode?: string; // for geocode_postcode sources
    category?: string; // controlled-vocabulary column → SiteType
    walkTime?: string; // editorial walk-in time (e.g. "15 mins"), stored verbatim
    description?: string;
    sourceUrl?: string; // canonical per-site page (attribution link in the detail card)
    county?: string;
    access?: string;
    role?: string; // structural point_type column
    listingNo?: string; // groups a main point with its sub-features
    listingTitle?: string; // curated label for the listing
    tags?: string; // free-text descriptive labels, JSON array in one cell
    [k: string]: string | undefined;
  };
  // When the source has no category column, every row takes this fixed leaf type
  // (e.g. wild_swims). Takes precedence over the `category` column.
  fixedCategory?: import('../types').SiteCategory;
  // Title-case the name at ingest (for ALL-CAPS source titles). Doesn't affect
  // the stable id, which is slugified.
  titleCaseName?: boolean;
  // Structural roles that represent a collectible destination. Other roles
  // (trailheads, parking) are navigation aids — logged and excluded from sites.
  collectibleRoles: string[];
  // Coordinate sanity box for this source. Omit for UK sources (the default).
  // Non-UK sources (e.g. magical France) must declare their own, or every row
  // is rejected as out of range. This is validation only — it catches swapped
  // lat/lng and bad grid conversions, it does not filter the product.
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  // Companion pictures for this source, joined to listings by `listing_no` (see
  // `parseImages` in ../ingest). `csv` is the manifest and `dir` the folder of
  // picture files, both relative to the repo root and both source data. The
  // build copies the referenced files into `public/<baseUrl>/`, which is what
  // the app serves; `baseUrl` is app-relative with no leading slash, so it
  // resolves under the GitHub Pages subpath too. Omit when the source has no
  // pictures.
  images?: { csv: string; dir: string; baseUrl: string };
  // Rows to drop entirely by product decision (not a data error): any row whose
  // `column` value is in `values` is skipped (counted, not rejected).
  exclude?: { column: string; values: string[] };
}

export const magicalBritainMapping: SourceMapping = {
  source: 'magical_britain_master',
  coords: 'in_row',
  columns: {
    name: 'point_name',
    lat: 'latitude',
    lng: 'longitude',
    gridRef: 'os_grid_ref',
    description: 'description',
    county: 'region',
    access: 'access_notes',
    role: 'point_type',
    listingNo: 'listing_no',
    listingTitle: 'listing_title',
    category: 'category'
  },
  collectibleRoles: ['main', 'nearby_feature'],
};
