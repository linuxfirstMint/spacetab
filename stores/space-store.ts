import { create } from 'zustand'
import { EMPTY_DB, type Database, type Favorite, type SpaceColor, type Tab, type TabGroup } from '@/lib/schema'
import { readDatabase, readFavorites, writeDatabase, writeDatabaseAndFavorites, writeFavorites } from '@/lib/storage'
import { addFavorite, removeFavorite, reorderFavorites, updateFavorite } from '@/lib/favorites'
import * as space from '@/lib/space'
import { purgeVaultedTabsForSpace, mergeSessionTags } from '@/lib/vault'
import { appendDeletionRecords, readDeletionHistory } from '@/lib/deletion-history'
import type { DeletionRecord } from '@/lib/schema'

export type ToastKind = 'info' | 'error'
export interface ToastAction {
  label: string
  perform: () => void
}
export interface Toast {
  id: number
  kind: ToastKind
  text: string
  action?: ToastAction
}
export interface ToastOptions {
  action?: ToastAction
  /** 自定义自动消失毫秒数,默认 4000 */
  ttl?: number
}

interface State {
  db: Database
  loaded: boolean
  toasts: Toast[]

  load: () => Promise<void>
  archive: (spaceId: string, tabs: Tab[], groups?: TabGroup[]) => Promise<boolean>
  archiveNew: (name: string, tabs: Tab[], groups?: TabGroup[]) => Promise<string | null>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  removeTab: (spaceId: string, url: string) => Promise<boolean>
  setTabPinned: (spaceId: string, url: string, pinned: boolean) => Promise<void>
  addFavorite: (tab: Pick<Tab, 'url' | 'title' | 'favIconUrl'>) => Promise<boolean>
  removeFavorite: (url: string) => Promise<void>
  updateFavorite: (url: string, next: Favorite) => Promise<void>
  reorderFavorites: (orderedUrls: string[]) => Promise<void>
  syncFavorites: (favorites: Favorite[]) => void
  restoreTabUrl: (spaceId: string, url: string) => Promise<boolean>
  createFolder: (spaceId: string, name: string) => Promise<string | null>
  renameFolder: (spaceId: string, folderId: string, name: string) => Promise<void>
  deleteFolder: (spaceId: string, folderId: string) => Promise<void>
  setFolderCollapsed: (spaceId: string, folderId: string, collapsed: boolean) => Promise<void>
  reorderFolders: (spaceId: string, orderedIds: string[]) => Promise<void>
  moveTabToFolder: (spaceId: string, url: string, folderId: string | undefined) => Promise<void>
  moveTab: (fromId: string, toId: string, url: string) => Promise<boolean>
  merge: (fromId: string, toId: string) => Promise<boolean>
  duplicate: (sourceId: string, newName: string) => Promise<string | null>
  setEmoji: (id: string, emoji: string | undefined) => Promise<void>
  setColor: (id: string, color: SpaceColor | undefined) => Promise<void>
  setNote: (id: string, note: string | undefined) => Promise<void>
  togglePinned: (id: string) => Promise<void>
  reorder: (orderedIds: string[]) => Promise<void>
  reorderTabs: (spaceId: string, orderedUrls: string[]) => Promise<void>
  removeTabs: (spaceId: string, urls: string[]) => Promise<void>
  restoreDeletion: (id: string) => Promise<boolean>
  moveTabsBatch: (fromId: string, toId: string, urls: string[]) => Promise<void>
  importDb: (next: Database) => Promise<boolean>
  pushToast: (kind: ToastKind, text: string, options?: ToastOptions) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useSpaceStore = create<State>((set, get) => {
  const persistDeletion = async (before: Database, next: Database, records: DeletionRecord[]): Promise<boolean> => {
    return navigator.locks.request('spacetab-deletion-history', async () => {
      const latest = (await readDatabase()).db
      const eligible = records.filter((record) => record.kind === 'space'
        ? latest.spaces.some((item) => item.id === record.space.id)
        : latest.spaces.some((item) => item.id === record.spaceId && item.tabs.some((tab) => tab.url === record.tab.url)))
      if (eligible.length === 0) return false
      const history = await appendDeletionRecords(eligible)
      if (!history) return false
      let reconciled: Database = { ...latest, favorites: get().db.favorites }
      for (const record of eligible) {
        if (record.kind === 'space') reconciled = { ...reconciled, spaces: reconciled.spaces.filter((item) => item.id !== record.space.id) }
        else reconciled = { ...reconciled, spaces: reconciled.spaces.map((item) => item.id === record.spaceId ? { ...item, tabs: item.tabs.filter((tab) => tab.url !== record.tab.url) } : item) }
      }
      try {
        const { favorites: _favorites, ...db } = reconciled
        await chrome.storage.local.set({ db, deletionHistory: history })
      } catch { return false }
      set({ db: reconciled })
      return true
    })
  }
  const persistMutation = async (before: Database, next: Database): Promise<boolean> => {
    if (next === before) return false
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return false
    }
    return true
  }

  const persistFavorites = async (before: Database, favorites: Favorite[]): Promise<boolean> => {
    const next = { ...before, favorites }
    set({ db: next })
    const result = await writeFavorites(favorites)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return false
    }
    return true
  }

