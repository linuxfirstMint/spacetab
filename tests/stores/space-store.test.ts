import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { useSpaceStore } from '@/stores/space-store'

beforeEach(() => {
  // 重置 zustand 内部 state
  useSpaceStore.setState({
    db: { version: 1, spaces: [] },
    loaded: false,
    toasts: [],
  })
})

describe('useSpaceStore.archiveNew', () => {
  it('creates a new space and persists it', async () => {
    const id = await useSpaceStore.getState().archiveNew('Work', [
      { url: 'https://a/', title: 'a' },
    ])
    const db = useSpaceStore.getState().db
    expect(db.spaces).toHaveLength(1)
    expect(db.spaces[0]?.id).toBe(id)

    const stored = await fakeBrowser.storage.local.get('db')
    expect(stored.db).toEqual(db)
  })
})

describe('useSpaceStore.archive', () => {
  it('appends to existing space (dedupe)', async () => {
    const id = await useSpaceStore.getState().archiveNew('Work', [
      { url: 'https://a/', title: 'a' },
    ])
    await useSpaceStore.getState().archive(id!, [
      { url: 'https://a/', title: 'a' },
      { url: 'https://b/', title: 'b' },
    ])
    const sp = useSpaceStore.getState().db.spaces.find((s) => s.id === id)!
    expect(sp.tabs.map((t) => t.url)).toEqual(['https://a/', 'https://b/'])
  })
})

