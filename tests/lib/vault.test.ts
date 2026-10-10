import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import {
  ensureVaultWindow,
  archiveCurrentWindowToSpace,
  switchToSpace,
  purgeVaultedTabsForSpace,
  onTabRemovedHandler,
  onWindowRemovedHandler,
  moveLiveTabToSpace,
  mergeSessionTags,
  restoreLastActiveSpaceOnStartup,
} from '@/lib/vault'
import { DatabaseSchema } from '@/lib/schema'
import { readSessionState } from '@/lib/session-state'

const FOCUSED_WIN = 1

// ---------------------------------------------------------------------------
// tabs.move stub — fakeBrowser doesn't implement chrome.tabs.move,
// so we simulate it using chrome.tabs.update (which does support windowId changes)
// ---------------------------------------------------------------------------
async function stubTabsMove(
  tabIds: number | number[],
  moveProps: { windowId: number; index: number },
): Promise<chrome.tabs.Tab | chrome.tabs.Tab[]> {
  const ids = Array.isArray(tabIds) ? tabIds : [tabIds]
  const results: chrome.tabs.Tab[] = []
  for (const id of ids) {
    try {
      const tab = await fakeBrowser.tabs.update(id, { windowId: moveProps.windowId })
      if (tab) results.push(tab)
    } catch {
      // ignore tabs that don't exist
    }
  }
  return Array.isArray(tabIds) ? results : (results[0] ?? ({} as chrome.tabs.Tab))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function seedFocusedWindow(
  tabs: Array<{ url?: string; pinned?: boolean }>,
): Promise<void> {
  for (const t of tabs) {
    await fakeBrowser.tabs.create({
      windowId: FOCUSED_WIN,
      url: t.url ?? 'https://example.com/',
      pinned: t.pinned ?? false,
    } as chrome.tabs.CreateProperties)
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => Promise<unknown>) => run() } })
  // 每次测试前创建一个 focused 窗口
  await fakeBrowser.windows.create({ focused: true })
  // 让 getURL 返回本扩展 origin,使自排除逻辑生效
  vi.spyOn(chrome.runtime, 'getURL').mockImplementation((path = '') => `chrome-extension://test-id/${path}`)
  // Stub chrome.tabs.move since fakeBrowser doesn't implement it
  vi.spyOn(chrome.tabs, 'move').mockImplementation(stubTabsMove as typeof chrome.tabs.move)
})

// ---------------------------------------------------------------------------
// ensureVaultWindow
// ---------------------------------------------------------------------------
describe('ensureVaultWindow', () => {
  it('creates a new vault window when none exists', async () => {
    const id = await ensureVaultWindow()
    expect(typeof id).toBe('number')
    const state = await readSessionState()
    expect(state.vaultWindowId).toBe(id)
  })

  it('returns the existing vault window id on repeated calls', async () => {
    const id1 = await ensureVaultWindow()
    const id2 = await ensureVaultWindow()
    expect(id1).toBe(id2)
  })

  it('creates a new vault window if the stored id no longer exists', async () => {
    const id1 = await ensureVaultWindow()
    // Simulate the vault window being closed externally
    await fakeBrowser.windows.remove(id1)
    const id2 = await ensureVaultWindow()
    expect(typeof id2).toBe('number')
    // The old window is gone so a new one must be created (different id or same recycled — just verify it's valid)
    const state = await readSessionState()
    expect(state.vaultWindowId).toBe(id2)
  })

  it('reuses a Chrome-restored marker window when session window IDs were lost', async () => {
    const restored = await fakeBrowser.windows.create({ focused: false })
    await fakeBrowser.tabs.create({
      windowId: restored.id,
      url: 'chrome-extension://test-id/vault-marker.html',
      pinned: true,
    } as chrome.tabs.CreateProperties)
    const vaultId = await ensureVaultWindow()

    expect(vaultId).toBe(restored.id)
    expect((await readSessionState()).vaultWindowId).toBe(restored.id)
  })

  it('reuses a restored marker window while its URL is still pending', async () => {
    const restored = await fakeBrowser.windows.create({ focused: false })
    const marker = await fakeBrowser.tabs.create({
      windowId: restored.id,
      url: 'chrome-extension://test-id/vault-marker.html',
      pinned: true,
    } as chrome.tabs.CreateProperties)
    vi.spyOn(chrome.tabs, 'query').mockImplementationOnce(async () => [{
      ...marker,
      url: undefined,
      pendingUrl: 'chrome-extension://test-id/vault-marker.html',
    } as chrome.tabs.Tab])

    const vaultId = await ensureVaultWindow()

    expect(vaultId).toBe(restored.id)
    expect((await readSessionState()).vaultWindowId).toBe(restored.id)
  })
})

