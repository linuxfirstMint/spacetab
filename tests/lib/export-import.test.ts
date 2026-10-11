import { describe, it, expect } from 'vitest'
import {
  serializeForExport,
  parseImport,
  mergeDatabase,
  replaceDatabase,
  summarizeImport,
  exportFilename,
} from '@/lib/export-import'
import type { Database } from '@/lib/schema'

const sampleDb: Database = {
  version: 1,
  spaces: [
    {
      id: 'sp1',
      name: 'Work',
      tabs: [{ url: 'https://a.com/', title: 'A' }],
      createdAt: 100,
      updatedAt: 200,
    },
  ],
}

describe('serializeForExport / parseImport round trip', () => {
  it('round-trips a valid db', () => {
    const json = serializeForExport(sampleDb, 9999)
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.db).toEqual(sampleDb)
      expect(result.file.exportedAt).toBe(9999)
      expect(result.file.format).toBe('spacetab-export')
      expect(result.file.formatVersion).toBe(1)
    }
  })

  it('preserves folder definitions, order, collapse state, and tab membership in backup files', () => {
    const foldered: Database = {
      ...sampleDb,
      spaces: [{ ...sampleDb.spaces[0]!, folders: [{ id: 'f1', name: 'Reading', collapsed: true }], tabs: [{ url: 'https://a.com/', title: 'A', pinned: true, folderId: 'f1' }] }],
    }
    const result = parseImport(serializeForExport(foldered, 1234))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.file.db).toEqual(foldered)
  })

  it('preserves selected Space colors in backup files', () => {
    const colored: Database = {
      ...sampleDb,
      spaces: [{ ...sampleDb.spaces[0]!, color: 'cyan' }],
    }
    const result = parseImport(serializeForExport(colored, 2345))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.file.db.spaces[0]?.color).toBe('cyan')
  })
})

describe('parseImport rejection cases', () => {
  it('rejects malformed JSON', () => {
    const r = parseImport('{not valid json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid-json')
  })

  it('rejects valid JSON missing required fields', () => {
    const r = parseImport(JSON.stringify({ format: 'spacetab-export' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid-shape')
  })

  it('rejects wrong format literal', () => {
    const r = parseImport(
      JSON.stringify({
        format: 'something-else',
        formatVersion: 1,
        exportedAt: 1,
        app: 'SpaceTab',
        db: sampleDb,
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects wrong formatVersion', () => {
    const r = parseImport(
      JSON.stringify({
        format: 'spacetab-export',
        formatVersion: 2,
        exportedAt: 1,
        app: 'SpaceTab',
        db: sampleDb,
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects when inner db.version is wrong', () => {
    const r = parseImport(
      JSON.stringify({
        format: 'spacetab-export',
        formatVersion: 1,
        exportedAt: 1,
        app: 'SpaceTab',
        db: { version: 2, spaces: [] },
      }),
    )
    expect(r.ok).toBe(false)
  })
})

describe('mergeDatabase', () => {
  it('adds new ids that are not in current', () => {
    const current: Database = { version: 1, spaces: [] }
    const incoming: Database = sampleDb
    const merged = mergeDatabase(current, incoming)
    expect(merged.spaces).toHaveLength(1)
    expect(merged.spaces[0]?.id).toBe('sp1')
  })

  it('replaces same id when incoming.updatedAt > current.updatedAt', () => {
    const current: Database = sampleDb
    const incoming: Database = {
      version: 1,
      spaces: [{ ...sampleDb.spaces[0]!, name: 'Work updated', updatedAt: 500 }],
    }
    const merged = mergeDatabase(current, incoming)
    expect(merged.spaces[0]?.name).toBe('Work updated')
    expect(merged.spaces[0]?.updatedAt).toBe(500)
  })

  it('keeps current when current is newer', () => {
    const current: Database = {
      version: 1,
      spaces: [{ ...sampleDb.spaces[0]!, name: 'Current wins', updatedAt: 999 }],
    }
    const incoming: Database = sampleDb // updatedAt: 200
    const merged = mergeDatabase(current, incoming)
    expect(merged.spaces[0]?.name).toBe('Current wins')
  })

  it('keeps current when timestamps are equal', () => {
    const current: Database = sampleDb
    const incoming: Database = {
      version: 1,
      spaces: [{ ...sampleDb.spaces[0]!, name: 'Tie' }],
    }
    const merged = mergeDatabase(current, incoming)
    expect(merged.spaces[0]?.name).toBe('Work')
  })
})

describe('replaceDatabase', () => {
  it('returns incoming as-is', () => {
    const current: Database = sampleDb
    const incoming: Database = { version: 1, spaces: [] }
    const result = replaceDatabase(current, incoming)
    expect(result).toBe(incoming)
  })
})

describe('summarizeImport', () => {
  it('counts new / updated / unchanged correctly', () => {
    const current: Database = {
      version: 1,
      spaces: [
        { id: 'a', name: 'A', tabs: [], createdAt: 1, updatedAt: 100 },
        { id: 'b', name: 'B', tabs: [], createdAt: 1, updatedAt: 100 },
      ],
    }
    const incoming: Database = {
      version: 1,
      spaces: [
        { id: 'a', name: 'A new', tabs: [], createdAt: 1, updatedAt: 200 }, // updated
        { id: 'b', name: 'B old', tabs: [], createdAt: 1, updatedAt: 50 },  // unchanged
        { id: 'c', name: 'C', tabs: [], createdAt: 1, updatedAt: 1 },        // new
      ],
    }
    const summary = summarizeImport(current, incoming)
    expect(summary.incomingSpaces).toBe(3)
    expect(summary.newSpaces).toBe(1)
    expect(summary.updatedSpaces).toBe(1)
    expect(summary.unchangedSpaces).toBe(1)
  })
})

describe('exportFilename', () => {
  it('produces a YYYY-MM-DD-HHmm pattern', () => {
    // 2026-05-07 14:23 (May = month index 4)
    const fixed = new Date(2026, 4, 7, 14, 23, 45).getTime()
    const name = exportFilename(fixed)
    expect(name).toBe('spacetab-2026-05-07-1423.json')
  })

  it('zero-pads single-digit values', () => {
    const fixed = new Date(2026, 0, 3, 9, 5, 0).getTime()
    const name = exportFilename(fixed)
    expect(name).toBe('spacetab-2026-01-03-0905.json')
  })
})
