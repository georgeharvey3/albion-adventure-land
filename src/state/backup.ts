import type { PersistedUserState, VisitLog } from './db';

// User-state backup (spec §6 F-export, Phase 3).
//
// The reason this exists is a hard platform limit, not a nicety: on iOS a
// home-screen web app gets its own storage container, and removing the icon —
// the only way to refresh a stale home-screen logo — takes that container with
// it. Without a file to carry the state out and back in, re-adding the icon
// costs the user every tick they have made.
//
// So this file is the one seam through which precious state leaves and re-enters
// the app. It is deliberately dumb: plain JSON, stable site ids, no site data.
// Site data is replaceable and ships with the build; what cannot be rebuilt is
// which of those sites the user has stood in front of.

export const BACKUP_FORMAT = 'albion-adventure-land/user-state';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  visited: VisitLog[];
  wishlist: string[];
  hidden: string[];
}

export interface RestoreCounts {
  visited: number;
  wishlist: number;
  hidden: number;
}

/** Everything precious, and nothing else — no derived caches, no site data. */
export function buildBackup(state: PersistedUserState): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Sorted so two exports of the same state are the same bytes, which makes a
    // backup diffable and tells you at a glance whether anything moved.
    visited: Object.values(state.visited)
      .map(({ siteId, visitedAt, note }) => ({ siteId, visitedAt, ...(note ? { note } : {}) }))
      .sort((a, b) => a.siteId.localeCompare(b.siteId)),
    wishlist: [...state.wishlist].sort(),
    hidden: [...state.hidden].sort(),
  };
}

export function serializeBackup(state: PersistedUserState): string {
  return JSON.stringify(buildBackup(state), null, 2);
}

export function backupFilename(now = new Date()): string {
  return `albion-backup-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Read a backup file, or throw a message fit to show the user.
 *
 * Strict about the envelope (a wrong file is the likely mistake — a photo, a
 * half-copied paste) and forgiving about the rows: a row missing an id is
 * dropped, not fatal, because a partly readable backup still beats none.
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like a backup file — it isn't valid JSON.");
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error("That doesn't look like a backup file.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error('That file is not an Albion Adventure Land backup.');
  }
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of the app. Update the app first.');
  }

  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

  const visited: VisitLog[] = Array.isArray(obj.visited)
    ? obj.visited.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        if (typeof r.siteId !== 'string' || !r.siteId) return [];
        const visitedAt = typeof r.visitedAt === 'string' ? r.visitedAt : new Date(0).toISOString();
        const note = typeof r.note === 'string' && r.note ? r.note : undefined;
        return [{ siteId: r.siteId, visitedAt, ...(note ? { note } : {}) }];
      })
    : [];

  return {
    format: BACKUP_FORMAT,
    version: obj.version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    visited,
    wishlist: ids(obj.wishlist),
    hidden: ids(obj.hidden),
  };
}

/**
 * Fold a backup into the state already held. A restore MERGES and never deletes.
 *
 * Into a fresh install (the icon-replacement case) the current state is empty,
 * so a merge restores exactly. Into a populated one it can only ever add, which
 * means restoring the wrong file, or the same file twice, costs nothing — the
 * same property that makes `foldDuplicateState` safe to re-run, and it follows
 * the same rules: the EARLIER visit date wins, and both notes are kept.
 */
export function mergeBackup(
  current: PersistedUserState,
  backup: BackupFile,
): { state: PersistedUserState; added: RestoreCounts } {
  const visited: Record<string, VisitLog> = { ...current.visited };
  const wishlist = new Set(current.wishlist);
  const hidden = new Set(current.hidden);
  const added: RestoreCounts = { visited: 0, wishlist: 0, hidden: 0 };

  for (const row of backup.visited) {
    const own = visited[row.siteId];
    if (!own) {
      visited[row.siteId] = row;
      added.visited++;
      continue;
    }
    const notes = [own.note, row.note].filter(Boolean) as string[];
    const note = [...new Set(notes)].join('\n\n');
    visited[row.siteId] = {
      siteId: row.siteId,
      visitedAt: own.visitedAt < row.visitedAt ? own.visitedAt : row.visitedAt,
      ...(note ? { note } : {}),
      ...(own.photoBlobKey ? { photoBlobKey: own.photoBlobKey } : {}),
    };
  }

  for (const id of backup.wishlist) {
    // A visited site is never on the wishlist (see markVisited) — a backup made
    // before the visit was ticked must not put it back on the list to do.
    if (visited[id] || wishlist.has(id)) continue;
    wishlist.add(id);
    added.wishlist++;
  }

  for (const id of backup.hidden) {
    if (hidden.has(id)) continue;
    hidden.add(id);
    added.hidden++;
  }

  // The invariant markVisited keeps: a visited site is not also on the list to
  // visit. A backup's visit can land on a site the current state still wishes
  // for, so the last word on the wishlist is what the merged visits say.
  for (const id of Object.keys(visited)) wishlist.delete(id);

  return { state: { visited, wishlist: [...wishlist], hidden: [...hidden] }, added };
}
