// Per-source mapping for ruins.csv (Wild Ruins). Columns: Name, Description,
// Lat/Lng, Tags, Region, Listing no. Coordinates arrive as a single "lat, lng"
// string in `Lat/Lng` (split at ingest), already WGS84 — no OSGB conversion or
// geocoding. The source has no category column, so every row is fixed to the
// `ruins` leaf, its own top-level parent in the taxonomy. The `Tags` column
// holds a JSON array of free-text labels ("Dramatic", "Lovely walk"); it is
// mapped and drives the tag filter chips under this layer.
//
// `Region` is the book's chapter and `Listing no` the number the book prints
// beside the entry, which restarts at 1 in each chapter. The two together are
// the listing key the guidebook photos join on. extract_ruin_images.py writes
// both columns: the CSV holds one row per listing in book order, and the script
// reads the printed headings to give each row its chapter and number. The book
// has one point per listing (no trailheads or nearby features), so there is no
// role column.

import { type SourceMapping } from './magical_britain';

export const ruinsMapping: SourceMapping = {
  source: 'ruins',
  coords: 'in_row',
  columns: {
    name: 'Name',
    location: 'Lat/Lng',
    description: 'Description',
    tags: 'Tags',
    county: 'Region',
    listingNo: 'Listing no',
  },
  collectibleRoles: [],
  fixedCategory: 'ruins',
  // Guidebook photos pulled out of the book PDF by extract_ruin_images.py,
  // joined by Region + Listing no. The manifest is the extractor's own index, so
  // a re-run refreshes it in place. The build copies the files from
  // data/ruin-images/ into public/images/ruins/.
  images: {
    csv: 'data/ruin-images/images_index.csv',
    dir: 'data/ruin-images',
    baseUrl: 'images/ruins',
  },
};