  return ({
  db: EMPTY_DB,
  loaded: false,
  toasts: [],

  load: async () => {
    const { db, events } = await readDatabase()
    const favorites = await readFavorites()
    set({ db: { ...db, favorites: favorites.length > 0 ? favorites : db.favorites ?? [] }, loaded: true })
    for (const e of events) {
      if (e.kind === 'corrupt-backup') {
        get().pushToast('error', `数据损坏,已备份至 ${e.backupKey}`)
      } else if (e.kind === 'read-failed') {
        get().pushToast('error', '存储读取失败')
      }
    }
  },

  archive: async (id, tabs, groups) => {
    const before = get().db
    if (!before.spaces.some((s) => s.id === id)) {
      get().pushToast('error', '空间已不存在')
      return false
    }
    const opts = groups && groups.length > 0 ? { incomingGroups: groups } : undefined
    const next = space.archiveToSpace(before, id, tabs, Date.now(), opts)
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return false
    }
    return true
  },

  archiveNew: async (name, tabs, groups) => {
    const before = get().db
    const id = crypto.randomUUID()
    const opts = groups && groups.length > 0 ? { incomingGroups: groups } : undefined
    const next = space.createSpace(before, name, tabs, id, Date.now(), opts)
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return null
    }
    return id
  },

  rename: async (id, name) => {
    const before = get().db
    if (!before.spaces.some((s) => s.id === id)) {
      get().pushToast('error', '空间已不存在')
      return
    }
    const next = space.renameSpace(before, id, name, Date.now())
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  remove: async (id) => {
    const before = get().db
    if (!before.spaces.some((s) => s.id === id)) {
      get().pushToast('error', '空间已不存在')
      return
    }
    const index = before.spaces.findIndex((item) => item.id === id)
    const target = before.spaces[index]!
    const next = space.deleteSpace(before, id)
    const record: DeletionRecord = { id: crypto.randomUUID(), kind: 'space', space: target, index, deletedAt: Date.now() }
    const ok = await persistDeletion(before, next, [record])
    if (!ok) {
      get().pushToast('error', '削除履歴を保存できませんでした。Space は削除していません')
      return
    }
    // 尽力关闭 vault 中该空间的标签,失败不影响主流程
    void purgeVaultedTabsForSpace(id).catch(() => undefined)
    get().pushToast('info', 'Space を削除しました', { ttl: 8000, action: { label: '元に戻す', perform: () => { void get().restoreDeletion(record.id) } } })
  },

  removeTab: async (spaceId, url) => {
    const before = get().db
    const next = space.removeTabFromSpace(before, spaceId, url, Date.now())
    if (next === before) return false
    const source = before.spaces.find((item) => item.id === spaceId)!
    const index = source.tabs.findIndex((tab) => tab.url === url)
    const tab = source.tabs[index]!
    const record: DeletionRecord = { id: crypto.randomUUID(), kind: 'tab', spaceId, spaceName: source.name, tab, index, deletedAt: Date.now() }
    const ok = await persistDeletion(before, next, [record])
    if (!ok) {
      get().pushToast('error', '削除履歴を保存できませんでした。タブは削除していません')
      return false
    }
    get().pushToast('info', 'タブを削除しました', { ttl: 8000, action: { label: '元に戻す', perform: () => { void get().restoreDeletion(record.id) } } })
    return true
  },

  setTabPinned: async (spaceId, url, pinned) => {
    const before = get().db
    const next = space.setTabPinned(before, spaceId, url, pinned, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) { set({ db: before }); get().pushToast('error', '存储写入失败,已回滚') }
  },

  addFavorite: async (tab) => {
    const before = get().db
    const currentFavorites = before.favorites ?? []
    const favorites = addFavorite(currentFavorites, tab)
    if (favorites === currentFavorites) return false
    return persistFavorites(before, favorites)
  },

  removeFavorite: async (url) => {
    const before = get().db
    const favorites = removeFavorite(before.favorites ?? [], url)
    if (favorites.length === (before.favorites ?? []).length) return
    await persistFavorites(before, favorites)
  },

  updateFavorite: async (url, nextFavorite) => {
    const before = get().db
    if (nextFavorite.url !== url && (before.favorites ?? []).some((favorite) => favorite.url === nextFavorite.url)) {
      get().pushToast('error', 'この URL はすでに Favorites にあります')
      return
    }
    await persistFavorites(before, updateFavorite(before.favorites ?? [], url, nextFavorite))
  },

  reorderFavorites: async (orderedUrls) => {
    const before = get().db
    await persistFavorites(before, reorderFavorites(before.favorites ?? [], orderedUrls))
  },

  syncFavorites: (favorites) => set((state) => ({ db: { ...state.db, favorites } })),

  restoreTabUrl: async (spaceId, url) => {
    const before = get().db
    const next = space.restoreTabUrl(before, spaceId, url, Date.now())
    if (next === before) return false
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) { set({ db: before }); get().pushToast('error', '存储写入失败,已回滚'); return false }
    return true
  },

