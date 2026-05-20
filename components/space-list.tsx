import type { Space } from '@/lib/schema'
import { useT } from '@/lib/i18n'
import { SpaceItem } from './space-item'
import { Layers } from './icons'

interface Props {
  spaces: Space[]
  /** App 已经把 spaces 排好序传进来,SpaceList 不再排 */
  focusedSpaceId?: string | null
  onSwitch: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onTabOpen: (url: string) => void
  onTabRemove: (spaceId: string, url: string) => void
  onTabMove: (fromId: string, toId: string, url: string) => void
  onTabReorder: (spaceId: string, orderedUrls: string[]) => void
  onTabsRemove: (spaceId: string, urls: string[]) => void
  onTabsMove: (fromId: string, toId: string, urls: string[]) => void
  onLiveTabDrop: (tabId: number, toSpaceId: string) => void
  onMerge: (fromId: string, toId: string) => void
  onReorder: (fromId: string, toId: string, position: 'before' | 'after') => void
  onTogglePinned: (id: string) => void
  onSetEmoji: (id: string, emoji: string | undefined) => void
  onSetNote: (id: string, note: string | undefined) => void
  groupingEnabled: boolean
}

export function SpaceList({
  spaces,
  focusedSpaceId = null,
  onSwitch,
  onRename,
  onDelete,
  onDuplicate,
  onTabOpen,
  onTabRemove,
  onTabMove,
  onTabReorder,
  onTabsRemove,
  onTabsMove,
  onLiveTabDrop,
  onMerge,
  onReorder,
  onTogglePinned,
  onSetEmoji,
  onSetNote,
  groupingEnabled,
}: Props) {
  const { t } = useT()

  if (spaces.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 px-6 py-16 text-center bg-slate-50 dark:bg-slate-800/40">
        <Layers className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">{t('emptyTitle')}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('emptySubtitle')}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {spaces.map((s) => (
        <SpaceItem
          key={s.id}
          space={s}
          otherSpaces={spaces.filter((x) => x.id !== s.id)}
          focused={focusedSpaceId === s.id}
          onSwitch={onSwitch}
          onRename={onRename}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onTabOpen={onTabOpen}
          onTabRemove={onTabRemove}
          onTabMove={onTabMove}
          onTabReorder={onTabReorder}
          onTabsRemove={onTabsRemove}
          onTabsMove={onTabsMove}
          onLiveTabDrop={onLiveTabDrop}
          onMerge={onMerge}
          onReorder={onReorder}
          onTogglePinned={onTogglePinned}
          onSetEmoji={onSetEmoji}
          onSetNote={onSetNote}
          groupingEnabled={groupingEnabled}
        />
      ))}
    </div>
  )
}
