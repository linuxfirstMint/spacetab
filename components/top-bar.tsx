import { useState, useRef, useEffect } from 'react'
import { Layers, Globe, Group, HelpCircle, Search, X } from './icons'
import { useT, LANGS, LANG_LABELS } from '@/lib/i18n'
import type { Space } from '@/lib/schema'
import { SettingsMenu } from './settings-menu'

interface Props {
  spaces: Space[]
  query: string
  onQueryChange: (q: string) => void
  searchInputRef?: React.Ref<HTMLInputElement>
  onExport: () => void
  onImport: () => void
  onHelp: () => void
  groupingEnabled: boolean
  onToggleGrouping: () => void
}

function LanguageSwitcher() {
  const { lang, setLang, t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        title={t('languageSelect')}
        aria-label="Language"
      >
        <Globe className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden z-30">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => {
                setLang(l)
                setOpen(false)
              }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                l === lang ? 'text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-600 dark:text-slate-300 dark:text-slate-600'
              }`}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TopBar({
  spaces,
  query,
  onQueryChange,
  searchInputRef,
  onExport,
  onImport,
  onHelp,
  groupingEnabled,
  onToggleGrouping,
}: Props) {
  const { t } = useT()

  return (
    <header className="sticky top-0 z-30 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-b border-slate-200 dark:border-slate-700/60">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
        {/* 左:品牌(自身宽度 + flex-1 撑开) */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-violet-200/60 shrink-0">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">SpaceTab</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
              {t('spacesAndTabsCount', {
                s: spaces.length,
                t: spaces.reduce((sum, sp) => sum + sp.tabs.length, 0),
              })}
            </p>
          </div>
        </div>

        {/* 中:搜索(固定宽度,居中) */}
        <div className="w-full max-w-md relative shrink-0">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          </div>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md bg-slate-100/80 dark:bg-slate-800/60 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-300 dark:focus:border-slate-600 focus:outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 transition-colors"
            aria-label={t('searchPlaceholder')}
          />
          {query.length > 0 && (
            <button
              onClick={() => onQueryChange('')}
              className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 右:按钮组靠右(flex-1 + justify-end) */}
        <div className="flex-1 flex items-center justify-end gap-2">
          {/* 分组开关:胶囊形,图标 + 文字,意图明确 */}
          <button
            onClick={onToggleGrouping}
            className={`h-8 pl-2 pr-2.5 flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-colors ${
              groupingEnabled
                ? 'text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            title={t('groupTabsByDomain')}
            aria-label={t('groupTabsByDomain')}
            aria-pressed={groupingEnabled}
          >
            <Group className="w-4 h-4" />
            <span>{t('tabGrouping')}</span>
          </button>
          <button
            onClick={onHelp}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title={t('helpLabel')}
            aria-label={t('helpLabel')}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <LanguageSwitcher />
          <SettingsMenu onExport={onExport} onImport={onImport} />
        </div>
      </div>
    </header>
  )
}
