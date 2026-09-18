// Normalized, read-only site model (spec §5.1). Site data is replaceable;
// user state (in IndexedDB) is keyed on the stable `id` and must never be lost.

// `SiteCategory` is the *leaf* type — what drives pin colour and filter chips.
// Folklore leaves come from the source CSV's `category` column
// (slugified). `historic_pubs` and `wild_swims` are leaves that have no finer
// subdivision: for them the leaf and its parent are one and the same. Keep this
// union in sync with the categories the data carries.
export type SiteCategory =
  | 'historic_pubs'
  | 'wild_swims'
  | 'ruins'
  | 'scrambles'
  | 'wells'
  | 'natural_water_features'
  | 'wild_places'
  | 'hills'
  | 'hillforts'
  | 'earthworks'
  | 'burial_chambers'
  | 'standing_stones'
  | 'stone_circles'
  | 'natural_stones'
  | 'sacred_buildings'
  | 'caves'
  | 'other';

export const SITE_TYPES: SiteCategory[] = [
  'historic_pubs',
  'wild_swims',
  'ruins',
  'scrambles',
  'wells',
  'natural_water_features',
  'wild_places',
  'hills',
  'hillforts',
  'earthworks',
  'burial_chambers',
  'standing_stones',
  'stone_circles',
  'natural_stones',
  'sacred_buildings',
  'caves',
  'other'
];

// Top-level grouping over leaf categories (spec: two-level taxonomy). The filter
// UI groups leaves by parent — Folklore expands to its 13 subcategories; Historic
// pubs is a single leaf shown on its own. Parent is DERIVED from category, never
// stored on a Site, so user state can't depend on it.
export type ParentCategory = 'folklore' | 'historic_pubs' | 'wild_swims' | 'ruins' | 'scrambles';

export const PARENT_CATEGORIES: ParentCategory[] = ['historic_pubs', 'wild_swims', 'ruins', 'scrambles', 'folklore'];

export const PARENT_CATEGORY_LABELS: Record<ParentCategory, string> = {
  historic_pubs: 'Historic pubs',
  wild_swims: 'Wild swims',
  ruins: 'Ruins',
  scrambles: 'Scrambles',
  folklore: 'Folklore',
};

export const CATEGORY_PARENT: Record<SiteCategory, ParentCategory> = {
  wells: 'folklore',
  natural_water_features: 'folklore',
  wild_places: 'folklore',
  hills: 'folklore',
  hillforts: 'folklore',
  earthworks: 'folklore',
  burial_chambers: 'folklore',
  standing_stones: 'folklore',
  stone_circles: 'folklore',
  natural_stones: 'folklore',
  sacred_buildings: 'folklore',
  caves: 'folklore',
  other: 'folklore',
  historic_pubs: 'historic_pubs',
  wild_swims: 'wild_swims',
  ruins: 'ruins',
  scrambles: 'scrambles',
};

export function parentOf(category: SiteCategory): ParentCategory {
  return CATEGORY_PARENT[category];
}

/**
 * Every leaf category a site can be FOUND under: its own first, then the
 * category of each row merged into it as a cross-source duplicate (issue #37).
 *
 * Old Sarum is a ruins row and a hillforts row. One pin covers it, and the
 * representative's own `category` alone decides that pin's icon, its colour,
 * the type on its card and the outing slot it fills — a single place is a
 * single thing to visit. But it stays findable under both filter layers, which
 * is what this list is for. Every merged group in the data today spans two
 * categories, so nothing is gained by treating the second as an afterthought.
 *
 * Read-only and derived, like `parentOf`: the order is the source order, and
 * the first element is always the representative's own category.
 */
export function categoriesOf(site: Site): SiteCategory[] {
  return site.alsoCategories?.length
    ? [site.category, ...site.alsoCategories]
    : [site.category];
}

// --- Source tags ----------------------------------------------------------
// Some sources (wild swims, ruins) carry free-text descriptive labels in a
// `Tags` column ("Waterfall", "Dramatic"). The vocabulary is per-source and NOT
// controlled — unlike SiteCategory — so tags are stored verbatim on the Site
// and the filter's tag list is DERIVED from the loaded data.
//
// A tag filter selection is SCOPED to the parent category it was picked under:
// two sources can use the same word for different things ("Difficult path"
// appears in both swims and ruins), and a tag only ever narrows its own layer.
// `tagKey` is that scoping, an opaque key the filter state is keyed on.
export function tagKey(parent: ParentCategory, tag: string): string {
  return `${parent}::${tag}`;
}

