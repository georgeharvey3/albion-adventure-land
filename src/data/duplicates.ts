import { haversine } from '../geo/haversine';
import { type Site, type SiteEntry, type SiteImage } from './types';

// Cross-source duplicates (issue #37).
//
// The same physical place appears in more than one guidebook: Tintern Abbey is
// a `ruins` row and a `sacred_buildings` row, Carn Euny is `earthworks` and
// `ruins`, St Dyfnog's Well is a `wells` row and a `wild_swims` row. Their
// names and coordinates differ by a word and a few metres, so the stable id
// differs too and ingest's per-source dedupe never sees them. Two pins land on
// one spot, and which icon covers the other is decided by the order of SOURCES
// in scripts/ingest.ts — arbitrary, and it flips when a source is added.
//
// TWO RULES SHAPE WHAT FOLLOWS.
//
// 1. A merge is CURATED, never inferred. No distance-and-name rule separates
//    "Tintern Abbey / Tintern Abbey And St Mary's" (one place) from "Roman
//    Baths / Ale House" (a pub 91 m from a Roman bath) or "Mount Snowdon
//    (summit) / Y Gribin" (a summit and the scramble that reaches it). So
//    `findCandidates` only PROPOSES pairs for `npm run dupes`, and only the
//    groups written into data/duplicates.json take effect.
// 2. No id changes and nothing leaves the data. The merged-away site keeps its
//    row and its stable id, and gains a derived `duplicateOf` — the same shape
//    as `parentId`, and the same seam as `closure`: one filter in
//    src/state/store.ts drops it from the map, the near-me list, search, the
//    outing pool, the rarity index and the stats. So user state keyed on the
//    old id is never orphaned, and widening or undoing a merge later costs one
//    line in a JSON file.

/** One curated group. `ids` is `[representative, ...merged]` — the FIRST id is
 *  the site that keeps the pin, so its category decides the icon, the colour,
 *  the name on the card and the filter layer the merged place shows up under.
 *  Reordering the ids is how you change that choice. `note` is for the human
 *  reading the file (JSON has no comments) and is never used by the code. */
export interface DuplicateGroup {
  ids: string[];
  note?: string;
}

/** data/duplicates.json. */
export interface DuplicateFile {
  groups: DuplicateGroup[];
}

export interface MergeResult {
  sites: Site[];
  /** How many sites were folded into a representative. */
  merged: number;
  /** Ids the file names that no site carries — data drift (a source renamed or
   *  moved the row, so its derived id changed). Reported, never ignored: a
   *  stale group silently stops merging, and the duplicate pin comes back. */
  unknownIds: string[];
  /** Groups with fewer than two live ids, so nothing merged. */
  deadGroups: number;
}

function entryOf(site: Site): SiteEntry | null {
  if (!site.description && !site.sourceUrl) return null;
  return {
    source: site.source,
    category: site.category,
    ...(site.description ? { description: site.description } : {}),
    ...(site.sourceUrl ? { sourceUrl: site.sourceUrl } : {}),
  };
}

function mergeImages(sites: readonly Site[]): SiteImage[] {
  const out: SiteImage[] = [];
  const seen = new Set<string>();
  for (const site of sites) {
    for (const image of site.images ?? []) {
      if (seen.has(image.url)) continue;
      seen.add(image.url);
      out.push(image);
    }
  }
  return out;
}

/**
 * Fold the curated groups into the site list.
 *
 * The representative gains the other members' write-ups (`entries`, one per
 * source, its own first), their pictures, and any sparse field it lacks itself.
 * Every other member gains `duplicateOf` and nothing else.
 *
 * `tags` are deliberately NOT merged. A tag selection is scoped to the parent
 * category it was picked under (`tagKey` in ./types), so moving a ruins tag
 * onto a folklore representative would invent a folklore filter chip that no
 * folklore site carries. Each site keeps the vocabulary of its own source.
 */
