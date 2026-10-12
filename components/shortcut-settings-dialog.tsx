import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_PALETTE_SHORTCUT, formatShortcut, isImeComposition, isMacPlatform, isReservedPaletteShortcut, isSameShortcut, normalizeShortcutKey, PALETTE_SHORTCUT_STORAGE_KEY, type PaletteShortcut } from '@/lib/shortcuts'
import { useT } from '@/lib/i18n'

interface Props { onClose: () => void }

function readShortcut(value: unknown): PaletteShortcut | null {
  if (value === null) return null
  if (value && typeof value === 'object' && 'key' in value && typeof value.key === 'string') {
    const key = normalizeShortcutKey(value.key)
    if (key && !isReservedPaletteShortcut(key)) return { key, modifier: true }
  }
  return DEFAULT_PALETTE_SHORTCUT
}

export function ShortcutSettingsDialog({ onClose }: Props) {
  const { t } = useT()
  const [shortcut, setShortcut] = useState<PaletteShortcut | null>(DEFAULT_PALETTE_SHORTCUT)
  const [commands, setCommands] = useState<chrome.commands.Command[]>([])
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const isMac = useMemo(() => isMacPlatform(navigator.platform), [])
  const display = (item: PaletteShortcut) => formatShortcut(item, isMac)

  useEffect(() => {
    void chrome.storage.local.get(PALETTE_SHORTCUT_STORAGE_KEY).then(value => setShortcut(PALETTE_SHORTCUT_STORAGE_KEY in value ? readShortcut(value[PALETTE_SHORTCUT_STORAGE_KEY]) : DEFAULT_PALETTE_SHORTCUT)).catch(() => undefined)
    try { void chrome.commands.getAll().then(setCommands).catch(() => setCommands([])) } catch { setCommands([]) }
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes[PALETTE_SHORTCUT_STORAGE_KEY]) setShortcut(readShortcut(changes[PALETTE_SHORTCUT_STORAGE_KEY]?.newValue))
    }
    chrome.storage.onChanged.addListener(onChanged)
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus())
    return () => { chrome.storage.onChanged.removeListener(onChanged); prior?.focus() }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isImeComposition(event)) { event.preventDefault(); onClose(); return }
      if (!recording || isImeComposition(event)) return
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) {
        if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Meta' && event.key !== 'Alt') setNotice(t('shortcutModifierPrompt'))
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      const key = normalizeShortcutKey(event.key)
      if (!key) { setNotice(t('shortcutLetterPrompt')); return }
      if (isReservedPaletteShortcut(key)) { setNotice(t('shortcutReservedPrompt')); return }
      const next = { key, modifier: true as const }
      setShortcut(next); setRecording(false); setNotice('')
      void chrome.storage.local.set({ [PALETTE_SHORTCUT_STORAGE_KEY]: next }).catch(() => setNotice(t('shortcutSaveFailed')))
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [recording, onClose])

  const clashes = shortcut ? commands.filter(command => command.shortcut && command.name && isSameShortcut(shortcut, readChromeShortcut(command.shortcut, isMac))) : []

  return createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="shortcut-dialog-title" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900" onKeyDown={event => {
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="shortcut-dialog-title" className="text-lg font-semibold">{t('keyboardShortcuts')}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('shortcutIntro')}</p></div>
        <button type="button" className="rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} aria-label={t('shortcutClose')}>×</button>
      </div>
      <section className="mt-5 space-y-3" aria-labelledby="app-shortcuts-heading">
        <h3 id="app-shortcuts-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('shortcutScopeInApp')}</h3>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><span className="text-sm">{t('shortcutOpenPalette')}</span><span className="font-mono text-sm">{shortcut ? display(shortcut) : t('shortcutOff')}</span></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setRecording(true); setNotice(t('shortcutModifierPrompt')) }} className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">{recording ? t('shortcutModifierPrompt') : t('shortcutChange')}</button>
          <button type="button" onClick={() => { setShortcut(DEFAULT_PALETTE_SHORTCUT); setRecording(false); setNotice(''); void chrome.storage.local.remove(PALETTE_SHORTCUT_STORAGE_KEY).catch(() => undefined) }} className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">{t('shortcutReset')}</button>
          <button type="button" onClick={() => { setShortcut(null); setRecording(false); setNotice(t('shortcutCleared')); void chrome.storage.local.set({ [PALETTE_SHORTCUT_STORAGE_KEY]: null }).catch(() => setNotice(t('shortcutClearFailed'))) }} className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">{t('shortcutClear')}</button>
        </div>
        {notice && <p role="status" aria-live="polite" className="text-sm text-amber-700 dark:text-amber-300">{notice}</p>}
        {clashes.length > 0 && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t('shortcutChromeConflict', { commands: clashes.map(c => c.description || c.name).join(', ') })}</p>}
      </section>
      <section className="mt-5 space-y-2" aria-labelledby="chrome-shortcuts-heading">
        <h3 id="chrome-shortcuts-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('shortcutChromeManaged')}</h3>
        {commands.filter(command => command.name).map(command => <div key={command.name} className="flex justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800"><span>{command.description || command.name}</span><span className="font-mono text-slate-500">{command.shortcut || t('shortcutNotAssigned')}</span></div>)}
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('shortcutChromeNote')}</p>
        <button type="button" className="text-sm font-medium text-indigo-600 underline dark:text-indigo-400" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>{t('shortcutOpenChromeSettings')}</button>
      </section>
      <section className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('shortcutFixed')}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('shortcutFixedDescription')}</p>
      </section>
    </div>
  </div>, document.body)
}

function readChromeShortcut(value: string, isMac: boolean): PaletteShortcut {
  const key = value.split('+').at(-1)?.trim().toLowerCase() ?? ''
  const usesExpectedModifier = isMac ? /command|meta/i.test(value) : /ctrl|control/i.test(value)
  return { key: usesExpectedModifier ? key : `!${key}`, modifier: true }
}
