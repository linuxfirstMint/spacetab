import { useState, useRef, useEffect } from 'react'
import { useT } from '@/lib/i18n'
import { useTheme, THEME_PREFS, type ThemePref } from '@/lib/theme'
import { Settings, Download, Upload } from './icons'
import { readAutoArchiveSettings, readAutoArchivedTabs, restoreAutoArchivedTab, writeAutoArchiveSettings } from '@/lib/auto-archive'
import type { AutoArchiveSettings, AutoArchivedTab, UrlRule } from '@/lib/schema'
import { useSpaceStore } from '@/stores/space-store'
import { normalizeUrlPattern } from '@/lib/url-rules'
import { readUrlRules, writeUrlRules } from '@/lib/url-rule-storage'
import { readDeletionHistory } from '@/lib/deletion-history'
import type { DeletionRecord } from '@/lib/schema'

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
  const [deleted, setDeleted] = useState<DeletionRecord[]>([])
  const spaces = useSpaceStore(state => state.db.spaces)
  const [rules, setRules] = useState<UrlRule[]>([])
  const [pattern, setPattern] = useState('https://*.example.com/*')
  const [spaceId, setSpaceId] = useState('')
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
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
    void readUrlRules().then(setRules)
    void readAutoArchivedTabs().then(setArchived)
    void readDeletionHistory().then(setDeleted)
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return
      if (changes.autoArchiveSettings) void readAutoArchiveSettings().then(setAutoArchive)
      if (changes.urlRoutingRules) void readUrlRules().then(setRules)
      if (changes.autoArchivedTabs) void readAutoArchivedTabs().then(setArchived)
      if (changes.deletionHistory) void readDeletionHistory().then(setDeleted)
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const saveAutoArchive = async (next: AutoArchiveSettings) => {
    if (await writeAutoArchiveSettings(next)) setAutoArchive(next)
  }
  const restoreDeleted = async (id: string) => {
    if (await useSpaceStore.getState().restoreDeletion(id)) setDeleted(await readDeletionHistory())
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
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">URL routing rules</div>
            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">Disabled until you add a rule. Matches full HTTP(S) URLs; * is a wildcard. Applies only to new links opened in a new tab, after redirects finish. Existing-tab navigation and OS links before Chrome receives them are not routed.</p>
            {rules.map((rule, index) => <div key={rule.id} className="flex items-center gap-1 text-xs">
              <input aria-label="Rule enabled" type="checkbox" checked={rule.enabled} onChange={async e => { const next = rules.map(item => item.id === rule.id ? { ...item, enabled: e.target.checked } : item); if (await writeUrlRules(next)) setRules(next) }} />
              <span className="min-w-0 flex-1 truncate" title={rule.pattern}>{rule.pattern} → {spaces.find(space => space.id === rule.spaceId)?.name ?? 'Missing Space'}</span>
              <button title="Edit rule" onClick={() => { setEditingRuleId(rule.id); setPattern(rule.pattern); setSpaceId(rule.spaceId) }}>Edit</button>
              <button title="Move rule up in priority" disabled={index === 0} onClick={async () => { const next = [...rules]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; const ordered = next.map((item, i) => ({ ...item, priority: i })); if (await writeUrlRules(ordered)) setRules(ordered) }}>↑</button>
              <button title="Move rule down in priority" disabled={index === rules.length - 1} onClick={async () => { const next = [...rules]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; const ordered = next.map((item, i) => ({ ...item, priority: i })); if (await writeUrlRules(ordered)) setRules(ordered) }}>↓</button>
              <button title="Delete rule" onClick={async () => { const next = rules.filter(item => item.id !== rule.id); if (await writeUrlRules(next)) { setRules(next); if (editingRuleId === rule.id) setEditingRuleId(null) } }}>×</button>
            </div>)}
            <div className="space-y-1">
              <input aria-label="URL pattern" value={pattern} onChange={e => setPattern(e.target.value)} className="w-full rounded border border-slate-200 bg-transparent p-1 text-xs dark:border-slate-700" placeholder="https://*.example.com/*" />
              <div className="flex gap-1">
                <select aria-label="Destination Space" value={spaceId} onChange={e => setSpaceId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 bg-transparent p-1 text-xs dark:border-slate-700">
                  <option value="">Choose Space</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
                </select>
                <button disabled={!normalizeUrlPattern(pattern) || !spaceId || !spaces.some(space => space.id === spaceId)} className="rounded border px-2 text-xs disabled:opacity-40" onClick={async () => { const clean = normalizeUrlPattern(pattern); if (!clean || !spaces.some(space => space.id === spaceId)) return; const next = editingRuleId ? rules.map(rule => rule.id === editingRuleId ? { ...rule, pattern: clean, spaceId } : rule) : [...rules, { id: crypto.randomUUID(), pattern: clean, spaceId, enabled: true, priority: rules.length }]; if (await writeUrlRules(next)) { setRules(next); setEditingRuleId(null) } }}>{editingRuleId ? 'Save' : 'Add'}</button>
                {editingRuleId && <button className="rounded border px-2 text-xs" onClick={() => setEditingRuleId(null)}>Cancel</button>}
              </div>
            </div>
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
            {deleted.length > 0 && <div className="border-t border-slate-100 pt-2 dark:border-slate-700">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Recently deleted · restore (up to 50)</div>
              {deleted.slice().reverse().map(item => <button key={item.id} onClick={() => void restoreDeleted(item.id)} className="block w-full truncate rounded px-1 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" title={item.kind === 'space' ? item.space.name : item.tab.url}>{item.kind === 'space' ? `Space · ${item.space.name}` : `Tab · ${item.tab.title || item.tab.url}`}</button>)}
              <p className="text-[10px] leading-4 text-slate-500">Restores saved URLs and Space structure. Page input and sign-in state are not restored.</p>
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
