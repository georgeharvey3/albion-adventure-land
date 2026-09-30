import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { layerState, siteLayers } from '../state/layers';
import {
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  PARENT_CATEGORY_LABELS,
  categoriesOf,
  parentOf,
  tagKey,
  TAG_ORDER,
  type ParentCategory,
  type SiteCategory,
} from '../data/types';
import { copy } from '../copy';

// Type filter (spec F3): toggle site types on/off; affects both map and list.
// Two-level taxonomy. Each top-level layer (Folklore, Historic pubs) leads with a
// prominent switch that turns the whole layer on/off — that's the primary control.
// The header is a fixed height for every layer, so the list reads as equal-weight
// rows; the finer controls (subcategory chips, tag chips) live in a collapsible
// body that starts closed. A layer with no subcategories and no tags (a single
// leaf such as Historic pubs) has no body and so no expander.
// Only types present in the loaded dataset are shown.
//
// A layer whose sites carry source tags (wild swims, ruins) also gets a tag
// refinement row. Tags start unselected, which means "no narrowing" — picking
// one keeps only the sites carrying it. The tag vocabulary is DERIVED from the
// loaded sites, never hard-coded, so a re-import changes the chips on its own.

const TAGS_COLLAPSED = 10; // chips shown before "Show all"

export function Filters() {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const toggleType = useStore((s) => s.toggleType);
  const setTypesActive = useStore((s) => s.setTypesActive);
  const [open, setOpen] = useState<ReadonlySet<ParentCategory>>(new Set());

  const toggleOpen = (parent: ParentCategory) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(parent)) next.add(parent);
      return next;
    });

  // A chip's count is what turning that chip on shows, so a cross-source
  // duplicate is counted under every category it is findable as (`categoriesOf`
  // — Old Sarum under Ruins and under Hillforts). The chips therefore sum to
  // more than the number of pins, by the number of merged places. A layer's
  // count is sites, not the sum of its chips (`siteLayers`).
  const counts = new Map<SiteCategory, number>();
  const tagCounts = new Map<ParentCategory, Map<string, number>>();
  for (const s of sites) {
    for (const category of categoriesOf(s)) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    if (!s.tags?.length) continue;
    const parent = parentOf(s.category);
    let forParent = tagCounts.get(parent);
    if (!forParent) tagCounts.set(parent, (forParent = new Map()));
    for (const tag of s.tags) forParent.set(tag, (forParent.get(tag) ?? 0) + 1);
  }

  // Leaves present in the dataset, grouped by parent (dataset order via SITE_TYPES).
  const layers = useMemo(() => siteLayers(sites), [sites]);

  // Every leaf in the dataset — the target of the all-layer controls.
  const allLeaves = layers.flatMap((g) => g.leaves);
  const allTypesOn = allLeaves.every((t) => activeTypes.has(t));
  const noTypesOn = allLeaves.every((t) => !activeTypes.has(t));

  return (
    <div className="filters">
      <div className="filters-controls">
        <button
          className="link-btn"
          onClick={() => setTypesActive(allLeaves, true)}
          disabled={allTypesOn}
        >
          {copy.filters.selectAll}
        </button>
        <button
          className="link-btn"
          onClick={() => setTypesActive(allLeaves, false)}
          disabled={noTypesOn}
        >
          {copy.filters.deselectAll}
        </button>
      </div>

      {layers.map(({ parent, leaves, count: groupCount }) => {
        const activeCount = leaves.filter((t) => activeTypes.has(t)).length;
        const state = layerState(leaves, activeTypes);
        const allOn = state === 'on';
        const noneOn = state === 'off';
        // A single-leaf parent (e.g. Historic pubs) has no finer subcategories.
        const hasSubs = !(leaves.length === 1 && (leaves[0] as string) === parent);
        // Commonest tags first — the long tail is behind "Show all". A layer
        // with a fixed order (the pub grades) uses that instead, for the tags
        // it names.
        const order = TAG_ORDER[parent];
        const rank = (tag: string) => {
          const i = order?.indexOf(tag) ?? -1;
          return i === -1 ? Infinity : i;
        };
        const tags = [...(tagCounts.get(parent) ?? new Map<string, number>())].sort(
          (a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        const hasBody = hasSubs || tags.length > 0;
        const isOpen = hasBody && open.has(parent);

        return (
          <section className="layer" key={parent}>
            <div className="layer-head">
              <button
                className={`layer-expand ${isOpen ? 'open' : ''}`}
                onClick={() => toggleOpen(parent)}
                aria-expanded={isOpen}
                disabled={!hasBody}
              >
                <span className="caret" aria-hidden="true">
                  {hasBody ? '▸' : ''}
                </span>
                <span className={`layer-name ${noneOn ? 'muted' : ''}`}>
                  {PARENT_CATEGORY_LABELS[parent]}
                </span>
                <span className="layer-count">
                  {allOn || !hasSubs ? groupCount : copy.filters.typesOn(activeCount, leaves.length)}
                </span>
              </button>
              <button
                className={`layer-switch ${allOn ? 'on' : noneOn ? 'off' : 'mixed'}`}
                onClick={() => setTypesActive(leaves, !allOn)}
                aria-pressed={allOn}
                aria-label={copy.filters.show(PARENT_CATEGORY_LABELS[parent])}
              >
                <span className="switch" aria-hidden="true" />
              </button>
            </div>

            {isOpen && hasSubs && (
              <div className="layer-subs">
                <div className="subs-controls">
                  <button
                    className="link-btn"
                    onClick={() => setTypesActive(leaves, true)}
                    disabled={allOn}
                  >
                    {copy.filters.selectAll}
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => setTypesActive(leaves, false)}
                    disabled={noneOn}
                  >
                    {copy.filters.deselectAll}
                  </button>
                </div>
                {leaves.map((type) => {
                  const on = activeTypes.has(type);
                  return (
                    <button
                      key={type}
                      className={`chip ${on ? 'on' : 'off'}`}
                      onClick={() => toggleType(type)}
                      aria-pressed={on}
                    >
                      <span className="dot" style={{ background: SITE_TYPE_COLORS[type] }} />
                      {SITE_TYPE_LABELS[type]}
                      <span className="chip-count">{counts.get(type)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {isOpen && tags.length > 0 && (
              <TagFilter parent={parent} tags={tags} leaves={leaves} layerOff={noneOn} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The tag refinement row for one layer. Its own component so the "Show all"
 *  state is per layer. */
function TagFilter({
  parent,
  tags,
  leaves,
  layerOff,
}: {
  parent: ParentCategory;
  tags: [string, number][];
  leaves: SiteCategory[];
  layerOff: boolean;
}) {
  const activeTags = useStore((s) => s.activeTags);
  const toggleTag = useStore((s) => s.toggleTag);
  const clearTags = useStore((s) => s.clearTags);
  const setTypesActive = useStore((s) => s.setTypesActive);
  const [expanded, setExpanded] = useState(false);

  const selected = tags.filter(([tag]) => activeTags.has(tagKey(parent, tag))).length;
  // Selected chips always stay visible, even when they sit in the hidden tail.
  const shown = expanded
    ? tags
    : tags.filter(([tag], i) => i < TAGS_COLLAPSED || activeTags.has(tagKey(parent, tag)));

  const pick = (tag: string) => {
    // Picking a tag on a switched-off layer is a request to see those sites, so
    // turn the layer back on rather than silently filtering nothing.
    if (layerOff) setTypesActive(leaves, true);
    toggleTag(parent, tag);
  };

  return (
    <div className="layer-tags">
      <div className="subs-controls">
        <span className="tags-title">
          {copy.filters.tags}
          {selected > 0 ? copy.filters.tagsSelected(selected) : ''}
        </span>
        <button className="link-btn" onClick={() => clearTags(parent)} disabled={selected === 0}>
          {copy.filters.clear}
        </button>
      </div>
      {shown.map(([tag, count]) => {
        const on = activeTags.has(tagKey(parent, tag));
        return (
          <button
            key={tag}
            className={`chip tag-chip ${on ? 'on' : ''}`}
            onClick={() => pick(tag)}
            aria-pressed={on}
          >
            {tag}
            <span className="chip-count">{count}</span>
          </button>
        );
      })}
      {tags.length > TAGS_COLLAPSED && (
        <button className="link-btn tags-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? copy.filters.fewerTags : copy.filters.allTags(tags.length)}
        </button>
      )}
    </div>
  );
}
