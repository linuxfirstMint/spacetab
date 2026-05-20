import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Space, Tab } from '@/lib/schema'
import { groupTabsForRender } from '@/lib/render-groups'
import { TabGroupBlock } from './tab-group-block'
import { colorForSpace, relativeTime } from '@/lib/ui-utils'
import { useT } from '@/lib/i18n'
import { ArrowRight, ChevronDown, Copy, FileText, GripVertical, Pencil, Search, Sparkle, Star, StarFilled, Trash, X } from './icons'
import { SpaceTabRow } from './space-tab-row'
import { filterSpaceTabs } from '@/lib/search'
import { GROUP_COLOR_BAR } from '@/lib/tab-groups'

interface Props {
  space: Space
  otherSpaces: Space[]
  focused?: boolean
  onSwitch: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onTogglePinned: (id: string) => void
  onSetEmoji: (id: string, emoji: string | undefined) => void
  onSetNote: (id: string, note: string | undefined) => void
  onTabOpen: (url: string) => void
  onTabRemove: (spaceId: string, url: string) => void
  onTabMove: (fromId: string, toId: string, url: string) => void
  onTabReorder: (spaceId: string, orderedUrls: string[]) => void
  onTabsRemove: (spaceId: string, urls: string[]) => void
  onTabsMove: (fromId: string, toId: string, urls: string[]) => void
  onLiveTabDrop: (tabId: number, toSpaceId: string) => void
  onMerge: (fromId: string, toId: string) => void
  onReorder: (fromId: string, toId: string, position: 'before' | 'after') => void
  groupingEnabled: boolean
}

type DragKind = 'tab' | 'liveTab' | 'space-merge' | 'space-before' | 'space-after' | null

