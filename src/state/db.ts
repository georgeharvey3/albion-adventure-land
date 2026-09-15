import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// IndexedDB wrappers (spec §5.3, §9). User state is the precious data: it must
// survive offline, reload, and CSV re-import — hence keyed on the stable site id.
// Phase 2 adds a `photos` blob store and cached travel matrices; the schema is
// versioned so those can be added without losing visited/wishlist state.
//
// The `places` store added in v3 is the one exception to "everything in here is
// precious": it is a DERIVED CACHE of places resolved online (issue #28), kept
// so a place you looked up on wifi is still findable in a glen with no signal.
// Losing it costs nothing, it is capped and evicted, and — critically — nothing
// else is keyed against it. It lives here rather than in localStorage only
// because it can run to a few hundred KB.

export interface VisitLog {
  siteId: string;
  visitedAt: string; // ISO date
  note?: string;
  photoBlobKey?: string;
}

interface AlbionDB extends DBSchema {
  visited: {
    key: string; // siteId
    value: VisitLog;
  };
  wishlist: {
    key: string; // siteId
    value: { siteId: string };
  };
  // Sites the user has chosen to hide from the map/lists. Precious user state,
  // keyed by the stable site id like the others.
  hidden: {
    key: string; // siteId
    value: { siteId: string };
  };
  // Derived, disposable — see the note at the top of this file.
  places: {
    key: string; // canonical name (the search match key)
    value: CachedPlace;
    indexes: { savedAt: number };
  };
}

/** A place resolved online once, kept so it can be found again offline. */
export interface CachedPlace {
  key: string;
  label: string;
  detail: string;
  lat: number;
  lng: number;
  /** Epoch millis, for least-recently-saved eviction. */
  savedAt: number;
}

/** Keep the cache bounded — this is a convenience, not an archive. */
const MAX_CACHED_PLACES = 500;

const DB_NAME = 'albion';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<AlbionDB>> | null = null;

function getDb(): Promise<IDBPDatabase<AlbionDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AlbionDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('visited')) {
          db.createObjectStore('visited', { keyPath: 'siteId' });
        }
        if (!db.objectStoreNames.contains('wishlist')) {
          db.createObjectStore('wishlist', { keyPath: 'siteId' });
        }
        if (!db.objectStoreNames.contains('hidden')) {
          db.createObjectStore('hidden', { keyPath: 'siteId' });
        }
        if (!db.objectStoreNames.contains('places')) {
          const places = db.createObjectStore('places', { keyPath: 'key' });
          places.createIndex('savedAt', 'savedAt');
        }
      },
    });
  }
  return dbPromise;
}

export interface PersistedUserState {
  visited: Record<string, VisitLog>;
  wishlist: string[];
  hidden: string[];
}

export async function loadUserState(): Promise<PersistedUserState> {
  const db = await getDb();
  const [visits, wishes, hiddens] = await Promise.all([
    db.getAll('visited'),
    db.getAll('wishlist'),
    db.getAll('hidden'),
  ]);
  const visited: Record<string, VisitLog> = {};
  for (const v of visits) visited[v.siteId] = v;
  return {
    visited,
    wishlist: wishes.map((w) => w.siteId),
    hidden: hiddens.map((h) => h.siteId),
  };
}

export async function putVisit(log: VisitLog): Promise<void> {
  const db = await getDb();
  await db.put('visited', log);
}

export async function deleteVisit(siteId: string): Promise<void> {
  const db = await getDb();
  await db.delete('visited', siteId);
}

export async function addWishlist(siteId: string): Promise<void> {
  const db = await getDb();
  await db.put('wishlist', { siteId });
}

export async function removeWishlist(siteId: string): Promise<void> {
  const db = await getDb();
  await db.delete('wishlist', siteId);
}

export async function addHidden(siteId: string): Promise<void> {
  const db = await getDb();
  await db.put('hidden', { siteId });
}

export async function removeHidden(siteId: string): Promise<void> {
  const db = await getDb();
  await db.delete('hidden', siteId);
}

// ---------------------------------------------------------------------------
// Cached places (issue #28). Derived data — every function here is best-effort
// and swallows its errors: a full disk or a blocked store must degrade search,
// never break it, and must never be allowed to surface as an error beside the
// visited/wishlist code paths that actually matter.

export async function loadCachedPlaces(): Promise<CachedPlace[]> {
  try {
    const db = await getDb();
    return await db.getAll('places');
  } catch {
    return [];
  }
}

/**
 * Remember places resolved online, evicting the least recently saved once the
 * cap is passed. Re-saving a place refreshes its timestamp, so the places you
 * keep using are the ones that survive.
 */
export async function cachePlaces(places: Omit<CachedPlace, 'savedAt'>[]): Promise<void> {
  if (!places.length) return;
  try {
    const db = await getDb();
    const now = Date.now();

    const tx = db.transaction('places', 'readwrite');
    await Promise.all(places.map((p) => tx.store.put({ ...p, savedAt: now })));
    await tx.done;

    const count = await db.count('places');
    if (count <= MAX_CACHED_PLACES) return;

    // Walk oldest-first and drop the overflow.
    const evict = count - MAX_CACHED_PLACES;
    const evictTx = db.transaction('places', 'readwrite');
    let cursor = await evictTx.store.index('savedAt').openCursor();
    for (let i = 0; i < evict && cursor; i++) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await evictTx.done;
  } catch {
    // Never surfaced: the search that produced these results already worked.
  }
}
