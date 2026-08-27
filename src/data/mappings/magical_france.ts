// Per-source mapping for MF-north.csv (magical France, northern regions). The
// source shares the schema of magical_britain_master.csv — same column names,
// same controlled `category` vocabulary, same structural `point_type` roles — so
// it reuses that mapping shape. Coordinates are already WGS84. It is kept as a
// separate source (not appended to the British CSV) because the two guidebooks
// are replaced independently, and `listing_no` restarts at 1 in each; the
// derived `listingId` includes the region, which never collides across the two.

import { type SourceMapping } from './magical_britain';

export const magicalFranceMapping: SourceMapping = {
  source: 'magical_france_north',
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
    category: 'category',
  },
  // Metropolitan France plus the border sites the guidebook includes (the Abbaye
  // d'Orval is in Belgium) and the Balearics (Sa Dragonera, the south end of the
  // Paris Meridian). Wide enough for the data, tight enough to still catch a
  // swapped lat/lng.
  bounds: { minLat: 39, maxLat: 52, minLng: -5, maxLng: 9 },
  collectibleRoles: ['main', 'nearby_feature'],
  // Guidebook pictures, joined by region + listing_no. The build copies them from
  // data/MF-north-images/ into public/images/mf-north/.
  images: {
    csv: 'data/MF-north-images.csv',
    dir: 'data/MF-north-images',
    baseUrl: 'images/mf-north',
  },
};
