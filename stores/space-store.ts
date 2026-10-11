import { create } from 'zustand'
import { EMPTY_DB, type Database, type SpaceColor, type Tab, type TabGroup } from '@/lib/schema'
import { readDatabase, writeDatabase } from '@/lib/storage'
import * as space from '@/lib/space'
import { purgeVaultedTabsForSpace, mergeSessionTags } from '@/lib/vault'

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
  moveTabsBatch: (fromId: string, toId: string, urls: string[]) => Promise<void>
  importDb: (next: Database) => Promise<boolean>
  pushToast: (kind: ToastKind, text: string, options?: ToastOptions) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useSpaceStore = create<State>((set, get) => {
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

  return ({
  db: EMPTY_DB,
  loaded: false,
  toasts: [],

  load: async () => {
    const { db, events } = await readDatabase()
    set({ db, loaded: true })
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
    const next = space.deleteSpace(before, id)
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
      return
    }
    // 尽力关闭 vault 中该空间的标签,失败不影响主流程
    void purgeVaultedTabsForSpace(id).catch(() => undefined)
  },

  removeTab: async (spaceId, url) => {
    const before = get().db
    const next = space.removeTabFromSpace(before, spaceId, url, Date.now())
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

  setTabPinned: async (spaceId, url, pinned) => {
    const before = get().db
    const next = space.setTabPinned(before, spaceId, url, pinned, Date.now())
    if (next === before) return
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) { set({ db: before }); get().pushToast('error', '存储写入失败,已回滚') }
  },

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
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
    }
  },

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
    set({ db: next })
    const result = await writeDatabase(next)
    if (!result.ok) {
      set({ db: before })
      get().pushToast('error', '存储写入失败,已回滚')
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
