import { describe, it, expect } from 'vitest'
import { safeParseDatabase, EMPTY_DB } from '@/lib/schema'

describe('safeParseDatabase', () => {
  const validDb = {
    version: 1,
    spaces: [
      {
        id: 'a',
        name: 'Work',
        tabs: [{ url: 'https://example.com/', title: 'Example' }],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  }

  it('parses a valid database', () => {
    const r = safeParseDatabase(validDb)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.db.spaces).toHaveLength(1)
  })

  it('keeps legacy tabs valid and parses Space pin plus current URL metadata', () => {
    const old = safeParseDatabase(validDb)
    const next = safeParseDatabase({ ...validDb, spaces: [{ ...validDb.spaces[0], tabs: [{ url: 'https://saved.example/', title: 'Saved', pinned: true, currentUrl: 'https://current.example/' }] }] })
    expect(old.ok).toBe(true)
    expect(next.ok && next.db.spaces[0]?.tabs[0]).toMatchObject({ url: 'https://saved.example/', currentUrl: 'https://current.example/', pinned: true })
  })

  it('keeps legacy Space colors optional and round-trips selected theme colors', () => {
    const legacy = safeParseDatabase(validDb)
    const colored = safeParseDatabase({ ...validDb, spaces: [{ ...validDb.spaces[0], color: 'violet' }] })
    expect(legacy.ok && legacy.db.spaces[0]).not.toHaveProperty('color')
    expect(colored.ok && colored.db.spaces[0]?.color).toBe('violet')
    expect(safeParseDatabase({ ...validDb, spaces: [{ ...validDb.spaces[0], color: 'ultraviolet' }] }).ok).toBe(false)
  })

  it('round-trips flat folder membership and collapsed state while keeping legacy spaces valid', () => {
    const legacy = safeParseDatabase(validDb)
    const withFolder = safeParseDatabase({
      ...validDb,
      spaces: [{ ...validDb.spaces[0], folders: [{ id: 'folder-1', name: 'Reading', collapsed: true }], tabs: [{ url: 'https://example.com/', title: 'Example', pinned: true, folderId: 'folder-1' }] }],
    })
    expect(legacy.ok).toBe(true)
    expect(withFolder.ok && withFolder.db.spaces[0]).toMatchObject({
      folders: [{ id: 'folder-1', name: 'Reading', collapsed: true }],
      tabs: [{ pinned: true, folderId: 'folder-1' }],
    })
  })

  it('rejects wrong version', () => {
    const r = safeParseDatabase({ ...validDb, version: 2 })
    expect(r.ok).toBe(false)
  })

  it('rejects missing fields', () => {
    const r = safeParseDatabase({ version: 1 })
    expect(r.ok).toBe(false)
  })

  it('rejects malformed url', () => {
    const bad = {
      version: 1,
      spaces: [{ ...validDb.spaces[0], tabs: [{ url: 'not a url', title: 't' }] }],
    }
    const r = safeParseDatabase(bad)
    expect(r.ok).toBe(false)
  })

  it('exports a usable EMPTY_DB constant', () => {
    expect(EMPTY_DB).toEqual({ version: 1, spaces: [] })
  })
})
