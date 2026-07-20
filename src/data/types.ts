// Normalized, read-only site model (spec §5.1). Site data is replaceable;
// user state (in IndexedDB) is keyed on the stable `id` and must never be lost.

// `SiteCategory` is the *leaf* type — what drives pin colour, filter chips,
// rarity and stats. Folklore leaves come from the source CSV's `category` column
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
// pubs is a single leaf shown on its own. Parent is DERIVED from category (like
// rarity), never stored on a Site, so user state can't depend on it.
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
  // ingest, like rarity/parent — never user state. `listingId` is shared by every
  // collectible point in the listing; `parentId` points a sub-feature back at the
  // listing's `main` point (undefined on the main point itself). Lets the detail
  // card link a sub-point to its full write-up and list a main point's features.
  listingId?: string;
  listingTitle?: string; // the curated listing label (CSV `listing_title`)
  parentId?: string; // stable id of the listing's `main` point

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
  openingHours?: string;
}
