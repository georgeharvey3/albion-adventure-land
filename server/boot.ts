// Everything the server loads once at start (issue #62): the site data, the
// place dictionary, the embedding model and the semantic index.

import { resolve } from 'node:path';
import { ROOT, type SiteData } from './data';
import { localEmbedder } from './embedder';
import { buildVectors, readIndexFile, semanticIndex, writeIndexFile, type SemanticIndex } from './semantic';

export const INDEX_PATH = resolve(ROOT, 'server/.cache/semantic-index.bin');

/** Build the index file from the current site data. */
export async function buildIndex(data: SiteData, log: (msg: string) => void = console.log): Promise<void> {
  const embedder = await localEmbedder();
  let last = 0;
  const vectors = await buildVectors(embedder, data.sites, (done, total) => {
    if (done - last >= 500 || done === total) {
      log(`  embedded ${done}/${total} sites`);
      last = done;
    }
  });
  writeIndexFile(INDEX_PATH, embedder.model, data.sites, vectors);
  log(`✓ Wrote the semantic index for ${vectors.size} sites to ${INDEX_PATH}`);
}

/**
 * The semantic index for the current data. A missing or stale index file is
 * rebuilt, once, before the server takes questions. If the embedding model
 * cannot load at all, the server still answers: `meaning` has no effect, and
 * each shortlist keeps its distance order.
 */
export async function loadSemantic(data: SiteData, log: (msg: string) => void = console.log): Promise<SemanticIndex | null> {
  try {
    const embedder = await localEmbedder();
    let vectors = readIndexFile(INDEX_PATH, embedder.model, data.sites);
    if (!vectors) {
      log('The semantic index is missing or stale. Building it now.');
      await buildIndex(data, log);
      vectors = readIndexFile(INDEX_PATH, embedder.model, data.sites);
    }
    return vectors ? semanticIndex(embedder, vectors) : null;
  } catch (err) {
    log(`⚠ No semantic index: ${(err as Error).message}. Answers rank by distance only.`);
    return null;
  }
}
