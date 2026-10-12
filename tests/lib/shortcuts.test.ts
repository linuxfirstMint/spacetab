import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE_SHORTCUT, formatShortcut, isImeComposition, isMacPlatform, isReservedPaletteShortcut, isSameShortcut, matchesPaletteShortcut, normalizeShortcutKey } from '@/lib/shortcuts'

describe('in-app shortcut rules', () => {
  it('normalizes a single letter or digit and rejects other keys', () => {
    expect(normalizeShortcutKey('K')).toBe('k')
    expect(normalizeShortcutKey('7')).toBe('7')
    expect(normalizeShortcutKey('ArrowDown')).toBeNull()
    expect(normalizeShortcutKey('あ')).toBeNull()
  })

  it('identifies common browser-reserved letter bindings', () => {
    expect(isReservedPaletteShortcut('w')).toBe(true)
    expect(isReservedPaletteShortcut('k')).toBe(false)
  })

  it('matches only the platform modifier and rejects extra modifiers', () => {
    expect(matchesPaletteShortcut({ key: 'K', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, DEFAULT_PALETTE_SHORTCUT, true)).toBe(true)
    expect(matchesPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, DEFAULT_PALETTE_SHORTCUT)).toBe(true)
    expect(matchesPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, DEFAULT_PALETTE_SHORTCUT)).toBe(false)
    expect(matchesPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, DEFAULT_PALETTE_SHORTCUT)).toBe(false)
    expect(matchesPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }, DEFAULT_PALETTE_SHORTCUT, true)).toBe(false)
  })

  it('detects macOS for displayed and active modifier choice', () => {
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('Win32')).toBe(false)
  })

  it('formats platform labels and compares assignments', () => {
    expect(formatShortcut(DEFAULT_PALETTE_SHORTCUT, true)).toBe('⌘+K')
    expect(formatShortcut(DEFAULT_PALETTE_SHORTCUT, false)).toBe('Ctrl+K')
    expect(isSameShortcut({ key: 'x', modifier: true }, { key: 'X', modifier: true })).toBe(true)
  })

  it('ignores both standard IME composition events and legacy keyCode 229', () => {
    expect(isImeComposition({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isImeComposition({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false)
  })
})
