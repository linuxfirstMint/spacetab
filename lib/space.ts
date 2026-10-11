import type { Database, Space, Tab, TabGroup } from './schema'

/** 计算"已用过的最大数字 key 后缀",用于追加新 group 时避免冲突 */
function maxKeySuffix(groups: TabGroup[] | undefined): number {
  if (!groups || groups.length === 0) return 0
  let max = 0
  for (const g of groups) {
    const m = /^g(\d+)$/.exec(g.key)
    if (m && m[1]) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max
}

/** 给 incomingGroups 重新分配 key,避免与 existing 冲突。返回新 groups + 原 key→新 key 映射 */
function rebaseGroupKeys(
  existingGroups: TabGroup[] | undefined,
  incomingGroups: TabGroup[],
): { remap: Map<string, string>; rebased: TabGroup[] } {
  const existingKeys = new Set((existingGroups ?? []).map((g) => g.key))
  const remap = new Map<string, string>()
  const rebased: TabGroup[] = []
  let next = maxKeySuffix(existingGroups) + 1
  for (const g of incomingGroups) {
    if (existingKeys.has(g.key)) {
      const newKey = `g${next++}`
      remap.set(g.key, newKey)
      rebased.push({ ...g, key: newKey })
    } else {
      rebased.push(g)
    }
  }
  return { remap, rebased }
}

export interface AppendOptions {
  incomingGroups?: TabGroup[]
}

export function appendTabs(
  space: Space,
  incoming: Tab[],
  now: number,
  options?: AppendOptions,
): Space {
  const groups = options?.incomingGroups ?? []
  const { remap, rebased } = rebaseGroupKeys(space.groups, groups)
  const remapped = remap.size > 0
    ? incoming.map((t) =>
        t.groupKey && remap.has(t.groupKey)
          ? { ...t, groupKey: remap.get(t.groupKey)! }
          : t,
      )
    : incoming
  const seen = new Set(space.tabs.map((t) => t.url))
  const fresh = remapped.filter((t) => !seen.has(t.url))
  if (fresh.length === 0) return space
  // 只保留被本次新增 tab 真正引用的 groups,避免孤儿
  const usedKeys = new Set<string>()
  for (const t of fresh) {
    if (t.groupKey) usedKeys.add(t.groupKey)
  }
  const newGroups = rebased.filter((g) => usedKeys.has(g.key))
  return {
    ...space,
    tabs: [...space.tabs, ...fresh],
    ...(newGroups.length > 0
      ? { groups: [...(space.groups ?? []), ...newGroups] }
      : {}),
    updatedAt: now,
  }
}

export function createSpace(
  db: Database,
  name: string,
  tabs: Tab[],
  id: string,
  now: number,
  options?: AppendOptions,
): Database {
  const seed: Space = { id, name, tabs: [], createdAt: now, updatedAt: now }
  const populated = appendTabs(seed, tabs, now, options)
  return { ...db, spaces: [...db.spaces, populated] }
}

export function renameSpace(db: Database, id: string, name: string, now: number): Database {
  return {
    ...db,
    spaces: db.spaces.map((s) => (s.id === id ? { ...s, name, updatedAt: now } : s)),
  }
}

export function deleteSpace(db: Database, id: string): Database {
  return { ...db, spaces: db.spaces.filter((s) => s.id !== id) }
}

export function findSpace(db: Database, id: string): Space | undefined {
  return db.spaces.find((s) => s.id === id)
}

export function archiveToSpace(
  db: Database,
  id: string,
  tabs: Tab[],
  now: number,
  options?: AppendOptions,
): Database {
  return {
    ...db,
    spaces: db.spaces.map((s) => (s.id === id ? appendTabs(s, tabs, now, options) : s)),
  }
}

export function removeTabFromSpace(
  db: Database,
  spaceId: string,
  tabUrl: string,
  now: number,
): Database {
  let changed = false
  const nextSpaces = db.spaces.map((s) => {
    if (s.id !== spaceId) return s
    const tabs = s.tabs.filter((t) => t.url !== tabUrl)
    if (tabs.length === s.tabs.length) return s
    changed = true
    return { ...s, tabs, updatedAt: now }
  })
  if (!changed) return db
  return { ...db, spaces: nextSpaces }
}

export function setTabPinned(db: Database, spaceId: string, url: string, pinned: boolean, now: number): Database {
  let changed = false
  const spaces = db.spaces.map((s) => {
    if (s.id !== spaceId) return s
    const tabs = s.tabs.map((tab) => {
      if (tab.url !== url || Boolean(tab.pinned) === pinned) return tab
      changed = true
      if (pinned) return { ...tab, pinned: true }
      const { pinned: _pinned, ...rest } = tab
      return rest
    })
    return changed ? { ...s, tabs, updatedAt: now } : s
  })
  return changed ? { ...db, spaces } : db
}

export function updateTabCurrentUrl(db: Database, spaceId: string, url: string, currentUrl: string): Database {
  let changed = false
  const spaces = db.spaces.map((s) => {
    if (s.id !== spaceId) return s
    const tabs = s.tabs.map((tab) => {
      if (tab.url !== url || tab.currentUrl === currentUrl || (!tab.currentUrl && currentUrl === tab.url)) return tab
      changed = true
      if (currentUrl !== tab.url) return { ...tab, currentUrl }
      const { currentUrl: _currentUrl, ...rest } = tab
      return rest
    })
    return changed ? { ...s, tabs } : s
  })
  return changed ? { ...db, spaces } : db
}

export function restoreTabUrl(db: Database, spaceId: string, url: string, now: number): Database {
  let changed = false
  const spaces = db.spaces.map((s) => {
    if (s.id !== spaceId) return s
    const tabs = s.tabs.map((tab) => {
      if (tab.url !== url || !tab.currentUrl) return tab
      changed = true
      const { currentUrl: _currentUrl, ...rest } = tab
      return rest
    })
    return changed ? { ...s, tabs, updatedAt: now } : s
  })
  return changed ? { ...db, spaces } : db
}

export function duplicateSpace(
  db: Database,
  sourceId: string,
  newId: string,
  newName: string,
  now: number,
): Database {
  const source = db.spaces.find((s) => s.id === sourceId)
  if (!source) return db
  const copy: Space = {
    id: newId,
    name: newName,
    tabs: source.tabs.map((t) => ({ ...t })),
    createdAt: now,
    updatedAt: now,
  }
  return { ...db, spaces: [...db.spaces, copy] }
}

export function mergeSpaces(
  db: Database,
  fromId: string,
  toId: string,
  now: number,
): Database {
  if (fromId === toId) return db
  const from = db.spaces.find((s) => s.id === fromId)
  const to = db.spaces.find((s) => s.id === toId)
  if (!from || !to) return db

  // 将 from 的标签追加到 to(appendTabs 内部去重)
  const mergedTo = appendTabs(to, from.tabs, now)
  return {
    ...db,
    spaces: db.spaces
      .filter((s) => s.id !== fromId)
      .map((s) => (s.id === toId ? mergedTo : s)),
  }
}

export function setSpaceEmoji(
  db: Database,
  id: string,
  emoji: string | undefined,
  now: number,
): Database {
  let changed = false
  const spaces = db.spaces.map((s) => {
    if (s.id !== id) return s
    const trimmed = emoji && emoji.trim().length > 0 ? emoji.trim() : undefined
    if (s.emoji === trimmed) return s
    changed = true
    const next: Space = { ...s, updatedAt: now }
    if (trimmed) next.emoji = trimmed
    else delete next.emoji
    return next
  })
  if (!changed) return db
  return { ...db, spaces }
}

export function setSpaceNote(
  db: Database,
  id: string,
  note: string | undefined,
  now: number,
): Database {
  let changed = false
  const spaces = db.spaces.map((s) => {
    if (s.id !== id) return s
    const trimmed = note && note.trim().length > 0 ? note.trim() : undefined
    if (s.note === trimmed) return s
    changed = true
    const next: Space = { ...s, updatedAt: now }
    if (trimmed) next.note = trimmed
    else delete next.note
    return next
  })
  if (!changed) return db
  return { ...db, spaces }
}

export function setSpacePinned(
  db: Database,
  id: string,
  pinned: boolean,
  now: number,
): Database {
  let changed = false
  const spaces = db.spaces.map((s) => {
    if (s.id !== id) return s
    const want = pinned || undefined  // 不再 pin 时不写入字段
    if ((s.pinned ?? false) === pinned) return s
    changed = true
    const next: Space = { ...s, updatedAt: now }
    if (want) next.pinned = true
    else delete next.pinned
    return next
  })
  if (!changed) return db
  return { ...db, spaces }
}

/**
 * 重排:把 spaces 按用户给定的 id 顺序重新分配 sortIndex。
 * 调用者负责传入完整的 id 顺序(只接受现有空间)。
 */
export function reorderSpaces(db: Database, orderedIds: string[], now: number): Database {
  const idToIndex = new Map<string, number>()
  orderedIds.forEach((id, i) => idToIndex.set(id, i))
  const spaces = db.spaces.map((s) => {
    const idx = idToIndex.get(s.id)
    if (idx === undefined) return s
    if (s.sortIndex === idx) return s
    return { ...s, sortIndex: idx, updatedAt: now }
  })
  return { ...db, spaces }
}

/**
 * 排序:置顶优先,然后按 sortIndex 升序;最后按 updatedAt 降序兜底。
 * 返回排序后的新数组。
 */
export function sortedForDisplay(spaces: Space[]): Space[] {
  return [...spaces].sort((a, b) => {
    const aP = a.pinned ? 1 : 0
    const bP = b.pinned ? 1 : 0
    if (aP !== bP) return bP - aP // pinned 在前
    const aIdx = a.sortIndex
    const bIdx = b.sortIndex
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx
    if (aIdx !== undefined) return -1
    if (bIdx !== undefined) return 1
    return b.updatedAt - a.updatedAt // 最近更新在前(原默认)
  })
}

/**
 * 在同一个空间内按 url 顺序重新排列 tabs。
 * 不在 orderedUrls 中出现的 tab 会保留在末尾(以原相对顺序),
 * 这样调用方传部分顺序也能拿到稳定结果。
 */
export function reorderTabsInSpace(
  db: Database,
  spaceId: string,
  orderedUrls: string[],
  now: number,
): Database {
  const target = db.spaces.find((s) => s.id === spaceId)
  if (!target) return db
  const byUrl = new Map<string, Tab>()
  for (const t of target.tabs) byUrl.set(t.url, t)
  const seen = new Set<string>()
  const reordered: Tab[] = []
  for (const url of orderedUrls) {
    const tab = byUrl.get(url)
    if (tab && !seen.has(url)) {
      reordered.push(tab)
      seen.add(url)
    }
  }
  for (const t of target.tabs) {
    if (!seen.has(t.url)) {
      reordered.push(t)
      seen.add(t.url)
    }
  }
  // 顺序未变:跳过更新避免无意义写入
  const unchanged = reordered.length === target.tabs.length
    && reordered.every((t, i) => t.url === target.tabs[i]?.url)
  if (unchanged) return db
  const spaces = db.spaces.map((s) =>
    s.id === spaceId ? { ...s, tabs: reordered, updatedAt: now } : s,
  )
  return { ...db, spaces }
}

export function moveTab(
  db: Database,
  fromId: string,
  toId: string,
  tabUrl: string,
  now: number,
): Database {
  if (fromId === toId) return db
  const fromSpace = db.spaces.find((s) => s.id === fromId)
  const tab = fromSpace?.tabs.find((t) => t.url === tabUrl)
  if (!tab) return db
  const toSpace = db.spaces.find((s) => s.id === toId)
  if (!toSpace) return db

  const afterRemove = removeTabFromSpace(db, fromId, tabUrl, now)
  return {
    ...afterRemove,
    spaces: afterRemove.spaces.map((s) =>
      s.id === toId ? appendTabs(s, [tab], now) : s,
    ),
  }
}

/** 批量从一个空间删除多个 tab。 */
export function removeTabsFromSpace(
  db: Database,
  spaceId: string,
  urls: string[],
  now: number,
): Database {
  if (urls.length === 0) return db
  const target = db.spaces.find((s) => s.id === spaceId)
  if (!target) return db
  const drop = new Set(urls)
  const remaining = target.tabs.filter((t) => !drop.has(t.url))
  if (remaining.length === target.tabs.length) return db
  const spaces = db.spaces.map((s) =>
    s.id === spaceId ? { ...s, tabs: remaining, updatedAt: now } : s,
  )
  return { ...db, spaces }
}

/** 批量把多个 tab 从一个空间移到另一个空间(append 到目的、保持选中相对顺序、去重)。 */
export function moveTabs(
  db: Database,
  fromId: string,
  toId: string,
  urls: string[],
  now: number,
): Database {
  if (fromId === toId || urls.length === 0) return db
  const fromSpace = db.spaces.find((s) => s.id === fromId)
  const toSpace = db.spaces.find((s) => s.id === toId)
  if (!fromSpace || !toSpace) return db
  const moving: Tab[] = []
  const moveSet = new Set(urls)
  // 保持源空间的相对顺序
  for (const t of fromSpace.tabs) {
    if (moveSet.has(t.url)) moving.push(t)
  }
  if (moving.length === 0) return db
  const afterRemove = removeTabsFromSpace(db, fromId, urls, now)
  return {
    ...afterRemove,
    spaces: afterRemove.spaces.map((s) =>
      s.id === toId ? appendTabs(s, moving, now) : s,
    ),
  }
}
