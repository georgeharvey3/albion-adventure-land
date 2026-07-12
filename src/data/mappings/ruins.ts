// Per-source mapping for ruins.csv. Columns: Name, Description, Lat/Lng, Tags.
// Coordinates arrive as a single "lat, lng" string in `Lat/Lng` (split at
// ingest), already WGS84 — no OSGB conversion or geocoding. The source has no
// category column, so every row is fixed to the `ruins` leaf, its own top-level
// parent in the taxonomy. The `Tags` column is deliberately NOT mapped — tags
// stay hidden for now (only Title, Description and Location are surfaced).

import { type SourceMapping } from './magical_britain';

export const ruinsMapping: SourceMapping = {
  source: 'ruins',
  coords: 'in_row',
  columns: {
    name: 'Name',
    location: 'Lat/Lng',
    description: 'Description',
  },
  collectibleRoles: [],
  fixedCategory: 'ruins',
};
