// Per-source mapping for swims.csv (Wild Swimming Britain, 3rd ed.). Columns:
// Name, Description, Walk time, Location. Coordinates arrive as a single
// "lat, lng" string in `Location` (split at ingest), already WGS84 — no OSGB
// conversion or geocoding. The source has no category column, so every row is
// fixed to the `wild_swims` leaf, its own top-level parent in the taxonomy.
// The `Tags` column holds a JSON array of free-text labels ("Waterfall",
// "Walk in"); it is mapped and drives the tag filter chips under this layer.

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
  },
  collectibleRoles: [],
  fixedCategory: 'wild_swims',
  titleCaseName: true, // source names are ALL CAPS
};