// ---------------------------------------------------------------------------
// archiveCurrentWindowToSpace
// ---------------------------------------------------------------------------
describe('archiveCurrentWindowToSpace', () => {
  it('returns archived snapshot and keeps the tabs in the focused window', async () => {
    await seedFocusedWindow([
      { url: 'https://a.com/' },
      { url: 'https://b.com/' },
    ])

    const { archived, closedNonRestorable } = await archiveCurrentWindowToSpace('space-1')

    expect(archived).toHaveLength(2)
    expect(archived.map((t) => t.url).sort()).toEqual(['https://a.com/', 'https://b.com/'])
    expect(closedNonRestorable).toBe(0)

    // 标签仍留在焦点窗口(归档不再搬走)
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const focusedUrls = focusedTabs.map((t: chrome.tabs.Tab) => t.url)
    expect(focusedUrls).toContain('https://a.com/')
    expect(focusedUrls).toContain('https://b.com/')
  })

  it('tags archived tab IDs under the spaceId in session state', async () => {
    await seedFocusedWindow([{ url: 'https://tagged.com/' }])

    await archiveCurrentWindowToSpace('space-x')

    const state = await readSessionState()
    expect(state.spaceIdToTabIds['space-x']).toBeDefined()
    expect(state.spaceIdToTabIds['space-x']!.length).toBeGreaterThan(0)
  })

  it('skips chrome:// tabs without closing them', async () => {
    await seedFocusedWindow([
      { url: 'https://good.com/' },
      { url: 'chrome://settings/' },
    ])

    const { archived, closedNonRestorable } = await archiveCurrentWindowToSpace('space-2')

    expect(archived.map((t) => t.url)).toEqual(['https://good.com/'])
    expect(closedNonRestorable).toBe(0)

    // chrome:// 标签仍在原处(不归档但也不关)
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const focusedUrls = focusedTabs.map((t: chrome.tabs.Tab) => t.url)
    expect(focusedUrls).toContain('chrome://settings/')
  })

  it('skips the manager (self-extension) tab', async () => {
    await seedFocusedWindow([
      { url: 'https://user.com/' },
      { url: 'chrome-extension://test-id/manager.html' },
    ])

    const { archived } = await archiveCurrentWindowToSpace('space-3')

    expect(archived.map((t) => t.url)).toEqual(['https://user.com/'])
  })

  it('skips pinned tabs', async () => {
    await seedFocusedWindow([
      { url: 'https://normal.com/' },
      { url: 'https://pinned.com/', pinned: true },
    ])

    const { archived } = await archiveCurrentWindowToSpace('space-4')

    expect(archived.map((t) => t.url)).toEqual(['https://normal.com/'])
  })
})

