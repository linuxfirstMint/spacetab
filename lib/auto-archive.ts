import { AutoArchiveSettingsSchema, AutoArchivedTabSchema, type AutoArchivedTab, type AutoArchiveSettings, type Tab } from './schema'
import { appendTabs } from './space'
import { readDatabase, writeDatabase } from './storage'
import { readSessionState, activeSpaceForWindow } from './session-state'

const SETTINGS_KEY = 'autoArchiveSettings'
const ARCHIVED_KEY = 'autoArchivedTabs'
const LAST_USED_KEY = 'autoArchiveLastUsed'
const ACTIVE_TABS_KEY = 'autoArchiveActiveTabs'
const DEFAULT_SETTINGS: AutoArchiveSettings = { enabled: false, inactivityHours: 12 }

export async function readAutoArchiveSettings(): Promise<AutoArchiveSettings> {
  try {
    const raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]
    const parsed = AutoArchiveSettingsSchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  } catch { return DEFAULT_SETTINGS }
}

export async function writeAutoArchiveSettings(settings: AutoArchiveSettings): Promise<boolean> {
  const parsed = AutoArchiveSettingsSchema.safeParse(settings)
  if (!parsed.success) return false
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: parsed.data })
    return true
  } catch { return false }
}

export async function readAutoArchivedTabs(): Promise<AutoArchivedTab[]> {
  return (await readAutoArchivedTabsSafely()) ?? []
}

async function readAutoArchivedTabsSafely(): Promise<AutoArchivedTab[] | null> {
  try {
    const raw = (await chrome.storage.local.get(ARCHIVED_KEY))[ARCHIVED_KEY]
    const parsed = AutoArchivedTabSchema.array().safeParse(raw ?? [])
    return parsed.success ? parsed.data : null
  } catch { return null }
}

async function updateLastUsed(tabId: number): Promise<void> {
  try {
    const all = await chrome.storage.local.get(LAST_USED_KEY)
    const map = all[LAST_USED_KEY] && typeof all[LAST_USED_KEY] === 'object' ? all[LAST_USED_KEY] as Record<string, number> : {}
    await chrome.storage.local.set({ [LAST_USED_KEY]: { ...map, [String(tabId)]: Date.now() } })
  } catch { /* a failed activity timestamp must never trigger a close */ }
}

export async function markAutoArchiveTabUsed(tabId: number): Promise<void> { await updateLastUsed(tabId) }

export async function markAutoArchiveTabActivated(tabId: number, windowId: number): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([LAST_USED_KEY, ACTIVE_TABS_KEY])
    const lastUsed = stored[LAST_USED_KEY] && typeof stored[LAST_USED_KEY] === 'object' ? { ...stored[LAST_USED_KEY] as Record<string, number> } : {}
    const active = stored[ACTIVE_TABS_KEY] && typeof stored[ACTIVE_TABS_KEY] === 'object' ? { ...stored[ACTIVE_TABS_KEY] as Record<string, number> } : {}
    const key = String(windowId)
    const previousId = active[key]
    const now = Date.now()
    if (typeof previousId === 'number' && previousId !== tabId) lastUsed[String(previousId)] = now
    lastUsed[String(tabId)] = now
    active[key] = tabId
    await chrome.storage.local.set({ [LAST_USED_KEY]: lastUsed, [ACTIVE_TABS_KEY]: active })
  } catch { /* a failed timestamp must never trigger a close */ }
}