export function SpaceItem({
  space,
  otherSpaces,
  focused = false,
  onSwitch,
  onRename,
  onDelete,
  onDuplicate,
  onTogglePinned,
  onSetEmoji,
  onSetNote,
  onTabOpen,
  onTabRemove,
  onTabMove,
  onTabReorder,
  onTabsRemove,
  onTabsMove,
  onLiveTabDrop,
  onMerge,
  onReorder,
  groupingEnabled,
}: Props) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(space.name)
  const [collapsed, setCollapsed] = useState(false)
  const [dragKind, setDragKind] = useState<DragKind>(null)
  // 空间内本地搜索:点放大镜展开
  const [cardQuery, setCardQuery] = useState('')
  const [cardSearchOpen, setCardSearchOpen] = useState(false)
  const cardSearchInputRef = useRef<HTMLInputElement | null>(null)
  // 多选状态:选中的 url 集合 + 上次单点的锚点(用于 shift 区间选)
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set())
  const [anchorUrl, setAnchorUrl] = useState<string | null>(null)
  // 批量移动菜单
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMenuPos, setBulkMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const bulkMoveBtnRef = useRef<HTMLButtonElement>(null)
  const bulkMenuRef = useRef<HTMLDivElement>(null)
  // 折叠状态:key 是 RenderedGroup.key。仅在 popup 生命周期内有效。
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const palette = colorForSpace(space.id)

  // focused 状态变化时滚到视口
  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  useEffect(() => {
    if (cardSearchOpen) cardSearchInputRef.current?.focus()
  }, [cardSearchOpen])

  // ESC 清除选区(只在有选区时挂监听,避免与全局 ESC 冲突)
  useEffect(() => {
    if (selectedSet.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedSet(new Set())
        setAnchorUrl(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedSet.size])

  // 选区中的 tab 若已不存在(被外部删除等),自动剔除
  useEffect(() => {
    if (selectedSet.size === 0) return
    const existing = new Set(space.tabs.map((tt) => tt.url))
    let changed = false
    const next = new Set<string>()
    for (const u of selectedSet) {
      if (existing.has(u)) next.add(u)
      else changed = true
    }
    if (changed) setSelectedSet(next)
  }, [space.tabs, selectedSet])

  useEffect(() => {
    if (!bulkMoveOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (bulkMoveBtnRef.current?.contains(target)) return
      if (bulkMenuRef.current?.contains(target)) return
      setBulkMoveOpen(false)
    }
    const onScrollOrResize = () => setBulkMoveOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [bulkMoveOpen])

  // 应用本地搜索过滤
  const visibleSpace = cardQuery ? filterSpaceTabs(space, cardQuery) : space

  // 分组渲染结果(关闭开关时不计算,直接走平铺)
  const rendered = useMemo(
    () => (groupingEnabled ? groupTabsForRender(visibleSpace) : null),
    [groupingEnabled, visibleSpace],
  )
  const useFlatList = !rendered || rendered.singleton

  // 选区按源顺序排好后给行用作拖拽 payload
  const selectedUrlsOrdered = useMemo(
    () => space.tabs.map((tt) => tt.url).filter((u) => selectedSet.has(u)),
    [space.tabs, selectedSet],
  )

  // groupKey → { barClass, title } 查表,渲染 tab 行时用
  const groupByKey = useMemo(() => {
    const m = new Map<string, { barClass: string; title?: string }>()
    for (const g of space.groups ?? []) {
      m.set(g.key, g.title !== undefined
        ? { barClass: GROUP_COLOR_BAR[g.color], title: g.title }
        : { barClass: GROUP_COLOR_BAR[g.color] })
    }
    return m
  }, [space.groups])

  const clearSelection = () => {
    setSelectedSet(new Set())
    setAnchorUrl(null)
  }

  const handleSelectToggle = (url: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
    setAnchorUrl(url)
  }

  const handleSelectRange = (url: string) => {
    const urls = visibleSpace.tabs.map((tt) => tt.url)
    const targetIdx = urls.indexOf(url)
    if (targetIdx === -1) return
    // 没有锚点 → 退化为 toggle
    const anchorIdx = anchorUrl ? urls.indexOf(anchorUrl) : -1
    if (anchorIdx === -1) {
      handleSelectToggle(url)
      return
    }
    const [lo, hi] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    setSelectedSet((prev) => {
      const next = new Set(prev)
      for (let i = lo; i <= hi; i += 1) {
        const u = urls[i]
        if (u) next.add(u)
      }
      return next
    })
  }

  const openBulkMoveMenu = () => {
    if (!bulkMoveBtnRef.current) return
    const rect = bulkMoveBtnRef.current.getBoundingClientRect()
    setBulkMenuPos({ top: rect.bottom + 4, left: rect.left })
    setBulkMoveOpen(true)
  }

  const handleBulkOpen = () => {
    selectedUrlsOrdered.forEach((u) => onTabOpen(u))
    clearSelection()
  }

  const handleBulkDelete = () => {
    if (selectedUrlsOrdered.length === 0) return
    const ok = window.confirm(
      t('confirmDelete', { name: space.name, n: selectedUrlsOrdered.length }),
    )
    if (!ok) return
    onTabsRemove(space.id, selectedUrlsOrdered)
    clearSelection()
  }

  const handleBulkMove = (toId: string) => {
    if (selectedUrlsOrdered.length === 0) return
    onTabsMove(space.id, toId, selectedUrlsOrdered)
    setBulkMoveOpen(false)
    clearSelection()
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    if (trimmed !== space.name) onRename(space.id, trimmed)
    setEditing(false)
  }

  const onConfirmDelete = () => {
    const ok = window.confirm(
      t('confirmDelete', { name: space.name, n: space.tabs.length }),
    )
    if (ok) onDelete(space.id)
  }

  // 拖入空间卡片时,根据鼠标 Y 在卡片内的相对位置区分:
  // 上 25% → 排到前面;下 25% → 排到后面;中间 → 合并
  const decideSpaceRegion = (e: React.DragEvent): 'before' | 'after' | 'merge' => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < rect.height * 0.25) return 'before'
    if (y > rect.height * 0.75) return 'after'
    return 'merge'
  }

  const handleDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (types.includes('application/x-spacetab-tab')) {
      // 同空间内的拖动由行接管,卡片不要显示跨空间提示
      if (types.includes(`application/x-spacetab-tab-from-${space.id.toLowerCase()}`)) {
        if (dragKind) setDragKind(null)
        return
      }
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragKind('tab')
    } else if (e.dataTransfer.types.includes('application/x-spacetab-live-tab')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragKind('liveTab')
    } else if (e.dataTransfer.types.includes('application/x-spacetab-space')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const region = decideSpaceRegion(e)
      setDragKind(region === 'merge' ? 'space-merge' : region === 'before' ? 'space-before' : 'space-after')
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // 只在真正离开卡片时清除(子元素触发的 leave 不算)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragKind(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    const tabRaw = e.dataTransfer.getData('application/x-spacetab-tab')
    if (tabRaw) {
      e.preventDefault()
      setDragKind(null)
      try {
        const { fromSpaceId, urls } = JSON.parse(tabRaw) as { fromSpaceId: string; urls: string[] }
        if (fromSpaceId !== space.id && urls.length > 0) {
          onTabsMove(fromSpaceId, space.id, urls)
        }
      } catch {
        // 数据损坏,忽略
      }
      return
    }
    const liveTabRaw = e.dataTransfer.getData('application/x-spacetab-live-tab')
    if (liveTabRaw) {
      e.preventDefault()
      setDragKind(null)
      try {
        const { tabId } = JSON.parse(liveTabRaw) as { tabId: number }
        onLiveTabDrop(tabId, space.id)
      } catch {
        // 数据损坏,忽略
      }
      return
    }
    const spaceRaw = e.dataTransfer.getData('application/x-spacetab-space')
    if (spaceRaw) {
      e.preventDefault()
      const region = decideSpaceRegion(e)
      setDragKind(null)
      try {
        const { spaceId: fromId } = JSON.parse(spaceRaw) as { spaceId: string }
        if (fromId === space.id) return
        if (region === 'merge') {
          onMerge(fromId, space.id)
        } else {
          onReorder(fromId, space.id, region)
        }
      } catch {
        // 数据损坏,忽略
      }
    }
  }

  const renderTabRow = (tab: Tab, i: number) => (
    <SpaceTabRow
      key={`${tab.url}-${i}`}
      tab={tab}
      otherSpaces={otherSpaces}
      palette={palette}
      fromSpaceId={space.id}
      selected={selectedSet.has(tab.url)}
      selectedUrls={selectedUrlsOrdered}
      {...(tab.groupKey && groupByKey.get(tab.groupKey)
        ? {
            groupBarClass: groupByKey.get(tab.groupKey)!.barClass,
            ...(groupByKey.get(tab.groupKey)!.title !== undefined
              ? { groupTitle: groupByKey.get(tab.groupKey)!.title }
              : {}),
          }
        : {})}
      onOpen={(url) => {
        // 普通点击打开 = 清掉选区(避免选着不知不觉就丢了)
        if (selectedSet.size > 0) clearSelection()
        onTabOpen(url)
      }}
      onRemove={(url) => onTabRemove(space.id, url)}
      onMove={(toId, url) => onTabMove(space.id, toId, url)}
      onSelectToggle={handleSelectToggle}
      onSelectRange={handleSelectRange}
      onReorderInSpace={(fromUrls, position) => {
        // 整组移动到 tab 行的前/后:从 urls 中拿出 fromUrls,保持源相对顺序后插入
        const allUrls = space.tabs.map((x) => x.url)
        const movingSet = new Set(fromUrls)
        const without = allUrls.filter((u) => !movingSet.has(u))
        const idx = without.indexOf(tab.url)
        if (idx === -1) return
        const insertAt = position === 'before' ? idx : idx + 1
        const sortedFrom = allUrls.filter((u) => movingSet.has(u))
        const next = [...without.slice(0, insertAt), ...sortedFrom, ...without.slice(insertAt)]
        onTabReorder(space.id, next)
      }}
    />
  )

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 拖放高亮样式:跨空间 tab drop 用 violet,live tab 加入用 indigo,空间合并用 emerald
  // 空间排序(before/after)不加整圈 ring,只在边缘画一条 emerald 线
  const dropRingClass =
    dragKind === 'tab'
      ? 'ring-2 ring-violet-400 bg-violet-50/60'
      : dragKind === 'liveTab'
        ? 'ring-2 ring-indigo-400 bg-indigo-50/60'
        : dragKind === 'space-merge'
          ? 'ring-2 ring-emerald-400 bg-emerald-50/60'
          : ''

  return (
    <div
      ref={cardRef}
      className={`group/card relative bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/80 transition-all duration-150 hover:border-slate-300 dark:hover:border-slate-600 hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)] ${
        focused ? 'ring-2 ring-slate-400 dark:ring-slate-500 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950' : ''
      } ${dropRingClass}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 左侧色条(装饰,不拦事件,在把手下方)*/}
      <div className={`absolute left-0 top-4 bottom-4 w-[5px] rounded-r-full ${palette.bar} pointer-events-none`} />

      {/* 空间排序指示线:before 在顶部,after 在底部 */}
      {dragKind === 'space-before' && (
        <div className="pointer-events-none absolute -top-[2px] left-2 right-2 h-[3px] bg-emerald-500 rounded-full shadow-[0_0_6px_rgba(16,185,129,0.6)]">
          <span className="absolute -left-1 -top-1 w-[7px] h-[7px] rounded-full bg-emerald-500" />
        </div>
      )}
      {dragKind === 'space-after' && (
        <div className="pointer-events-none absolute -bottom-[2px] left-2 right-2 h-[3px] bg-emerald-500 rounded-full shadow-[0_0_6px_rgba(16,185,129,0.6)]">
          <span className="absolute -left-1 -top-1 w-[7px] h-[7px] rounded-full bg-emerald-500" />
        </div>
      )}

      {/* 拖动整张卡片的把手:左边整列垂直居中,常驻 50% 透明度,hover 加深 */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/x-spacetab-space',
            JSON.stringify({ spaceId: space.id }),
          )
          e.dataTransfer.effectAllowed = 'move'
        }}
        className="group/grip absolute left-0 top-1/2 -translate-y-1/2 w-7 h-10 flex items-center justify-center rounded-md cursor-grab active:cursor-grabbing transition-all duration-150 opacity-50 hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 z-10"
        title={t('dragHandle')}
        aria-label={t('dragHandle')}
      >
        <GripVertical className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover/grip:text-slate-800 transition-colors" />
      </div>

      <div className={`pl-7 pr-4 py-4 rounded-xl transition-colors duration-200 ${palette.headerHoverGradient}`}>
        {/* 卡片头部 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCollapsed((v) => !v)}
                className="w-5 h-5 -ml-1 flex items-center justify-center rounded text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                title={collapsed ? t('expand') : t('collapse')}
                aria-label={collapsed ? t('expand') : t('collapse')}
                aria-expanded={!collapsed}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
                />
              </button>
              {space.emoji ? (
                <span className="text-base leading-none flex-shrink-0 transition-transform duration-200 group-hover/card:scale-110" aria-hidden>{space.emoji}</span>
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full ${palette.dot} flex-shrink-0 transition-transform duration-200 group-hover/card:scale-150`} />
              )}
              {editing ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') {
                      setDraft(space.name)
                      setEditing(false)
                    }
                  }}
                  className="flex-1 px-1.5 py-0.5 -ml-1.5 -my-0.5 text-[15px] font-semibold border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900"
                />
              ) : (
                <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate tracking-tight">
                  {space.name}
                </h3>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-mono text-[11px] ring-1 transition-all duration-150 ${palette.countBg} ${palette.countText} ${palette.countRing} ${palette.countRingHover} group-hover/card:font-semibold`}
              >
                {space.tabs.length}
              </span>
              <span>{t('tabsLabel')}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span>{relativeTime(space.updatedAt, t)}</span>
            </div>
            {space.note && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 italic line-clamp-2">
                {space.note}
              </p>
            )}
          </div>
          {/* 操作按钮区:[搜索] | [改名 emoji 备注] | [置顶 复制 删除] | [切换] */}
          <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
            {space.tabs.length > 1 && (
              <>
                <button
                  onClick={() => {
                    if (cardSearchOpen) {
                      setCardSearchOpen(false)
                      setCardQuery('')
                    } else {
                      setCardSearchOpen(true)
                    }
                  }}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                    cardSearchOpen || cardQuery
                      ? 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700'
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                  title={t('searchInSpace')}
                  aria-label={t('searchInSpace')}
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
                <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden />
              </>
            )}
            <button
              onClick={() => {
                setDraft(space.name)
                setEditing(true)
              }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={t('rename')}
              aria-label={t('rename')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                const next = window.prompt(t('editEmoji'), space.emoji ?? '')
                if (next === null) return
                onSetEmoji(space.id, next)
              }}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                space.emoji
                  ? 'hover:bg-slate-100 dark:hover:bg-slate-700 text-base'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={t('editEmoji')}
              aria-label={t('editEmoji')}
            >
              {space.emoji ? <span aria-hidden>{space.emoji}</span> : <Sparkle className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => {
                const next = window.prompt(t('editNote'), space.note ?? '')
                if (next === null) return
                onSetNote(space.id, next)
              }}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                space.note
                  ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={t('editNote')}
              aria-label={t('editNote')}
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden />
            <button
              onClick={() => onTogglePinned(space.id)}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 ${
                space.pinned
                  ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 drop-shadow-[0_0_4px_rgba(245,158,11,0.5)] hover:scale-110'
                  : 'text-slate-400 dark:text-slate-500 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={space.pinned ? t('unpinSpace') : t('pinSpace')}
              aria-label={space.pinned ? t('unpinSpace') : t('pinSpace')}
            >
              {space.pinned ? <StarFilled className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => onDuplicate(space.id)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={t('duplicate')}
              aria-label={t('duplicate')}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onConfirmDelete}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title={t('delete')}
              aria-label={t('delete')}
            >
              <Trash className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden />
            <button
              onClick={() => onSwitch(space.id)}
              className={`group/switch px-2.5 h-7 flex items-center gap-1 rounded-md text-xs font-medium text-white ${palette.switchBg} ${palette.switchRing} active:scale-[0.98] transition-all duration-100 shadow-sm hover:shadow-md`}
              title={t('switchToSpaceTitle')}
            >
              <span>{t('switchAction')}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover/switch:translate-x-0.5" />
            </button>
          </div>
        </div>

        {/* 空间内搜索框(展开时显示) */}
        {!collapsed && cardSearchOpen && space.tabs.length > 1 && (
          <div className="mt-3 relative">
            <input
              ref={cardSearchInputRef}
              value={cardQuery}
              onChange={(e) => setCardQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCardQuery('')
                  setCardSearchOpen(false)
                }
              }}
              placeholder={t('searchInSpace')}
              className="w-full pl-7 pr-7 py-1.5 text-xs rounded-md bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-300 dark:focus:border-slate-600 focus:outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
            />
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 dark:text-slate-500 pointer-events-none" />
            {cardQuery.length > 0 && (
              <button
                onClick={() => setCardQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* 选区批量操作栏 */}
        {!collapsed && selectedSet.size > 0 && (
          <div className="mt-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
              {selectedSet.size}
            </span>
            <span className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
              {t('selectionCount', { n: selectedSet.size })}
            </span>
            <span className="flex-1" />
            <button
              onClick={handleBulkOpen}
              className="px-2 h-6 text-xs font-medium rounded text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-800/40 transition-colors"
            >
              {t('openSelected')}
            </button>
            {otherSpaces.length > 0 && (
              <button
                ref={bulkMoveBtnRef}
                onClick={() => (bulkMoveOpen ? setBulkMoveOpen(false) : openBulkMoveMenu())}
                className="px-2 h-6 text-xs font-medium rounded text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-800/40 transition-colors"
              >
                {t('moveTo')}
              </button>
            )}
            <button
              onClick={handleBulkDelete}
              className="px-2 h-6 text-xs font-medium rounded text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              {t('deleteSelected')}
            </button>
            <button
              onClick={clearSelection}
              className="px-2 h-6 text-xs font-medium rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {t('clearSelection')}
            </button>
          </div>
        )}
        {bulkMoveOpen &&
          createPortal(
            <div
              ref={bulkMenuRef}
              className="fixed w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden"
              style={{ top: bulkMenuPos.top, left: bulkMenuPos.left }}
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                {t('moveTo')}
              </div>
              <div className="max-h-56 overflow-y-auto">
                {otherSpaces.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleBulkMove(s.id)}
                    className="block w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 truncate text-slate-700 dark:text-slate-200"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}

        {/* 标签列表(收起时整段不渲染) */}
        {collapsed ? null : visibleSpace.tabs.length > 0 ? (
          useFlatList ? (
            <div className="mt-3 space-y-0.5">
              {visibleSpace.tabs.map((tab, i) => renderTabRow(tab, i))}
            </div>
          ) : (
            <div className="mt-3 space-y-0.5">
              {rendered!.groups.map((g) => (
                <TabGroupBlock
                  key={g.key}
                  group={g}
                  otherLabel={t('categoryOther')}
                  palette={palette}
                  collapsed={collapsedGroups.has(g.key)}
                  onToggleCollapse={() => toggleGroup(g.key)}
                >
                  {g.tabs.map((tab) =>
                    renderTabRow(
                      tab,
                      visibleSpace.tabs.findIndex((tt) => tt.url === tab.url),
                    ),
                  )}
                </TabGroupBlock>
              ))}
            </div>
          )
        ) : cardQuery ? (
          <div className="mt-3 px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
            {t('noSearchResults')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