// Tags a session starts with picked. Empty means "no narrowing" everywhere
// else, and that is still the rule for every other layer — this is the one
// layer where the whole set is not the right opening view. The CAMRA heritage
// grades run 3-star (exceptional interiors, a few hundred) down to 1-star
// (over seven hundred), and starting with all of them lit up buries the
// flagship pubs under the long tail in every town. So a session opens on the
// 3-star and 2-star pubs; the 1-star chip is one tap away in the pubs layer.
// Like every other filter, this is NOT persisted — each session opens here.
export const DEFAULT_ACTIVE_TAGS: readonly string[] = [
  tagKey('historic_pubs', '3-star'),
  tagKey('historic_pubs', '2-star'),
];

// Tag orders that are not "commonest first". A layer lists its tags by how many
// sites carry them, which is right for free-text guidebook labels but wrong for
// a graded vocabulary: the pub grades read 3, 2, 1, and 1-star is the commonest
// of them. A tag not named here keeps its place, by count, after the named ones.
export const TAG_ORDER: Partial<Record<ParentCategory, readonly string[]>> = {
  historic_pubs: ['3-star', '2-star', '1-star'],
};

export function parseTagKey(key: string): { parent: ParentCategory; tag: string } {
  const at = key.indexOf('::');
  return { parent: key.slice(0, at) as ParentCategory, tag: key.slice(at + 2) };
}

// --- Outing slots ---------------------------------------------------------
// The outing picker (spec §7.2) matches "one site per selected slot". A slot is
// one of three shapes:
//   • a leaf `SiteCategory` — one site of exactly that type ("one of each");
//   • a `ParentCategory` — one site of ANY of the parent's leaves (e.g. "any
//     folklore"). Only Folklore has more than one leaf today, so it is the only
//     parent slot that widens anything;
//   • a `UnionSlot` — one site of any of a CHOSEN subset of one parent's leaves
//     (e.g. "a holy well OR a standing stone, one stop"). Encoded as
//     `any:<sorted leaf slugs joined by +>` — an opaque string that can't
//     collide with a leaf or parent name, so the search treats it like any
//     other slot.
// Because none of the three encodings overlap, a single string type is safe.
export type UnionSlot = `any:${string}`;
export type OutingSlot = SiteCategory | ParentCategory | UnionSlot;

const PARENT_CATEGORY_SET: ReadonlySet<string> = new Set(PARENT_CATEGORIES);

/** Is this slot a whole-parent group standing in for several leaves? (Only
 *  Folklore today — the single-leaf parents are indistinguishable from their
 *  leaf.) A union slot is NOT a parent slot. */
export function isParentSlot(slot: OutingSlot): slot is ParentCategory {
  return PARENT_CATEGORY_SET.has(slot);
}

export function isUnionSlot(slot: OutingSlot): slot is UnionSlot {
  return slot.startsWith('any:');
}

/** Build the union slot for a subset of a parent's leaves. Sorted so the id is
 *  stable regardless of the order the user picked the chips. */
export function unionSlot(leaves: readonly SiteCategory[]): UnionSlot {
  return `any:${[...leaves].sort().join('+')}`;
}

/** The leaf categories a union slot covers. */
export function unionMembers(slot: UnionSlot): SiteCategory[] {
  return slot.slice('any:'.length).split('+') as SiteCategory[];
}

/**
 * Turn the picker's raw selection into the set of slots the search matches:
 * for each parent, either one union/whole-parent slot ("any of these") or one
 * slot per picked leaf ("one of each"). A parent in `anyParents` with no picked
 * leaves means "any of the whole category" (the whole-parent slot); with picked
 * leaves it means "any of just those" (a union slot).
 */
export function resolveOutingSlots(
  leaves: ReadonlySet<SiteCategory>,
  anyParents: ReadonlySet<ParentCategory>,
): Set<OutingSlot> {
  const slots = new Set<OutingSlot>();
  for (const parent of PARENT_CATEGORIES) {
    const picked = SITE_TYPES.filter((t) => parentOf(t) === parent && leaves.has(t));
    if (anyParents.has(parent)) {
      slots.add(picked.length ? unionSlot(picked) : parent);
    } else {
      for (const t of picked) slots.add(t);
    }
  }
  return slots;
}

/**
 * Given the resolved slot set, map a site's leaf category to the slot it fills
 * (or `undefined` when no selected slot covers it). Precomputes a lookup so the
 * search buckets sites in O(1) each.
 */