/** A failed or unavailable activity read is treated as recently used. */
export async function runAutoArchiveSweep(now = Date.now()): Promise<number> {
  const settings = await readAutoArchiveSettings()
  if (!settings.enabled) return 0
  return navigator.locks.request('spacetab-switch', async () => {
    let lastUsed: Record<string, number>
    try {
      const value = (await chrome.storage.local.get(LAST_USED_KEY))[LAST_USED_KEY]
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
      lastUsed = value as Record<string, number>
    } catch { return 0 }
    const tabs = await chrome.tabs.query({})
    const history = await readAutoArchivedTabsSafely()
    if (!history) return 0
    let archived: AutoArchivedTab[] = history
    const deadline = now - settings.inactivityHours * 60 * 60 * 1000
    let count = 0
    for (const tab of tabs) {
      if (typeof tab.id !== 'number' || tab.active || tab.pinned || tab.audible || tab.discarded || !tab.url || !/^https?:\/\//i.test(tab.url)) continue
      const url = tab.url
      const usedAt = lastUsed[String(tab.id)]
      if (typeof usedAt !== 'number' || usedAt > deadline) continue
      const [dbResult, state, favoritesRaw] = await Promise.all([
        readDatabase(), readSessionState(), chrome.storage.local.get('favorites'),
      ])
      if (dbResult.events.some(event => event.kind === 'read-failed')) continue
      if (state.vaultWindowId === tab.windowId) continue
      const favorites = new Set(Array.isArray(favoritesRaw.favorites) ? favoritesRaw.favorites.flatMap((x: { url?: unknown }) => typeof x?.url === 'string' ? [x.url] : []) : [])
      const sourceSpaceId = activeSpaceForWindow(state, tab.windowId) ?? null
      const source = sourceSpaceId ? dbResult.db.spaces.find(s => s.id === sourceSpaceId) : undefined
      if (favorites.has(url) || source?.tabs.some(t => (t.url === url || t.currentUrl === url) && (t.pinned || t.folderId))) continue
      const nextTab: Tab = { url, title: tab.title || url, ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}) }
      // Persist the tab in its source Space first. If this fails, leave the live tab untouched.
      let persisted = false
      if (source) {
        const nextDb = { ...dbResult.db, spaces: dbResult.db.spaces.map(space => space.id === source.id ? appendTabs(space, [nextTab], now) : space) }
        persisted = nextDb === dbResult.db || (await writeDatabase(nextDb)).ok
      }
      if (persisted) {
        try {
          const record: AutoArchivedTab = { id: crypto.randomUUID(), ...nextTab, sourceSpaceId, archivedAt: now }
          const nextArchived: AutoArchivedTab[] = [...archived, record]
          await chrome.storage.local.set({ [ARCHIVED_KEY]: nextArchived })
          archived = nextArchived
        } catch { persisted = false }
      }
      if (!persisted) continue
      // Re-check identity and eligibility immediately before closing: another window may have focused it.
      try {
        const current = await chrome.tabs.get(tab.id)
        if (current.active || current.audible || current.url !== url) continue
        await chrome.tabs.remove(tab.id)
        count++
      } catch { /* already closed or no longer accessible */ }
    }
    return count
  })
}

export async function restoreAutoArchivedTab(id: string, windowId?: number): Promise<boolean> {
  return navigator.locks.request('spacetab-switch', async () => {
    const records = await readAutoArchivedTabsSafely()
    if (!records) return false
    const record = records.find(item => item.id === id)
    if (!record) return false
    const [db, state] = await Promise.all([readDatabase(), readSessionState()])
    const sourceExists = Boolean(record.sourceSpaceId && db.db.spaces.some(space => space.id === record.sourceSpaceId))
    const owner = sourceExists
      ? Object.entries(state.windowIdToSpaceId ?? {}).find(([, spaceId]) => spaceId === record.sourceSpaceId)
      : undefined
    let winId = windowId
    if (owner) {
      const ownerId = Number(owner[0])
      try {
        const sourceWindow = await chrome.windows.get(ownerId)
        if (sourceWindow.type === 'normal') {
          winId = ownerId
          await chrome.windows.update(ownerId, { focused: true })
        }
      } catch { /* use the focused normal window as a safe fallback */ }
    }
    winId ??= (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id
    if (winId === undefined) return false
    // Keep the archive record until Chrome confirms the tab was created.
    const existing = (await chrome.tabs.query({ windowId: winId })).find(tab => tab.url === record.url)
    const created = existing
      ? await chrome.tabs.update(existing.id!, { active: true })
      : await chrome.tabs.create({ windowId: winId, url: record.url, active: true })
    if (!created || typeof created.id !== 'number') return false
    try {
      // The tab is already retained in its source Space from archive time.
      // If that Space is gone, leave it as an ordinary live tab in this window.
      await chrome.storage.local.set({ [ARCHIVED_KEY]: records.filter(item => item.id !== id) })
      return true
    } catch {
      // The created tab is preserved and the archive record remains for safe retry.
      return false
    }
  })
}

export async function initializeAutoArchive(): Promise<void> {
  try {
    const active = await chrome.tabs.query({ active: true })
    const stored = await chrome.storage.local.get([LAST_USED_KEY, ACTIVE_TABS_KEY])
    const lastUsed = stored[LAST_USED_KEY] && typeof stored[LAST_USED_KEY] === 'object' ? { ...stored[LAST_USED_KEY] as Record<string, number> } : {}
    const activeTabs = stored[ACTIVE_TABS_KEY] && typeof stored[ACTIVE_TABS_KEY] === 'object' ? { ...stored[ACTIVE_TABS_KEY] as Record<string, number> } : {}
    const now = Date.now()
    for (const tab of active) if (typeof tab.id === 'number') {
      lastUsed[String(tab.id)] = now
      activeTabs[String(tab.windowId)] = tab.id
    }
    await chrome.storage.local.set({ [LAST_USED_KEY]: lastUsed, [ACTIVE_TABS_KEY]: activeTabs })
  } catch { /* if timestamps cannot be read, the safe behavior is to skip candidates */ }
}
