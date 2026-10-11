import { describe, it, expect } from 'vitest'
import {
  appendTabs,
  archiveToSpace,
  createSpace,
  deleteSpace,
  duplicateSpace,
  findSpace,
  mergeSpaces,
  moveTab,
  moveTabs,
  removeTabFromSpace,
  removeTabsFromSpace,
  renameSpace,
  reorderSpaces,
  reorderTabsInSpace,
  setSpaceEmoji,
  setSpaceColor,
  setSpaceNote,
  setSpacePinned,
  sortedForDisplay,
  setTabPinned,
  updateTabCurrentUrl,
  restoreTabUrl,
  createSpaceFolder,
  renameSpaceFolder,
  deleteSpaceFolder,
  setSpaceFolderCollapsed,
  reorderSpaceFolders,
  moveTabToFolder,
} from '@/lib/space'
import type { Database, Space, Tab } from '@/lib/schema'

const t = (url: string, title = url): Tab => ({ url, title })

const makeSpace = (overrides: Partial<Space> = {}): Space => ({
  id: 'sp1',
  name: 'Work',
  tabs: [],
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
})

const makeDb = (spaces: Space[]): Database => ({ version: 1, spaces })

describe('appendTabs with groups', () => {
  it('attaches incoming groups when their keys are referenced by appended tabs', () => {
    const dest = makeSpace({ id: 'sp', tabs: [] })
    const incoming: Tab[] = [{ url: 'https://a/', title: 'A', groupKey: 'g1' }]
    const next = appendTabs(dest, incoming, 100, {
      incomingGroups: [{ key: 'g1', color: 'blue', title: 'Work' }],
    })
    expect(next.groups).toEqual([{ key: 'g1', color: 'blue', title: 'Work' }])
    expect(next.tabs[0]?.groupKey).toBe('g1')
  })

  it('rebases incoming group keys when they collide with existing keys', () => {
    const dest = makeSpace({
      id: 'sp',
      tabs: [{ url: 'https://x/', title: 'X', groupKey: 'g1' }],
      groups: [{ key: 'g1', color: 'red' }],
    })
    const incoming: Tab[] = [{ url: 'https://y/', title: 'Y', groupKey: 'g1' }]
    const next = appendTabs(dest, incoming, 200, {
      incomingGroups: [{ key: 'g1', color: 'green', title: 'New' }],
    })
    expect(next.groups).toEqual([
      { key: 'g1', color: 'red' },
      { key: 'g2', color: 'green', title: 'New' },
    ])
    const added = next.tabs.find((tt) => tt.url === 'https://y/')
    expect(added?.groupKey).toBe('g2')
  })

  it('drops orphan groups whose keys are not referenced by appended tabs', () => {
    const dest = makeSpace({ id: 'sp', tabs: [] })
    const incoming: Tab[] = [{ url: 'https://a/', title: 'A' }]
    const next = appendTabs(dest, incoming, 300, {
      incomingGroups: [{ key: 'g1', color: 'blue' }],
    })
    expect(next.groups).toBeUndefined()
  })
})

describe('Space pinned tabs', () => {
  it('pins and unpins only the selected Space entry', () => {
    const db = makeDb([makeSpace({ tabs: [t('https://a/'), t('https://b/')] })])
    const pinned = setTabPinned(db, 'sp1', 'https://a/', true, 200)
    expect(pinned.spaces[0]?.tabs[0]?.pinned).toBe(true)
    expect(pinned.spaces[0]?.tabs[1]?.pinned).toBeUndefined()
    const unpinned = setTabPinned(pinned, 'sp1', 'https://a/', false, 300)
    expect(unpinned.spaces[0]?.tabs[0]?.pinned).toBeUndefined()
  })

  it('tracks a live URL separately and restores the saved URL', () => {
    const db = makeDb([makeSpace({ tabs: [t('https://saved.example/')] })])
    const navigated = updateTabCurrentUrl(db, 'sp1', 'https://saved.example/', 'https://current.example/')
    expect(navigated.spaces[0]?.tabs[0]).toMatchObject({ url: 'https://saved.example/', currentUrl: 'https://current.example/' })
    expect(restoreTabUrl(navigated, 'sp1', 'https://saved.example/', 300).spaces[0]?.tabs[0]?.currentUrl).toBeUndefined()
  })
})

