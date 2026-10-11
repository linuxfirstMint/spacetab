import {
  readSessionState,
  writeSessionState,
  tagTabIdsForSpace,
  untagTabIdInState,
  dropSpaceFromState,
  activeSpaceForWindow,
  setActiveSpaceForWindow,
  removeWindowFromState,
} from './session-state'
import { DatabaseSchema, type Tab, type TabGroup } from './schema'
import { readDatabase, writeDatabase } from './storage'
import { snapshotGroupsForTabs, restoreGroupsForTabs } from './tab-groups'
import { readLastActiveSpaceId, writeLastActiveSpaceId } from './last-active-space'
import {
  clearAllLastActiveTabs,
  clearLastActiveTab,
  clearLastActiveTabById,
  readLastActiveTab,
  writeLastActiveTab,
} from './last-active-tab'

const SKIP_URL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:']

function canRestore(url: string | undefined): url is string {
  if (!url) return false
  return !SKIP_URL_PREFIXES.some((p) => url.startsWith(p))
}

function getTabUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string | undefined {
  return tab.url || tab.pendingUrl
}

function isSelfExtension(url: string | undefined): boolean {
  if (!url) return false
  const prefix = chrome.runtime.getURL('')
  return prefix.length > 0 && url.startsWith(prefix)
}

function selectNormalWindowId(windows: chrome.windows.Window[], vaultWindowId: number | null): number | undefined {
  return windows.find(win => win.focused && win.id !== undefined && win.id !== vaultWindowId)?.id
    ?? windows.find(win => win.id !== undefined && win.id !== vaultWindowId)?.id
}

async function waitForNormalWindow(vaultWindowId: number | null): Promise<number | undefined> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
    const windowId = selectNormalWindowId(windows, vaultWindowId)
    if (windowId !== undefined) return windowId
    await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())))
  }
  return undefined
}

async function focusedWindowId(): Promise<number> {
  const win = await chrome.windows.getCurrent()
  if (typeof win.id !== 'number') throw new Error('No focused window')
  return win.id
}

async function legacySpaceForWindow(state: Awaited<ReturnType<typeof readSessionState>>, windowId: number): Promise<string | null> {
  if (Object.keys(state.windowIdToSpaceId ?? {}).length > 0 || !state.currentSpaceId) return null
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  const normalIds = windows.filter(win => win.id !== undefined && win.id !== state.vaultWindowId).map(win => win.id!)
  return normalIds.length === 1 && normalIds[0] === windowId ? state.currentSpaceId : null
}

/** Resolve current selection without letting a legacy global pointer claim one of several windows. */
export async function readActiveSpaceForWindow(windowId: number): Promise<string | null> {
  const state = await readSessionState()
  return activeSpaceForWindow(state, windowId) ?? await legacySpaceForWindow(state, windowId)
}

async function focusExistingSpaceWindow(windowId: number): Promise<void> {
  await chrome.windows.update(windowId, { focused: true })
}

export async function ensureVaultWindow(): Promise<number> {
  const state = await readSessionState()
  if (state.vaultWindowId !== null) {
    try {
      await chrome.windows.get(state.vaultWindowId)
      return state.vaultWindowId
    } catch {
      // window was closed externally; fall through to recreate
    }
  }
  // storage.session is cleared when Chrome restarts. Reuse the marker window
  // Chrome restored instead of creating a second Vault window with a new ID.
  const markerUrl = chrome.runtime.getURL('vault-marker.html')
  const existingMarker = (await chrome.tabs.query({})).find(t => getTabUrl(t) === markerUrl && typeof t.windowId === 'number')
  if (existingMarker?.windowId !== undefined) {
    await writeSessionState({ ...state, vaultWindowId: existingMarker.windowId })
    return existingMarker.windowId
  }
  // 用扩展自带的 vault-marker.html 当锚点 tab:
  // 1) 让 dock / 任务栏的窗口标题写明这是 SpaceTab vault,用户一眼能认出来
  // 2) 钉住这个 tab,空 vault 时也不会被 Chrome 自动关掉
  const win = await chrome.windows.create({
    state: 'minimized',
    focused: false,
    type: 'normal',
    url: markerUrl,
  })
  if (!win || typeof win.id !== 'number') throw new Error('Vault create returned no id')
  // chrome.windows.create 的回调里 tabs 可能还没填充,显式查一下窗口里的标签
  try {
    const winTabs = await chrome.tabs.query({ windowId: win.id })
    const markerTab = winTabs.find((t) => t.url?.startsWith('chrome-extension://')) ?? winTabs[0]
    if (markerTab && typeof markerTab.id === 'number') {
      await chrome.tabs.update(markerTab.id, { pinned: true })
    }
  } catch {
    // 钉失败不致命,只是窗口名不会显示
  }
  await writeSessionState({ ...state, vaultWindowId: win.id })
  return win.id
}

