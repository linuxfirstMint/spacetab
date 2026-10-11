import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { readAutoArchiveSettings, restoreAutoArchivedTab, runAutoArchiveSweep } from '@/lib/auto-archive'

const now = 2_000_000_000_000
const old = now - 13 * 60 * 60 * 1000
let windowId: number

beforeEach(async () => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => Promise<unknown>) => run() } })
  const win = await fakeBrowser.windows.create({ focused: true })
  windowId = win.id!
})

async function seedDb(): Promise<void> {
  await fakeBrowser.storage.local.set({
    db: { version: 1, spaces: [{ id: 'source', name: 'Source', tabs: [], createdAt: 1, updatedAt: 1 }] },
  })
  await fakeBrowser.storage.session.set({ vaultWindowId: null, spaceIdToTabIds: {}, windowIdToSpaceId: { [String(windowId)]: 'source' } })
}

describe('automatic tab archive', () => {
  it('defaults to disabled and leaves an expired tab untouched', async () => {
    const tab = await fakeBrowser.tabs.create({ windowId, url: 'https://old.example/', active: false })
    await fakeBrowser.storage.local.set({ autoArchiveLastUsed: { [String(tab.id)]: old } })
    expect(await readAutoArchiveSettings()).toEqual({ enabled: false, inactivityHours: 12 })
    expect(await runAutoArchiveSweep(now)).toBe(0)
    await expect(fakeBrowser.tabs.get(tab.id!)).resolves.toBeTruthy()
  })

  it('persists an expired tab to its source Space before closing and keeps a restore record', async () => {
    await seedDb()
    const tab = await fakeBrowser.tabs.create({ windowId, url: 'https://old.example/', active: false })
    await fakeBrowser.storage.local.set({
      autoArchiveSettings: { enabled: true, inactivityHours: 12 },
      autoArchiveLastUsed: { [String(tab.id)]: old },
    })
    expect(await runAutoArchiveSweep(now)).toBe(1)
    await expect(fakeBrowser.tabs.get(tab.id!)).resolves.toBeUndefined()
    const stored = await fakeBrowser.storage.local.get(['db', 'autoArchivedTabs'])
    expect(stored.db.spaces[0].tabs).toMatchObject([{ url: 'https://old.example/' }])
    expect(stored.autoArchivedTabs).toMatchObject([{ url: 'https://old.example/', sourceSpaceId: 'source' }])
    const [record] = stored.autoArchivedTabs
    expect(await restoreAutoArchivedTab(record.id, windowId)).toBe(true)
    expect((await fakeBrowser.storage.local.get('autoArchivedTabs')).autoArchivedTabs).toEqual([])
  })

  it('does not close the live tab when archive-record persistence fails', async () => {
    await seedDb()
    const tab = await fakeBrowser.tabs.create({ windowId, url: 'https://old.example/', active: false })
    await fakeBrowser.storage.local.set({
      autoArchiveSettings: { enabled: true, inactivityHours: 12 },
      autoArchiveLastUsed: { [String(tab.id)]: old },
    })
    const originalSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local)
    const set = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      if ('autoArchivedTabs' in (items as Record<string, unknown>)) throw new Error('storage unavailable')
      return await originalSet(items)
    })
    expect(await runAutoArchiveSweep(now)).toBe(0)
    await expect(fakeBrowser.tabs.get(tab.id!)).resolves.toBeTruthy()
    set.mockRestore()
  })

  it('leaves every live tab open when prior archive history cannot be read', async () => {
    await seedDb()
    const tab = await fakeBrowser.tabs.create({ windowId, url: 'https://old.example/', active: false })
    await fakeBrowser.storage.local.set({
      autoArchiveSettings: { enabled: true, inactivityHours: 12 },
      autoArchiveLastUsed: { [String(tab.id)]: old },
    })
    const originalGet = fakeBrowser.storage.local.get.bind(fakeBrowser.storage.local)
    const get = vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(async (keys: unknown) => {
      if (keys === 'autoArchivedTabs') throw new Error('storage unavailable')
      return await (originalGet as (key: unknown) => Promise<Record<string, unknown>>)(keys)
    })
    expect(await runAutoArchiveSweep(now)).toBe(0)
    await expect(fakeBrowser.tabs.get(tab.id!)).resolves.toBeTruthy()
    get.mockRestore()
  })

  it('excludes Favorite URLs, Space-pinned and folder tabs, and native pinned tabs', async () => {
    await fakeBrowser.storage.local.set({
      db: { version: 1, spaces: [{ id: 'source', name: 'Source', tabs: [
        { url: 'https://space-pinned.example/', title: 'Pinned', pinned: true },
        { url: 'https://folder.example/', title: 'Folder', pinned: true, folderId: 'folder' },
      ], folders: [{ id: 'folder', name: 'Keep' }], createdAt: 1, updatedAt: 1 }] },
      favorites: [{ url: 'https://favorite.example/', title: 'Favorite' }],
      autoArchiveSettings: { enabled: true, inactivityHours: 12 },
    })
    await fakeBrowser.storage.session.set({ vaultWindowId: null, spaceIdToTabIds: {}, windowIdToSpaceId: { [String(windowId)]: 'source' } })
    const urls = ['https://favorite.example/', 'https://space-pinned.example/', 'https://folder.example/', 'https://native-pinned.example/']
    const tabs = []
    for (const url of urls) tabs.push(await fakeBrowser.tabs.create({ windowId, url, active: false, pinned: url.includes('native-pinned') }))
    await fakeBrowser.storage.local.set({ autoArchiveLastUsed: Object.fromEntries(tabs.map(tab => [String(tab.id), old])) })
    expect(await runAutoArchiveSweep(now)).toBe(0)
    for (const tab of tabs) await expect(fakeBrowser.tabs.get(tab.id!)).resolves.toBeTruthy()
  })

  it('restores safely to a normal window when the original Space was deleted', async () => {
    await fakeBrowser.storage.local.set({ autoArchivedTabs: [{
      id: 'orphaned', url: 'https://orphaned.example/', title: 'Orphaned', sourceSpaceId: 'deleted-space', archivedAt: now,
    }] })
    expect(await restoreAutoArchivedTab('orphaned', windowId)).toBe(true)
    const restored = (await fakeBrowser.tabs.query({ windowId })).find((tab: chrome.tabs.Tab) => tab.url === 'https://orphaned.example/')
    expect(restored).toBeTruthy()
    expect((await fakeBrowser.storage.local.get('autoArchivedTabs')).autoArchivedTabs).toEqual([])
  })
})
