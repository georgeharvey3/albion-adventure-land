// The wire format of public/data/places.json — the ONE contract shared between
// the build script (scripts/build-gazetteer.ts) and the app (src/search/places.ts).
//
// It lives in its own file, with no runtime and no `import.meta`, because the
// build script compiles under tsconfig.node.json where Vite's client types
// don't exist. Same reason src/data/types.ts stays importable from ingest.
//
// TUPLES, NOT OBJECTS: ~4,300 settlements as {name, lat, lng, …} costs roughly
// three times the positional form, and this file is precached on every install.
// The keys are spent once here in a comment rather than 4,300 times on the wire.

export type PlaceRegion = 'ENG' | 'SCT' | 'WLS' | 'NIR';
export type PlaceKind = 'city' | 'town' | 'village' | 'landmark';

/** [name, lat, lng, population, region, kind, aliases?] */
export type PlaceTuple = [string, number, number, number, PlaceRegion, PlaceKind, string[]?];

/** [outward code, lat, lng] */
export type OutcodeTuple = [string, number, number];

export interface Gazetteer {
  version: number;
  generated: string;
  /** Licence line for the source data. Rendered in the app — don't drop it. */
  attribution: string;
  places: PlaceTuple[];
  outcodes: OutcodeTuple[];
}
