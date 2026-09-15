// What a search can return (issue #28). Four kinds, from four sources, ranked
// into one list — but each stays identifiable so the UI can group and label
// them, and so the store knows whether picking one should also open a site card.
//
// Every result resolves to a point and a label, because that is all the journey
// ends need. `id` is for React keys and de-duplication only: it is NEVER
// persisted and never keyed against user state (CLAUDE.md — user state is keyed
// on stable site ids, and a place has no such thing).

export type ResultKind = 'site' | 'place' | 'postcode' | 'coords';

/** Where a place result came from — drives the "saved offline" marker. */
export type ResultSource = 'offline' | 'online' | 'cached' | 'local';

export interface SearchResult {
  id: string;
  kind: ResultKind;
  /** Primary line: the name you typed towards. */
  label: string;
  /** Secondary line: county, region, category — whatever disambiguates. */
  detail?: string;
  lat: number;
  lng: number;
  source: ResultSource;
  /** Set only on `kind: 'site'` — lets picking a site also open its card. */
  siteId?: string;
  /** Metres from the search anchor, filled in by the ranker when it has one. */
  distance?: number;
  /** Ranking score; higher is better. Internal to the ranker. */
  score: number;
}

/** Which end of the journey a search is filling. */
export type SearchTarget = 'origin' | 'destination';