describe('useSpaceStore.rename', () => {
  it('renames a space', async () => {
    const id = await useSpaceStore.getState().archiveNew('Old', [])
    await useSpaceStore.getState().rename(id!, 'New')
    const sp = useSpaceStore.getState().db.spaces.find((s) => s.id === id)!
    expect(sp.name).toBe('New')
  })

  it('toasts when target missing', async () => {
    await useSpaceStore.getState().rename('ghost', 'X')
    expect(useSpaceStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
  })
})

describe('useSpaceStore.setColor', () => {
  it('persists a selected Space color and resets to automatic by removing the override', async () => {
    const id = await useSpaceStore.getState().archiveNew('Colored', [])
    await useSpaceStore.getState().setColor(id!, 'violet')
    expect(useSpaceStore.getState().db.spaces[0]?.color).toBe('violet')
    expect((await fakeBrowser.storage.local.get('db')).db).toEqual(useSpaceStore.getState().db)

    await useSpaceStore.getState().setColor(id!, undefined)
    expect(useSpaceStore.getState().db.spaces[0]).not.toHaveProperty('color')
    expect((await fakeBrowser.storage.local.get('db')).db).toEqual(useSpaceStore.getState().db)
  })
})

describe('useSpaceStore.remove', () => {
  it('deletes a space', async () => {
    const id = await useSpaceStore.getState().archiveNew('X', [])
    await useSpaceStore.getState().remove(id!)
    expect(useSpaceStore.getState().db.spaces).toHaveLength(0)
  })
})

describe('write-failure rollback', () => {
  it('rolls back db when storage.set throws', async () => {
    const before = useSpaceStore.getState().db
    const spy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('quota'))
    await useSpaceStore.getState().archiveNew('Work', [])
    expect(useSpaceStore.getState().db).toEqual(before)
    expect(useSpaceStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
    spy.mockRestore()
  })
})

describe('useSpaceStore.removeTab', () => {
  it('removes the tab and persists', async () => {
    const id = await useSpaceStore.getState().archiveNew('Work', [
      { url: 'https://a/', title: 'a' },
      { url: 'https://b/', title: 'b' },
    ])
    const ok = await useSpaceStore.getState().removeTab(id!, 'https://a/')
    expect(ok).toBe(true)
    const sp = useSpaceStore.getState().db.spaces.find((s) => s.id === id)!
    expect(sp.tabs.map((t) => t.url)).toEqual(['https://b/'])
    const stored = await fakeBrowser.storage.local.get('db')
    expect(stored.db).toEqual(useSpaceStore.getState().db)
  })

  it('returns false (no write) when url does not exist', async () => {
    const id = await useSpaceStore.getState().archiveNew('Work', [
      { url: 'https://a/', title: 'a' },
    ])
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set')
    const ok = await useSpaceStore.getState().removeTab(id!, 'https://nope/')
    expect(ok).toBe(false)
    expect(setSpy).not.toHaveBeenCalled()
    setSpy.mockRestore()
  })
})

describe('useSpaceStore folder actions', () => {
  it('persists folder lifecycle and pinned-tab membership changes', async () => {
    const id = await useSpaceStore.getState().archiveNew('Work', [
      { url: 'https://a/', title: 'a', pinned: true },
      { url: 'https://b/', title: 'b' },
    ])
    const folderId = await useSpaceStore.getState().createFolder(id!, 'Reading')
    expect(folderId).toBeTruthy()
    await useSpaceStore.getState().moveTabToFolder(id!, 'https://a/', folderId!)
    await useSpaceStore.getState().setFolderCollapsed(id!, folderId!, true)
    await useSpaceStore.getState().renameFolder(id!, folderId!, 'Reference')
    let db = useSpaceStore.getState().db
    expect(db.spaces[0]).toMatchObject({
      folders: [{ id: folderId, name: 'Reference', collapsed: true }],
      tabs: [{ url: 'https://a/', pinned: true, folderId }, { url: 'https://b/' }],
    })
    expect((await fakeBrowser.storage.local.get('db')).db).toEqual(db)

    await useSpaceStore.getState().deleteFolder(id!, folderId!)
    db = useSpaceStore.getState().db
    expect(db.spaces[0]?.folders).toEqual([])
    expect(db.spaces[0]?.tabs[0]).toMatchObject({ url: 'https://a/', pinned: true })
    expect(db.spaces[0]?.tabs[0]).not.toHaveProperty('folderId')
    expect((await fakeBrowser.storage.local.get('db')).db).toEqual(db)
  })
})

describe('useSpaceStore.merge', () => {
  it('moves tabs from source into target and removes source space', async () => {
    const id1 = await useSpaceStore.getState().archiveNew('From', [
      { url: 'https://a/', title: 'a' },
      { url: 'https://b/', title: 'b' },
    ])
    const id2 = await useSpaceStore.getState().archiveNew('To', [
      { url: 'https://b/', title: 'b' }, // duplicate — should be deduped
    ])
    const ok = await useSpaceStore.getState().merge(id1!, id2!)
    expect(ok).toBe(true)
    const db = useSpaceStore.getState().db
    // source removed
    expect(db.spaces.find((s) => s.id === id1)).toBeUndefined()
    // target has both tabs, deduplicated
    const to = db.spaces.find((s) => s.id === id2)!
    expect(to.tabs.map((t) => t.url)).toContain('https://a/')
    expect(to.tabs.map((t) => t.url)).toContain('https://b/')
    expect(to.tabs.filter((t) => t.url === 'https://b/')).toHaveLength(1)
    const stored = await fakeBrowser.storage.local.get('db')
    expect(stored.db).toEqual(db)
  })

  it('returns false when fromId === toId', async () => {
    const id = await useSpaceStore.getState().archiveNew('X', [])
    const ok = await useSpaceStore.getState().merge(id!, id!)
    expect(ok).toBe(false)
  })

  it('rolls back on storage write failure', async () => {
    const id1 = await useSpaceStore.getState().archiveNew('From', [
      { url: 'https://x/', title: 'x' },
    ])
    const id2 = await useSpaceStore.getState().archiveNew('To', [])
    const before = useSpaceStore.getState().db
    const spy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('quota'))
    const ok = await useSpaceStore.getState().merge(id1!, id2!)
    expect(ok).toBe(false)
    expect(useSpaceStore.getState().db).toEqual(before)
    expect(useSpaceStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
    spy.mockRestore()
  })
})

describe('useSpaceStore.moveTab', () => {
  it('moves tab between two spaces and persists', async () => {
    const id1 = await useSpaceStore.getState().archiveNew('A', [
      { url: 'https://a/', title: 'a' },
    ])
    const id2 = await useSpaceStore.getState().archiveNew('B', [])
    const ok = await useSpaceStore.getState().moveTab(id1!, id2!, 'https://a/')
    expect(ok).toBe(true)
    const sp1 = useSpaceStore.getState().db.spaces.find((s) => s.id === id1)!
    const sp2 = useSpaceStore.getState().db.spaces.find((s) => s.id === id2)!
    expect(sp1.tabs).toHaveLength(0)
    expect(sp2.tabs.map((t) => t.url)).toEqual(['https://a/'])
    const stored = await fakeBrowser.storage.local.get('db')
    expect(stored.db).toEqual(useSpaceStore.getState().db)
  })

  it('rolls back on storage write failure', async () => {
    const id1 = await useSpaceStore.getState().archiveNew('A', [
      { url: 'https://a/', title: 'a' },
    ])
    const id2 = await useSpaceStore.getState().archiveNew('B', [])
    const before = useSpaceStore.getState().db
    const spy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('quota'))
    const ok = await useSpaceStore.getState().moveTab(id1!, id2!, 'https://a/')
    expect(ok).toBe(false)
    expect(useSpaceStore.getState().db).toEqual(before)
    expect(useSpaceStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
    spy.mockRestore()
  })
})
