import { useState, type ReactNode } from 'react'
import type { RenderedGroup } from '@/lib/render-groups'
import { GROUP_COLOR_BAR } from '@/lib/tab-groups'
import { ChevronDown, Globe } from './icons'
import type { SpacePalette } from '@/lib/ui-utils'

interface Props {
  group: RenderedGroup
  /** "其他" 组的本地化标题(由调用方传入,避免组件直接依赖 i18n) */
  otherLabel: string
  /** 卡片调色板,用于计数 chip 配色与卡片视觉一致 */
  palette: SpacePalette
  collapsed: boolean
  onToggleCollapse: () => void
  /** 组内 tab 行,由调用方渲染并传入(已包好 SpaceTabRow 列表) */
  children: ReactNode
}

export function TabGroupBlock({
  group,
  otherLabel,
  palette,
  collapsed,
  onToggleCollapse,
  children,
}: Props) {
  const [favFailed, setFavFailed] = useState(false)
  const title = group.isOther ? otherLabel : group.title

  return (
    <div className="mt-2 first:mt-0">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors group/groupheader"
        aria-expanded={!collapsed}
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-150 flex-shrink-0 ${
            collapsed ? '-rotate-90' : ''
          }`}
        />
        {group.kind === 'native' && group.nativeColor && (
          <span
            className={`w-1 h-4 rounded-full flex-shrink-0 ${GROUP_COLOR_BAR[group.nativeColor]}`}
            aria-hidden
          />
        )}
        {group.faviconUrl && !favFailed ? (
          <img
            src={group.faviconUrl}
            alt=""
            onError={() => setFavFailed(true)}
            className="w-4 h-4 rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700/60 flex-shrink-0 bg-white dark:bg-slate-900"
          />
        ) : (
          <span className="w-4 h-4 rounded-sm bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200/60 dark:ring-slate-700/60 flex-shrink-0 flex items-center justify-center">
            <Globe className="w-3 h-3 text-slate-400 dark:text-slate-500" />
          </span>
        )}
        <span
          className={`flex-1 truncate text-[11px] leading-none ${
            group.kind === 'domain' ? 'font-mono' : 'font-medium'
          } text-slate-600 dark:text-slate-300`}
        >
          {title}
        </span>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] ring-1 transition-colors duration-150 ${palette.countBg} ${palette.countText} ${palette.countRing}`}
        >
          {group.tabs.length}
        </span>
      </button>
      {!collapsed && <div className="mt-0.5 pl-6">{children}</div>}
    </div>
  )
}
