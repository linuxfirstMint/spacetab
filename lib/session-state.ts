export interface SessionState {
  vaultWindowId: number | null
  spaceIdToTabIds: Record<string, number[]>
  /** Active Space owned by each normal Chrome window (keys are window IDs). */
  windowIdToSpaceId?: Record<string, string>
  /** 当前可见窗口对应的空间 id;切换时更新,用于撤销切换。
   *  可选以兼容旧测试夹具,读取时统一用 `?? null`。 */
  currentSpaceId?: string | null
}

const KEYS = ['vaultWindowId', 'spaceIdToTabIds', 'windowIdToSpaceId', 'currentSpaceId'] as const

export const EMPTY_SESSION: SessionState = {
  vaultWindowId: null,
  spaceIdToTabIds: {},
  windowIdToSpaceId: {},
  currentSpaceId: null,
}

export async function readSessionState(): Promise<SessionState> {
  try {
    const stored = await chrome.storage.session.get(KEYS as unknown as string[])
    const win = stored.vaultWindowId
    const map = stored.spaceIdToTabIds
    const windows = stored.windowIdToSpaceId
    const cur = stored.currentSpaceId
    return {
      vaultWindowId: typeof win === 'number' ? win : null,
      spaceIdToTabIds:
        map && typeof map === 'object' && !Array.isArray(map)
          ? (map as Record<string, number[]>)
          : {},
      windowIdToSpaceId:
        windows && typeof windows === 'object' && !Array.isArray(windows)
          ? Object.fromEntries(Object.entries(windows).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
          : {},
      currentSpaceId: typeof cur === 'string' && cur.length > 0 ? cur : null,
    }
  } catch {
    return EMPTY_SESSION
  }
}

export async function writeSessionState(s: SessionState): Promise<void> {
  try {
    await chrome.storage.session.set({
      vaultWindowId: s.vaultWindowId,
      spaceIdToTabIds: s.spaceIdToTabIds,
      windowIdToSpaceId: s.windowIdToSpaceId ?? {},
      currentSpaceId: s.currentSpaceId ?? null,
    })
  } catch {
    // 写失败不阻塞主流程,下一次读会回退到 EMPTY_SESSION
  }
}

export function untagTabIdInState(state: SessionState, tabId: number): SessionState {
  let changed = false
  const next: Record<string, number[]> = {}
  for (const [sid, ids] of Object.entries(state.spaceIdToTabIds)) {
    const filtered = ids.filter((id) => id !== tabId)
    if (filtered.length !== ids.length) changed = true
    if (filtered.length > 0) next[sid] = filtered
  }
  if (!changed) return state
  return { ...state, spaceIdToTabIds: next }
}

export function tagTabIdsForSpace(
  state: SessionState,
  spaceId: string,
  ids: number[],
): SessionState {
  if (ids.length === 0) return state
  const existing = state.spaceIdToTabIds[spaceId] ?? []
  const idSet = new Set(ids)
  const merged = [...existing.filter((id) => !idSet.has(id)), ...ids]
  return {
    ...state,
    spaceIdToTabIds: { ...state.spaceIdToTabIds, [spaceId]: merged },
  }
}

export function dropSpaceFromState(state: SessionState, spaceId: string): SessionState {
  const hasTabs = spaceId in state.spaceIdToTabIds
  const hasWindow = Object.values(state.windowIdToSpaceId ?? {}).includes(spaceId)
  if (!hasTabs && !hasWindow) return state
  const spaceIdToTabIds = { ...state.spaceIdToTabIds }
  delete spaceIdToTabIds[spaceId]
  const windowIdToSpaceId = Object.fromEntries(
    Object.entries(state.windowIdToSpaceId ?? {}).filter(([, activeSpaceId]) => activeSpaceId !== spaceId),
  )
  return {
    ...state,
    spaceIdToTabIds,
    windowIdToSpaceId,
    ...(state.currentSpaceId === spaceId ? { currentSpaceId: null } : {}),
  }
}

export function activeSpaceForWindow(state: SessionState, windowId: number): string | null {
  return state.windowIdToSpaceId?.[String(windowId)] ?? null
}

export function setActiveSpaceForWindow(state: SessionState, windowId: number, spaceId: string): SessionState {
  return {
    ...state,
    currentSpaceId: spaceId,
    windowIdToSpaceId: { ...(state.windowIdToSpaceId ?? {}), [String(windowId)]: spaceId },
  }
}

export function removeWindowFromState(state: SessionState, windowId: number): SessionState {
  const key = String(windowId)
  if (!(key in (state.windowIdToSpaceId ?? {}))) return state
  const windowIdToSpaceId = { ...state.windowIdToSpaceId }
  const removedSpaceId = windowIdToSpaceId[key]
  delete windowIdToSpaceId[key]
  const remaining = Object.values(windowIdToSpaceId)
  return {
    ...state,
    windowIdToSpaceId,
    ...(state.currentSpaceId === removedSpaceId ? { currentSpaceId: remaining.at(-1) ?? null } : {}),
  }
}
