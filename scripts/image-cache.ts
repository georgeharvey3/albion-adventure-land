import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteImage } from '../src/data/types.ts';

// Shared shape + IO for the site-photo cache (data/image-cache.json), split out
// so scripts/ingest.ts can read it without importing the fetcher's side effects.
// Keyed by the STABLE site id — same contract as geocode-cache and
// camra-descriptions: site data is replaceable, cached enrichment survives.

export interface ImageCacheEntry {
  /** null = searched every provider and found nothing usable — a re-run skips
   *  the site instead of re-searching (use --force to retry misses). */
  image: (SiteImage & { thumbUrl?: string }) | null;
  checkedAt: string; // ISO date of the lookup
}

export type ImageCache = Record<string, ImageCacheEntry>;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const IMAGE_CACHE_FILE = resolve(root, 'data/image-cache.json');
export const IMAGES_DIR = resolve(root, 'public/images');

export function loadImageCache(): ImageCache {
  if (!existsSync(IMAGE_CACHE_FILE)) return {};
  return JSON.parse(readFileSync(IMAGE_CACHE_FILE, 'utf8')) as ImageCache;
}

export function saveImageCache(cache: ImageCache): void {
  mkdirSync(dirname(IMAGE_CACHE_FILE), { recursive: true });
  writeFileSync(IMAGE_CACHE_FILE, JSON.stringify(cache, null, 1));
}
