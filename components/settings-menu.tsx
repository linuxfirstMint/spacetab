import { useState, useRef, useEffect } from 'react'
import { useT } from '@/lib/i18n'
import { useTheme, THEME_PREFS, type ThemePref } from '@/lib/theme'
import { Settings, Download, Upload } from './icons'
import { readAutoArchiveSettings, readAutoArchivedTabs, restoreAutoArchivedTab, writeAutoArchiveSettings } from '@/lib/auto-archive'
import type { AutoArchiveSettings, AutoArchivedTab } from '@/lib/schema'

interface Props {
  onExport: () => void
  onImport: () => void
}

export function SettingsMenu({ onExport, onImport }: Props) {
  const { t } = useT()
  const { pref: themePref, setPref: setThemePref } = useTheme()
  const [open, setOpen] = useState(false)
  const [autoArchive, setAutoArchive] = useState<AutoArchiveSettings>({ enabled: false, inactivityHours: 12 })
  const [archived, setArchived] = useState<AutoArchivedTab[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    void readAutoArchiveSettings().then(setAutoArchive)
    void readAutoArchivedTabs().then(setArchived)
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return
      if (changes.autoArchiveSettings) void readAutoArchiveSettings().then(setAutoArchive)
      if (changes.autoArchivedTabs) void readAutoArchivedTabs().then(setArchived)
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const saveAutoArchive = async (next: AutoArchiveSettings) => {
    if (await writeAutoArchiveSettings(next)) setAutoArchive(next)
  }

  const themeLabel = (p: ThemePref): string => {
    if (p === 'system') return t('themeSystem')
    if (p === 'light') return t('themeLight')
    return t('themeDark')
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        title={t('settings')}
        aria-label={t('settings')}
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-30">
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('theme')}
          </div>
          <div className="px-1 pb-1.5">
            {THEME_PREFS.map((p) => (
              <button
                key={p}
                onClick={() => setThemePref(p)}
                className={`block w-full text-left px-2 py-1 text-sm rounded transition-colors ${
                  p === themePref
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {themeLabel(p)}
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 dark:border-slate-700 p-3 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Automatic tab archive</div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={autoArchive.enabled} onChange={e => void saveAutoArchive({ ...autoArchive, enabled: e.target.checked })} />
              Enable automatic archive
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span>After inactivity</span>
              <select value={autoArchive.inactivityHours} onChange={e => void saveAutoArchive({ ...autoArchive, inactivityHours: Number(e.target.value) })} className="rounded border border-slate-200 bg-transparent p-1 dark:border-slate-700" disabled={!autoArchive.enabled}>
                {[1, 3, 6, 12, 24, 48, 72, 168].map(hours => <option key={hours} value={hours}>{hours}h</option>)}
              </select>
            </label>
            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">Disabled by default. Pinned tabs, Favorites, Space-pinned/folder tabs, active tabs, and currently audible tabs are skipped. Chrome cannot detect unsaved form/editor input or audio that is not currently audible. Only URL and title are saved; page state is not recoverable.</p>
            {archived.length > 0 && <div className="border-t border-slate-100 pt-2 dark:border-slate-700">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Auto-archived · restore</div>
              {archived.slice().reverse().map(item => <button key={item.id} onClick={async () => { if (await restoreAutoArchivedTab(item.id)) setArchived(await readAutoArchivedTabs()) }} className="block w-full truncate rounded px-1 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" title={item.url}>{item.title || item.url}</button>)}
            </div>}
          </div>
          <div className="border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => {
                onExport()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-200"
            >
              <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>{t('exportJson')}</span>
            </button>
            <button
              onClick={() => {
                onImport()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-200 border-t border-slate-100 dark:border-slate-800"
            >
              <Upload className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>{t('importJson')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
