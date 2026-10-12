export const LINK_PREVIEW_SESSION_KEY = 'linkPreviewWindow'

export type LinkPreviewSession = {
  windowId: number
  sourceWindowId: number
}

export function parsePreviewUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function readLinkPreviewSession(value: unknown): LinkPreviewSession | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LinkPreviewSession>
  return Number.isInteger(candidate.windowId) && Number.isInteger(candidate.sourceWindowId)
    ? { windowId: candidate.windowId!, sourceWindowId: candidate.sourceWindowId! }
    : null
}

export type PreviewDestination =
  | { kind: 'existing-window'; windowId: number }
  | { kind: 'new-window' }

export function choosePreviewDestination(
  sourceWindow: { id?: number | undefined; type?: string | undefined } | undefined,
  lastFocusedWindow: { id?: number | undefined; type?: string | undefined } | undefined,
  previewWindowId: number,
): PreviewDestination {
  if (sourceWindow?.type === 'normal' && typeof sourceWindow.id === 'number' && sourceWindow.id !== previewWindowId) {
    return { kind: 'existing-window', windowId: sourceWindow.id }
  }
  if (lastFocusedWindow?.type === 'normal' && typeof lastFocusedWindow.id === 'number' && lastFocusedWindow.id !== previewWindowId) {
    return { kind: 'existing-window', windowId: lastFocusedWindow.id }
  }
  return { kind: 'new-window' }
}
