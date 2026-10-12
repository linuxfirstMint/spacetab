import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Tab } from '@/lib/schema'
import type { ClusterDraft, ClusterLabel } from '@/lib/clustering'
import { useT } from '@/lib/i18n'
import { X, Sparkle, Trash } from './icons'

interface EditableCluster {
  id: string
  name: string
  tabs: Tab[]
  included: boolean
  // 标识"其他"那一组——删除其他分组时,标签会汇入此组(若不存在则按需创建)
  isOther: boolean
}

interface DragPayload {
  fromClusterId: string
  tabUrl: string
}

const DRAG_MIME = 'application/x-spacetab-cluster-tab'

interface Props {
  initialClusters: ClusterDraft[]
  totalTabsCount: number
  onCancel: () => void
  onConfirm: (clusters: Array<{ name: string; tabs: Tab[] }>) => void
}

export function SmartArchiveDialog({ initialClusters, totalTabsCount, onCancel, onConfirm }: Props) {
  const { t } = useT()

  const resolveLabel = (label: ClusterLabel): string => {
    if (label.kind === 'category') return t(label.key)
    return label.value
  }

  const [clusters, setClusters] = useState<EditableCluster[]>(() =>
    initialClusters.map((c, i) => ({
      id: `c${i}`,
      name: resolveLabel(c.label),
      tabs: [...c.tabs],
      included: true,
      isOther: c.label.kind === 'category' && c.label.key === 'categoryOther',
    })),
  )

  // 用本地 ref 计数生成新 cluster id,避免与初始的 c0..cN 撞
  const nextClusterIdRef = useState({ n: initialClusters.length })[0]
  const allocClusterId = () => `c${nextClusterIdRef.n++}`

  // 当前正被拖动的 tab(用于源行的视觉淡出);拖到的目标 cluster id(用于高亮 drop zone)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [dragOverClusterId, setDragOverClusterId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const includedCount = clusters.filter((c) => c.included && c.tabs.length > 0).length

  const updateName = (id: string, name: string) => {
    setClusters((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)))
  }
  const toggleIncluded = (id: string) => {
    setClusters((prev) => prev.map((c) => (c.id === id ? { ...c, included: !c.included } : c)))
  }
  const removeTab = (clusterId: string, url: string) => {
    setClusters((prev) =>
      prev.map((c) => (c.id === clusterId ? { ...c, tabs: c.tabs.filter((tab) => tab.url !== url) } : c)),
    )
  }
  // 删除整组:标签合并到"其他"组(若不存在则新建);若被删的本身就是"其他",标签直接丢弃
  const deleteCluster = (clusterId: string) => {
    setClusters((prev) => {
      const target = prev.find((c) => c.id === clusterId)
      if (!target) return prev
      if (target.isOther) {
        // 删"其他"组本身,直接移除
        return prev.filter((c) => c.id !== clusterId)
      }
      const otherIdx = prev.findIndex((c) => c.isOther)
      const tabsToTransfer = target.tabs
      if (otherIdx >= 0) {
        // 合并到已有"其他"
        const otherCluster = prev[otherIdx]!
        const existingUrls = new Set(otherCluster.tabs.map((t) => t.url))
        const merged = [
          ...otherCluster.tabs,
          ...tabsToTransfer.filter((t) => !existingUrls.has(t.url)),
        ]
        return prev
          .filter((c) => c.id !== clusterId)
          .map((c) => (c.id === otherCluster.id ? { ...c, tabs: merged } : c))
      }
      // 没有"其他"组,新建一个并把标签放进去
      const newOther: EditableCluster = {
        id: allocClusterId(),
        name: t('categoryOther'),
        tabs: tabsToTransfer,
        included: true,
        isOther: true,
      }
      return [...prev.filter((c) => c.id !== clusterId), newOther]
    })
  }

  const moveTabBetween = (fromId: string, toId: string, url: string) => {
    if (fromId === toId) return
    setClusters((prev) => {
      const source = prev.find((c) => c.id === fromId)
      const tab = source?.tabs.find((t) => t.url === url)
      if (!tab) return prev
      return prev.map((c) => {
        if (c.id === fromId) return { ...c, tabs: c.tabs.filter((t) => t.url !== url) }
        if (c.id === toId) {
          // 去重:目标已有同 url 则不重复加
          if (c.tabs.some((t) => t.url === url)) return c
          return { ...c, tabs: [...c.tabs, tab] }
        }
        return c
      })
    })
  }

  const handleConfirm = () => {
    const toCreate = clusters
      .filter((c) => c.included && c.tabs.length > 0 && c.name.trim().length > 0)
      .map((c) => ({ name: c.name.trim(), tabs: c.tabs }))
    onConfirm(toCreate)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-archive-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[640px] max-h-[85vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-sm">
            <Sparkle className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h2 id="smart-archive-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('smartArchive')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('smartArchiveSummary', { n: totalTabsCount, g: clusters.length })}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={t('cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {clusters.map((c) => (
            <ClusterCard
              key={c.id}
              cluster={c}
              dragOver={dragOverClusterId === c.id}
              draggingPayload={dragging}
              onToggle={() => toggleIncluded(c.id)}
              onRename={(name) => updateName(c.id, name)}
              onRemoveTab={(url) => removeTab(c.id, url)}
              onDelete={() => deleteCluster(c.id)}
              onTabDragStart={(url) => setDragging({ fromClusterId: c.id, tabUrl: url })}
              onTabDragEnd={() => {
                setDragging(null)
                setDragOverClusterId(null)
              }}
              onCardDragEnter={() => {
                if (dragging && dragging.fromClusterId !== c.id) setDragOverClusterId(c.id)
              }}
              onCardDragLeave={() => {
                setDragOverClusterId((prev) => (prev === c.id ? null : prev))
              }}
              onCardDrop={(payload) => {
                moveTabBetween(payload.fromClusterId, c.id, payload.tabUrl)
                setDragging(null)
                setDragOverClusterId(null)
              }}
            />
          ))}
        </div>

        <footer className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
          <button
            onClick={onCancel}
            className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={includedCount === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {t('archiveAsNSpaces', { n: includedCount })}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function ClusterCard({
  cluster,
  dragOver,
  draggingPayload,
  onToggle,
  onRename,
  onRemoveTab,
  onDelete,
  onTabDragStart,
  onTabDragEnd,
  onCardDragEnter,
  onCardDragLeave,
  onCardDrop,
}: {
  cluster: EditableCluster
  dragOver: boolean
  draggingPayload: DragPayload | null
  onToggle: () => void
  onRename: (name: string) => void
  onRemoveTab: (url: string) => void
  onDelete: () => void
  onTabDragStart: (url: string) => void
  onTabDragEnd: () => void
  onCardDragEnter: () => void
  onCardDragLeave: () => void
  onCardDrop: (payload: DragPayload) => void
}) {
  const { t } = useT()
  const muted = !cluster.included || cluster.tabs.length === 0
  const acceptingDrop =
    dragOver && draggingPayload !== null && draggingPayload.fromClusterId !== cluster.id

  return (
    <div
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault()
          onCardDragEnter()
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDragLeave={(e) => {
        // 防止子元素之间冒泡造成抖动:仅当真正离开卡片时关
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        onCardDragLeave()
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DRAG_MIME)
        if (!raw) return
        e.preventDefault()
        try {
          const payload = JSON.parse(raw) as DragPayload
          onCardDrop(payload)
        } catch {
          // ignore malformed payload
        }
      }}
      className={`rounded-lg border transition-colors ${
        acceptingDrop
          ? 'border-violet-400 bg-violet-50/40 ring-2 ring-violet-200'
          : muted
          ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 dark:bg-slate-800/40'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
      }`}
    >
      <div className="group/header flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <input
          type="checkbox"
          checked={cluster.included}
          onChange={onToggle}
          className="w-4 h-4 cursor-pointer"
        />
        <input
          value={cluster.name}
          onChange={(e) => onRename(e.target.value)}
          className={`flex-1 bg-transparent text-sm font-medium px-1 py-0.5 -mx-1 rounded border border-transparent hover:border-slate-200 dark:border-slate-700 focus:border-slate-300 dark:border-slate-600 focus:outline-none ${
            muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'
          }`}
        />
        <span className={`text-xs font-mono ${muted ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400 dark:text-slate-500'}`}>
          {cluster.tabs.length}
        </span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 w-6 h-6 flex items-center justify-center rounded text-slate-400 dark:text-slate-500 hover:text-red-600 hover:bg-red-50 transition-opacity"
          title={t('deleteCluster')}
          aria-label={t('deleteCluster')}
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 py-2 space-y-0.5 max-h-48 overflow-y-auto">
        {cluster.tabs.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500 py-2 text-center">—</div>
        ) : (
          cluster.tabs.map((tab) => {
            const isDraggingThis =
              draggingPayload?.fromClusterId === cluster.id &&
              draggingPayload.tabUrl === tab.url
            return (
              <ClusterTabRow
                key={tab.url}
                tab={tab}
                fromClusterId={cluster.id}
                muted={muted}
                isDraggingThis={isDraggingThis}
                onRemove={() => onRemoveTab(tab.url)}
                onDragStart={() => onTabDragStart(tab.url)}
                onDragEnd={onTabDragEnd}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

function ClusterTabRow({
  tab,
  fromClusterId,
  muted,
  isDraggingThis,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  tab: Tab
  fromClusterId: string
  muted: boolean
  isDraggingThis: boolean
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        const payload: DragPayload = { fromClusterId, tabUrl: tab.url }
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={`group/row flex items-center gap-2 px-1 py-1 text-[13px] cursor-grab active:cursor-grabbing rounded ${
        muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'
      } ${isDraggingThis ? 'opacity-40' : ''}`}
    >
      {tab.favIconUrl ? (
        <img src={tab.favIconUrl} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-sm bg-slate-200 flex-shrink-0" />
      )}
      <span className="flex-1 truncate" title={tab.url}>
        {tab.title || tab.url}
      </span>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover/row:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-500 hover:text-red-600 hover:bg-red-50 transition-opacity"
        title="移除"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
