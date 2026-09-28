import type { Site } from './types';

// Sources kept in sites.json but left out of the app for now. Filtered at the
// load seam (src/state/store.ts), like a closed pub, so no user state keyed on
// them is lost. Deleting a source here brings its rows back.
const HIDDEN_SOURCES = new Set(['magical_france_north']);

/**
 * Whether the app shows a site at all. The one rule for the store's load seam
 * and for `npm run plate`, which fits the painted map to the sites shown.
 *
 * A site the source says is shut is not a place you can visit. A site merged
 * into another (issue #37) is the same place under a second guidebook's name.
 * Both stay in sites.json, so a refresh or a change to the merge can bring
 * them back.
 */
export function isShown(site: Site): boolean {
  return !site.closure && !site.duplicateOf && !HIDDEN_SOURCES.has(site.source);
}
