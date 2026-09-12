// Per-source mapping for swims.csv (Wild Swimming Britain, 3rd ed.). Columns:
// Name, Description, Walk time, Location, Tags, Region, Listing no. Coordinates
// arrive as a single "lat, lng" string in `Location` (split at ingest), already
// WGS84 — no OSGB conversion or geocoding. The source has no category column, so
// every row is fixed to the `wild_swims` leaf, its own top-level parent in the
// taxonomy. The `Tags` column holds a JSON array of free-text labels
// ("Waterfall", "Walk in"); it is mapped and drives the tag filter chips under
// this layer.
//
// `Region` is the book's chapter and `Listing no` the number the book prints
// beside the entry, which restarts at 1 in each chapter. The two together are
// the listing key the guidebook photos join on. The book has one point per
// listing (no trailheads or nearby features), so there is no role column.

import { type SourceMapping } from './magical_britain';

export const wildSwimsMapping: SourceMapping = {
  source: 'wild_swimming_britain',
  coords: 'in_row',
  columns: {
    name: 'Name',
    location: 'Location',
    description: 'Description',
    walkTime: 'Walk time',
    tags: 'Tags',
    county: 'Region',
    listingNo: 'Listing no',
  },
  collectibleRoles: [],
  fixedCategory: 'wild_swims',
  titleCaseName: true, // source names are ALL CAPS
  // Guidebook photos pulled out of the book PDF by extract_swim_images.py,
  // joined by Region + Listing no. The manifest is the extractor's own index, so
  // a re-run refreshes it in place. The build copies the files from
  // data/swim-images/ into public/images/swims/.
  images: {
    csv: 'data/swim-images/images_index.csv',
    dir: 'data/swim-images',
    baseUrl: 'images/swims',
  },
};