// Filter tabIds, returning only those that still exist
async function filterAlive(tabIds: number[]): Promise<number[]> {
  const alive: number[] = []
  for (const id of tabIds) {
    try {
      await chrome.tabs.get(id)
      alive.push(id)
    } catch {
      // tab closed
    }
  }
  return alive
}

// 仅快照当前窗口可归档的标签,不写入任何 session 状态。
// 用于智能归档预览阶段,避免在用户确认前污染 vault 状态。
export async function snapshotCurrentWindow(): Promise<Tab[]> {
  const focusedId = await focusedWindowId()
  const visible = await chrome.tabs.query({ windowId: focusedId, pinned: false })
  const out: Tab[] = []
  for (const t of visible) {
    if (isSelfExtension(getTabUrl(t))) continue
    if (typeof t.id !== 'number') continue
    const url = getTabUrl(t)
    if (!canRestore(url)) continue
    out.push({
      url,
      title: t.title && t.title.length > 0 ? t.title : url,
      ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
    })
  }
  return out
}

export async function archiveCurrentWindowToSpace(
  spaceId: string,
): Promise<{ archived: Tab[]; groups: TabGroup[]; closedNonRestorable: number }> {
  const focusedId = await focusedWindowId()
  const visible = await chrome.tabs.query({ windowId: focusedId, pinned: false })

  const tabIdsToTag: number[] = []
  // 先收集要归档的 chrome tabIds(只收符合条件的)
  const accepted: chrome.tabs.Tab[] = []
  for (const t of visible) {
    if (isSelfExtension(getTabUrl(t))) continue
    if (typeof t.id !== 'number') continue
    if (!canRestore(getTabUrl(t))) continue
    accepted.push(t)
    tabIdsToTag.push(t.id)
  }

  // 抓分组快照
  const { tabIdToKey, groups } = await snapshotGroupsForTabs(tabIdsToTag)

  const archived: Tab[] = accepted.map((t) => {
    const url = getTabUrl(t)!
    const tabIdNum = t.id as number
    const key = tabIdToKey.get(tabIdNum)
    const base: Tab = {
      url,
      title: t.title && t.title.length > 0 ? t.title : url,
      ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
    }
    return key ? { ...base, groupKey: key } : base
  })

  // 仅给当前窗口的标签打标,不搬走、不关闭——保持用户视野。
  // 下次切换到别的空间时,switchToSpace 会把这些 tagged 标签自然地搬入 vault。
  if (tabIdsToTag.length > 0) {
    const state = await readSessionState()
    await writeSessionState(tagTabIdsForSpace(state, spaceId, tabIdsToTag))
  }

  return { archived, groups, closedNonRestorable: 0 }
}

export async function switchToSpace(
  toSpaceId: string,
  toSpaceTabs: Tab[],
  toSpaceGroups: TabGroup[] = [],
  windowId?: number,
): Promise<{ failed: Tab[]; fromSpaceId: string | null }> {
  // 同一扩展的管理页和侧栏共享锁，快速点击不能交错搬动标签。
  return navigator.locks.request('spacetab-switch', () => switchToSpaceUnlocked(toSpaceId, toSpaceTabs, toSpaceGroups, windowId))
}

/** Restore the last selected Space once per browser session, without treating
 * Chrome-restored tabs that match it as unregistered ambient tabs. */
