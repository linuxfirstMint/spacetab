import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'

// chrome.i18n は fakeBrowser に実装されていないため、navigator.language で検出する
// detectBrowserLang のテストでは navigator.language をスタブする

describe('detectBrowserLang', () => {
  // chrome.i18n が undefined の状態 (fakeBrowser のデフォルト) で navigator.language を使う
  beforeEach(() => {
    // chrome.i18n を undefined に設定してから各テストが navigator にフォールバックするようにする
    vi.stubGlobal('chrome', { ...chrome, i18n: undefined })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('chrome', fakeBrowser)
  })

  const withLang = (lang: string) => {
    vi.stubGlobal('navigator', { language: lang })
  }

  it('maps zh-CN to zh-CN', async () => {
    withLang('zh-CN')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('zh-CN')
  })

  it('maps zh-TW to zh-TW', async () => {
    withLang('zh-TW')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('zh-TW')
  })

  it('maps zh-HK to zh-TW (Traditional)', async () => {
    withLang('zh-HK')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('zh-TW')
  })

  it('maps zh-Hant to zh-TW via script tag', async () => {
    withLang('zh-Hant')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('zh-TW')
  })

  it('maps bare zh to zh-CN', async () => {
    withLang('zh')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('zh-CN')
  })

  it('maps zh-SG to zh-CN', async () => {
    withLang('zh-SG')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('zh-CN')
  })

  it('maps ja-JP to ja', async () => {
    withLang('ja-JP')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('ja')
  })

  it('maps de-DE to de', async () => {
    withLang('de-DE')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('de')
  })

  it('maps de-AT to de', async () => {
    withLang('de-AT')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('de')
  })

  it('defaults to en for fr-FR', async () => {
    withLang('fr-FR')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('en')
  })

  it('defaults to en for ko-KR', async () => {
    withLang('ko-KR')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('en')
  })

  it('defaults to en for empty string', async () => {
    withLang('')
    const { detectBrowserLang } = await import('@/lib/i18n')
    expect(detectBrowserLang()).toBe('en')
  })
})

describe('format', () => {
  // format は純粋関数なので navigator/chrome 不要
  it('interpolates {n} correctly', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('en', 'spacesCount', { n: 5 })).toBe('5 spaces')
  })

  it('interpolates {name} correctly', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('en', 'toastSwitched', { name: 'Work' })).toBe('Switched to "Work"')
  })

  it('interpolates multiple params', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('en', 'confirmDelete', { name: 'Work', n: 3 })).toBe(
      'Delete "Work"? Its 3 tabs will be lost.',
    )
  })

  it('falls back to en when key missing in requested language', async () => {
    const { format } = await import('@/lib/i18n')
    // 存在しないキーはキー文字列そのものを返す
    expect(format('ja', '__nonexistent_key__')).toBe('__nonexistent_key__')
  })

  it('returns the key string when missing in both target and en', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('zh-CN', 'totally_missing_key_xyz')).toBe('totally_missing_key_xyz')
  })

  it('works for zh-CN translations', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('zh-CN', 'mySpaces')).toBe('我的空间')
    expect(format('zh-CN', 'timeJustNow')).toBe('刚刚')
  })

  it('works for ja translations', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('ja', 'switchAction')).toBe('切り替え')
  })

  it('works for de translations', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('de', 'switchAction')).toBe('Wechseln')
  })

  it('localizes shortcut settings and conflict guidance in every supported language', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('zh-CN', 'keyboardShortcuts')).toBe('键盘快捷键')
    expect(format('zh-TW', 'shortcutClose')).toBe('關閉')
    expect(format('en', 'shortcutOpenChromeSettings')).toBe('Open Chrome shortcut settings')
    expect(format('ja', 'shortcutChromeConflict', { commands: 'Next Space' })).toContain('Next Space')
    expect(format('de', 'shortcutChromeNote')).toContain('Chrome')
  })

  it('handles {n} in time keys', async () => {
    const { format } = await import('@/lib/i18n')
    expect(format('en', 'timeMinutesAgo', { n: 10 })).toBe('10m ago')
  })
})

describe('readLang / writeLang', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('returns browser lang when storage is empty (falls back to navigator)', async () => {
    // navigator.language = 'ja' (already set by fakeBrowser global, which has no i18n)
    vi.stubGlobal('navigator', { language: 'ja-JP' })
    vi.stubGlobal('chrome', { ...fakeBrowser, i18n: undefined })
    const { readLang } = await import('@/lib/i18n')
    const lang = await readLang()
    expect(lang).toBe('ja')
    vi.unstubAllGlobals()
    vi.stubGlobal('chrome', fakeBrowser)
  })

  it('round-trips: writeLang then readLang returns the same lang', async () => {
    const { writeLang, readLang, LANGS } = await import('@/lib/i18n')
    for (const l of LANGS) {
      await writeLang(l)
      const back = await readLang()
      expect(back).toBe(l)
    }
  })

  it('ignores invalid values in storage and falls back to navigator', async () => {
    await fakeBrowser.storage.local.set({ lang: 'invalid-lang' })
    vi.stubGlobal('navigator', { language: 'de-DE' })
    vi.stubGlobal('chrome', { ...fakeBrowser, i18n: undefined })
    const { readLang } = await import('@/lib/i18n')
    const lang = await readLang()
    expect(lang).toBe('de')
    vi.unstubAllGlobals()
    vi.stubGlobal('chrome', fakeBrowser)
  })
})