describe('Space folders', () => {
  const folderDb = () => makeDb([makeSpace({ tabs: [
    { ...t('https://a/'), pinned: true, folderId: 'f1' },
    { ...t('https://b/'), pinned: true, folderId: 'f1' },
    { ...t('https://c/') },
  ], folders: [{ id: 'f1', name: 'Reading' }, { id: 'f2', name: 'Work' }] })])

  it('creates, renames, collapses, and reorders flat folders', () => {
    let db = createSpaceFolder(makeDb([makeSpace()]), 'sp1', 'f1', '  Reading  ', 2)
    db = renameSpaceFolder(db, 'sp1', 'f1', 'Reference', 3)
    db = setSpaceFolderCollapsed(db, 'sp1', 'f1', true, 4)
    db = createSpaceFolder(db, 'sp1', 'f2', 'Work', 5)
    db = reorderSpaceFolders(db, 'sp1', ['f2', 'f1'], 6)
    expect(db.spaces[0]?.folders).toEqual([{ id: 'f2', name: 'Work' }, { id: 'f1', name: 'Reference', collapsed: true }])
  })

  it('moves only pinned tabs and unpins a foldered tab without losing the tab', () => {
    const db = folderDb()
    expect(moveTabToFolder(db, 'sp1', 'https://c/', 'f2', 10)).toBe(db)
    const moved = moveTabToFolder(db, 'sp1', 'https://c/', 'f2', 11)
    // c is intentionally unpinned, so folder assignment is rejected.
    expect(moved).toBe(db)
    const pinned = setTabPinned(db, 'sp1', 'https://c/', true, 12)
    const filed = moveTabToFolder(pinned, 'sp1', 'https://c/', 'f2', 13)
    expect(filed.spaces[0]?.tabs.find((tab) => tab.url === 'https://c/')).toMatchObject({ pinned: true, folderId: 'f2' })
    const unpinned = setTabPinned(filed, 'sp1', 'https://c/', false, 14)
    expect(unpinned.spaces[0]?.tabs.find((tab) => tab.url === 'https://c/')).toMatchObject({ url: 'https://c/' })
    expect(unpinned.spaces[0]?.tabs.find((tab) => tab.url === 'https://c/')).not.toHaveProperty('folderId')
  })

  it('deleting a folder keeps and unfiles its pinned tabs', () => {
    const deleted = deleteSpaceFolder(folderDb(), 'sp1', 'f1', 20)
    expect(deleted.spaces[0]?.tabs.map((tab) => tab.url)).toEqual(['https://a/', 'https://b/', 'https://c/'])
    expect(deleted.spaces[0]?.tabs.filter((tab) => tab.folderId)).toHaveLength(0)
    expect(deleted.spaces[0]?.folders?.map((folder) => folder.id)).toEqual(['f2'])
  })

  it('unfiles a tab when moving it to another Space', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [{ ...t('https://a/'), pinned: true, folderId: 'f1' }], folders: [{ id: 'f1', name: 'Reading' }] }),
      makeSpace({ id: 'sp2', tabs: [] }),
    ])
    const moved = moveTab(db, 'sp1', 'sp2', 'https://a/', 30)
    expect(moved.spaces[1]?.tabs[0]).toMatchObject({ url: 'https://a/', pinned: true })
    expect(moved.spaces[1]?.tabs[0]).not.toHaveProperty('folderId')
  })

  it('merges source folders with collision-safe IDs and keeps membership valid', () => {
    const db = makeDb([
      makeSpace({ id: 'src', tabs: [{ ...t('https://a/'), pinned: true, folderId: 'f1' }], folders: [{ id: 'f1', name: 'Source' }] }),
      makeSpace({ id: 'dst', tabs: [{ ...t('https://b/'), pinned: true, folderId: 'f1' }], folders: [{ id: 'f1', name: 'Destination' }] }),
    ])
    const merged = mergeSpaces(db, 'src', 'dst', 40).spaces[0]!
    expect(merged.folders).toHaveLength(2)
    expect(new Set(merged.folders?.map((folder) => folder.id)).size).toBe(2)
    expect(merged.tabs.find((tab) => tab.url === 'https://a/')?.folderId).not.toBe('f1')
    expect(merged.tabs.some((tab) => merged.folders?.some((folder) => folder.id === tab.folderId))).toBe(true)
  })
})

