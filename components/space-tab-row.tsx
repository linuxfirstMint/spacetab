import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Tab, Space } from '@/lib/schema'
import { useT } from '@/lib/i18n'
import type { SpacePalette } from '@/lib/ui-utils'
import { ArrowRight, Pin, Trash } from './icons'

interface Props {
  tab: Tab
  otherSpaces: Space[]
  palette: SpacePalette
  fromSpaceId: string
  selected: boolean
  /** 当前空间的整体选区(按源顺序),拖拽时作为 payload */
  selectedUrls: string[]
  /** 该 tab 所在分组的色块 class(如 'bg-blue-500');未分组传 undefined */
  groupBarClass?: string
  /** 该 tab 所在分组的标题(可选) */
  groupTitle?: string
  onOpen: (url: string) => void
  onRemove: (url: string) => void
  onTogglePinned: (url: string, pinned: boolean) => void
  onRestoreUrl: (url: string) => void
  onMove: (toSpaceId: string, url: string) => void
  /** 同空间内排序:把 fromUrls(>=1)整体移动到本行的前/后位置 */
  onReorderInSpace: (fromUrls: string[], position: 'before' | 'after') => void
  /** Cmd/Ctrl+点击:切换本行选中 */
  onSelectToggle: (url: string) => void
  /** Shift+点击:从锚点到本行做区间选择 */
  onSelectRange: (url: string) => void
}

// 同空间标识符:dragstart 时塞一个空 data,dragover 阶段就能从 types 里识别
const sameSpaceMarker = (spaceId: string) => `application/x-spacetab-tab-from-${spaceId.toLowerCase()}`

