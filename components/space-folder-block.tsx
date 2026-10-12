import type { ReactNode } from 'react'
import type { SpaceFolder } from '@/lib/schema'
import { useT } from '@/lib/i18n'
import { ChevronDown, Pencil, Trash } from './icons'
import { Plus } from './icons'

interface Props {
  folder: SpaceFolder
  count: number
  canMoveUp: boolean
  canMoveDown: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onCreateChild: () => void
  canCreateChild: boolean
  parentOptions: { id: string; name: string }[]
  onMoveToParent: (parentId: string | undefined) => void
  children: ReactNode
}

export function SpaceFolderBlock({ folder, count, canMoveUp, canMoveDown, onToggle, onRename, onDelete, onMoveUp, onMoveDown, onCreateChild, canCreateChild, parentOptions, onMoveToParent, children }: Props) {
  const { t } = useT()
  return (
    <section className="rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/30 overflow-visible" aria-label={folder.name}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button onClick={onToggle} aria-expanded={!folder.collapsed} aria-label={folder.collapsed ? t('expandFolder') : t('collapseFolder')} className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${folder.collapsed ? '-rotate-90' : ''}`} />
        </button>
        <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{folder.name}</span>
        <span className="text-[10px] text-slate-400 font-mono">{count}</span>
        {canCreateChild && <button onClick={onCreateChild} aria-label={t('newFolder')} title={t('newFolder')} className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700"><Plus className="w-3 h-3" /></button>}
        <select aria-label={t('moveFolder')} value={folder.parentId ?? ''} onChange={(event) => onMoveToParent(event.target.value || undefined)} className="max-w-20 bg-transparent text-[10px] text-slate-500"><option value="">{t('rootFolder')}</option>{parentOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
        <button onClick={onMoveUp} disabled={!canMoveUp} aria-label={t('moveFolderUp')} title={t('moveFolderUp')} className="w-5 h-5 rounded text-slate-400 hover:bg-slate-200/70 disabled:opacity-30 dark:hover:bg-slate-700">↑</button>
        <button onClick={onMoveDown} disabled={!canMoveDown} aria-label={t('moveFolderDown')} title={t('moveFolderDown')} className="w-5 h-5 rounded text-slate-400 hover:bg-slate-200/70 disabled:opacity-30 dark:hover:bg-slate-700">↓</button>
        <button onClick={onRename} aria-label={t('renameFolder')} title={t('renameFolder')} className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 dark:hover:bg-slate-700"><Pencil className="w-3 h-3" /></button>
        <button onClick={onDelete} aria-label={t('deleteFolder')} title={t('deleteFolder')} className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash className="w-3 h-3" /></button>
      </div>
      {!folder.collapsed && <div className="px-1 pb-1 space-y-0.5">{children}</div>}
    </section>
  )
}
