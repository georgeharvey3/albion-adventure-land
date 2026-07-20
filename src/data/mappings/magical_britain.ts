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