export function outingSlotResolver(
  slots: ReadonlySet<OutingSlot>,
): (category: SiteCategory) => OutingSlot | undefined {
  const byCategory = new Map<SiteCategory, OutingSlot>();
  for (const slot of slots) {
    if (isUnionSlot(slot)) {
      for (const m of unionMembers(slot)) byCategory.set(m, slot);
    } else if (isParentSlot(slot)) {
      for (const t of SITE_TYPES) if (parentOf(t) === slot) byCategory.set(t, slot);
    } else {
      byCategory.set(slot, slot);
    }
  }
  return (category) => byCategory.get(category);
}

export function outingSlotLabel(slot: OutingSlot): string {
  if (isUnionSlot(slot)) {
    const labels = unionMembers(slot).map((m) => SITE_TYPE_LABELS[m]);
    // "A or B" reads naturally for the small subsets this is used on; keep the
    // first two and summarise a longer tail so the failure line stays short.
    if (labels.length <= 2) return labels.join(' or ');
    return `${labels[0]}, ${labels[1]} or ${labels.length - 2} more`;
  }
  return isParentSlot(slot) ? PARENT_CATEGORY_LABELS[slot] : SITE_TYPE_LABELS[slot];
}

export function outingSlotColor(slot: OutingSlot): string {
  if (isUnionSlot(slot)) return PARENT_CATEGORY_COLORS[parentOf(unionMembers(slot)[0])];
  return isParentSlot(slot) ? PARENT_CATEGORY_COLORS[slot] : SITE_TYPE_COLORS[slot];
}

export const SITE_TYPE_LABELS: Record<SiteCategory, string> = {
  wells: 'Wells',
  natural_water_features: 'Natural water features',
  wild_places: 'Wild places',
  hills: 'Hills',
  hillforts: 'Hillforts',
  earthworks: 'Earthworks',
  burial_chambers: 'Burial chambers',
  standing_stones: 'Standing stones',
  stone_circles: 'Stone circles',
  natural_stones: 'Natural stones',
  sacred_buildings: 'Sacred buildings',
  caves: 'Caves',
  other: 'Other',
  historic_pubs: 'Historic pubs',
  wild_swims: 'Wild swims',
  ruins: 'Ruins',
  scrambles: 'Scrambles',
};

// Distinct, colour-blind-friendly-ish palette for map pins and list dots.
export const SITE_TYPE_COLORS: Record<SiteCategory, string> = {
  wells: '#2a9d8f',
  natural_water_features: '#0077b6',
  wild_places: '#43aa8b',
  hills: '#8a5a44',
  hillforts: '#bc6c25',
  earthworks: '#b08968',
  burial_chambers: '#577590',
  standing_stones: '#6a4c93',
  stone_circles: '#e76f51',
  natural_stones: '#9a8c98',
  sacred_buildings: '#c9184a',
  caves: '#3d405b',
  other: '#6c757d',
  historic_pubs: '#d4a017', // amber — distinct from every folklore hue
  wild_swims: '#00b4d8', // bright cyan — distinct from the navy natural_water_features blue
  ruins: '#6b705c', // muted stone/olive — distinct from the browns and greys above
  scrambles: '#d00000', // alpine red — the chevron pin makes it unmistakable next to sacred_buildings' crimson
};

// Colour for a whole-parent outing slot. The single-leaf parents reuse their
// leaf hue; Folklore (spanning many leaves) gets its own so the "Any folklore"
// chip and dot read as distinct from any single sub-type.
export const PARENT_CATEGORY_COLORS: Record<ParentCategory, string> = {
  historic_pubs: SITE_TYPE_COLORS.historic_pubs,
  wild_swims: SITE_TYPE_COLORS.wild_swims,
  ruins: SITE_TYPE_COLORS.ruins,
  scrambles: SITE_TYPE_COLORS.scrambles,
  folklore: '#7b4fb0',
};

const SITE_TYPE_SET: ReadonlySet<string> = new Set(SITE_TYPES);

// Normalize a raw CSV `category` value to a SiteType. The category vocabulary is
// authoritative now (no keyword guessing); anything blank or unrecognised falls
// back to 'other'.
export function normalizeCategory(raw: string | undefined): SiteCategory {
  const slug = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return SITE_TYPE_SET.has(slug) ? (slug as SiteCategory) : 'other';
}

// One picture from a source guidebook, joined to a listing at ingest by
// `listing_no` (see the companion `*-images.csv` next to each source CSV).
// `url` is relative to the app base (BASE_URL), never absolute, so it resolves
// under the GitHub Pages subpath as well as at the dev-server root. Intrinsic
// width/height come from the CSV so the card can reserve space and not reflow
// while the picture loads.
export interface SiteImage {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
}

