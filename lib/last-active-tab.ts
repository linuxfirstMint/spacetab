import { z } from 'zod'

const KEY = 'lastActiveTabBySpace'

const LastActiveTabSchema = z.object({
  tabId: z.number().int().nonnegative(),
  url: z.string().min(1),
  urlOccurrence: z.number().int().nonnegative().optional(),
})

const LastActiveTabsSchema = z.record(z.string(), LastActiveTabSchema)

export type LastActiveTab = z.infer<typeof LastActiveTabSchema>

async function withActiveTabLock<T>(run: () => Promise<T>): Promise<T> {
  return navigator.locks.request('spacetab-last-active-tabs', run)
}

async function readAll(): Promise<Record<string, LastActiveTab>> {
  try {
    const stored = await chrome.storage.local.get(KEY)
    const parsed = LastActiveTabsSchema.safeParse(stored[KEY])
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export async function readLastActiveTab(spaceId: string): Promise<LastActiveTab | null> {
  const tabs = await readAll()
  return tabs[spaceId] ?? null
}

export async function writeLastActiveTab(
  spaceId: string,
  tab: LastActiveTab,
): Promise<void> {
  const parsed = LastActiveTabSchema.safeParse(tab)
  if (!parsed.success) return
  const value = { ...parsed.data, urlOccurrence: parsed.data.urlOccurrence ?? 0 }
  await withActiveTabLock(async () => {
    const tabs = await readAll()
    try {
      await chrome.storage.local.set({ [KEY]: { ...tabs, [spaceId]: value } })
    } catch {
      // A failed preference write must not interrupt tab switching.
    }
  })
}

export async function clearLastActiveTab(spaceId: string): Promise<void> {
  await withActiveTabLock(async () => {
    const tabs = await readAll()
    if (!(spaceId in tabs)) return
    delete tabs[spaceId]
    try {
      await chrome.storage.local.set({ [KEY]: tabs })
    } catch {
      // A failed cleanup must not interrupt tab removal or Space deletion.
    }
  })
}

export async function clearLastActiveTabById(tabId: number): Promise<void> {
  await withActiveTabLock(async () => {
    const tabs = await readAll()
    const next = Object.fromEntries(
      Object.entries(tabs).filter(([, tab]) => tab.tabId !== tabId),
    )
    if (Object.keys(next).length === Object.keys(tabs).length) return
    try {
      await chrome.storage.local.set({ [KEY]: next })
    } catch {
      // A failed cleanup must not interrupt tab removal.
    }
  })
}

export async function clearAllLastActiveTabs(): Promise<void> {
  await withActiveTabLock(async () => {
    try {
      await chrome.storage.local.set({ [KEY]: {} })
    } catch {
      // A failed cleanup must not interrupt startup restoration.
    }
  })
}
