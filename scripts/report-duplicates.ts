import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCandidates, type Candidate, type DuplicateFile } from '../src/data/duplicates.ts';
import { SITE_TYPE_LABELS, type Site } from '../src/data/types.ts';

// `npm run dupes` — the PROPOSING half of cross-source dedupe (issue #37).
//
// This script decides nothing and writes nothing. It reads the built
// public/data/sites.json, lists every pair of sites from different sources that
// sit within a few hundred metres of each other, and prints the ones
// data/duplicates.json does not already cover, with a paste-ready group for
// each. A pair only becomes a merge when a human puts it in that file: no
// distance rule tells "Tintern Abbey" and "Tintern Abbey And St Mary's" (one
// abbey) apart from "Roman Baths" and the "Ale House" pub 91 m away.
//
// Flags: --radius=<metres> (default 200), --all (also list pairs already
// merged), --json (print only the paste-ready groups).

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function flag(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const at = hit.indexOf('=');
  return at === -1 ? '' : hit.slice(at + 1);
}

const radiusM = Number(flag('radius') ?? '') || 200;
const showAll = flag('all') !== undefined;
const jsonOnly = flag('json') !== undefined;

const sitesFile = resolve(root, 'public/data/sites.json');
if (!existsSync(sitesFile)) {
  console.error('public/data/sites.json not found — run `npm run ingest` first.');
  process.exit(1);
}
const sites = JSON.parse(readFileSync(sitesFile, 'utf8')) as Site[];

const dupFile = resolve(root, 'data/duplicates.json');
const groups = existsSync(dupFile)
  ? (JSON.parse(readFileSync(dupFile, 'utf8')) as DuplicateFile).groups
  : [];

// Which group each curated id belongs to, so a candidate pair can be recognised
// as already merged (in either direction, and across a group of three).
const groupOf = new Map<string, number>();
groups.forEach((group, i) => {
  for (const id of group.ids) groupOf.set(id, i);
});

const byId = new Map(sites.map((s) => [s.id, s]));
const unknown = [...groupOf.keys()].filter((id) => !byId.has(id));

const label = (s: Site) => `${SITE_TYPE_LABELS[s.category]} · ${s.source}`;

const candidates = findCandidates(sites, radiusM);
const open = candidates.filter((c) => {
  const ga = groupOf.get(c.a.id);
  return ga === undefined || ga !== groupOf.get(c.b.id);
});

// A paste-ready group, `note` filled with both names so the file stays readable
// (see DuplicateGroup — JSON has no comments).
const asGroup = (c: Candidate) =>
  `    { "note": ${JSON.stringify(`${c.a.name} / ${c.b.name}`)}, ` +
  `"ids": [${JSON.stringify(c.a.id)}, ${JSON.stringify(c.b.id)}] },`;

if (jsonOnly) {
  for (const c of open) console.log(asGroup(c));
  process.exit(0);
}

console.log(`${sites.length} sites · ${candidates.length} cross-source pairs within ${radiusM} m`);
console.log(`${groups.length} curated group(s) in data/duplicates.json`);
if (unknown.length) {
  console.warn(
    `\n⚠ ${unknown.length} curated id(s) match no site — the source moved or renamed the row, ` +
      `so its derived id changed and the merge has silently stopped:`,
  );
  for (const id of unknown) console.warn(`    - ${id}`);
}

const listed = showAll ? candidates : open;
console.log(`\n${listed.length} pair(s) ${showAll ? 'found' : 'not yet curated'}:\n`);
for (const c of listed) {
  const merged = groupOf.get(c.a.id) !== undefined && groupOf.get(c.a.id) === groupOf.get(c.b.id);
  const shared = c.sharedWords.length ? `  shared: ${c.sharedWords.join(', ')}` : '';
  console.log(`${Math.round(c.distanceM).toString().padStart(4)} m${merged ? '  [merged]' : ''}${shared}`);
  console.log(`      ${c.a.name}  (${label(c.a)})`);
  console.log(`        ${c.a.id}`);
  console.log(`      ${c.b.name}  (${label(c.b)})`);
  console.log(`        ${c.b.id}`);
}

if (open.length) {
  console.log(
    '\nPaste the real duplicates into data/duplicates.json. The FIRST id keeps the pin,\n' +
      'so put the entry whose category you want on the map first:\n',
  );
  for (const c of open) console.log(asGroup(c));
}