describe('appendTabs', () => {
  it('appends new tabs and updates updatedAt', () => {
    const sp = makeSpace({ tabs: [t('https://a/')] })
    const next = appendTabs(sp, [t('https://b/')], 200)
    expect(next.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/'])
    expect(next.updatedAt).toBe(200)
    expect(next.createdAt).toBe(100)
    expect(next.id).toBe('sp1')
  })

  it('dedupes by url, preserving original order', () => {
    const sp = makeSpace({ tabs: [t('https://a/'), t('https://b/')] })
    const next = appendTabs(sp, [t('https://b/'), t('https://c/')], 200)
    expect(next.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/', 'https://c/'])
  })

  it('returns same reference when nothing new', () => {
    const sp = makeSpace({ tabs: [t('https://a/')] })
    const next = appendTabs(sp, [t('https://a/')], 200)
    expect(next).toBe(sp)
  })
})

describe('createSpace', () => {
  it('appends a new space with given id and tabs', () => {
    const db = makeDb([])
    const next = createSpace(db, 'Work', [t('https://a/')], 'sp1', 100)
    expect(next.spaces).toHaveLength(1)
    expect(next.spaces[0]).toMatchObject({
      id: 'sp1',
      name: 'Work',
      createdAt: 100,
      updatedAt: 100,
    })
    expect(next.spaces[0]?.tabs.map((x) => x.url)).toEqual(['https://a/'])
  })
})

describe('renameSpace', () => {
  it('renames matching space and bumps updatedAt', () => {
    const db = makeDb([makeSpace({ id: 'sp1', name: 'Old' })])
    const next = renameSpace(db, 'sp1', 'New', 200)
    expect(next.spaces[0]?.name).toBe('New')
    expect(next.spaces[0]?.updatedAt).toBe(200)
  })

  it('no-op when id missing', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    const next = renameSpace(db, 'sp2', 'New', 200)
    expect(next.spaces[0]?.name).toBe('Work')
  })
})

describe('deleteSpace', () => {
  it('removes matching space', () => {
    const db = makeDb([makeSpace({ id: 'sp1' }), makeSpace({ id: 'sp2', name: 'Two' })])
    const next = deleteSpace(db, 'sp1')
    expect(next.spaces.map((s) => s.id)).toEqual(['sp2'])
  })
})

describe('findSpace', () => {
  it('finds by id', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    expect(findSpace(db, 'sp1')?.id).toBe('sp1')
    expect(findSpace(db, 'nope')).toBeUndefined()
  })
})

describe('archiveToSpace', () => {
  it('appends tabs into target space with dedupe', () => {
    const db = makeDb([makeSpace({ id: 'sp1', tabs: [t('https://a/')] })])
    const next = archiveToSpace(db, 'sp1', [t('https://a/'), t('https://b/')], 300)
    expect(next.spaces[0]?.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/'])
    expect(next.spaces[0]?.updatedAt).toBe(300)
  })
})

describe('removeTabFromSpace', () => {
  it('removes matching url, bumps updatedAt, leaves other spaces alone', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [t('https://a/'), t('https://b/')] }),
      makeSpace({ id: 'sp2', name: 'Other', tabs: [t('https://c/')] }),
    ])
    const next = removeTabFromSpace(db, 'sp1', 'https://a/', 200)
    expect(next.spaces[0]?.tabs.map((x) => x.url)).toEqual(['https://b/'])
    expect(next.spaces[0]?.updatedAt).toBe(200)
    // other space untouched
    expect(next.spaces[1]).toBe(db.spaces[1])
  })

  it('returns same reference when url not found', () => {
    const db = makeDb([makeSpace({ id: 'sp1', tabs: [t('https://a/')] })])
    const next = removeTabFromSpace(db, 'sp1', 'https://nope/', 200)
    expect(next).toBe(db)
  })

  it('returns same reference when spaceId not found', () => {
    const db = makeDb([makeSpace({ id: 'sp1', tabs: [t('https://a/')] })])
    const next = removeTabFromSpace(db, 'ghost', 'https://a/', 200)
    expect(next).toBe(db)
  })
})

