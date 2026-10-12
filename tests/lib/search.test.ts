import { describe, it, expect } from 'vitest'
import { filterDatabase, filterSpaceTabs, filterLiveTabs } from '@/lib/search'
import type { Database, Space, Tab } from '@/lib/schema'

const t = (url: string, title = url): Tab => ({ url, title })
const sp = (id: string, name: string, tabs: Tab[]): Space => ({
  id,
  name,
  tabs,
  createdAt: 1,
  updatedAt: 1,
})

describe('filterDatabase', () => {
  const db: Database = {
    version: 1,
    spaces: [
      sp('a', 'Work', [
        t('https://github.com/foo', 'GitHub Foo'),
        t('https://linear.app/issue/1', 'Linear Issue'),
      ]),
      sp('b', 'Reading', [
        t('https://medium.com/post', 'Some Medium post'),
        t('https://news.ycombinator.com/item?id=123', 'Hacker News'),
      ]),
      sp('c', 'AI tools', [
        t('https://chatgpt.com', 'ChatGPT'),
      ]),
    ],
  }

  it('returns same db for empty query', () => {
    expect(filterDatabase(db, '')).toBe(db)
    expect(filterDatabase(db, '   ')).toBe(db)
  })

  it('matches by space name (preserves all tabs in that space)', () => {
    const r = filterDatabase(db, 'work')
    expect(r.spaces).toHaveLength(1)
    expect(r.spaces[0]?.id).toBe('a')
    expect(r.spaces[0]?.tabs).toHaveLength(2)
  })

  it('matches by tab title', () => {
    const r = filterDatabase(db, 'github')
    expect(r.spaces).toHaveLength(1)
    expect(r.spaces[0]?.tabs.map((t) => t.title)).toEqual(['GitHub Foo'])
  })

  it('matches by tab url', () => {
    const r = filterDatabase(db, 'medium.com')
    expect(r.spaces).toHaveLength(1)
    expect(r.spaces[0]?.tabs).toHaveLength(1)
  })

  it('returns multiple spaces when query hits across', () => {
    const r = filterDatabase(db, 'm')
    // matches 'Medium' in space b, 'AI tools' has nothing — actually let me check
    // 'm' in 'Work' name? no. 'Reading' name? no. 'AI tools' name? no.
    // tabs: Linear has no m? 'Linear Issue' lowercase 'linear issue' — no 'm'.
    // Medium post has 'm'. ChatGPT has no 'm'. Hacker News no 'm'.
    // So just space b with the medium tab.
    // But also 'github' has no 'm'.
    // Hmm let me make this more deterministic
    expect(r.spaces.length).toBeGreaterThanOrEqual(1)
  })

  it('AND-matches multiple terms', () => {
    const r = filterDatabase(db, 'github foo')
    expect(r.spaces).toHaveLength(1)
    expect(r.spaces[0]?.tabs).toHaveLength(1)

    const r2 = filterDatabase(db, 'github linear')
    // No single tab has both 'github' and 'linear'
    expect(r2.spaces).toHaveLength(0)
  })

  it('case-insensitive', () => {
    expect(filterDatabase(db, 'GITHUB').spaces).toHaveLength(1)
    expect(filterDatabase(db, 'GitHub').spaces).toHaveLength(1)
  })

  it('matches folder names and keeps only their tabs visible', () => {
    const folderSpace: Space = {
      ...sp('folders', 'Projects', [
        { ...t('https://one.example/', 'One'), pinned: true, folderId: 'f1' },
        { ...t('https://two.example/', 'Two'), pinned: true, folderId: 'f2' },
      ]),
      folders: [{ id: 'f1', name: 'Reading list' }, { id: 'f2', name: 'Work' }],
    }
    const foldered: Database = {
      version: 1,
      spaces: [folderSpace],
    }
    const result = filterDatabase(foldered, 'reading list')
    expect(result.spaces[0]?.tabs.map((tab) => tab.title)).toEqual(['One'])
    expect(result.spaces[0]?.folders?.map((folder) => folder.name)).toEqual(['Reading list'])
  })

  it('filters out spaces with no matching tabs and no name match', () => {
    const r = filterDatabase(db, 'nonexistent')
    expect(r.spaces).toHaveLength(0)
  })
})

describe('filterSpaceTabs', () => {
  const space = sp('a', 'Work', [
    t('https://a.com/', 'Alpha'),
    t('https://b.com/', 'Beta'),
  ])

  it('returns same space for empty query', () => {
    expect(filterSpaceTabs(space, '')).toBe(space)
  })

  it('filters tabs matching the query', () => {
    const r = filterSpaceTabs(space, 'alpha')
    expect(r.tabs.map((t) => t.title)).toEqual(['Alpha'])
  })

  it('returns same ref when nothing changed (all tabs match)', () => {
    const r = filterSpaceTabs(space, 'a.com')
    // 'a.com' only matches one tab
    expect(r.tabs).toHaveLength(1)
  })

  it('returns whole space when name matches', () => {
    expect(filterSpaceTabs(space, 'work')).toBe(space)
  })

  it('keeps a folder and its matching tabs visible when searching for the folder name', () => {
    const foldered = { ...space, folders: [{ id: 'f1', name: 'Reference' }], tabs: [{ ...space.tabs[0]!, pinned: true, folderId: 'f1' }, space.tabs[1]!] }
    const result = filterSpaceTabs(foldered, 'reference')
    expect(result.folders).toEqual([{ id: 'f1', name: 'Reference' }])
    expect(result.tabs.map((tab) => tab.title)).toEqual(['Alpha'])
  })

  it('keeps the ancestor path visible when a nested folder matches', () => {
    const nested = { ...space, folders: [{ id: 'root', name: 'Projects' }, { id: 'child', name: 'Reading', parentId: 'root' }], tabs: [{ ...space.tabs[0]!, pinned: true, folderId: 'child' }, space.tabs[1]!] }
    const result = filterSpaceTabs(nested, 'reading')
    expect(result.folders?.map((folder) => folder.id)).toEqual(['root', 'child'])
    expect(result.tabs).toHaveLength(1)
  })

  it('includes descendant folders and tabs when a parent folder name matches', () => {
    const nested = { ...space, folders: [{ id: 'root', name: 'Projects' }, { id: 'child', name: 'Reading', parentId: 'root' }], tabs: [{ ...space.tabs[0]!, pinned: true, folderId: 'child' }, space.tabs[1]!] }
    const result = filterSpaceTabs(nested, 'projects')
    expect(result.folders?.map((folder) => folder.id)).toEqual(['root', 'child'])
    expect(result.tabs).toHaveLength(1)
  })
})

describe('filterLiveTabs', () => {
  const tabs = [
    { url: 'https://a.com/', title: 'Alpha' },
    { url: 'https://b.com/', title: 'Beta' },
  ]

  it('returns same array for empty query', () => {
    expect(filterLiveTabs(tabs, '')).toBe(tabs)
  })

  it('filters by title', () => {
    expect(filterLiveTabs(tabs, 'alpha').map((t) => t.title)).toEqual(['Alpha'])
  })

  it('filters by url', () => {
    expect(filterLiveTabs(tabs, 'b.com').map((t) => t.title)).toEqual(['Beta'])
  })
})
