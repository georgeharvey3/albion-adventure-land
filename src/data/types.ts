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
export type ParentCategory = 'folklore' | 'historic_pubs' | 'wild_swims' | 'ruins';

export const PARENT_CATEGORIES: ParentCategory[] = ['historic_pubs', 'wild_swims', 'ruins', 'folklore'];

export const PARENT_CATEGORY_LABELS: Record<ParentCategory, string> = {
  historic_pubs: 'Historic pubs',
  wild_swims: 'Wild swims',
  ruins: 'Ruins',
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
};

export function parentOf(category: SiteCategory): ParentCategory {
  return CATEGORY_PARENT[category];
}

// --- Outing slots ---------------------------------------------------------
// The outing picker (spec §7.2) matches "one site per selected slot". A slot is
// usually a leaf `SiteCategory`, but a parent with more than one leaf can also
// be picked as a whole — then ANY of its leaves satisfies that one slot. In the
// current taxonomy Folklore is the only multi-leaf parent, so `'folklore'` is
// the only genuinely new slot value; the single-leaf parents (`historic_pubs`,
// `wild_swims`) are their own leaf and add nothing. Because `'folklore'` is not
// a `SiteCategory`, `SiteCategory | ParentCategory` has no real collision.
export type OutingSlot = SiteCategory | ParentCategory;

const SITE_CATEGORY_SET: ReadonlySet<string> = new Set(SITE_TYPES);

/** Is this slot a parent group standing in for several leaves? (Only Folklore
 *  today — the single-leaf parents are indistinguishable from their leaf.) */
export function isParentSlot(slot: OutingSlot): slot is ParentCategory {
  return !SITE_CATEGORY_SET.has(slot);
}

/** The slot a site fills, given the current selection: its parent when that
 *  parent is picked as a whole, otherwise its leaf category. */
export function outingSlotOf(category: SiteCategory, selection: ReadonlySet<OutingSlot>): OutingSlot {
  const parent = parentOf(category);
  return selection.has(parent) ? parent : category;
}

export function outingSlotLabel(slot: OutingSlot): string {
  return isParentSlot(slot) ? PARENT_CATEGORY_LABELS[slot] : SITE_TYPE_LABELS[slot];
}

export function outingSlotColor(slot: OutingSlot): string {
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
};

// Colour for a whole-parent outing slot. The single-leaf parents reuse their
// leaf hue; Folklore (spanning many leaves) gets its own so the "Any folklore"
// chip and dot read as distinct from any single sub-type.
export const PARENT_CATEGORY_COLORS: Record<ParentCategory, string> = {
  historic_pubs: SITE_TYPE_COLORS.historic_pubs,
  wild_swims: SITE_TYPE_COLORS.wild_swims,
  ruins: SITE_TYPE_COLORS.ruins,
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