  createFolder: async (spaceId, name) => {
    const before = get().db
    const folderId = crypto.randomUUID()
    const next = space.createSpaceFolder(before, spaceId, folderId, name, Date.now())
    return await persistMutation(before, next) ? folderId : null
  },

  renameFolder: async (spaceId, folderId, name) => {
    const before = get().db
    await persistMutation(before, space.renameSpaceFolder(before, spaceId, folderId, name, Date.now()))
  },

  deleteFolder: async (spaceId, folderId) => {
    const before = get().db
    await persistMutation(before, space.deleteSpaceFolder(before, spaceId, folderId, Date.now()))
  },

  setFolderCollapsed: async (spaceId, folderId, collapsed) => {
    const before = get().db
    await persistMutation(before, space.setSpaceFolderCollapsed(before, spaceId, folderId, collapsed, Date.now()))
  },

  reorderFolders: async (spaceId, orderedIds) => {
    const before = get().db
    await persistMutation(before, space.reorderSpaceFolders(before, spaceId, orderedIds, Date.now()))
  },

  moveTabToFolder: async (spaceId, url, folderId) => {
    const before = get().db
    await persistMutation(before, space.moveTabToFolder(before, spaceId, url, folderId, Date.now()))
  },

  moveTab: async (fromId, toId, url) => {
    const before = get().db
    const next = space.moveTab(before, fromId, toId, url, Date.now())
    if (next === before) return false
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return false
    }
    return true
  },

  merge: async (fromId, toId) => {
    if (fromId === toId) return false
    const before = get().db
    const next = space.mergeSpaces(before, fromId, toId, Date.now())
    if (next === before) return false
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return false
    }
    // best-effort:合并 session 标签。失败不影响主流程。
    void mergeSessionTags(fromId, toId).catch(() => undefined)
    return true
  },

  setEmoji: async (id, emoji) => {
    const before = get().db
    const next = space.setSpaceEmoji(before, id, emoji, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  setColor: async (id, color) => {
    const before = get().db
    const next = space.setSpaceColor(before, id, color, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  setNote: async (id, note) => {
    const before = get().db
    const next = space.setSpaceNote(before, id, note, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  togglePinned: async (id) => {
    const before = get().db
    const target = before.spaces.find((s) => s.id === id)
    if (!target) return
    const next = space.setSpacePinned(before, id, !(target.pinned ?? false), Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  reorder: async (orderedIds) => {
    const before = get().db
    const next = space.reorderSpaces(before, orderedIds, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  reorderTabs: async (spaceId, orderedUrls) => {
    const before = get().db
    const next = space.reorderTabsInSpace(before, spaceId, orderedUrls, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  removeTabs: async (spaceId, urls) => {
    const before = get().db
    const next = space.removeTabsFromSpace(before, spaceId, urls, Date.now())
    if (next === before) return
    const source = before.spaces.find((item) => item.id === spaceId)!
    const records = source.tabs.flatMap((tab, index) => urls.includes(tab.url) ? [{ id: crypto.randomUUID(), kind: 'tab' as const, spaceId, spaceName: source.name, tab, index, deletedAt: Date.now() }] : [])
    if (!(await persistDeletion(before, next, records))) get().pushToast('error', '削除履歴を保存できませんでした。タブは削除していません')
    else get().pushToast('info', `${records.length} 件のタブを削除しました`, { ttl: 8000, action: { label: '元に戻す', perform: () => { void (async () => { for (const record of records.slice().reverse()) await get().restoreDeletion(record.id) })() } } })
  },

  restoreDeletion: async (id) => navigator.locks.request('spacetab-deletion-history', async () => {
    const history = await readDeletionHistory()
    const record = history.find((item) => item.id === id)
    if (!record) return false
    const beforeRaw = (await readDatabase()).db
    const before: Database = { ...beforeRaw, favorites: get().db.favorites }
    let next: Database
    if (record.kind === 'space') {
      const restored = { ...record.space, id: before.spaces.some((item) => item.id === record.space.id) ? crypto.randomUUID() : record.space.id }
      if (before.spaces.some((item) => item.id === restored.id)) return false
      const spaces = [...before.spaces]
      spaces.splice(Math.min(record.index, spaces.length), 0, restored)
      next = { ...before, spaces }
    } else {
      let spaceId = record.spaceId
      if (!before.spaces.some((item) => item.id === spaceId)) {
        spaceId = crypto.randomUUID()
        const recovered = { id: spaceId, name: record.spaceName, tabs: [], createdAt: record.deletedAt, updatedAt: Date.now() }
        next = { ...before, spaces: [...before.spaces, recovered] }
      } else next = before
      const target = next.spaces.find((item) => item.id === spaceId)!
      if (target.tabs.some((tab) => tab.url === record.tab.url)) return false
      const tabs = [...target.tabs]
      tabs.splice(Math.min(record.index, tabs.length), 0, record.tab)
      next = { ...next, spaces: next.spaces.map((item) => item.id === spaceId ? { ...item, tabs, updatedAt: Date.now() } : item) }
    }
    const remaining = history.filter((item) => item.id !== id)
    try { const { favorites: _favorites, ...db } = next; await chrome.storage.local.set({ db, deletionHistory: remaining }) } catch { return false }
    set({ db: next })
    return true
  }),

  moveTabsBatch: async (fromId, toId, urls) => {
    const before = get().db
    const next = space.moveTabs(before, fromId, toId, urls, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

  importDb: async (next) => {
    const before = get().db
    const normalizedNext = { ...next, favorites: next.favorites ?? [] }
    set({ db: normalizedNext })
    const result = await writeDatabaseAndFavorites(normalizedNext)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', 'ストレージ書き込みに失敗しました。変更を元に戻しました')
      return false
    }
    return true
  },

  duplicate: async (sourceId, newName) => {
    const before = get().db
    if (!before.spaces.some((s) => s.id === sourceId)) {
      get().pushToast('error', '空间已不存在')
      return null
    }
    const newId = crypto.randomUUID()
    const next = space.duplicateSpace(before, sourceId, newId, newName, Date.now())
    if (next === before) return null
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return null
    }
    return newId
  },

  pushToast: (kind, text, options) => {
    const id = ++toastSeq
    const toast: Toast = options?.action
      ? { id, kind, text, action: options.action }
      : { id, kind, text }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => get().dismissToast(id), options?.ttl ?? 4000)
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  })
})
