import {
  categoriesOf,
  parentOf,
  PARENT_CATEGORIES,
  SITE_TYPES,
  type ParentCategory,
  type Site,
  type SiteCategory,
} from '../data/types';

// The layers of the filter: one per parent category that the loaded data has,
// with the leaves the data has under it. Derived from the sites on every load,
// so a re-import changes the layers on its own. The layer chips (both shells)
// and the Filters tab read this one list.

export interface SiteLayer {
  parent: ParentCategory;
  /** The leaves the data has under this layer, in the order of SITE_TYPES. */
  leaves: SiteCategory[];
  /** The sites the layer shows when it is on. A merged place counts once in
   *  each layer it is findable under (`categoriesOf`), so the layers sum to
   *  more than the pins. */
  count: number;
}

export function siteLayers(sites: readonly Site[]): SiteLayer[] {
  const leaves = new Map<ParentCategory, Set<SiteCategory>>();
  const counts = new Map<ParentCategory, number>();
  for (const site of sites) {
    const parents = new Set<ParentCategory>();
    for (const category of categoriesOf(site)) {
      const parent = parentOf(category);
      parents.add(parent);
      let set = leaves.get(parent);
      if (!set) leaves.set(parent, (set = new Set()));
      set.add(category);
    }
    for (const parent of parents) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return PARENT_CATEGORIES.filter((p) => leaves.has(p)).map((parent) => ({
    parent,
    leaves: SITE_TYPES.filter((t) => leaves.get(parent)!.has(t)),
    count: counts.get(parent)!,
  }));
}

export type LayerState = 'on' | 'mixed' | 'off';

/** On when every leaf is on, off when none is. */
export function layerState(leaves: readonly SiteCategory[], active: ReadonlySet<SiteCategory>): LayerState {
  const on = leaves.filter((t) => active.has(t)).length;
  return on === leaves.length ? 'on' : on ? 'mixed' : 'off';
}