describe('moveTab', () => {
  it('moves tab from source to target', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [t('https://a/'), t('https://b/')] }),
      makeSpace({ id: 'sp2', name: 'Two', tabs: [] }),
    ])
    const next = moveTab(db, 'sp1', 'sp2', 'https://a/', 300)
    expect(next.spaces[0]?.tabs.map((x) => x.url)).toEqual(['https://b/'])
    expect(next.spaces[1]?.tabs.map((x) => x.url)).toEqual(['https://a/'])
  })

  it('is no-op when fromId === toId (returns same ref)', () => {
    const db = makeDb([makeSpace({ id: 'sp1', tabs: [t('https://a/')] })])
    const next = moveTab(db, 'sp1', 'sp1', 'https://a/', 300)
    expect(next).toBe(db)
  })

  it('is no-op when tab not in source (returns same ref)', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [t('https://a/')] }),
      makeSpace({ id: 'sp2', name: 'Two', tabs: [] }),
    ])
    const next = moveTab(db, 'sp1', 'sp2', 'https://nope/', 300)
    expect(next).toBe(db)
  })

  it('is no-op when target space not found', () => {
    const db = makeDb([makeSpace({ id: 'sp1', tabs: [t('https://a/')] })])
    const next = moveTab(db, 'sp1', 'ghost', 'https://a/', 300)
    expect(next).toBe(db)
  })

  it('dedupes when target already has the same url', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [t('https://a/'), t('https://b/')] }),
      makeSpace({ id: 'sp2', name: 'Two', tabs: [t('https://a/')] }),
    ])
    const next = moveTab(db, 'sp1', 'sp2', 'https://a/', 300)
    // removed from source
    expect(next.spaces[0]?.tabs.map((x) => x.url)).toEqual(['https://b/'])
    // not duplicated in target
    expect(next.spaces[1]?.tabs.map((x) => x.url)).toEqual(['https://a/'])
  })
})

describe('duplicateSpace', () => {
  it('appends a copy with new id, new name, fresh timestamps, same tabs', () => {
    const db = makeDb([
      makeSpace({
        id: 'sp1',
        name: 'Work',
        tabs: [t('https://a/'), t('https://b/')],
        createdAt: 100,
        updatedAt: 150,
      }),
    ])
    const next = duplicateSpace(db, 'sp1', 'sp2', 'Work copy', 300)
    expect(next.spaces).toHaveLength(2)
    const copy = next.spaces[1]!
    expect(copy.id).toBe('sp2')
    expect(copy.name).toBe('Work copy')
    expect(copy.createdAt).toBe(300)
    expect(copy.updatedAt).toBe(300)
    expect(copy.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/'])
    expect(next.spaces[0]).toEqual(db.spaces[0])
  })

  it('copies tabs by value', () => {
    const db = makeDb([makeSpace({ id: 'sp1', tabs: [t('https://a/')] })])
    const next = duplicateSpace(db, 'sp1', 'sp2', 'Copy', 300)
    expect(next.spaces[1]!.tabs[0]).not.toBe(db.spaces[0]!.tabs[0])
  })

  it('copies a user-selected Space color', () => {
    const db = makeDb([makeSpace({ id: 'sp1', color: 'cyan' })])
    expect(duplicateSpace(db, 'sp1', 'sp2', 'Copy', 300).spaces[1]?.color).toBe('cyan')
  })

  it('returns same reference when source not found', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    const next = duplicateSpace(db, 'ghost', 'sp2', 'X', 300)
    expect(next).toBe(db)
  })
})

describe('setSpaceColor', () => {
  it('sets and clears a selected color while updating the Space timestamp', () => {
    const db = makeDb([makeSpace({ color: 'amber', updatedAt: 100 })])
    const changed = setSpaceColor(db, 'sp1', 'violet', 300)
    expect(changed.spaces[0]).toMatchObject({ color: 'violet', updatedAt: 300 })
    const reset = setSpaceColor(changed, 'sp1', undefined, 400)
    expect(reset.spaces[0]).toMatchObject({ updatedAt: 400 })
    expect(reset.spaces[0]).not.toHaveProperty('color')
  })

  it('keeps the database reference when the color is unchanged', () => {
    const db = makeDb([makeSpace({ color: 'cyan' })])
    expect(setSpaceColor(db, 'sp1', 'cyan', 300)).toBe(db)
  })
})

