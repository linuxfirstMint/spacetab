export const DEFAULT_PALETTE_SHORTCUT = { key: 'k', modifier: true } as const
export const PALETTE_SHORTCUT_STORAGE_KEY = 'paletteShortcut'

export interface PaletteShortcut {
  key: string
  modifier: true
}

const RESERVED_KEYS = new Set(['w', 'q', 't', 'n', 'l', 'r', 'p', 'j', 'h', 'd', 'f'])

export function normalizeShortcutKey(key: string): string | null {
  if (key.length !== 1 || !/[a-z0-9]/i.test(key)) return null
  return key.toLowerCase()
}

export function isReservedPaletteShortcut(key: string): boolean {
  return RESERVED_KEYS.has(key.toLowerCase())
}

export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad/.test(platform)
}

export function matchesPaletteShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, shortcut: PaletteShortcut, isMac = false): boolean {
  return (isMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === shortcut.key
}

export function formatShortcut(shortcut: PaletteShortcut, isMac: boolean): string {
  return `${isMac ? '⌘' : 'Ctrl'}+${shortcut.key.toUpperCase()}`
}

export function isSameShortcut(a: PaletteShortcut, b: PaletteShortcut): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase()
}

export function isImeComposition(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229
}