// One source's write-up of a site that several sources describe (issue #37).
// Built at ingest by ./duplicates from the merged rows, so the card can show
// both guidebooks under their own headings instead of picking a winner. The
// heading itself is DERIVED in the UI from `category` (the parent category's
// label — "Folklore entry", "Ruins entry"), never stored.
export interface SiteEntry {
  source: string;
  category: SiteCategory;
  description?: string;
  sourceUrl?: string;
}

export interface Site {
  id: string; // stable, derived: slug(name)+rounded(lat,lng)
  name: string;
  lat: number; // WGS84
  lng: number; // WGS84
  description?: string;
  county?: string; // region/area from the source
  postcode?: string; // present for sources keyed on postcode (e.g. pubs); used for the Maps query and the stable id
  source: string; // which CSV / guidebook this came from
  sourceUrl?: string; // canonical page this site/description came from (e.g. CAMRA pub page); shown as attribution
  category: SiteCategory

  // Listing grouping (spec: a `listing` groups a `main` point with its
  // trailheads/nearby features). DERIVED from the source's listing columns at
  // ingest, like `parentOf` — never user state. `listingId` is shared by every
  // collectible point in the listing; `parentId` points a sub-feature back at the
  // listing's `main` point (undefined on the main point itself). Lets the detail
  // card link a sub-point to its full write-up and list a main point's features.
  listingId?: string;
  listingTitle?: string; // the curated listing label (CSV `listing_title`)
  parentId?: string; // stable id of the listing's `main` point

  // Cross-source duplicate merge (issue #37), DERIVED at ingest from the
  // curated data/duplicates.json — never user state, and no id ever changes.
  // The same shape as the listing pair above: `duplicateOf` names the
  // representative that keeps the pin (set on the merged-away site, which stays
  // in sites.json and is dropped by one filter in the store, exactly like a
  // closed pub), and `duplicateIds` lists the sites folded INTO a
  // representative, so user state saved against an old id still finds its way
  // home. `entries` carries the merged write-ups.
  duplicateOf?: string;
  duplicateIds?: string[];
  entries?: SiteEntry[];
  /** The merged rows' leaf categories, in file order and without the
   *  representative's own. Read through `categoriesOf`, never directly. It is
   *  what keeps a merged place in both filter layers; it changes no pin, no
   *  slot and no count. */
  alsoCategories?: SiteCategory[];

  // Guidebook pictures for this listing, in source order. DERIVED at ingest from
  // the source's companion images CSV and attached only to the listing's `main`
  // point, so a listing's pictures are not duplicated onto its sub-features.
  images?: SiteImage[];

  // Free-text labels from the source guidebook, verbatim and in source order
  // (see `tagKey`). Only the swims and ruins sources carry them today. Read-only
  // site data — the *selection* of tags is filter state, held in the store.
  tags?: string[];

  // Walk-in time from parking to the site, verbatim from the source guidebook
  // (e.g. "15 mins"). A fixed editorial figure — NOT travel time from the user's
  // live location. Currently only wild-swim sites carry it.
  walkTime?: string;

  // Condition / access metadata (optional, sparse in practice).
  access?: string;
  tideDependent?: boolean;
  seasonal?: boolean;
  needsWalk?: boolean;
  cost?: 'free' | 'paid';

  // --- Transient source facts (pubs only today) --------------------------
  // These four change under us between builds, unlike the rest of a Site, so
  // they are refreshed by their own script (`npm run refresh:camra`) and are
  // always shown together with the dates, never on their own: an opening time
  // with no survey date behind it is a claim the app cannot stand behind.
  // See scripts/refresh-camra-status.ts.
  hours?: OpeningHours[];
  /** Present only when the source says the site is shut. Its presence IS the
   *  closed flag — there is no separate boolean. A site carrying one is
   *  filtered out of the app when the data loads (see src/state/store.ts); it
   *  stays in sites.json so the next refresh can clear it and bring the site
   *  back. */
  closure?: Closure;
  lastSurveyed?: string; // ISO date the source last inspected the site
  lastUpdated?: string; // ISO date the source last edited the entry
  checkedAt?: string; // ISO date this app last read the source page
}

/** One opening period, verbatim from the source in 24-hour local time. A day
 *  the source gives no period for is shut that day; a day with two periods
 *  (afternoon break) simply appears twice, so no consumer has to model it. */
export interface OpeningHours {
  day: Weekday;
  opens: string; // "HH:MM"
  closes: string; // "HH:MM", and "24:00" for midnight
}

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/** Why a site is shut, as the source states it. `label` is the source's own
 *  short status ("Temporarily Closed"); `note` is the full sentence, which
 *  usually carries the closure date and any expected reopening. */
export interface Closure {
  label: string;
  note: string;
}