export function SpaceTabRow({
  tab,
  otherSpaces,
  palette,
  fromSpaceId,
  selected,
  selectedUrls,
  groupBarClass,
  groupTitle,
  onOpen,
  onRemove,
  onTogglePinned,
  onRestoreUrl,
  onMove,
  onReorderInSpace,
  onSelectToggle,
  onSelectRange,
}: Props) {
  const { t } = useT()
  const [moveOpen, setMoveOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const [favFailed, setFavFailed] = useState(false)
  const [reorderRegion, setReorderRegion] = useState<'before' | 'after' | null>(null)
  const moveBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moveOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (moveBtnRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMoveOpen(false)
    }
    const onScrollOrResize = () => setMoveOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [moveOpen])

  const openMenu = () => {
    if (!moveBtnRef.current) return
    const rect = moveBtnRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
    setMoveOpen(true)
  }

  const host = (() => {
    try {
      return new URL(tab.url).host
    } catch {
      return tab.url
    }
  })()

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          onSelectToggle(tab.url)
          return
        }
        if (e.shiftKey) {
          e.preventDefault()
          onSelectRange(tab.url)
          return
        }
        onOpen(tab.currentUrl ?? tab.url)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(tab.currentUrl ?? tab.url)
      }}
      onDragStart={(e) => {
        // 当前行参与多选 → 拖整组,否则只拖本行
        const isMultiDrag = selected && selectedUrls.length > 1
        const urls = isMultiDrag ? selectedUrls : [tab.url]
        e.dataTransfer.setData(
          'application/x-spacetab-tab',
          JSON.stringify({ fromSpaceId, urls }),
        )
        // 标记 MIME(空 data,只为让 dragOver 阶段能区分同/跨空间)
        e.dataTransfer.setData(sameSpaceMarker(fromSpaceId), '')
        e.dataTransfer.effectAllowed = 'move'

        // 多拖时换一张带计数徽章的拖拽图(item 19)
        if (isMultiDrag) {
          const ghost = document.createElement('div')
          ghost.style.cssText =
            'position:fixed;top:-1000px;left:-1000px;display:inline-flex;align-items:center;gap:8px;' +
            'padding:8px 12px;font-size:12px;font-weight:600;font-family:system-ui,-apple-system,sans-serif;' +
            'background:#0f172a;color:#fff;border-radius:8px;' +
            'box-shadow:0 6px 20px rgba(0,0,0,.25);white-space:nowrap;'
          const dot = document.createElement('span')
          dot.style.cssText =
            'display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;' +
            'border-radius:10px;background:#10b981;color:#fff;font-size:11px;font-weight:700;'
          dot.textContent = String(urls.length)
          const label = document.createElement('span')
          label.textContent = 'tabs'
          ghost.appendChild(dot)
          ghost.appendChild(label)
          document.body.appendChild(ghost)
          e.dataTransfer.setDragImage(ghost, 12, 12)
          setTimeout(() => ghost.remove(), 0)
        }
        setDragging(true)
      }}
      onDragEnd={() => {
        setDragging(false)
        setReorderRegion(null)
      }}
      onDragOver={(e) => {
        const types = e.dataTransfer.types
        if (!types.includes('application/x-spacetab-tab')) return
        // 跨空间拖入:不接管,留给父卡片
        if (!types.includes(sameSpaceMarker(fromSpaceId))) {
          if (reorderRegion) setReorderRegion(null)
          return
        }
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const y = e.clientY - rect.top
        setReorderRegion(y < rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) {
          setReorderRegion(null)
        }
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('application/x-spacetab-tab')
        if (!raw) return
        let parsed: { fromSpaceId: string; urls: string[] }
        try {
          parsed = JSON.parse(raw) as { fromSpaceId: string; urls: string[] }
        } catch {
          return
        }
        if (parsed.fromSpaceId !== fromSpaceId) return // 跨空间,留给父
        e.preventDefault()
        e.stopPropagation()
        const region = reorderRegion ?? (() => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          return e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
        })()
        setReorderRegion(null)
        // 去掉等于本行 url 的项,避免自我插入
        const fromUrls = parsed.urls.filter((u) => u !== tab.url)
        if (fromUrls.length === 0) return
        onReorderInSpace(fromUrls, region)
      }}
      className={`group/row relative flex items-center gap-2.5 pl-2.5 pr-2 py-1.5 -mx-2 rounded-md cursor-pointer transition-all duration-150 border-l-[3px] ${
        selected
          ? 'bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-500 ring-1 ring-emerald-300/60 dark:ring-emerald-700/50'
          : `border-transparent ${palette.rowHoverBg} ${palette.rowAccent}`
      } ${dragging ? 'opacity-40 scale-[0.98] border-dashed border-slate-400 dark:border-slate-500' : ''}`}
      title={tab.url}
    >
      {reorderRegion === 'before' && (
        <span className="pointer-events-none absolute -top-px left-1 right-1 h-[2px] bg-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.6)]" />
      )}
      {reorderRegion === 'after' && (
        <span className="pointer-events-none absolute -bottom-px left-1 right-1 h-[2px] bg-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.6)]" />
      )}
      {groupBarClass && (
        <span
          className={`w-1 h-4 rounded-full flex-shrink-0 ${groupBarClass}`}
          title={groupTitle ?? undefined}
          aria-label={groupTitle ? `Group: ${groupTitle}` : 'Tab group'}
        />
      )}
      {tab.favIconUrl && !favFailed ? (
        <img
          src={tab.favIconUrl}
          alt=""
          onError={() => setFavFailed(true)}
          className="w-[18px] h-[18px] rounded ring-1 ring-slate-200/60 dark:ring-slate-700/60 flex-shrink-0 bg-white dark:bg-slate-900"
        />
      ) : (
        <span className="w-[18px] h-[18px] rounded bg-slate-100 dark:bg-slate-700 ring-1 ring-slate-200/60 dark:ring-slate-700/60 flex-shrink-0" />
      )}
      {selected && (
        <span
          className="absolute left-[-3px] top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-emerald-500"
          aria-hidden
        />
      )}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[13px] text-slate-800 dark:text-slate-200 truncate transition-transform duration-150 group-hover/row:translate-x-0.5">
          {tab.title || tab.url}
        </span>
        <span
          className={`text-[10.5px] font-medium leading-none px-1.5 py-0.5 rounded bg-slate-100/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400 truncate flex-shrink-0 max-w-[40%] transition-colors duration-150 ${palette.chipHoverBg} ${palette.chipHoverText}`}
        >
          {host}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
        {tab.currentUrl && tab.currentUrl !== tab.url && (
          <button onClick={(e) => { e.stopPropagation(); onRestoreUrl(tab.url) }} className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" title={t('restoreSavedUrl')} aria-label={t('restoreSavedUrl')}>↶</button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onTogglePinned(tab.url, !tab.pinned) }} className={`w-6 h-6 flex items-center justify-center rounded ${tab.pinned ? 'text-emerald-600' : 'text-slate-400'} hover:text-slate-700 hover:bg-slate-100`} title={tab.pinned ? t('unpinFromSpaceTab') : t('pinToSpace')} aria-label={tab.pinned ? t('unpinFromSpaceTab') : t('pinToSpace')}>{tab.pinned ? '📌' : <Pin className="w-3 h-3" />}</button>
        {otherSpaces.length > 0 && (
          <button
            ref={moveBtnRef}
            onClick={(e) => {
              e.stopPropagation()
              if (moveOpen) setMoveOpen(false)
              else openMenu()
            }}
            className="w-6 h-6 flex items-center justify-center rounded text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title={t('moveToOtherSpace')}
            aria-label={t('moveToOtherSpace')}
          >
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(tab.url)
          }}
          className="w-6 h-6 flex items-center justify-center rounded text-slate-400 dark:text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          title={t('removeFromSpace')}
          aria-label={t('removeFromSpace')}
        >
          <Trash className="w-3 h-3" />
        </button>
      </div>
      {moveOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden"
            style={{ top: menuPos.top, right: menuPos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
              {t('moveTo')}
            </div>
            <div className="max-h-56 overflow-y-auto">
              {otherSpaces.map((s) => (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(s.id, tab.url)
                    setMoveOpen(false)
                  }}
                  className="block w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 truncate text-slate-700 dark:text-slate-200"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
