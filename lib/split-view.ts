/** Chrome 155 native Split View support. Keep this API behind a runtime feature check
 * because @types/chrome versions in use may predate tabs.createSplit/unsplit. */
export type SplitResult =
  | { ok: true; splitViewId: number }
  | { ok: false; reason: 'unsupported' | 'manager-unavailable' | 'tabs-not-live' | 'different-window' | 'pinned-mismatch' | 'group-mismatch' | 'already-split' | 'not-adjacent' | 'not-split-together' | 'api-error' }

export type SplitTab = { id?: number; url?: string; windowId: number; index: number; pinned?: boolean; groupId?: number; splitViewId?: number }
export type SplitApi = {
  tabs: {
    getCurrent: () => Promise<SplitTab | undefined>
    query: (query: { windowId: number }) => Promise<SplitTab[]>
    createSplit?: (tabIds: [number, number]) => Promise<number>
    unsplit?: (splitViewId: number) => Promise<void>
  }
}

export async function unsplitLiveSpaceTabs(urls: string[], api: SplitApi = chrome as unknown as SplitApi): Promise<SplitResult> {
  if (typeof api.tabs.unsplit !== 'function') return { ok: false, reason: 'unsupported' }
  if (urls.length !== 2 || urls[0] === urls[1]) return { ok: false, reason: 'tabs-not-live' }
  const manager = await api.tabs.getCurrent()
  if (!manager || typeof manager.id !== 'number') return { ok: false, reason: 'manager-unavailable' }
  const windowTabs = await api.tabs.query({ windowId: manager.windowId })
  const selected = urls.map((url) => windowTabs.find((tab) => tab.url === url))
  if (!selected[0] || !selected[1] || typeof selected[0].id !== 'number' || typeof selected[1].id !== 'number') return { ok: false, reason: 'tabs-not-live' }
  const [left, right] = selected as [SplitTab, SplitTab]
  const splitViewId = left.splitViewId ?? -1
  if (splitViewId < 0 || right.splitViewId !== splitViewId) return { ok: false, reason: 'not-split-together' }
  try {
    await api.tabs.unsplit(splitViewId)
    return { ok: true, splitViewId }
  } catch {
    return { ok: false, reason: 'api-error' }
  }
}

export async function splitLiveSpaceTabs(urls: string[], api: SplitApi = chrome as unknown as SplitApi): Promise<SplitResult> {
  if (typeof api.tabs.createSplit !== 'function') return { ok: false, reason: 'unsupported' }
  if (urls.length !== 2 || urls[0] === urls[1]) return { ok: false, reason: 'tabs-not-live' }
  const manager = await api.tabs.getCurrent()
  if (!manager || typeof manager.id !== 'number') return { ok: false, reason: 'manager-unavailable' }
  const windowTabs = await api.tabs.query({ windowId: manager.windowId })
  const selected = urls.map((url) => windowTabs.find((tab) => tab.url === url))
  if (!selected[0] || !selected[1] || typeof selected[0].id !== 'number' || typeof selected[1].id !== 'number') return { ok: false, reason: 'tabs-not-live' }
  const [left, right] = selected as [SplitTab, SplitTab]
  if (left.windowId !== right.windowId) return { ok: false, reason: 'different-window' }
  if ((left.pinned ?? false) !== (right.pinned ?? false)) return { ok: false, reason: 'pinned-mismatch' }
  if ((left.groupId ?? -1) !== (right.groupId ?? -1)) return { ok: false, reason: 'group-mismatch' }
  if ((left.splitViewId ?? -1) !== -1 || (right.splitViewId ?? -1) !== -1) return { ok: false, reason: 'already-split' }
  if (Math.abs(left.index - right.index) !== 1) return { ok: false, reason: 'not-adjacent' }
  const ids: [number, number] = left.index < right.index ? [left.id!, right.id!] : [right.id!, left.id!]
  try {
    return { ok: true, splitViewId: await api.tabs.createSplit(ids) }
  } catch {
    return { ok: false, reason: 'api-error' }
  }
}
