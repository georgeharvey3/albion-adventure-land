// The semantic index (issue #62): one embedding for each site, and a
// brute-force cosine scan. About 3,800 sites at 384 dimensions is 1.5 M
// multiplications for a question, which is nothing next to one model turn, so
// no vector database is needed.
//
// The index ranks a shortlist; it never makes one. `find_sites` cuts the
// candidates by place, type, tag and user state first, and `meaning` only
// orders what survives. So a "deep water" question can never pull in a swim at
// the other end of the country.
//
// The same embedding model embeds the sites at build time and the question at
// ask time. The index file records the model and a hash of `sites.json`, and a
// file that does not match either is rebuilt, not trusted.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SITE_TYPE_LABELS, categoriesOf, type Site } from '../src/data/types';

/** Turns text into unit-length vectors. Documents and queries are separate
 *  because some models want a different prefix on each. */
export interface Embedder {
  model: string;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export interface SemanticIndex {
  /** Cosine similarity of `query` to each of `ids`. An id with no vector is
   *  missing from the result. */
  score(query: string, ids: readonly string[]): Promise<Map<string, number>>;
}

/** The text a site is embedded from: its name, the layers it is findable
 *  under, its tags and every write-up it carries. */
export function siteText(site: Site): string {
  const layers = categoriesOf(site).map((c) => SITE_TYPE_LABELS[c]).join(', ');
  const writeUps = site.entries?.length
    ? site.entries.map((e) => e.description ?? '').join(' ')
    : (site.description ?? '');
  return [
    site.name,
    layers,
    site.county ?? '',
    site.tags?.length ? `Tags: ${site.tags.join(', ')}` : '',
    writeUps,
  ]
    .filter(Boolean)
    .join('. ');
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** An index over in-memory vectors. The vectors must be unit length, so the
 *  dot product is the cosine. */
export function semanticIndex(embedder: Embedder, vectors: ReadonlyMap<string, Float32Array>): SemanticIndex {
  return {
    async score(query, ids) {
      const q = await embedder.embedQuery(query);
      const out = new Map<string, number>();
      for (const id of ids) {
        const v = vectors.get(id);
        if (v) out.set(id, dot(q, v));
      }
      return out;
    },
  };
}

// --- The index file --------------------------------------------------------
// A JSON header line, then the vectors as raw little-endian float32, in the
// order of the header's `ids`. About 6 MB for the whole data.

interface IndexHeader {
  model: string;
  sitesHash: string;
  dims: number;
  ids: string[];
}

export function hashSites(sites: readonly Site[]): string {
  const h = createHash('sha256');
  for (const s of sites) h.update(`${s.id}\n${siteText(s)}\n`);
  return h.digest('hex').slice(0, 16);
}

export async function buildVectors(
  embedder: Embedder,
  sites: readonly Site[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>();
  const BATCH = 32;
  for (let i = 0; i < sites.length; i += BATCH) {
    const batch = sites.slice(i, i + BATCH);
    const embedded = await embedder.embedDocuments(batch.map(siteText));
    batch.forEach((s, j) => vectors.set(s.id, embedded[j]));
    onProgress?.(Math.min(i + BATCH, sites.length), sites.length);
  }
  return vectors;
}

export function writeIndexFile(
  path: string,
  model: string,
  sites: readonly Site[],
  vectors: ReadonlyMap<string, Float32Array>,
): void {
  const ids = sites.map((s) => s.id).filter((id) => vectors.has(id));
  const dims = ids.length ? vectors.get(ids[0])!.length : 0;
  const header: IndexHeader = { model, sitesHash: hashSites(sites), dims, ids };
  const body = new Float32Array(ids.length * dims);
  ids.forEach((id, i) => body.set(vectors.get(id)!, i * dims));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), Buffer.from(body.buffer)]));
}

/** The vectors in the index file, or null when the file is missing or was
 *  built from another model or other site data. */
export function readIndexFile(
  path: string,
  model: string,
  sites: readonly Site[],
): Map<string, Float32Array> | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const nl = buf.indexOf(0x0a);
  if (nl < 0) return null;
  const header = JSON.parse(buf.subarray(0, nl).toString('utf8')) as IndexHeader;
  if (header.model !== model || header.sitesHash !== hashSites(sites)) return null;

  // Copy into an aligned buffer: the header's length puts the floats at an
  // arbitrary byte offset.
  const bytes = buf.subarray(nl + 1);
  const floats = new Float32Array(new Uint8Array(bytes).buffer);
  const vectors = new Map<string, Float32Array>();
  header.ids.forEach((id, i) => vectors.set(id, floats.subarray(i * header.dims, (i + 1) * header.dims)));
  return vectors;
}