export async function restoreLastActiveSpaceOnStartup(
  report?: (entry: { phase: string; at: string; details?: Record<string, unknown> }) => void | Promise<void>,
): Promise<boolean> {
  return navigator.locks.request('spacetab-switch', async () => {
    const diagnose = async (phase: string, details?: Record<string, unknown>) => {
      await report?.({ phase, at: new Date().toISOString(), ...(details ? { details } : {}) })
    }
    await diagnose('restore-started')
    const session = await readSessionState()
    // A user selection or a previous startup restore already won this race.
    if (session.currentSpaceId || Object.keys(session.windowIdToSpaceId ?? {}).length > 0) {
      await diagnose('skipped-current-space', { currentSpaceId: session.currentSpaceId })
      return false
    }

    const lastSpaceId = await readLastActiveSpaceId()
    const previousSelection = lastSpaceId ? await readLastActiveTab(lastSpaceId) : null
    // storage.local survives Chrome restarts, but tab IDs do not. Rebuild only
    // the active Space's pointer from restored tabs below. Keep URL occurrence
    // metadata so a non-active extension page does not lose the tab selection.
    await clearAllLastActiveTabs()

    if (!lastSpaceId) {
      await diagnose('skipped-no-last-active-space')
      return false
    }
    const { db, events } = await readDatabase()
    if (events.length > 0) {
      await diagnose('skipped-pending-database-events', { eventCount: events.length })
      return false
    }
    const target = db.spaces.find(space => space.id === lastSpaceId)
    if (!target) {
      await diagnose('skipped-space-not-found')
      return false
    }
    await diagnose('space-selected', { tabCount: target.tabs.length })

    let allTabs = await chrome.tabs.query({})
    const markerUrl = chrome.runtime.getURL('vault-marker.html')
    let marker = allTabs.find(tab => getTabUrl(tab) === markerUrl && typeof tab.windowId === 'number')
    let vaultWindowId = marker?.windowId ?? session.vaultWindowId

    let windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
    let windowId = selectNormalWindowId(windows, vaultWindowId)
    if (windowId === undefined) {
      await diagnose('waiting-for-normal-window', { windowCount: windows.length, vaultWindowId })
      windowId = await waitForNormalWindow(vaultWindowId)
      if (windowId === undefined) {
        await diagnose('creating-normal-window')
        // Chrome can restore only the minimized Vault marker when its startup
        // preference is the New Tab page. Provide a normal destination window
        // so the selected Space is still restored on a natural startup.
        const created = await chrome.windows.create({
          focused: true,
          type: 'normal',
          url: chrome.runtime.getURL('manager.html'),
        })
        if (typeof created?.id !== 'number') {
          await diagnose('skipped-window-create-returned-no-id')
          return false
        }
        windowId = created.id
        await diagnose('created-normal-window', { windowId })
      }
      // Chrome may create the normal window before it restores its tabs.
      // Query again after the wait so pending restored tabs are considered.
      allTabs = await chrome.tabs.query({})
      marker = allTabs.find(tab => getTabUrl(tab) === markerUrl && typeof tab.windowId === 'number')
      vaultWindowId = marker?.windowId ?? session.vaultWindowId
      windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
      windowId = selectNormalWindowId(windows, vaultWindowId) ?? windowId
    }
    if (windowId === undefined) {
      await diagnose('skipped-no-destination-window')
      return false
    }
    await diagnose('destination-window-selected', { windowId, vaultWindowId, windowCount: windows.length })

    // Match URL occurrences one-to-one. Counts preserve duplicate tabs and
    // ensure extra same-URL tabs remain unregistered and are recovered below.
    const remaining = new Map<string, number>()
    for (const tab of target.tabs) {
      const wantedUrl = tab.currentUrl ?? tab.url
      remaining.set(wantedUrl, (remaining.get(wantedUrl) ?? 0) + 1)
    }
    const candidates = allTabs
      .filter(tab =>
        (tab.windowId === vaultWindowId || tab.windowId === windowId) &&
        !tab.pinned && typeof tab.id === 'number' && canRestore(getTabUrl(tab)) && !isSelfExtension(getTabUrl(tab)),
      )
      .sort((a, b) => {
        const aPriority = a.windowId === vaultWindowId ? 0 : 1
        const bPriority = b.windowId === vaultWindowId ? 0 : 1
        return aPriority - bPriority || (a.index ?? 0) - (b.index ?? 0)
      })
    const matchedIds: number[] = []
    const matchedByUrl = new Map<string, chrome.tabs.Tab[]>()
    for (const tab of candidates) {
      const url = getTabUrl(tab)!
      const count = remaining.get(url) ?? 0
      if (count <= 0) continue
      matchedIds.push(tab.id!)
      remaining.set(url, count - 1)
      const matching = matchedByUrl.get(url)
      if (matching) matching.push(tab)
      else matchedByUrl.set(url, [tab])
    }

    const restoredActiveTab = candidates.find(tab =>
      tab.active && tab.id !== undefined && matchedIds.includes(tab.id),
    )
    const selectionCandidates = previousSelection
      ? matchedByUrl.get(previousSelection.url)
      : undefined
    const selectedOccurrence = previousSelection?.urlOccurrence ?? 0
    const targetHasSelectedOccurrence = previousSelection
      ? target.tabs.filter(tab => (tab.currentUrl ?? tab.url) === previousSelection.url).length > selectedOccurrence
      : false
    const restoredTab = selectionCandidates?.[selectedOccurrence]
      ?? (targetHasSelectedOccurrence ? undefined : restoredActiveTab)

    let nextSession = { ...session, vaultWindowId: vaultWindowId ?? null }
    nextSession = tagTabIdsForSpace(nextSession, target.id, matchedIds)
    await writeSessionState(nextSession)
    if (restoredTab?.id !== undefined) {
      const restoredUrl = getTabUrl(restoredTab)
      if (restoredUrl) {
        const urlOccurrence = matchedByUrl.get(restoredUrl)?.findIndex(tab => tab.id === restoredTab.id) ?? 0
        await writeLastActiveTab(target.id, {
          tabId: restoredTab.id,
          url: restoredUrl,
          urlOccurrence: Math.max(0, urlOccurrence),
        })
      }
    } else if (previousSelection && targetHasSelectedOccurrence) {
      // Chrome may not have restored every duplicate URL yet (or may start
      // with a New Tab page). Keep the requested occurrence until the normal
      // switch path recreates the missing tabs and can bind it to a live ID.
      await writeLastActiveTab(target.id, previousSelection)
    }

    await diagnose('switch-started', { matchingRestoredTabs: matchedIds.length })
    const result = await switchToSpaceUnlocked(target.id, target.tabs, target.groups ?? [], windowId)
    await diagnose('switch-finished', { failedTabCount: result.failed.length })
    return result.failed.length === 0
  })
}

