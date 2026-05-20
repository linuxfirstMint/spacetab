import type { Space, Tab, TabGroupColor } from './schema'

export interface RenderedGroup {
  /** 稳定 key,用作折叠 state 与 React key */
  key: string
  /** 组标题:原生 group title / 域名 / 'other' 占位由调用方做 i18n */
  title: string
  /** 是否是"其他"组(由调用方决定如何 i18n 标题) */
  isOther: boolean
  /** 组内 tabs,保持输入相对顺序 */
  tabs: Tab[]
  /** 视觉来源 */
  kind: 'native' | 'domain' | 'other'
  /** 原生分支:Chrome group 颜色;其他分支:undefined */
  nativeColor?: TabGroupColor
  /** 域名分支:eTLD+1;原生分支不填 */
  host?: string
  /** 代表性 favicon(组内第一个非空 favIconUrl);"其他"不填 */
  faviconUrl?: string
}

export interface GroupTabsResult {
  groups: RenderedGroup[]
  /** 仅 1 组时调用方应降级为平铺 */
  singleton: boolean
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

function registeredDomain(host: string): string {
  const parts = host.split('.')
  if (parts.length <= 2) return host
  return parts.slice(-2).join('.')
}

export function groupTabsForRender(space: Space): GroupTabsResult {
  const nativeGroups = space.groups ?? []

  // —— 原生分支:仅当存在原生 groups 且至少一个 tab 引用其中之一时启用 ——
  if (nativeGroups.length > 0) {
    const known = new Set(nativeGroups.map((g) => g.key))
    const anyReferenced = space.tabs.some((tt) => tt.groupKey && known.has(tt.groupKey))
    if (anyReferenced) {
      const buckets = new Map<string, Tab[]>()
      const orphans: Tab[] = []
      for (const tab of space.tabs) {
        if (tab.groupKey && known.has(tab.groupKey)) {
          const list = buckets.get(tab.groupKey)
          if (list) list.push(tab)
          else buckets.set(tab.groupKey, [tab])
        } else {
          orphans.push(tab)
        }
      }
      const groups: RenderedGroup[] = []
      for (const g of nativeGroups) {
        const tabs = buckets.get(g.key)
        if (!tabs || tabs.length === 0) continue
        const fav = tabs.find((tt) => tt.favIconUrl)?.favIconUrl
        groups.push({
          key: `native:${g.key}`,
          title: g.title ?? g.color,
          isOther: false,
          tabs,
          kind: 'native',
          nativeColor: g.color,
          ...(fav ? { faviconUrl: fav } : {}),
        })
      }
      if (orphans.length > 0) {
        groups.push({
          key: 'other',
          title: 'other',
          isOther: true,
          tabs: orphans,
          kind: 'other',
        })
      }
      return { groups, singleton: groups.length === 1 }
    }
  }

  // —— 域名分支(默认)——
  const byDomain = new Map<string, Tab[]>()
  for (const tab of space.tabs) {
    const host = hostOf(tab.url)
    if (!host) continue
    const dom = registeredDomain(host)
    const list = byDomain.get(dom)
    if (list) list.push(tab)
    else byDomain.set(dom, [tab])
  }

  if (byDomain.size === 0) {
    return { groups: [], singleton: false }
  }

  // 分离:tab 数 >= 2 的域名各成一组;tab 数 == 1 的汇入"其他"
  const multi: RenderedGroup[] = []
  const otherTabs: Tab[] = []
  for (const [dom, tabs] of byDomain.entries()) {
    if (tabs.length >= 2) {
      const fav = tabs.find((tt) => tt.favIconUrl)?.favIconUrl
      multi.push({
        key: `dom:${dom}`,
        title: dom,
        isOther: false,
        tabs,
        kind: 'domain',
        host: dom,
        ...(fav ? { faviconUrl: fav } : {}),
      })
    } else {
      otherTabs.push(...tabs)
    }
  }

  // 多组按 tab 数倒序;V8 sort 稳定,相同 tab 数保留插入顺序
  multi.sort((a, b) => b.tabs.length - a.tabs.length)

  const groups: RenderedGroup[] = [...multi]
  if (otherTabs.length > 0) {
    groups.push({
      key: 'other',
      title: 'other',
      isOther: true,
      tabs: otherTabs,
      kind: 'other',
    })
  }

  return { groups, singleton: groups.length === 1 }
}
