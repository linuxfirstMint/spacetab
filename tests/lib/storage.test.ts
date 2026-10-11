import { describe, it, expect } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { readDatabase, readFavorites, writeDatabase, writeFavorites } from '@/lib/storage'
import { EMPTY_DB } from '@/lib/schema'

describe('storage round trip', () => {
  it('returns EMPTY_DB on first read', async () => {
    const { db, events } = await readDatabase()
    expect(db).toEqual(EMPTY_DB)
    expect(events).toEqual([])
  })

  it('write → read returns same db', async () => {
    const sample = {
      version: 1 as const,
      spaces: [
        {
          id: 'sp1',
          name: 'Work',
          tabs: [{ url: 'https://example.com/', title: 'E' }],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    }
    const w = await writeDatabase(sample)
    expect(w.ok).toBe(true)
    const { db } = await readDatabase()
    expect(db).toEqual(sample)
  })

  it('backs up corrupt data and returns empty db', async () => {
    await fakeBrowser.storage.local.set({ db: { totally: 'wrong' } })
    const { db, events } = await readDatabase()
    expect(db).toEqual(EMPTY_DB)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('corrupt-backup')

    const all = await fakeBrowser.storage.local.get(null)
    const backupKey = Object.keys(all).find((k) => k.startsWith('db_corrupt_'))
    expect(backupKey).toBeDefined()
    expect(all[backupKey!]).toEqual({ totally: 'wrong' })
  })

  it('keeps Favorites independent from Space writes and migrates embedded legacy Favorites', async () => {
    const favorite = { url: 'https://favorite.example/', title: 'Favorite' }
    await fakeBrowser.storage.local.set({ db: { ...EMPTY_DB, favorites: [favorite] } })
    const migrated = await readDatabase()
    expect(migrated.db.favorites).toEqual([favorite])
    expect(await readFavorites()).toEqual([favorite])

    await writeFavorites([{ url: 'https://new.example/', title: 'New' }])
    await writeDatabase({ version: 1, spaces: [{ id: 'work', name: 'Work', tabs: [], createdAt: 1, updatedAt: 2 }] })
    expect(await readFavorites()).toEqual([{ url: 'https://new.example/', title: 'New' }])
  })
})
