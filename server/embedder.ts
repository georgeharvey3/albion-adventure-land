// The embedding model (issue #62): small, open, and run in the server process
// with transformers.js, so the index needs no second service and no key.
//
// BAAI's bge-small-en-v1.5 is 384 dimensions and about 34 MB quantised. It
// embeds the whole data on a laptop CPU in a minute or two, and one question
// in a few milliseconds. The first run downloads it from Hugging Face into
// server/.cache/models; after that it works offline.

import { resolve } from 'node:path';
import { ROOT } from './data';
import type { Embedder } from './semantic';

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

// bge wants this prefix on a query, and no prefix on a document.
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

export async function localEmbedder(model = EMBEDDING_MODEL): Promise<Embedder> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = resolve(ROOT, 'server/.cache/models');
  const extract = await pipeline('feature-extraction', model, { dtype: 'q8' });

  async function embed(texts: string[]): Promise<Float32Array[]> {
    const out = await extract(texts, { pooling: 'cls', normalize: true });
    const [n, dims] = out.dims as [number, number];
    const data = out.data as Float32Array;
    return Array.from({ length: n }, (_, i) => data.slice(i * dims, (i + 1) * dims));
  }

  return {
    model,
    embedDocuments: embed,
    embedQuery: async (text) => (await embed([QUERY_PREFIX + text]))[0],
  };
}
