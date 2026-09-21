import {
  categoriesOf,
  parentOf,
  parseTagKey,
  type ParentCategory,
  type Site,
  type SiteCategory,
} from '../data/types';

// The one definition of "is this site on the map right now". Two surfaces need
// it and they have to agree: the list the map and the near-me sheet render
// (src/state/selectors.ts), and `revealSite` in ./store, which opens the filter
// far enough to show a site the finder found. When they disagreed, the finder
// could open a site that stayed invisible.

/** Tag picks, grouped by the layer they were picked under. A layer absent from
 *  the map has no tag picked and is therefore unnarrowed. */
export function tagsByParent(
  activeTags: ReadonlySet<string>,
): Map<ParentCategory, Set<string>> {
  const out = new Map<ParentCategory, Set<string>>();
  for (const key of activeTags) {
    const { parent, tag } = parseTagKey(key);
    const set = out.get(parent);
    if (set) set.add(tag);
    else out.set(parent, new Set([tag]));
  }
  return out;
}

/**
 * Does this site survive the type and tag filter?
 *
 * A site is tested under EVERY category it is findable as (`categoriesOf`), so
 * a cross-source duplicate like Old Sarum — a ruins row with a hillforts row
 * merged into it — answers both layers. One active category is enough.
 *
 * Tags narrow the layer they were picked under, and they are matched against
 * the site's own tags only, because tags are not merged across sources (see
 * src/data/duplicates.ts). So a place matched through a merged-in category
 * drops out while that category's layer is narrowed by a tag: it carries none
 * of that source's vocabulary, and inventing one for it would be a guess.
 *
 * `hidden` is deliberately not considered here — hiding is a decision about one
 * site rather than about a type, and its callers treat it separately.
 */
export function matchesFilter(
  site: Site,
  activeTypes: ReadonlySet<SiteCategory>,
  tags: ReadonlyMap<ParentCategory, ReadonlySet<string>>,
): boolean {
  for (const category of categoriesOf(site)) {
    if (!activeTypes.has(category)) continue;
    const wanted = tags.get(parentOf(category));
    // Any one of the layer's picked tags is enough (OR). A site with no tags
    // cannot match, so it drops out while its layer is narrowed.
    if (!wanted || site.tags?.some((t) => wanted.has(t))) return true;
  }
  return false;
}
