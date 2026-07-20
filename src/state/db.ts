import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// IndexedDB wrappers (spec §5.3, §9). User state is the precious data: it must
// survive offline, reload, and CSV re-import — hence keyed on the stable site id.
// Phase 2 adds a `photos` blob store and cached travel matrices; the schema is
// versioned so those can be added without losing visited/wishlist state.

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
}

const DB_NAME = 'albion';
const DB_VERSION = 2;

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