export function applyDuplicates(
  sites: readonly Site[],
  groups: readonly DuplicateGroup[],
): MergeResult {
  const byId = new Map(sites.map((s) => [s.id, s]));
  /** merged-away id → representative id */
  const repOf = new Map<string, string>();
  /** representative id → the members folded into it, in file order */
  const membersOf = new Map<string, Site[]>();
  const unknownIds: string[] = [];
  let deadGroups = 0;

  for (const group of groups) {
    const live: Site[] = [];
    for (const id of group.ids) {
      const site = byId.get(id);
      if (site) live.push(site);
      else unknownIds.push(id);
    }
    if (live.length < 2) {
      deadGroups++;
      continue;
    }
    const [rep, ...members] = live;
    const kept = membersOf.get(rep.id) ?? [];
    for (const m of members) {
      // A site can only be merged once. A second group naming it is a curation
      // mistake — keep the first and leave the site alone rather than build a
      // chain of representatives.
      if (repOf.has(m.id) || membersOf.has(m.id) || m.id === rep.id) continue;
      repOf.set(m.id, rep.id);
      kept.push(m);
    }
    if (kept.length) membersOf.set(rep.id, kept);
  }

  // A sub-feature whose listing's main point was merged away would link to a
  // site the app no longer shows. Point it at the representative instead.
  const reparent = (site: Site): Site => {
    const repId = site.parentId ? repOf.get(site.parentId) : undefined;
    return repId && repId !== site.id ? { ...site, parentId: repId } : site;
  };

  const out = sites.map((raw) => {
    const site = reparent(raw);
    const repId = repOf.get(site.id);
    if (repId) return { ...site, duplicateOf: repId };

    const members = membersOf.get(site.id);
    if (!members) return site;

    const group = [site, ...members];
    const entries = group.map(entryOf).filter((e): e is SiteEntry => e !== null);
    const images = mergeImages(group);
    const withField = <K extends keyof Site>(key: K): Site[K] | undefined =>
      site[key] ?? group.find((s) => s[key] !== undefined)?.[key];

    return {
      ...site,
      duplicateIds: members.map((m) => m.id),
      // One write-up needs no heading, so the card keeps its single-description
      // rendering; two or more become labelled blocks.
      ...(entries.length > 1 ? { entries } : {}),
      // Fill only what this site does not say for itself.
      description: withField('description'),
      sourceUrl: withField('sourceUrl'),
      county: withField('county'),
      postcode: withField('postcode'),
      access: withField('access'),
      walkTime: withField('walkTime'),
      ...(images.length ? { images } : {}),
    } satisfies Site;
  });

  return { sites: out, merged: repOf.size, unknownIds, deadGroups };
}

// --- Candidate report (npm run dupes) ------------------------------------

export interface Candidate {
  a: Site;
  b: Site;
  distanceM: number;
  /** Words of four or more letters the two names share. A strong hint, never a
   *  decision: "Rocky Valley" and "Rocky Valley, Tintagel" share one, and so do
   *  "Llyn Idwal" and "Llyn Idwal (East Wall)". */
  sharedWords: string[];
}

const STOP_WORDS = new Set(['the', 'and', 'of', 'a', 'an', 'at', 'near', 'upon']);

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

/**
 * Propose duplicate pairs: two sites from DIFFERENT sources within `radiusM`.
 *
 * Same-source pairs are excluded on purpose. They are dense — 162 scramble
 * routes on shared crags, 47 listing siblings like "Tintagel Castle" and
 * "Merlin's Cave" — and they are not duplicates: `listingId`/`parentId`
 * already group them, and each is a separate thing to visit.
 */
export function findCandidates(sites: readonly Site[], radiusM = 200): Candidate[] {
  // Grid index at roughly the search radius, so each site is compared only with
  // its own cell and the eight around it.
  const cellDeg = Math.max(radiusM, 100) / 111_000;
  const cells = new Map<string, number[]>();
  const key = (lat: number, lng: number) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor(lng / cellDeg)}`;

  sites.forEach((s, i) => {
    const k = key(s.lat, s.lng);
    const bucket = cells.get(k);
    if (bucket) bucket.push(i);
    else cells.set(k, [i]);
  });

  const out: Candidate[] = [];
  sites.forEach((a, i) => {
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const bucket = cells.get(key(a.lat + dLat * cellDeg, a.lng + dLng * cellDeg));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue; // each pair once
          const b = sites[j];
          if (a.source === b.source) continue;
          const distanceM = haversine(a, b);
          if (distanceM > radiusM) continue;
          const wordsOfA = new Set(words(a.name));
          out.push({
            a,
            b,
            distanceM,
            sharedWords: words(b.name).filter((w) => wordsOfA.has(w)),
          });
        }
      }
    }
  });

  return out.sort((x, y) => x.distanceM - y.distanceM);
}
