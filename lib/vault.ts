import {
  readSessionState,
  writeSessionState,
  tagTabIdsForSpace,
  untagTabIdInState,
  dropSpaceFromState,
} from './session-state'
import { DatabaseSchema, type Tab, type TabGroup } from './schema'
import { readDatabase, writeDatabase } from './storage'
import { snapshotGroupsForTabs, restoreGroupsForTabs } from './tab-groups'

const SKIP_URL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:']

function canRestore(url: string | undefined): url is string {
  if (!url) return false
  return !SKIP_URL_PREFIXES.some((p) => url.startsWith(p))
}

function isSelfExtension(url: string | undefined): boolean {
  if (!url) return false
  const prefix = chrome.runtime.getURL('')
  return prefix.length > 0 && url.startsWith(prefix)
}

async function focusedWindowId(): Promise<number> {
  const win = await chrome.windows.getCurrent()
  if (typeof win.id !== 'number') throw new Error('No focused window')
  return win.id
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
  // 用扩展自带的 vault-marker.html 当锚点 tab:
  // 1) 让 dock / 任务栏的窗口标题写明这是 SpaceTab vault,用户一眼能认出来
  // 2) 钉住这个 tab,空 vault 时也不会被 Chrome 自动关掉
  const markerUrl = chrome.runtime.getURL('vault-marker.html')
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
  await writeSessionState({
    vaultWindowId: win.id,
    spaceIdToTabIds: {},
  })
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
    if (isSelfExtension(t.url)) continue
    if (typeof t.id !== 'number') continue
    if (!canRestore(t.url)) continue
    const url = t.url!
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
    if (isSelfExtension(t.url)) continue
    if (typeof t.id !== 'number') continue
    if (!canRestore(t.url)) continue
    accepted.push(t)
    tabIdsToTag.push(t.id)
  }

  // 抓分组快照
  const { tabIdToKey, groups } = await snapshotGroupsForTabs(tabIdsToTag)

  const archived: Tab[] = accepted.map((t) => {
    const url = t.url!
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

async function switchToSpaceUnlocked(
  toSpaceId: string,
  toSpaceTabs: Tab[],
  toSpaceGroups: TabGroup[] = [],
  windowId?: number,
): Promise<{ failed: Tab[]; fromSpaceId: string | null }> {
  const focusedId = windowId ?? await focusedWindowId()
  const visibleAll = await chrome.tabs.query({ windowId: focusedId, pinned: false })

  const state = await readSessionState()
  const fromSpaceId = state.currentSpaceId ?? null
  if (fromSpaceId === toSpaceId) return { failed: [], fromSpaceId }
  const allTaggedIds = new Set<number>()
  for (const ids of Object.values(state.spaceIdToTabIds)) {
    for (const id of ids) allTaggedIds.add(id)
  }

  // Categorize visible tabs
  const taggedToVault: number[] = []
  const ambientToClose: number[] = []
  for (const t of visibleAll) {
    if (isSelfExtension(t.url)) continue
    if (typeof t.id !== 'number') continue
    if (allTaggedIds.has(t.id)) taggedToVault.push(t.id)
    else ambientToClose.push(t.id)
  }

  // 侧栏不是标签；临时锚点防止搬走最后一页时源窗口被关闭。
  const allVisible = await chrome.tabs.query({ windowId: focusedId })
  const anchor = allVisible.some(t => t.pinned || isSelfExtension(t.url))
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
  const aliveKnownIds = await filterAlive(knownIds)
  const wantedUrls = new Set(toSpaceTabs.map((tt) => tt.url))
  const liveUrls = new Set<string>()
  const wantedKnownIds: number[] = []
  const orphanKnownIds: number[] = []
  // url → groupKey,从 space 的 tabs 里抽出来,用于把 chrome tabId 归到分组桶
  const urlToKey = new Map<string, string>()
  for (const tt of toSpaceTabs) {
    if (tt.groupKey) urlToKey.set(tt.url, tt.groupKey)
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
      if (tab.url && wantedUrls.has(tab.url)) {
        wantedKnownIds.push(id)
        liveUrls.add(tab.url)
        const k = urlToKey.get(tab.url)
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
    if (liveUrls.has(tab.url)) continue
    try {
      // 冷启动场景(vault 里没有这条 URL 的真实标签):正常创建,
      // 让 Chrome 在后台加载真实内容(标题、favicon、页面)。不再 discard。
      const created = await chrome.tabs.create({
        windowId: focusedId,
        url: tab.url,
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
  if (
    orphanKnownIds.length > 0 ||
    newlyCreatedIds.length > 0 ||
    next.currentSpaceId !== toSpaceId
  ) {
    await writeSessionState({ ...next, currentSpaceId: toSpaceId })
  }

  const destination = await chrome.tabs.query({ windowId: focusedId })
  const first = destination.find(t => typeof t.id === 'number' && !isSelfExtension(t.url))
  if (first?.id !== undefined) {
    await chrome.tabs.update(first.id, { active: true })
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
}

// 历史名,保留转发以避免外部破坏
export const purgeVaultedTabsForSpace = releaseSpaceTabs

// 合并空间时:把 fromId 的 session 标签 ID 移到 toId 名下。
// 失败不阻断主流程(调用方按 best-effort 处理)。
export async function mergeSessionTags(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return
  const state = await readSessionState()
  const fromIds = state.spaceIdToTabIds[fromId]
  if (!fromIds || fromIds.length === 0) {
    // 源空间没有 session 标签,仅清理条目
    await writeSessionState(dropSpaceFromState(state, fromId))
    return
  }
  // tagTabIdsForSpace 内部已去重
  const tagged = tagTabIdsForSpace(state, toId, fromIds)
  await writeSessionState(dropSpaceFromState(tagged, fromId))
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
export async function onTabRemovedHandler(tabId: number): Promise<void> {
  const state = await readSessionState()
  const next = untagTabIdInState(state, tabId)
  if (next !== state) await writeSessionState(next)
}

export async function onWindowRemovedHandler(closedWindowId: number): Promise<void> {
  const state = await readSessionState()
  if (state.vaultWindowId === closedWindowId) {
    await writeSessionState({ vaultWindowId: null, spaceIdToTabIds: {} })
  }
}