describe('mergeSpaces', () => {
  it('merges tabs from source into target with dedupe; source space removed', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', name: 'A', tabs: [t('https://a/'), t('https://b/')] }),
      makeSpace({ id: 'sp2', name: 'B', tabs: [t('https://b/'), t('https://c/')] }),
    ])
    const next = mergeSpaces(db, 'sp1', 'sp2', 300)
    // source space removed
    expect(next.spaces.map((s) => s.id)).toEqual(['sp2'])
    // target has merged tabs, deduplicated (b already in target)
    expect(next.spaces[0]?.tabs.map((x) => x.url)).toEqual([
      'https://b/',
      'https://c/',
      'https://a/',
    ])
  })

  it('updates target updatedAt when there are new tabs', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [t('https://new/')] }),
      makeSpace({ id: 'sp2', name: 'B', tabs: [], updatedAt: 100 }),
    ])
    const next = mergeSpaces(db, 'sp1', 'sp2', 999)
    expect(next.spaces[0]?.updatedAt).toBe(999)
  })

  it('target updatedAt unchanged when source has no new urls', () => {
    const db = makeDb([
      makeSpace({ id: 'sp1', tabs: [t('https://dup/')] }),
      makeSpace({ id: 'sp2', name: 'B', tabs: [t('https://dup/')], updatedAt: 100 }),
    ])
    const next = mergeSpaces(db, 'sp1', 'sp2', 999)
    // source still removed
    expect(next.spaces.map((s) => s.id)).toEqual(['sp2'])
    // appendTabs returned same ref → updatedAt untouched
    expect(next.spaces[0]?.updatedAt).toBe(100)
  })

  it('fromId === toId returns same db reference', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    const next = mergeSpaces(db, 'sp1', 'sp1', 300)
    expect(next).toBe(db)
  })

  it('missing fromId returns same db reference', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    const next = mergeSpaces(db, 'ghost', 'sp1', 300)
    expect(next).toBe(db)
  })

  it('missing toId returns same db reference', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    const next = mergeSpaces(db, 'sp1', 'ghost', 300)
    expect(next).toBe(db)
  })
})

describe('setSpaceEmoji', () => {
  it('sets emoji and bumps updatedAt', () => {
    const db = makeDb([makeSpace({ id: 'sp1', updatedAt: 100 })])
    const next = setSpaceEmoji(db, 'sp1', '📚', 300)
    expect(next.spaces[0]?.emoji).toBe('📚')
    expect(next.spaces[0]?.updatedAt).toBe(300)
  })

  it('clears emoji when given empty/whitespace string', () => {
    const db = makeDb([makeSpace({ id: 'sp1', emoji: '📚' })])
    const next = setSpaceEmoji(db, 'sp1', '', 300)
    expect(next.spaces[0]?.emoji).toBeUndefined()
    const next2 = setSpaceEmoji(db, 'sp1', '   ', 300)
    expect(next2.spaces[0]?.emoji).toBeUndefined()
  })

  it('returns same ref when no change', () => {
    const db = makeDb([makeSpace({ id: 'sp1', emoji: '📚' })])
    expect(setSpaceEmoji(db, 'sp1', '📚', 300)).toBe(db)
  })
})

describe('setSpaceNote', () => {
  it('sets and trims note', () => {
    const db = makeDb([makeSpace({ id: 'sp1' })])
    const next = setSpaceNote(db, 'sp1', '  some note  ', 300)
    expect(next.spaces[0]?.note).toBe('some note')
  })

  it('clears note for empty', () => {
    const db = makeDb([makeSpace({ id: 'sp1', note: 'old' })])
    const next = setSpaceNote(db, 'sp1', '', 300)
    expect(next.spaces[0]?.note).toBeUndefined()
  })
})

describe('setSpacePinned', () => {
  it('sets pinned true and bumps updatedAt', () => {
    const db = makeDb([makeSpace({ id: 'sp1', updatedAt: 100 })])
    const next = setSpacePinned(db, 'sp1', true, 300)
    expect(next.spaces[0]?.pinned).toBe(true)
    expect(next.spaces[0]?.updatedAt).toBe(300)
  })

  it('removes pinned field when set false', () => {
    const db = makeDb([makeSpace({ id: 'sp1', pinned: true })])
    const next = setSpacePinned(db, 'sp1', false, 300)
    expect(next.spaces[0]?.pinned).toBeUndefined()
  })

  it('returns same ref when no change', () => {
    const db = makeDb([makeSpace({ id: 'sp1', pinned: true })])
    expect(setSpacePinned(db, 'sp1', true, 300)).toBe(db)
  })
})

describe('reorderSpaces', () => {
  it('assigns sortIndex matching given order', () => {
    const db = makeDb([
      makeSpace({ id: 'a', name: 'A' }),
      makeSpace({ id: 'b', name: 'B' }),
      makeSpace({ id: 'c', name: 'C' }),
    ])
    const next = reorderSpaces(db, ['c', 'a', 'b'], 300)
    const byId = new Map(next.spaces.map((s) => [s.id, s.sortIndex]))
    expect(byId.get('c')).toBe(0)
    expect(byId.get('a')).toBe(1)
    expect(byId.get('b')).toBe(2)
  })
})