async function switchToSpaceUnlocked(
  toSpaceId: string,
  toSpaceTabs: Tab[],
  toSpaceGroups: TabGroup[] = [],
  windowId?: number,
): Promise<{ failed: Tab[]; fromSpaceId: string | null }> {
  const focusedId = windowId ?? await focusedWindowId()
  const visibleAll = await chrome.tabs.query({ windowId: focusedId, pinned: false })

  let state = await readSessionState()
  const fromSpaceId = activeSpaceForWindow(state, focusedId) ?? await legacySpaceForWindow(state, focusedId)

  // A Space has one visible window owner. Reusing it focuses that window so
  // its live pages, form state, and scroll position remain intact.
  const mappedOwner = Object.entries(state.windowIdToSpaceId ?? {})
    .find(([id, activeSpaceId]) => Number(id) !== focusedId && activeSpaceId === toSpaceId)
  if (mappedOwner) {
    const ownerId = Number(mappedOwner[0])
    try {
      const owner = await chrome.windows.get(ownerId)
      if (ownerId !== state.vaultWindowId && owner.type === 'normal') {
        await focusExistingSpaceWindow(ownerId)
        return { failed: [], fromSpaceId }
      }
    } catch {
      // Remove stale ownership before considering any live tagged tabs.
    }
    state = removeWindowFromState(state, ownerId)
    await writeSessionState(state)
  }

  // During an upgrade or after a manually moved tab, session tags can prove
  // that the requested Space is already visible even if its window map is
  // missing. Focus that window rather than creating duplicate live tabs.
  const targetIds = new Set(state.spaceIdToTabIds[toSpaceId] ?? [])
  if (targetIds.size > 0) {
    const taggedTabs = await chrome.tabs.query({})
    const visibleTarget = taggedTabs.find(tab =>
      typeof tab.id === 'number' && targetIds.has(tab.id)
      && tab.windowId !== focusedId && tab.windowId !== state.vaultWindowId
      && (!state.windowIdToSpaceId?.[String(tab.windowId)]
        || state.windowIdToSpaceId[String(tab.windowId)] === toSpaceId),
    )
    if (visibleTarget?.windowId !== undefined) {
      await focusExistingSpaceWindow(visibleTarget.windowId)
      await writeSessionState(setActiveSpaceForWindow(state, visibleTarget.windowId, toSpaceId))
      return { failed: [], fromSpaceId }
    }
  }

  if (fromSpaceId === toSpaceId) {
    const mapped = setActiveSpaceForWindow(state, focusedId, toSpaceId)
    if (mapped.windowIdToSpaceId?.[String(focusedId)] !== state.windowIdToSpaceId?.[String(focusedId)]) {
      await writeSessionState(mapped)
    }
    await writeLastActiveSpaceId(toSpaceId)
    return { failed: [], fromSpaceId }
  }
  if (fromSpaceId) {
    const previousSelection = await readLastActiveTab(fromSpaceId)
    if (previousSelection && (state.spaceIdToTabIds[fromSpaceId] ?? []).includes(previousSelection.tabId)) {
      const selectedTab = visibleAll.find(tab => tab.id === previousSelection.tabId)
      if (selectedTab && getTabUrl(selectedTab) === previousSelection.url) {
        const sameUrlTabs = visibleAll.filter(tab =>
          typeof tab.id === 'number'
          && (state.spaceIdToTabIds[fromSpaceId] ?? []).includes(tab.id)
          && getTabUrl(tab) === previousSelection.url,
        )
        const urlOccurrence = sameUrlTabs.findIndex(tab => tab.id === previousSelection.tabId)
        if (urlOccurrence >= 0) {
          await writeLastActiveTab(fromSpaceId, { ...previousSelection, urlOccurrence })
        }
      }
    }
  }
  const allTaggedIds = new Set<number>()
  for (const ids of Object.values(state.spaceIdToTabIds)) {
    for (const id of ids) allTaggedIds.add(id)
  }

  // Categorize visible tabs
  const taggedToVault: number[] = []
  const ambientToClose: number[] = []
  for (const t of visibleAll) {
    if (isSelfExtension(getTabUrl(t))) continue
    if (typeof t.id !== 'number') continue
    if (allTaggedIds.has(t.id)) taggedToVault.push(t.id)
    else ambientToClose.push(t.id)
  }

  // 侧栏不是标签；临时锚点防止搬走最后一页时源窗口被关闭。
  const allVisible = await chrome.tabs.query({ windowId: focusedId })
  const anchor = allVisible.some(t => t.pinned || isSelfExtension(getTabUrl(t)))
    ? null : await chrome.tabs.create({ windowId: focusedId, url: chrome.runtime.getURL('manager.html'), active: false })

  // 未归档标签也必须保留；持久化失败时停止切换，避免丢失页面。
  if (ambientToClose.length > 0) {
    const { db, events } = await readDatabase()
    if (events.length > 0) throw new Error('Cannot safely save current tabs')
    const recoveryId = crypto.randomUUID()
    const tabs = visibleAll.filter(t => ambientToClose.includes(t.id!)).map(t => ({
      url: t.url ?? t.pendingUrl ?? 'about:blank', title: t.title ?? t.url ?? 'Tab',
    }))
    const now = Date.now()
    const nextDb = DatabaseSchema.parse({ ...db, spaces: [...db.spaces, {
      id: recoveryId, name: `Saved tabs ${new Date(now).toLocaleString()}`,
      tabs, createdAt: now, updatedAt: now,
    }] })
    const saved = await writeDatabase(nextDb)
    if (!saved.ok) throw new Error('Cannot safely save current tabs')
    const vaultId = await ensureVaultWindow()
    await writeSessionState(tagTabIdsForSpace(await readSessionState(), recoveryId, ambientToClose))
    await chrome.tabs.move(ambientToClose, { windowId: vaultId, index: -1 })
  }

  // Stash tagged tabs back into vault (they keep their existing tags)
  if (taggedToVault.length > 0) {
    try {
      const vaultId = await ensureVaultWindow()
      await chrome.tabs.move(taggedToVault, { windowId: vaultId, index: -1 })
    } catch {
      // ignore — best effort
    }
  }

  // 先检查目标空间在 vault 里挂着的所有 tabId,按 URL 校对是否还属于该空间。
  // 用户在 manager 里删 / 跨空间移动后,DB 已经反映新状态,但 session state 里的
  // tabId 标记还没被清理 — 这里是关键的一致性兜底。
  const knownIds = state.spaceIdToTabIds[toSpaceId] ?? []
  const lastActiveTab = await readLastActiveTab(toSpaceId)
  const aliveKnownIds = await filterAlive(knownIds)
  const wantedUrls = new Set(toSpaceTabs.map((tt) => tt.currentUrl ?? tt.url))
  const liveUrlCounts = new Map<string, number>()
  const wantedKnownIds: number[] = []
  const orphanKnownIds: number[] = []
  // url → groupKey,从 space 的 tabs 里抽出来,用于把 chrome tabId 归到分组桶
  const urlToKey = new Map<string, string>()
  for (const tt of toSpaceTabs) {
    if (tt.groupKey) urlToKey.set(tt.currentUrl ?? tt.url, tt.groupKey)
  }
  const tabIdsByKey = new Map<string, number[]>()
  const pushBucket = (key: string, id: number) => {
    const arr = tabIdsByKey.get(key)
    if (arr) arr.push(id)
    else tabIdsByKey.set(key, [id])
  }
  for (const id of aliveKnownIds) {
    try {
      const tab = await chrome.tabs.get(id)
      const tabUrl = getTabUrl(tab)
      if (tabUrl && wantedUrls.has(tabUrl)) {
        wantedKnownIds.push(id)
        liveUrlCounts.set(tabUrl, (liveUrlCounts.get(tabUrl) ?? 0) + 1)
        const k = urlToKey.get(tabUrl)
        if (k) pushBucket(k, id)
      } else {
        orphanKnownIds.push(id)
      }
    } catch {
      orphanKnownIds.push(id)
    }
  }

  // 把仍然属于该空间的 tab 搬回可见窗口
  if (wantedKnownIds.length > 0) {
    try {
      await chrome.tabs.move(wantedKnownIds, { windowId: focusedId, index: -1 })
    } catch {
      // ignore — 后面的 create 路径会兜
    }
  }

  // 孤儿:用户在 manager 里把它们移走 / 删了,直接关掉
  if (orphanKnownIds.length > 0) {
    try {
      await chrome.tabs.remove(orphanKnownIds)
    } catch {
      // 关失败也无所谓,最坏情况下用户多看到几条标签
    }
  }

  const failed: Tab[] = []
  const newlyCreatedIds: number[] = []
  for (const tab of toSpaceTabs) {
    const liveUrl = tab.currentUrl ?? tab.url
    const liveCount = liveUrlCounts.get(liveUrl) ?? 0
    if (liveCount > 0) {
      liveUrlCounts.set(liveUrl, liveCount - 1)
      continue
    }
    try {
      // 冷启动场景(vault 里没有这条 URL 的真实标签):正常创建,
      // 让 Chrome 在后台加载真实内容(标题、favicon、页面)。不再 discard。
      const created = await chrome.tabs.create({
        windowId: focusedId,
        url: liveUrl,
        active: false,
      })
      if (typeof created.id === 'number') {
        newlyCreatedIds.push(created.id)
        if (tab.groupKey) pushBucket(tab.groupKey, created.id)
      }
    } catch {
      failed.push(tab)
    }
  }

  // 重建 chrome 标签组(title + 颜色)
  if (tabIdsByKey.size > 0 && toSpaceGroups.length > 0) {
    await restoreGroupsForTabs(focusedId, tabIdsByKey, toSpaceGroups)
  }

  // 一次性把 session state 写定:
  //   1) 解绑刚才识别出的孤儿 tabId
  //   2) 把新创建的 tab 标到该空间
  //   3) 把当前空间 id 设为 toSpaceId(用于后续的撤销切换)
  let next = await readSessionState()
  if (orphanKnownIds.length > 0) {
    for (const id of orphanKnownIds) {
      next = untagTabIdInState(next, id)
    }
  }
  if (newlyCreatedIds.length > 0) {
    next = tagTabIdsForSpace(next, toSpaceId, newlyCreatedIds)
  }
  const mapped = setActiveSpaceForWindow(next, focusedId, toSpaceId)
  if (
    orphanKnownIds.length > 0 ||
    newlyCreatedIds.length > 0 ||
    next.currentSpaceId !== toSpaceId ||
    next.windowIdToSpaceId?.[String(focusedId)] !== toSpaceId
  ) {
    await writeSessionState(mapped)
  }
  await writeLastActiveSpaceId(toSpaceId)

  const destination = await chrome.tabs.query({ windowId: focusedId })
  const remembered = lastActiveTab
    ? wantedKnownIds.find(id => id === lastActiveTab.tabId)
    : undefined
  let activeTabId = remembered
  if (remembered !== undefined) {
    try {
      const tab = await chrome.tabs.get(remembered)
      if (getTabUrl(tab) !== lastActiveTab?.url || tab.windowId !== focusedId) activeTabId = undefined
    } catch {
      activeTabId = undefined
    }
  }
  if (activeTabId === undefined && lastActiveTab) {
    const targetIds = new Set([...wantedKnownIds, ...newlyCreatedIds])
    const matchingTargets = destination.filter(tab =>
      typeof tab.id === 'number'
      && targetIds.has(tab.id)
      && (getTabUrl(tab) === lastActiveTab.url || toSpaceTabs.some(saved => saved.url === lastActiveTab.url && (saved.currentUrl ?? saved.url) === getTabUrl(tab))),
    )
    activeTabId = matchingTargets[lastActiveTab.urlOccurrence ?? 0]?.id
  }
  const first = destination.find(t => typeof t.id === 'number' && !isSelfExtension(getTabUrl(t)))
  activeTabId ??= first?.id
  if (activeTabId !== undefined) {
    await chrome.tabs.update(activeTabId, { active: true })
    const activeTab = await chrome.tabs.get(activeTabId).catch(() => null)
    const activeUrl = activeTab ? getTabUrl(activeTab) : undefined
    if (activeUrl && !isSelfExtension(activeUrl)) {
      const targetIds = new Set([...wantedKnownIds, ...newlyCreatedIds])
      const urlOccurrence = destination
        .filter(tab => typeof tab.id === 'number' && targetIds.has(tab.id) && getTabUrl(tab) === activeUrl)
        .findIndex(tab => tab.id === activeTabId)
      await writeLastActiveTab(toSpaceId, {
        tabId: activeTabId,
        url: activeUrl,
        urlOccurrence: Math.max(0, urlOccurrence),
      })
    }
    if (anchor?.id !== undefined) await chrome.tabs.remove(anchor.id)
  }
  return { failed, fromSpaceId }
}

