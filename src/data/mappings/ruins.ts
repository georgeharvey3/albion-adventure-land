// Per-source mapping for ruins.csv. Columns: Name, Description, Lat/Lng, Tags.
// Coordinates arrive as a single "lat, lng" string in `Lat/Lng` (split at
// ingest), already WGS84 — no OSGB conversion or geocoding. The source has no
// category column, so every row is fixed to the `ruins` leaf, its own top-level
// parent in the taxonomy. The `Tags` column holds a JSON array of free-text
// labels ("Dramatic", "Lovely walk"); it is mapped and drives the tag filter
// chips under this layer.

import { type SourceMapping } from './magical_britain';

export const ruinsMapping: SourceMapping = {
  source: 'ruins',
  coords: 'in_row',
  columns: {
    name: 'Name',
    location: 'Lat/Lng',
    description: 'Description',
    tags: 'Tags',
  },
  collectibleRoles: [],
  fixedCategory: 'ruins',
};
