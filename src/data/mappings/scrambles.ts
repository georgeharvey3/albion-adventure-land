// Per-source mapping for scrambles.csv — the UKC "British 3 Star Scrambles"
// ticklist (https://www.ukclimbing.com/logbook/ticklists/british_3_star_scrambles-5550),
// scraped by scripts/scrape-scrambles.py into a normal CSV. Coordinates are the
// UKC crag location (WGS84), nudged apart at scrape time where several routes
// share one crag so pins never stack exactly. The description column is
// composed at scrape time (grade/length/crag context line + the UKC route
// write-up); `url` links back to the route's UKC page for the full logbook.
// Every row is fixed to the `scrambles` leaf, its own top-level parent.

import { type SourceMapping } from './magical_britain';

export const scramblesMapping: SourceMapping = {
  source: 'scrambles_ukc',
  coords: 'in_row',
  columns: {
    name: 'name',
    lat: 'lat',
    lng: 'lng',
    description: 'description',
    county: 'region',
    sourceUrl: 'url',
  },
  collectibleRoles: [],
  fixedCategory: 'scrambles',
};