// ---------------------------------------------------------------------------
// switchToSpace
// ---------------------------------------------------------------------------
describe('switchToSpace', () => {
  it('persists the last manually selected Space for the next browser startup', async () => {
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [], createdAt: 1, updatedAt: 1 }] },
    })
    await seedFocusedWindow([{ url: 'chrome-extension://test-id/vault-marker.html', pinned: true }])

    await switchToSpace('alpha', [{ url: 'https://alpha.example/', title: 'Alpha' }])

    expect((await chrome.storage.local.get('lastActiveSpaceId')).lastActiveSpaceId).toBe('alpha')
  })

  it('restores the last Space on startup without filing its matching restored tab as Saved tabs', async () => {
    const spaceTabs = [
      { url: 'https://www.google.com/?hl=ja', title: 'Google' },
      { url: 'https://alpha.example/', title: 'Alpha' },
    ]
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: spaceTabs, createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })
    await seedFocusedWindow([{ url: 'https://www.google.com/?hl=ja' }])

    const restored = await restoreLastActiveSpaceOnStartup()

    expect(restored).toBe(true)
    expect((await readSessionState()).currentSpaceId).toBe('alpha')
    expect((await chrome.tabs.query({ windowId: FOCUSED_WIN })).map(t => t.url)).toEqual(
      expect.arrayContaining(['https://www.google.com/?hl=ja', 'https://alpha.example/']),
    )
    const { db } = await import('@/lib/storage').then(m => m.readDatabase())
    expect(db.spaces.map(s => s.name)).toEqual(['Alpha'])
  })

  it('matches restored tabs by pendingUrl before the navigation commits', async () => {
    const savedUrl = 'https://alpha.example/'
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [{ url: savedUrl, title: 'Alpha' }], createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })
    await seedFocusedWindow([
      { url: savedUrl },
      { url: 'https://pinned-anchor.example/', pinned: true },
    ])
    const originalTab = (await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })).find((tab: chrome.tabs.Tab) => tab.url === savedUrl)!
    const queriedTabs = await chrome.tabs.query({})
    const pendingTabs = queriedTabs.map(tab => ({
      ...tab,
      url: undefined,
      pendingUrl: tab.url ?? tab.pendingUrl,
    }))
    const querySpy = vi.spyOn(chrome.tabs, 'query').mockImplementation(async (queryInfo: chrome.tabs.QueryInfo) => pendingTabs.filter((tab: chrome.tabs.Tab) =>
      (queryInfo.windowId === undefined || tab.windowId === queryInfo.windowId) &&
      (queryInfo.pinned === undefined || tab.pinned === queryInfo.pinned),
    ))
    const getSpy = vi.spyOn(chrome.tabs, 'get').mockImplementation(async (tabId: number) => {
      const tab = pendingTabs.find(candidate => candidate.id === tabId)
      if (!tab) throw new Error(`No tab with id ${tabId}`)
      return tab
    })
    let restored: boolean
    try {
      restored = await restoreLastActiveSpaceOnStartup()
    } finally {
      querySpy.mockRestore()
      getSpy.mockRestore()
    }

    expect(restored).toBe(true)
    expect((await readSessionState()).currentSpaceId).toBe('alpha')
    expect((await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })).filter((tab: chrome.tabs.Tab) => tab.url === savedUrl).map((tab: chrome.tabs.Tab) => tab.id)).toContain(originalTab.id)
    const { db } = await import('@/lib/storage').then(m => m.readDatabase())
    expect(db.spaces.map(space => space.name)).toEqual(['Alpha'])
  })

  it('waits briefly for a normal window created just after startup begins', async () => {
    const savedUrl = 'https://alpha.example/'
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [{ url: savedUrl, title: 'Alpha' }], createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })
    await fakeBrowser.tabs.create({
      windowId: FOCUSED_WIN,
      url: 'chrome-extension://test-id/vault-marker.html',
      pinned: true,
    } as chrome.tabs.CreateProperties)
    await chrome.storage.session.set({ vaultWindowId: FOCUSED_WIN })

    const restorePromise = restoreLastActiveSpaceOnStartup()
    await new Promise(resolve => setTimeout(resolve, 20))
    const window = await fakeBrowser.windows.create({ focused: true })

    expect(await restorePromise).toBe(true)
    expect((await readSessionState()).currentSpaceId).toBe('alpha')
    expect(typeof window.id).toBe('number')
  })

  it('creates a normal window when startup restores only the Vault marker window', async () => {
    const savedUrl = 'https://alpha.example/'
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [{ url: savedUrl, title: 'Alpha' }], createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })
    await fakeBrowser.tabs.create({
      windowId: FOCUSED_WIN,
      url: 'chrome-extension://test-id/vault-marker.html',
      pinned: true,
    } as chrome.tabs.CreateProperties)
    await chrome.storage.session.set({ vaultWindowId: FOCUSED_WIN })
    vi.spyOn(chrome.windows, 'getAll').mockImplementationOnce((() => Promise.resolve([])) as never)
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6_000)

    const createWindow = vi.spyOn(chrome.windows, 'create')
    const diagnostics: Array<{ phase: string }> = []
    expect(await restoreLastActiveSpaceOnStartup(entry => { diagnostics.push(entry) })).toBe(true)

    const state = await readSessionState()
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'normal',
      url: 'chrome-extension://test-id/manager.html',
    }))
    expect(diagnostics.map(entry => entry.phase)).toEqual(expect.arrayContaining([
      'restore-started',
      'waiting-for-normal-window',
      'creating-normal-window',
      'created-normal-window',
      'switch-started',
      'switch-finished',
    ]))
    expect(state.currentSpaceId).toBe('alpha')
    vi.restoreAllMocks()
  })

  it('matches duplicate URLs one-to-one and preserves extra same-URL tabs as unregistered', async () => {
    const sameUrl = 'https://same.example/'
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [{ url: sameUrl, title: 'Saved' }], createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })
    await seedFocusedWindow([
      { url: sameUrl },
      { url: sameUrl },
      // A pinned utility tab prevents the fake-browser's known anchor-tab removal limitation.
      { url: 'https://pinned-anchor.example/', pinned: true },
    ])

    await restoreLastActiveSpaceOnStartup()

    const allTabs = await chrome.tabs.query({})
    expect(allTabs.filter(t => t.url === sameUrl)).toHaveLength(2)
    const { db } = await import('@/lib/storage').then(m => m.readDatabase())
    const recovery = db.spaces.find(s => s.name.startsWith('Saved tabs '))
    expect(recovery?.tabs.filter(t => t.url === sameUrl)).toHaveLength(1)
  })

  it('keeps unrelated user tabs when restoring the saved Space', async () => {
    const savedUrl = 'https://www.google.com/?hl=ja'
    const userUrl = 'https://unregistered.example/'
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{
        id: 'alpha', name: 'Alpha', tabs: [
          { url: savedUrl, title: 'Google' },
          { url: 'https://alpha.example/', title: 'Alpha' },
        ], createdAt: 1, updatedAt: 1,
      }] },
      lastActiveSpaceId: 'alpha',
    })
    await seedFocusedWindow([
      { url: savedUrl },
      { url: userUrl },
      { url: 'https://pinned-anchor.example/', pinned: true },
    ])

    await restoreLastActiveSpaceOnStartup()

    expect((await chrome.tabs.query({})).some(tab => tab.url === userUrl)).toBe(true)
    const { db } = await import('@/lib/storage').then(m => m.readDatabase())
    expect(db.spaces.find(space => space.name.startsWith('Saved tabs '))?.tabs.map(tab => tab.url)).toContain(userUrl)
  })

  it('restores missing duplicate URL occurrences without collapsing saved tabs', async () => {
    const sameUrl = 'https://same-saved.example/'
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{
        id: 'alpha', name: 'Alpha', tabs: [
          { url: sameUrl, title: 'First' },
          { url: sameUrl, title: 'Second' },
        ], createdAt: 1, updatedAt: 1,
      }] },
      lastActiveSpaceId: 'alpha',
    })
    await seedFocusedWindow([
      { url: sameUrl },
      { url: 'https://pinned-anchor.example/', pinned: true },
    ])

    await restoreLastActiveSpaceOnStartup()

    expect((await chrome.tabs.query({ windowId: FOCUSED_WIN })).filter(tab => tab.url === sameUrl)).toHaveLength(2)
  })

  it('does not duplicate tabs when startup restoration races with itself', async () => {
    let tail = Promise.resolve()
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, run: () => Promise<unknown>) => {
          const previous = tail
          let release!: () => void
          tail = new Promise<void>(resolve => { release = resolve })
          await previous
          try { return await run() } finally { release() }
        },
      },
    })
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [{ url: 'https://alpha.example/', title: 'Alpha' }], createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })

    await Promise.all([restoreLastActiveSpaceOnStartup(), restoreLastActiveSpaceOnStartup()])

    expect((await chrome.tabs.query({})).filter(t => t.url === 'https://alpha.example/')).toHaveLength(1)
  })

  it('keeps a manual Space selection that acquired the switch lock before startup restore', async () => {
    let tail = Promise.resolve()
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, run: () => Promise<unknown>) => {
          const previous = tail
          let release!: () => void
          tail = new Promise<void>(resolve => { release = resolve })
          await previous
          try { return await run() } finally { release() }
        },
      },
    })
    await chrome.storage.local.set({
      db: { version: 1, spaces: [
        { id: 'alpha', name: 'Alpha', tabs: [{ url: 'https://alpha.example/', title: 'Alpha' }], createdAt: 1, updatedAt: 1 },
        { id: 'beta', name: 'Beta', tabs: [{ url: 'https://beta.example/', title: 'Beta' }], createdAt: 2, updatedAt: 2 },
      ] },
      lastActiveSpaceId: 'alpha',
    })

    await Promise.all([
      switchToSpace('beta', [{ url: 'https://beta.example/', title: 'Beta' }]),
      restoreLastActiveSpaceOnStartup(),
    ])

    expect((await readSessionState()).currentSpaceId).toBe('beta')
    expect((await chrome.storage.local.get('lastActiveSpaceId')).lastActiveSpaceId).toBe('beta')
    expect((await chrome.tabs.query({})).filter(tab => tab.url === 'https://beta.example/')).toHaveLength(1)
    expect((await chrome.tabs.query({})).some(tab => tab.url === 'https://alpha.example/')).toBe(false)
  })

  it('skips restoration without changing session or opening tabs when the saved Space was deleted', async () => {
    await chrome.storage.local.set({
      db: { version: 1, spaces: [] },
      lastActiveSpaceId: 'deleted-space',
    })
    await seedFocusedWindow([{ url: 'https://ambient.example/' }])
    const diagnostics: Array<{ phase: string }> = []

    expect(await restoreLastActiveSpaceOnStartup(entry => { diagnostics.push(entry) })).toBe(false)

    expect((await readSessionState()).currentSpaceId).toBeNull()
    expect((await chrome.storage.local.get('lastActiveSpaceId')).lastActiveSpaceId).toBe('deleted-space')
    expect((await chrome.tabs.query({})).some(tab => tab.url === 'https://ambient.example/')).toBe(true)
    expect(diagnostics.map(entry => entry.phase)).toContain('skipped-space-not-found')
  })

  it('restores into only the focused normal window and leaves other windows alone', async () => {
    const otherWindow = await fakeBrowser.windows.create({ focused: false })
    await fakeBrowser.tabs.create({ windowId: otherWindow.id, url: 'https://other-window.example/' } as chrome.tabs.CreateProperties)
    await chrome.storage.local.set({
      db: { version: 1, spaces: [{ id: 'alpha', name: 'Alpha', tabs: [{ url: 'https://alpha.example/', title: 'Alpha' }], createdAt: 1, updatedAt: 1 }] },
      lastActiveSpaceId: 'alpha',
    })

    await restoreLastActiveSpaceOnStartup()

    expect((await chrome.tabs.query({ windowId: FOCUSED_WIN })).some(tab => tab.url === 'https://alpha.example/')).toBe(true)
    expect((await chrome.tabs.query({ windowId: otherWindow.id })).map(tab => tab.url)).toContain('https://other-window.example/')
  })

  it('keeps unregistered pages alive if saving their recovery space fails', async () => {
    await seedFocusedWindow([{ url: 'https://unsaved.com/' }])
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('disk full'))
    await expect(switchToSpace('other', [])).rejects.toThrow('Cannot safely save')
    expect((await chrome.tabs.query({ windowId: FOCUSED_WIN })).some(t => t.url === 'https://unsaved.com/')).toBe(true)
  })
  it('does not move or reopen pages when switching to the current space', async () => {
    await seedFocusedWindow([{ url: 'https://current.com/' }])
    await chrome.storage.session.set({ currentSpaceId: 'current' })
    const move = vi.spyOn(chrome.tabs, 'move')
    await switchToSpace('current', [])
    expect(move).not.toHaveBeenCalled()
    expect((await chrome.tabs.query({ windowId: FOCUSED_WIN })).some(t => t.url === 'https://current.com/')).toBe(true)
  })
  it('restores every occurrence of a duplicate URL instead of collapsing the tabs', async () => {
    const sameUrl = 'https://duplicate.example/'
    await seedFocusedWindow([{ url: 'chrome-extension://test-id/vault-marker.html', pinned: true }])

    await switchToSpace('duplicate-space', [
      { url: sameUrl, title: 'First duplicate' },
      { url: sameUrl, title: 'Second duplicate' },
    ])

    expect((await chrome.tabs.query({ windowId: FOCUSED_WIN })).filter(tab => tab.url === sameUrl)).toHaveLength(2)
  })
  it('preserves ambient tabs in a saved recovery space when switching', async () => {
    await seedFocusedWindow([{ url: 'https://ambient.com/' }])

    await switchToSpace('space-new', [])

    const remaining = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const urls = remaining.map((t: chrome.tabs.Tab) => t.url)
    expect(urls).not.toContain('https://ambient.com/')
    const all = await chrome.tabs.query({})
    expect(all.some(t => t.url === 'https://ambient.com/')).toBe(true)
    const saved = await chrome.storage.local.get('db')
    expect(DatabaseSchema.parse(saved.db).spaces.some((s: { tabs: { url: string }[] }) => s.tabs.some(t => t.url === 'https://ambient.com/'))).toBe(true)
  })

  it('reuses the original tab when switching Alpha → Beta → Alpha and creating the vault', async () => {
    await seedFocusedWindow([
      { url: 'https://alpha.com/' },
      { url: 'https://anchor.com/', pinned: true },
    ])
    const [originalAlphaTab] = (await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN }))
      .filter((t: chrome.tabs.Tab) => t.url === 'https://alpha.com/')
    expect(originalAlphaTab?.id).toBeDefined()
    await archiveCurrentWindowToSpace('space-alpha')

    await switchToSpace('space-beta', [{ url: 'https://beta.com/', title: 'Beta' }])
    const stateWhileOnBeta = await readSessionState()
    expect(stateWhileOnBeta.spaceIdToTabIds['space-alpha']).toContain(originalAlphaTab!.id)

    await switchToSpace('space-alpha', [{ url: 'https://alpha.com/', title: 'Alpha' }])

    const alphaTabs = (await fakeBrowser.tabs.query({})).filter((t: chrome.tabs.Tab) => t.url === 'https://alpha.com/')
    expect(alphaTabs).toHaveLength(1)
    expect(alphaTabs[0]?.id).toBe(originalAlphaTab!.id)
  })

  it('creates tabs for URLs in the target space that have no live vault tab', async () => {
    // Start with empty focused window
    const spaceTabs = [
      { url: 'https://restored1.com/', title: 'r1' },
      { url: 'https://restored2.com/', title: 'r2' },
    ]

    await switchToSpace('space-restore', spaceTabs)

    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const urls = focusedTabs.map((t: chrome.tabs.Tab) => t.url)
    expect(urls).toContain('https://restored1.com/')
    expect(urls).toContain('https://restored2.com/')
  })

  it('newly created tabs are tagged in session state for the target space', async () => {
    const spaceTabs = [{ url: 'https://newtag.com/', title: 'n' }]

    await switchToSpace('space-tag', spaceTabs)

    const state = await readSessionState()
    expect(state.spaceIdToTabIds['space-tag']).toBeDefined()
    expect(state.spaceIdToTabIds['space-tag']!.length).toBeGreaterThan(0)
  })

  it('moves vaulted tabs of the target space back into the focused window', async () => {
    // 先归档(只打标,标签仍在焦点窗口);再切到别的空间(把 tagged 标签搬入 vault)
    await seedFocusedWindow([{ url: 'https://space-a.com/' }])
    await archiveCurrentWindowToSpace('space-A')
    await switchToSpace('space-other', [])

    // 此时 space-A 的标签已经在 vault 里
    const stateAfterAway = await readSessionState()
    const vaultId = stateAfterAway.vaultWindowId!
    const tabsInVault = await fakeBrowser.tabs.query({ windowId: vaultId })
    const vaultUrls = tabsInVault.map((t: chrome.tabs.Tab) => t.url)
    expect(vaultUrls).toContain('https://space-a.com/')

    // 切到 space-A — vault 里的标签搬回焦点窗口
    await switchToSpace('space-A', [{ url: 'https://space-a.com/', title: 'a' }])

    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const urls = focusedTabs.map((t: chrome.tabs.Tab) => t.url)
    expect(urls).toContain('https://space-a.com/')
  })

  it('drops orphan vaulted tabs whose URLs are no longer in the target space', async () => {
    // 模拟用户场景:在 manager 把 t2 从 A 移到 B,但 session state 里 A 还挂着 t2 的 tabId。
    // 切回 A 时,孤儿应该被关掉 + 解绑,而不是搬回焦点窗口。
    await seedFocusedWindow([
      { url: 'https://kept.com/' },
      { url: 'https://moved-away.com/' },
    ])
    await archiveCurrentWindowToSpace('space-A')
    await switchToSpace('space-other', [])

    // 此时 space-A 在 session state 里仍挂着两条 tabId,vault 里也有这俩标签
    // 但用户已经在 manager 里把 'moved-away' 移走 → 调用方传的 toSpaceTabs 只剩 'kept'
    await switchToSpace('space-A', [{ url: 'https://kept.com/', title: 'kept' }])

    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const urls = focusedTabs.map((t: chrome.tabs.Tab) => t.url)
    expect(urls).toContain('https://kept.com/')
    expect(urls).not.toContain('https://moved-away.com/')

    // session state 中不应再挂着孤儿 tabId
    const finalState = await readSessionState()
    const finalIds = finalState.spaceIdToTabIds['space-A'] ?? []
    // 现在只有 'kept' 那条 tabId 还属于 A
    expect(finalIds.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// purgeVaultedTabsForSpace
// ---------------------------------------------------------------------------
describe('purgeVaultedTabsForSpace (releaseSpaceTabs)', () => {
  it('drops the session entry for the space', async () => {
    await seedFocusedWindow([{ url: 'https://to-release.com/' }])
    await archiveCurrentWindowToSpace('space-release')

    const stateBefore = await readSessionState()
    expect(stateBefore.spaceIdToTabIds['space-release']).toBeDefined()

    await purgeVaultedTabsForSpace('space-release')

    const stateAfter = await readSessionState()
    expect(stateAfter.spaceIdToTabIds['space-release']).toBeUndefined()
  })

  it('does NOT close the tabs — they remain alive (orphaned)', async () => {
    await seedFocusedWindow([{ url: 'https://stay-alive.com/' }])
    await archiveCurrentWindowToSpace('space-x')

    const focusedBefore = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const target = focusedBefore.find((t: chrome.tabs.Tab) => t.url === 'https://stay-alive.com/')!
    const tabId = target.id!

    await purgeVaultedTabsForSpace('space-x')

    // 标签仍然存在(没被关掉)
    const stillThere = await fakeBrowser.tabs.get(tabId)
    expect(stillThere.url).toBe('https://stay-alive.com/')
  })

  it('is a no-op when the spaceId has no session entry', async () => {
    await purgeVaultedTabsForSpace('nonexistent-space')
    const state = await readSessionState()
    expect(state.spaceIdToTabIds['nonexistent-space']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// moveLiveTabToSpace
// ---------------------------------------------------------------------------
describe('moveLiveTabToSpace', () => {
  it('moves an ambient (untagged) tab to a space — returns tab payload with fromSpaceId null', async () => {
    await seedFocusedWindow([{ url: 'https://ambient.com/' }])
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find((t: chrome.tabs.Tab) => t.url === 'https://ambient.com/')!.id!

    const { tab, fromSpaceId } = await moveLiveTabToSpace(tabId, 'space-X')

    expect(tab).not.toBeNull()
    expect(tab!.url).toBe('https://ambient.com/')
    expect(fromSpaceId).toBeNull()

    const state = await readSessionState()
    expect(state.spaceIdToTabIds['space-X']).toContain(tabId)
  })

  it('keeps the tab in the focused window after tagging — does NOT move to vault', async () => {
    await seedFocusedWindow([{ url: 'https://stay.com/' }])
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find((t: chrome.tabs.Tab) => t.url === 'https://stay.com/')!.id!

    await moveLiveTabToSpace(tabId, 'space-X')

    // 标签仍在焦点窗口,没被移走
    const after = await fakeBrowser.tabs.get(tabId)
    expect(after.windowId).toBe(FOCUSED_WIN)
  })

  it('adds the tab to the target space without removing it from the source', async () => {
    await seedFocusedWindow([{ url: 'https://shared.com/' }])
    await archiveCurrentWindowToSpace('space-A')

    // 归档后标签仍在焦点窗口(新语义)
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find((t: chrome.tabs.Tab) => t.url === 'https://shared.com/')!.id!

    const { tab, fromSpaceId } = await moveLiveTabToSpace(tabId, 'space-B')

    expect(tab).not.toBeNull()
    expect(fromSpaceId).toBeNull() // API 返回的 fromSpaceId 总是 null,因为不再"搬"

    const state = await readSessionState()
    // A 仍然包含这个 tabId(没有被移除)
    expect(state.spaceIdToTabIds['space-A']).toContain(tabId)
    // B 也包含
    expect(state.spaceIdToTabIds['space-B']).toContain(tabId)
  })

  it('rejects a pinned tab — returns null tab and null fromSpaceId, state unchanged', async () => {
    await seedFocusedWindow([{ url: 'https://pinned.com/', pinned: true }])
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find((t: chrome.tabs.Tab) => t.url === 'https://pinned.com/')!.id!

    const stateBefore = await readSessionState()
    const { tab, fromSpaceId } = await moveLiveTabToSpace(tabId, 'space-X')

    expect(tab).toBeNull()
    expect(fromSpaceId).toBeNull()
    const stateAfter = await readSessionState()
    expect(stateAfter).toEqual(stateBefore)
  })

  it('rejects a non-restorable URL (chrome://) — returns null tab, state unchanged', async () => {
    await seedFocusedWindow([{ url: 'chrome://settings/' }])
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find((t: chrome.tabs.Tab) => t.url === 'chrome://settings/')!.id!

    const stateBefore = await readSessionState()
    const { tab, fromSpaceId } = await moveLiveTabToSpace(tabId, 'space-X')

    expect(tab).toBeNull()
    expect(fromSpaceId).toBeNull()
    const stateAfter = await readSessionState()
    expect(stateAfter).toEqual(stateBefore)
  })

  it('rejects a self-extension URL — returns null tab, state unchanged', async () => {
    await seedFocusedWindow([{ url: 'chrome-extension://test-id/manager.html' }])
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find(
      (t: chrome.tabs.Tab) => t.url === 'chrome-extension://test-id/manager.html',
    )!.id!

    const stateBefore = await readSessionState()
    const { tab, fromSpaceId } = await moveLiveTabToSpace(tabId, 'space-X')

    expect(tab).toBeNull()
    expect(fromSpaceId).toBeNull()
    const stateAfter = await readSessionState()
    expect(stateAfter).toEqual(stateBefore)
  })

  it('no-op when tab already belongs to the target space — returns null', async () => {
    await seedFocusedWindow([{ url: 'https://same.com/' }])
    // 归档让 tab 打上 space-X 的标(标签留在焦点窗口)
    await archiveCurrentWindowToSpace('space-X')
    const focusedTabs = await fakeBrowser.tabs.query({ windowId: FOCUSED_WIN })
    const tabId = focusedTabs.find((t: chrome.tabs.Tab) => t.url === 'https://same.com/')!.id!

    const { tab, fromSpaceId } = await moveLiveTabToSpace(tabId, 'space-X')

    expect(tab).toBeNull()
    expect(fromSpaceId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// onTabRemovedHandler
// ---------------------------------------------------------------------------
describe('onTabRemovedHandler', () => {
  it('removes the tabId from session state when a tab is closed', async () => {
    await seedFocusedWindow([{ url: 'https://track.com/' }])
    await archiveCurrentWindowToSpace('space-track')

    const stateBefore = await readSessionState()
    const trackedIds = stateBefore.spaceIdToTabIds['space-track'] ?? []
    expect(trackedIds.length).toBeGreaterThan(0)

    // Simulate tab removal
    await onTabRemovedHandler(trackedIds[0]!)

    const stateAfter = await readSessionState()
    expect(stateAfter.spaceIdToTabIds['space-track'] ?? []).not.toContain(trackedIds[0])
  })
})

// ---------------------------------------------------------------------------
// onWindowRemovedHandler
// ---------------------------------------------------------------------------
describe('onWindowRemovedHandler', () => {
  it('resets vault state when the vault window is closed', async () => {
    const vaultId = await ensureVaultWindow()

    await onWindowRemovedHandler(vaultId)

    const state = await readSessionState()
    expect(state.vaultWindowId).toBeNull()
    expect(state.spaceIdToTabIds).toEqual({})
  })

  it('does not reset state when a non-vault window is closed', async () => {
    await ensureVaultWindow()

    await onWindowRemovedHandler(9999)

    const state = await readSessionState()
    expect(state.vaultWindowId).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mergeSessionTags
// ---------------------------------------------------------------------------
describe('mergeSessionTags', () => {
  it('moves all fromId tab-ids under toId and drops fromId entry', async () => {
    // 在两个空间各归档一些标签
    await seedFocusedWindow([{ url: 'https://from.com/' }, { url: 'https://also-from.com/' }])
    await archiveCurrentWindowToSpace('space-from')

    // 单独给 space-to 打上另一个标签
    await seedFocusedWindow([{ url: 'https://to.com/' }])
    await archiveCurrentWindowToSpace('space-to')

    const stateBefore = await readSessionState()
    const fromIds = stateBefore.spaceIdToTabIds['space-from'] ?? []
    expect(fromIds.length).toBeGreaterThan(0)

    await mergeSessionTags('space-from', 'space-to')

    const stateAfter = await readSessionState()
    // from 条目消失
    expect(stateAfter.spaceIdToTabIds['space-from']).toBeUndefined()
    // to 包含原来 from 的所有 id
    const toIds = stateAfter.spaceIdToTabIds['space-to'] ?? []
    for (const id of fromIds) {
      expect(toIds).toContain(id)
    }
  })

  it('no-op when fromId === toId', async () => {
    await seedFocusedWindow([{ url: 'https://same.com/' }])
    await archiveCurrentWindowToSpace('space-same')

    const stateBefore = await readSessionState()
    await mergeSessionTags('space-same', 'space-same')
    const stateAfter = await readSessionState()
    expect(stateAfter).toEqual(stateBefore)
  })

  it('when source has no session entry, just drops (no error)', async () => {
    await seedFocusedWindow([{ url: 'https://target.com/' }])
    await archiveCurrentWindowToSpace('space-target')

    const stateBefore = await readSessionState()
    // 'space-ghost' has no session entry
    await mergeSessionTags('space-ghost', 'space-target')
    const stateAfter = await readSessionState()
    // target unchanged; ghost entry simply doesn't exist to begin with
    expect(stateAfter.spaceIdToTabIds['space-target']).toEqual(
      stateBefore.spaceIdToTabIds['space-target'],
    )
    expect(stateAfter.spaceIdToTabIds['space-ghost']).toBeUndefined()
  })
})
