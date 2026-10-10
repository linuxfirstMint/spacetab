const KEY = 'lastActiveSpaceId'

/** The last selected Space survives a browser restart; live tab IDs do not. */
export async function readLastActiveSpaceId(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(KEY)
    const id = stored[KEY]
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

export async function writeLastActiveSpaceId(id: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: id })
  } catch {
    // A failed preference write must not interrupt switching or strand tabs.
  }
}