describe('removeTabsFromSpace', () => {
  it('removes multiple urls in one pass', () => {
    const db = makeDb([
      makeSpace({ id: 'sp', tabs: [t('a'), t('b'), t('c'), t('d')] }),
    ])
    const next = removeTabsFromSpace(db, 'sp', ['a', 'c'], 300)
    expect(next.spaces[0]!.tabs.map((x) => x.url)).toEqual(['b', 'd'])
    expect(next.spaces[0]!.updatedAt).toBe(300)
  })

  it('returns same db on empty list', () => {
    const db = makeDb([makeSpace({ id: 'sp', tabs: [t('a')] })])
    expect(removeTabsFromSpace(db, 'sp', [], 300)).toBe(db)
  })

  it('returns same db when nothing matched', () => {
    const db = makeDb([makeSpace({ id: 'sp', tabs: [t('a')] })])
    expect(removeTabsFromSpace(db, 'sp', ['z'], 300)).toBe(db)
  })
})

describe('moveTabs', () => {
  it('moves multiple urls preserving source order', () => {
    const db = makeDb([
      makeSpace({ id: 'src', tabs: [t('a'), t('b'), t('c')] }),
      makeSpace({ id: 'dst', tabs: [t('x')] }),
    ])
    const next = moveTabs(db, 'src', 'dst', ['c', 'a'], 300)
    expect(next.spaces.find((s) => s.id === 'src')!.tabs.map((x) => x.url)).toEqual(['b'])
    expect(next.spaces.find((s) => s.id === 'dst')!.tabs.map((x) => x.url)).toEqual(['x', 'a', 'c'])
  })

  it('returns same db when fromId === toId', () => {
    const db = makeDb([makeSpace({ id: 'sp', tabs: [t('a')] })])
    expect(moveTabs(db, 'sp', 'sp', ['a'], 300)).toBe(db)
  })
})

describe('reorderTabsInSpace', () => {
  it('reorders tabs by url', () => {
    const db = makeDb([
      makeSpace({ id: 'sp', tabs: [t('a'), t('b'), t('c')] }),
    ])
    const next = reorderTabsInSpace(db, 'sp', ['c', 'a', 'b'], 300)
    expect(next.spaces[0]!.tabs.map((x) => x.url)).toEqual(['c', 'a', 'b'])
    expect(next.spaces[0]!.updatedAt).toBe(300)
  })

  it('keeps tabs not in orderedUrls at the end in original order', () => {
    const db = makeDb([
      makeSpace({ id: 'sp', tabs: [t('a'), t('b'), t('c'), t('d')] }),
    ])
    const next = reorderTabsInSpace(db, 'sp', ['c', 'a'], 300)
    expect(next.spaces[0]!.tabs.map((x) => x.url)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('returns same db when order unchanged', () => {
    const db = makeDb([
      makeSpace({ id: 'sp', tabs: [t('a'), t('b')] }),
    ])
    const next = reorderTabsInSpace(db, 'sp', ['a', 'b'], 300)
    expect(next).toBe(db)
  })

  it('returns same db when space missing', () => {
    const db = makeDb([makeSpace({ id: 'sp', tabs: [t('a')] })])
    expect(reorderTabsInSpace(db, 'missing', ['a'], 300)).toBe(db)
  })
})

describe('sortedForDisplay', () => {
  it('places pinned spaces first', () => {
    const a = makeSpace({ id: 'a', pinned: false, updatedAt: 200 })
    const b = makeSpace({ id: 'b', pinned: true, updatedAt: 100 })
    expect(sortedForDisplay([a, b]).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('within same pinned status, sortIndex wins over updatedAt', () => {
    const a = makeSpace({ id: 'a', sortIndex: 1, updatedAt: 999 })
    const b = makeSpace({ id: 'b', sortIndex: 0, updatedAt: 100 })
    expect(sortedForDisplay([a, b]).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('falls back to updatedAt desc when no sortIndex', () => {
    const a = makeSpace({ id: 'a', updatedAt: 100 })
    const b = makeSpace({ id: 'b', updatedAt: 200 })
    expect(sortedForDisplay([a, b]).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('mixes: pinned > sortIndex > updatedAt', () => {
    const spaces = [
      makeSpace({ id: 'p1', pinned: true, sortIndex: 1 }),
      makeSpace({ id: 'p0', pinned: true, sortIndex: 0 }),
      makeSpace({ id: 'n2', updatedAt: 100 }),
      makeSpace({ id: 'n1', updatedAt: 200 }),
    ]
    expect(sortedForDisplay(spaces).map((s) => s.id)).toEqual(['p0', 'p1', 'n1', 'n2'])
  })
})
