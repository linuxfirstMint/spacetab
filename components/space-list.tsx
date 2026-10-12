import type { Space, SpaceColor, Tab } from '@/lib/schema'
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
  onTabPin: (spaceId: string, url: string, pinned: boolean) => void
  onTabFavorite: (spaceId: string, tab: Tab) => void
  favoriteUrls: string[]
  onTabRestoreUrl: (spaceId: string, url: string) => void
  onCreateFolder: (spaceId: string, name: string, parentId?: string) => void
  onMoveFolder: (spaceId: string, folderId: string, parentId: string | undefined) => void
  onRenameFolder: (spaceId: string, folderId: string, name: string) => void
  onDeleteFolder: (spaceId: string, folderId: string) => void
  onSetFolderCollapsed: (spaceId: string, folderId: string, collapsed: boolean) => void
  onReorderFolders: (spaceId: string, folderIds: string[]) => void
  onMoveTabToFolder: (spaceId: string, url: string, folderId: string | undefined) => void
  onTabMove: (fromId: string, toId: string, url: string) => void
  onTabReorder: (spaceId: string, orderedUrls: string[]) => void
  onTabsRemove: (spaceId: string, urls: string[]) => void
  onTabsMove: (fromId: string, toId: string, urls: string[]) => void
  onLiveTabDrop: (tabId: number, toSpaceId: string) => void
  onMerge: (fromId: string, toId: string) => void
  onReorder: (fromId: string, toId: string, position: 'before' | 'after') => void
  onTogglePinned: (id: string) => void
  onSetEmoji: (id: string, emoji: string | undefined) => void
  onSetColor: (id: string, color: SpaceColor | undefined) => void
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
  onTabPin,
  onTabFavorite,
  favoriteUrls,
  onTabRestoreUrl,
  onCreateFolder,
  onMoveFolder,
  onRenameFolder,
  onDeleteFolder,
  onSetFolderCollapsed,
  onReorderFolders,
  onMoveTabToFolder,
  onTabMove,
  onTabReorder,
  onTabsRemove,
  onTabsMove,
  onLiveTabDrop,
  onMerge,
  onReorder,
  onTogglePinned,
  onSetEmoji,
  onSetColor,
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
          onTabPin={onTabPin}
          onTabFavorite={onTabFavorite}
          favoriteUrls={favoriteUrls}
          onTabRestoreUrl={onTabRestoreUrl}
          onCreateFolder={onCreateFolder}
          onMoveFolder={onMoveFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onSetFolderCollapsed={onSetFolderCollapsed}
          onReorderFolders={onReorderFolders}
          onMoveTabToFolder={onMoveTabToFolder}
          onTabMove={onTabMove}
          onTabReorder={onTabReorder}
          onTabsRemove={onTabsRemove}
          onTabsMove={onTabsMove}
          onLiveTabDrop={onLiveTabDrop}
          onMerge={onMerge}
          onReorder={onReorder}
          onTogglePinned={onTogglePinned}
          onSetEmoji={onSetEmoji}
          onSetColor={onSetColor}
          onSetNote={onSetNote}
          groupingEnabled={groupingEnabled}
        />
      ))}
    </div>
  )
}
