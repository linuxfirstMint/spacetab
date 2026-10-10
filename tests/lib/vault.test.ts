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
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => Promise<unknown>) => run() } })
  // 每次测试前创建一个 focused 窗口
  await fakeBrowser.windows.create({ focused: true })
  // 让 getURL 返回本扩展 origin,使自排除逻辑生效
  vi.spyOn(chrome.runtime, 'getURL').mockReturnValue('chrome-extension://test-id/')
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