// 删除空间时调用:仅解除 session 里对这些 tabId 的归属关系。
// 不关闭任何标签——它们继续存在(在 vault 或可见窗口),变成"无空间归属"的孤儿,
// 用户可以手动归到别的空间或自己关掉。
export async function releaseSpaceTabs(spaceId: string): Promise<void> {
  const state = await readSessionState()
  await writeSessionState(dropSpaceFromState(state, spaceId))
  await clearLastActiveTab(spaceId)
}

// 历史名,保留转发以避免外部破坏
export const purgeVaultedTabsForSpace = releaseSpaceTabs

// 合并空间时:把 fromId 的 session 标签 ID 移到 toId 名下。
// 失败不阻断主流程(调用方按 best-effort 处理)。
export async function mergeSessionTags(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return
  const state = await readSessionState()
  const sourceWindows = Object.entries(state.windowIdToSpaceId ?? {})
    .filter(([, spaceId]) => spaceId === fromId)
    .map(([windowId]) => windowId)
  const targetOwnedElsewhere = Object.entries(state.windowIdToSpaceId ?? {})
    .some(([windowId, spaceId]) => spaceId === toId && !sourceWindows.includes(windowId))
  const targetOwnerWindowId = targetOwnedElsewhere
    ? Object.entries(state.windowIdToSpaceId ?? {}).find(([windowId, spaceId]) => spaceId === toId && !sourceWindows.includes(windowId))?.[0]
    : sourceWindows[0]
  let windowIdToSpaceId = { ...(state.windowIdToSpaceId ?? {}) }
  for (const windowId of sourceWindows) {
    if (windowId === targetOwnerWindowId) windowIdToSpaceId[windowId] = toId
    else delete windowIdToSpaceId[windowId]
  }
  const mergedCurrentSpaceId = state.currentSpaceId === fromId
    ? (targetOwnerWindowId && windowIdToSpaceId[targetOwnerWindowId] === toId
        ? toId
        : Object.values(windowIdToSpaceId).at(-1) ?? null)
    : state.currentSpaceId ?? null
  const fromIds = state.spaceIdToTabIds[fromId]
  if (!fromIds || fromIds.length === 0) {
    // 源空间没有 session 标签,仅清理条目
    const next = dropSpaceFromState({ ...state, windowIdToSpaceId, currentSpaceId: mergedCurrentSpaceId }, fromId)
    await writeSessionState(next)
    await clearLastActiveTab(fromId)
    return
  }
  const sourceSelection = await readLastActiveTab(fromId)
  const targetSelection = await readLastActiveTab(toId)
  // tagTabIdsForSpace 内部已去重
  const tagged = tagTabIdsForSpace(state, toId, fromIds)
  await writeSessionState(dropSpaceFromState({ ...tagged, windowIdToSpaceId, currentSpaceId: mergedCurrentSpaceId }, fromId))
  await clearLastActiveTab(fromId)
  if (!targetSelection && sourceSelection && fromIds.includes(sourceSelection.tabId)) {
    await writeLastActiveTab(toId, sourceSelection)
  }
}

