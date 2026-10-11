import { EMPTY_DB, FavoriteSchema, safeParseDatabase, type Database, type Favorite } from './schema'
import { normalizeFavorites } from './favorites'

const KEY = 'db'
const FAVORITES_KEY = 'favorites'
const CORRUPT_PREFIX = 'db_corrupt_'

export type StorageEvent =
  | { kind: 'corrupt-backup'; backupKey: string }
  | { kind: 'read-failed'; error: unknown }
  | { kind: 'write-failed'; error: unknown }

export async function readDatabase(): Promise<{ db: Database; events: StorageEvent[] }> {
  let stored: Record<string, unknown>
  try {
    stored = (await chrome.storage.local.get([KEY, FAVORITES_KEY])) as Record<string, unknown>
  } catch (error) {
    return { db: EMPTY_DB, events: [{ kind: 'read-failed', error }] }
  }

  const raw = stored[KEY]
  if (raw === undefined) return { db: EMPTY_DB, events: [] }

  const parsed = safeParseDatabase(raw)
  if (parsed.ok) {
    const legacyFavorites = parsed.db.favorites
    const favoritesResult = FavoriteSchema.array().safeParse(stored[FAVORITES_KEY] ?? legacyFavorites ?? [])
    const favorites = favoritesResult.success ? normalizeFavorites(favoritesResult.data) : []
    if (stored[FAVORITES_KEY] === undefined && legacyFavorites !== undefined) {
      try { await chrome.storage.local.set({ [FAVORITES_KEY]: favorites }) } catch { /* keep legacy field readable */ }
    }
    return {
      db: stored[FAVORITES_KEY] !== undefined || legacyFavorites !== undefined
        ? { ...parsed.db, favorites }
        : parsed.db,
      events: [],
    }
  }

  const backupKey = `${CORRUPT_PREFIX}${Date.now()}`
  try {
    await chrome.storage.local.set({ [backupKey]: raw })
  } catch {
    // 备份失败不影响主流程,正常路径继续返回 EMPTY_DB
  }
  return { db: EMPTY_DB, events: [{ kind: 'corrupt-backup', backupKey }] }
}

export async function writeDatabase(
  db: Database,
): Promise<{ ok: boolean; events: StorageEvent[] }> {
  try {
    // Keep shared profile favorites in a separate key so stale Space writes from
    // another window cannot overwrite them.
    const { favorites: _favorites, ...spacesDatabase } = db
    await chrome.storage.local.set({ [KEY]: spacesDatabase })
    return { ok: true, events: [] }
  } catch (error) {
    return { ok: false, events: [{ kind: 'write-failed', error }] }
  }
}

/** Atomically replace both the Space database and profile-wide Favorites during import. */
export async function writeDatabaseAndFavorites(
  db: Database,
): Promise<{ ok: boolean; events: StorageEvent[] }> {
  try {
    const { favorites, ...spacesDatabase } = db
    await chrome.storage.local.set({
      [KEY]: spacesDatabase,
      [FAVORITES_KEY]: normalizeFavorites(favorites ?? []),
    })
    return { ok: true, events: [] }
  } catch (error) {
    return { ok: false, events: [{ kind: 'write-failed', error }] }
  }
}

export async function readFavorites(): Promise<Favorite[]> {
  try {
    const stored = await chrome.storage.local.get(FAVORITES_KEY)
    const parsed = FavoriteSchema.array().safeParse(stored[FAVORITES_KEY] ?? [])
    return parsed.success ? normalizeFavorites(parsed.data) : []
  } catch {
    return []
  }
}

export async function writeFavorites(favorites: Favorite[]): Promise<{ ok: boolean; events: StorageEvent[] }> {
  try {
    await chrome.storage.local.set({ [FAVORITES_KEY]: normalizeFavorites(favorites) })
    return { ok: true, events: [] }
  } catch (error) {
    return { ok: false, events: [{ kind: 'write-failed', error }] }
  }
}
