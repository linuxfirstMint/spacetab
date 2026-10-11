import type { Database, Space, SpaceFolder, Tab, TabGroup } from './schema'

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
    let spaceChanged = false
    const tabs = s.tabs.map((tab) => {
      if (tab.url !== url || Boolean(tab.pinned) === pinned) return tab
      changed = true
      spaceChanged = true
      if (pinned) return { ...tab, pinned: true }
      const { pinned: _pinned, folderId: _folderId, ...rest } = tab
      return rest
    })
    return spaceChanged ? { ...s, tabs, updatedAt: now } : s
  })
  return changed ? { ...db, spaces } : db
}

export function createSpaceFolder(db: Database, spaceId: string, folderId: string, name: string, now: number): Database {
  const trimmed = name.trim()
  if (!trimmed || !folderId) return db
  let changed = false
  const spaces = db.spaces.map((space) => {
    if (space.id !== spaceId || (space.folders ?? []).some((folder) => folder.id === folderId)) return space
    changed = true
    const folder: SpaceFolder = { id: folderId, name: trimmed }
    return { ...space, folders: [...(space.folders ?? []), folder], updatedAt: now }
  })
  return changed ? { ...db, spaces } : db
}

export function renameSpaceFolder(db: Database, spaceId: string, folderId: string, name: string, now: number): Database {
  const trimmed = name.trim()
  if (!trimmed) return db
  let changed = false
  const spaces = db.spaces.map((space) => {
    if (space.id !== spaceId) return space
    let spaceChanged = false
    const folders = (space.folders ?? []).map((folder) => {
      if (folder.id !== folderId || folder.name === trimmed) return folder
      changed = true
      spaceChanged = true
      return { ...folder, name: trimmed }
    })
    return spaceChanged ? { ...space, folders, updatedAt: now } : space
  })
  return changed ? { ...db, spaces } : db
}

/** Deleting a folder always keeps its tabs pinned and in the Space, but makes them unfiled. */
export function deleteSpaceFolder(db: Database, spaceId: string, folderId: string, now: number): Database {
  let changed = false
  const spaces = db.spaces.map((space) => {
    if (space.id !== spaceId || !(space.folders ?? []).some((folder) => folder.id === folderId)) return space
    changed = true
    const folders = (space.folders ?? []).filter((folder) => folder.id !== folderId)
    const tabs = space.tabs.map((tab) => {
      if (tab.folderId !== folderId) return tab
      const { folderId: _folderId, ...rest } = tab
      return rest
    })
    return { ...space, folders, tabs, updatedAt: now }
  })
  return changed ? { ...db, spaces } : db
}

export function setSpaceFolderCollapsed(db: Database, spaceId: string, folderId: string, collapsed: boolean, now: number): Database {
  let changed = false
  const spaces = db.spaces.map((space) => {
    if (space.id !== spaceId) return space
    let spaceChanged = false
    const folders = (space.folders ?? []).map((folder) => {
      if (folder.id !== folderId || Boolean(folder.collapsed) === collapsed) return folder
      changed = true
      spaceChanged = true
      return collapsed ? { ...folder, collapsed: true } : { id: folder.id, name: folder.name }
    })
    return spaceChanged ? { ...space, folders, updatedAt: now } : space
  })
  return changed ? { ...db, spaces } : db
}

export function reorderSpaceFolders(db: Database, spaceId: string, orderedIds: string[], now: number): Database {
  const target = db.spaces.find((space) => space.id === spaceId)
  if (!target?.folders || target.folders.length < 2) return db
  const byId = new Map(target.folders.map((folder) => [folder.id, folder]))
  const ordered = [...orderedIds, ...target.folders.map((folder) => folder.id)].filter((id, index, all) => byId.has(id) && all.indexOf(id) === index).map((id) => byId.get(id)!)
  if (ordered.every((folder, index) => folder.id === target.folders?.[index]?.id)) return db
  return { ...db, spaces: db.spaces.map((space) => space.id === spaceId ? { ...space, folders: ordered, updatedAt: now } : space) }
}

export function moveTabToFolder(db: Database, spaceId: string, url: string, folderId: string | undefined, now: number): Database {
  let changed = false
  const spaces = db.spaces.map((space) => {
    if (space.id !== spaceId) return space
    const tab = space.tabs.find((item) => item.url === url)
    if (!tab || !tab.pinned || (folderId !== undefined && !(space.folders ?? []).some((folder) => folder.id === folderId))) return space
    if (tab.folderId === folderId) return space
    changed = true
    const tabs = space.tabs.map((item) => {
      if (item.url !== url) return item
      if (folderId) return { ...item, folderId }
      const { folderId: _folderId, ...rest } = item
      return rest
    })
    return { ...space, tabs, updatedAt: now }
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

  // Keep the source folder structure while avoiding folder-ID collisions in the destination Space.
  const destinationFolderIds = new Set((to.folders ?? []).map((folder) => folder.id))
  const folderIdMap = new Map<string, string>()
  const incomingFolders = (from.folders ?? []).map((folder) => {
    let id = folder.id
    let suffix = 1
    while (destinationFolderIds.has(id)) id = `${folder.id}-${fromId}-${suffix++}`
    destinationFolderIds.add(id)
    folderIdMap.set(folder.id, id)
    return { ...folder, id }
  })
  const incomingTabs = from.tabs.map((tab) => {
    if (!tab.folderId) return tab
    const folderId = folderIdMap.get(tab.folderId)
    if (folderId) return { ...tab, folderId }
    const { folderId: _folderId, ...unfiledTab } = tab
    return unfiledTab
  })
  // appendTabs de-duplicates saved URLs; folder entries remain even when their tabs duplicate existing tabs.
  const appended = appendTabs(to, incomingTabs, now)
  const mergedTo = incomingFolders.length > 0
    ? { ...appended, folders: [...(to.folders ?? []), ...incomingFolders] }
    : appended
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

  const { folderId: _folderId, ...unfiledTab } = tab
  const afterRemove = removeTabFromSpace(db, fromId, tabUrl, now)
  return {
    ...afterRemove,
    spaces: afterRemove.spaces.map((s) =>
      s.id === toId ? appendTabs(s, [unfiledTab], now) : s,
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
    if (moveSet.has(t.url)) {
      const { folderId: _folderId, ...unfiledTab } = t
      moving.push(unfiledTab)
    }
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