export async function moveLiveTabToSpace(
  tabId: number,
  toSpaceId: string,
): Promise<{ tab: Tab | null; fromSpaceId: string | null }> {
  // 1. Look up the tab
  let chromeTab: chrome.tabs.Tab
  try {
    chromeTab = await chrome.tabs.get(tabId)
  } catch {
    return { tab: null, fromSpaceId: null }
  }

  // 2. Reject if pinned, self-extension, or non-restorable
  if (chromeTab.pinned) return { tab: null, fromSpaceId: null }
  if (isSelfExtension(chromeTab.url)) return { tab: null, fromSpaceId: null }
  if (!canRestore(chromeTab.url)) return { tab: null, fromSpaceId: null }

  // 3. Reverse-lookup: 这个 tab 是否已经在目标空间里(避免重复打标)
  const state = await readSessionState()
  const targetIds = state.spaceIdToTabIds[toSpaceId] ?? []
  if (targetIds.includes(tabId)) {
    // 已经属于目标,无需操作
    return { tab: null, fromSpaceId: null }
  }

  // 4. 仅 ADD 打标——不从源空间移除。
  //    标签可以同时属于多个空间(URL 在多个 space.tabs[],session 在多个 spaceIdToTabIds)。
  //    切到任一空间时这个 tab 都会被搬回可见窗口。
  const nextState = tagTabIdsForSpace(state, toSpaceId, [tabId])
  await writeSessionState(nextState)

  // 5. Build Tab payload from current chrome.tabs.Tab snapshot
  const url = chromeTab.url!
  const payload: Tab = {
    url,
    title: chromeTab.title && chromeTab.title.length > 0 ? chromeTab.title : url,
    ...(chromeTab.favIconUrl ? { favIconUrl: chromeTab.favIconUrl } : {}),
  }

  return { tab: payload, fromSpaceId: null }
}

// Called from background listeners
export async function onTabRemovedHandler(tabId: number, isWindowClosing = false): Promise<void> {
  // Chrome can remove tabs as part of a normal browser shutdown. Keep the
  // URL/occurrence descriptor even when its session-only ID goes stale; the
  // startup restore rebinds it to a matching tab or falls back safely.
  if (!isWindowClosing) await clearLastActiveTabById(tabId)
  const state = await readSessionState()
  const next = untagTabIdInState(state, tabId)
  if (next !== state) await writeSessionState(next)
}

export async function onWindowRemovedHandler(closedWindowId: number): Promise<void> {
  const state = await readSessionState()
  if (state.vaultWindowId === closedWindowId) {
    await writeSessionState({ ...state, vaultWindowId: null, spaceIdToTabIds: {} })
    return
  }
  const next = removeWindowFromState(state, closedWindowId)
  if (next !== state) await writeSessionState(next)
}
