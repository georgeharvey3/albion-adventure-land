import { useState } from 'react';
import { useStore } from '../state/store';
import {
  SITE_TYPES,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  PARENT_CATEGORIES,
  PARENT_CATEGORY_LABELS,
  parentOf,
  tagKey,
  type ParentCategory,
  type SiteCategory,
} from '../data/types';

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
  const activeTagSet = useStore((s) => s.activeTags);
  const [open, setOpen] = useState<ReadonlySet<ParentCategory>>(new Set());

  const toggleOpen = (parent: ParentCategory) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(parent)) next.add(parent);
      return next;
    });

  const counts = new Map<SiteCategory, number>();
  const tagCounts = new Map<ParentCategory, Map<string, number>>();
  for (const s of sites) {
    counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    if (!s.tags?.length) continue;
    const parent = parentOf(s.category);
    let forParent = tagCounts.get(parent);
    if (!forParent) tagCounts.set(parent, (forParent = new Map()));
    for (const tag of s.tags) forParent.set(tag, (forParent.get(tag) ?? 0) + 1);
  }

  // Leaves present in the dataset, grouped by parent (dataset order via SITE_TYPES).
  const layers = PARENT_CATEGORIES.map((parent) => ({
    parent,
    leaves: SITE_TYPES.filter((t) => counts.has(t) && parentOf(t) === parent),
  })).filter((g) => g.leaves.length > 0);

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
          Select all
        </button>
        <button
          className="link-btn"
          onClick={() => setTypesActive(allLeaves, false)}
          disabled={noTypesOn}
        >
          Deselect all
        </button>
      </div>

      {layers.map(({ parent, leaves }) => {
        const groupCount = leaves.reduce((n, t) => n + (counts.get(t) ?? 0), 0);
        const activeCount = leaves.filter((t) => activeTypes.has(t)).length;
        const allOn = activeCount === leaves.length;
        const noneOn = activeCount === 0;
        // A single-leaf parent (e.g. Historic pubs) has no finer subcategories.
        const hasSubs = !(leaves.length === 1 && (leaves[0] as string) === parent);
        // Commonest tags first — the long tail is behind "Show all".
        const tags = [...(tagCounts.get(parent) ?? new Map<string, number>())].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        const hasBody = hasSubs || tags.length > 0;
        const isOpen = hasBody && open.has(parent);
        const selectedTags = tags.filter(([tag]) => activeTagSet.has(tagKey(parent, tag))).length;

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
                  {allOn || !hasSubs ? groupCount : `${activeCount}/${leaves.length} types`}
                  {selectedTags > 0 ? ` · ${selectedTags} tags` : ''}
                </span>
              </button>
              <button
                className={`layer-switch ${allOn ? 'on' : noneOn ? 'off' : 'mixed'}`}
                onClick={() => setTypesActive(leaves, !allOn)}
                aria-pressed={allOn}
                aria-label={`Show ${PARENT_CATEGORY_LABELS[parent]}`}
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
                    Select all
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => setTypesActive(leaves, false)}
                    disabled={noneOn}
                  >
                    Deselect all
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
          Tags{selected > 0 ? ` · ${selected} selected` : ''}
        </span>
        <button className="link-btn" onClick={() => clearTags(parent)} disabled={selected === 0}>
          Clear
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
          {expanded ? 'Show fewer tags' : `Show all ${tags.length} tags`}
        </button>
      )}
    </div>
  );
}
