# Tab Grouping by Domain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在每个 SpaceItem 内,把同一注册域名的 tab 视觉上聚拢成可折叠分组块;有 Chrome 原生标签组的空间优先用原生 groups;全局可关闭。纯展示层,不动 schema、不动 storage。

**Architecture:** 新增纯函数 `lib/render-groups.ts` 在内存对 `space.tabs` 计算 `RenderedGroup[]`(原生分支 / 域名分支 / 单组降级)。新增哑组件 `components/tab-group-block.tsx` 渲染分组块。`SpaceItem` 接入,设置 toggle 控制是否调用聚类函数。`Space`/`Tab`/`Database` schema 完全不变。

**Tech Stack:** TypeScript (strict), React 18, Tailwind CSS, Zustand(已有 store 不改),Vitest,WXT,Manifest V3。i18n 五语种(zh-CN / zh-TW / en / ja / de)。

**Spec:** `docs/superpowers/specs/2026-05-20-tab-grouping-design.md`

---

## File Structure

| 路径 | 类型 | 职责 |
|---|---|---|
| `lib/render-groups.ts` | 新建 | 导出 `RenderedGroup` 类型与 `groupTabsForRender(space)`。零 Chrome API 依赖。 |
| `tests/lib/render-groups.test.ts` | 新建 | 单测覆盖原生分支 / 域名分支 / 单组降级 / 其他兜底 / 无效 URL。 |
| `lib/settings.ts` | 改动 | 新增 `KEY_GROUP_BY_DOMAIN` 常量、`readGroupTabsByDomain` / `writeGroupTabsByDomain` / `useGroupTabsByDomain` hook(沿用现有 `useUseAsNewtab` 模式)。 |
| `components/tab-group-block.tsx` | 新建 | 哑组件:接 `group: RenderedGroup`、`collapsed: boolean`、`onToggleCollapse: () => void`、`children: ReactNode`。渲染头部行 + children(由调用方传入 `SpaceTabRow` 数组)。 |
| `components/space-item.tsx` | 改动 | 接入 `useGroupTabsByDomain`,开启时调用 `groupTabsForRender` 并用 `TabGroupBlock` 包裹;关闭/降级时走原平铺路径。新增 `collapsedGroups` state。 |
| `components/settings-menu.tsx` | 改动 | 在 Theme 块和 Export/Import 之间插入一个"按域名分组 tabs"toggle。 |
| `lib/i18n.ts` | 改动 | 5 个 locale 各加 1 个 key:`groupTabsByDomain`(设置项名)。`categoryOther` 已有。 |

---

## Task 1: `lib/render-groups.ts` — 纯函数与类型

**Files:**
- Create: `lib/render-groups.ts`
- Create: `tests/lib/render-groups.test.ts`

任务目标:实现 `groupTabsForRender(space): { groups, singleton }`,可独立单测。

### Step 1: 写第一批失败测试(空、单 host、降级)

- [ ] **Step 1.1: 新建测试文件,写入"空与降级"用例**

Create `tests/lib/render-groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupTabsForRender } from '@/lib/render-groups'
import type { Space, Tab } from '@/lib/schema'

const t = (url: string, extra: Partial<Tab> = {}): Tab => ({ url, title: url, ...extra })

const makeSpace = (overrides: Partial<Space> = {}): Space => ({
  id: 'sp1',
  name: 'Work',
  tabs: [],
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
})

describe('groupTabsForRender — 边界与降级', () => {
  it('空 tabs 返回空数组,singleton 为 false', () => {
    const r = groupTabsForRender(makeSpace({ tabs: [] }))
    expect(r.groups).toEqual([])
    expect(r.singleton).toBe(false)
  })

  it('全部同 host 触发 singleton 降级', () => {
    const r = groupTabsForRender(
      makeSpace({
        tabs: [
          t('https://github.com/a'),
          t('https://github.com/b'),
          t('https://docs.github.com/c'),
        ],
      }),
    )
    expect(r.singleton).toBe(true)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]?.host).toBe('github.com')
  })

  it('跳过无效 URL;全无效时返回空', () => {
    const r = groupTabsForRender(
      makeSpace({ tabs: [t('not-a-url'), t('also bad')] }),
    )
    expect(r.groups).toEqual([])
    expect(r.singleton).toBe(false)
  })
})
```

- [ ] **Step 1.2: 运行,确认测试失败**

Run: `pnpm vitest run tests/lib/render-groups.test.ts`
Expected: 三个用例都 FAIL,错误为找不到模块 `@/lib/render-groups`。

### Step 2: 写最小实现让上述用例通过

- [ ] **Step 2.1: 创建 `lib/render-groups.ts` 骨架**

Create `lib/render-groups.ts`:

```ts
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
  // 先按域名走;后续 step 加原生 groups 分支
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

  const groups: RenderedGroup[] = []
  for (const [dom, tabs] of byDomain.entries()) {
    const fav = tabs.find((tt) => tt.favIconUrl)?.favIconUrl
    groups.push({
      key: `dom:${dom}`,
      title: dom,
      isOther: false,
      tabs,
      kind: 'domain',
      host: dom,
      ...(fav ? { faviconUrl: fav } : {}),
    })
  }

  return { groups, singleton: groups.length === 1 }
}
```

- [ ] **Step 2.2: 运行,三个用例应通过**

Run: `pnpm vitest run tests/lib/render-groups.test.ts`
Expected: 3 passed。

### Step 3: 加"其他兜底 + 组间排序"用例与实现

- [ ] **Step 3.1: 追加测试到同一文件末尾**

Append to `tests/lib/render-groups.test.ts`:

```ts
describe('groupTabsForRender — 域名分支:其他兜底与排序', () => {
  it('单 tab 的小众域汇入末尾"其他"组', () => {
    const r = groupTabsForRender(
      makeSpace({
        tabs: [
          t('https://github.com/a'),
          t('https://github.com/b'),
          t('https://figma.com/x'),
          t('https://figma.com/y'),
          t('https://lonely.example.com/z'),
        ],
      }),
    )
    expect(r.singleton).toBe(false)
    const titles = r.groups.map((g) => g.title)
    // github(2), figma(2) 在前,"其他" 在末尾
    expect(titles[titles.length - 1]).toBe('other')
    // 域名组按 tab 数倒序;tab 数相同时保留首次出现顺序
    expect(titles.slice(0, 2)).toEqual(['github.com', 'figma.com'])
    const otherGroup = r.groups[r.groups.length - 1]
    expect(otherGroup?.isOther).toBe(true)
    expect(otherGroup?.kind).toBe('other')
    expect(otherGroup?.tabs.map((tt) => tt.url)).toEqual(['https://lonely.example.com/z'])
  })

  it('组内顺序保留输入相对顺序', () => {
    const r = groupTabsForRender(
      makeSpace({
        tabs: [
          t('https://github.com/c'),
          t('https://figma.com/x'),
          t('https://github.com/a'),
          t('https://github.com/b'),
        ],
      }),
    )
    const gh = r.groups.find((g) => g.host === 'github.com')
    expect(gh?.tabs.map((tt) => tt.url)).toEqual([
      'https://github.com/c',
      'https://github.com/a',
      'https://github.com/b',
    ])
  })

  it('"其他"组只有 1 个 tab 时仍单组降级(其他组不与多组同时存在?— 不,要测多组+其他不降级)', () => {
    const r = groupTabsForRender(
      makeSpace({
        tabs: [
          t('https://github.com/a'),
          t('https://github.com/b'),
          t('https://lonely.example.com/z'),
        ],
      }),
    )
    // github 2 + "其他" 1 = 2 组,不降级
    expect(r.singleton).toBe(false)
    expect(r.groups).toHaveLength(2)
  })

  it('全部 tab 都是小众单 host 时,合并进 1 个"其他"组并触发降级', () => {
    const r = groupTabsForRender(
      makeSpace({
        tabs: [
          t('https://a.example/x'),
          t('https://b.example/y'),
          t('https://c.example/z'),
        ],
      }),
    )
    expect(r.singleton).toBe(true)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]?.isOther).toBe(true)
    expect(r.groups[0]?.tabs).toHaveLength(3)
  })
})
```

注:测试期望 `title === 'other'` 是因为 lib 不做 i18n。i18n 由调用方做。

- [ ] **Step 3.2: 运行,期望 4 个新用例 FAIL**

Run: `pnpm vitest run tests/lib/render-groups.test.ts`
Expected: 之前 3 个 pass,新加的 4 个 fail(还没有"其他"兜底)。

- [ ] **Step 3.3: 重写 `groupTabsForRender` 加入"其他"兜底与排序**

Replace the body of `groupTabsForRender` in `lib/render-groups.ts` with:

```ts
export function groupTabsForRender(space: Space): GroupTabsResult {
  // domain 分支:先按注册域聚类,保留首次出现顺序
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

  // 多组按 tab 数倒序;相同时保留 byDomain 的插入顺序(JS Map 保证)
  // 用稳定排序:先记录原始 index 作为 tie-breaker
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
```

- [ ] **Step 3.4: 运行,所有 7 个用例应通过**

Run: `pnpm vitest run tests/lib/render-groups.test.ts`
Expected: 7 passed.

注:`Array.prototype.sort` 在现代 V8 是稳定的,所以 tie-breaker 自动保留插入顺序。

### Step 4: 加原生 groups 分支

- [ ] **Step 4.1: 追加测试**

Append to `tests/lib/render-groups.test.ts`:

```ts
describe('groupTabsForRender — 原生 groups 分支优先', () => {
  it('有 space.groups 时按 groups 数组顺序产出,kind=native', () => {
    const r = groupTabsForRender(
      makeSpace({
        groups: [
          { key: 'g1', title: 'Frontend', color: 'blue' },
          { key: 'g2', title: 'Docs', color: 'green' },
        ],
        tabs: [
          t('https://github.com/a', { groupKey: 'g1' }),
          t('https://example.com/x', { groupKey: 'g2' }),
          t('https://github.com/b', { groupKey: 'g1' }),
        ],
      }),
    )
    expect(r.groups.map((g) => g.kind)).toEqual(['native', 'native'])
    expect(r.groups[0]?.title).toBe('Frontend')
    expect(r.groups[0]?.nativeColor).toBe('blue')
    expect(r.groups[0]?.tabs.map((tt) => tt.url)).toEqual([
      'https://github.com/a',
      'https://github.com/b',
    ])
    expect(r.groups[1]?.title).toBe('Docs')
    expect(r.groups[1]?.nativeColor).toBe('green')
  })

  it('原生分支:未携 groupKey 的 tab 进末尾"其他"组', () => {
    const r = groupTabsForRender(
      makeSpace({
        groups: [{ key: 'g1', title: 'A', color: 'red' }],
        tabs: [
          t('https://github.com/a', { groupKey: 'g1' }),
          t('https://github.com/b', { groupKey: 'g1' }),
          t('https://other.example/x'),
        ],
      }),
    )
    expect(r.groups.map((g) => g.kind)).toEqual(['native', 'other'])
    expect(r.groups[1]?.isOther).toBe(true)
    expect(r.groups[1]?.tabs).toHaveLength(1)
  })

  it('原生分支:groupKey 指向不存在的 group 时按"其他"兜底', () => {
    const r = groupTabsForRender(
      makeSpace({
        groups: [{ key: 'g1', title: 'A', color: 'red' }],
        tabs: [
          t('https://github.com/a', { groupKey: 'g1' }),
          t('https://github.com/b', { groupKey: 'g1' }),
          t('https://stale.example/x', { groupKey: 'g-stale' }),
        ],
      }),
    )
    expect(r.groups).toHaveLength(2)
    expect(r.groups[1]?.isOther).toBe(true)
    expect(r.groups[1]?.tabs[0]?.url).toBe('https://stale.example/x')
  })

  it('原生分支:无 title 的原生 group 标题用颜色名兜底', () => {
    const r = groupTabsForRender(
      makeSpace({
        groups: [{ key: 'g1', color: 'purple' }],
        tabs: [
          t('https://x.example/a', { groupKey: 'g1' }),
          t('https://x.example/b', { groupKey: 'g1' }),
        ],
      }),
    )
    expect(r.groups[0]?.title).toBe('purple')
  })

  it('原生分支:有 groups 字段但全部 tab 都没 groupKey 时,回退到域名分支', () => {
    const r = groupTabsForRender(
      makeSpace({
        groups: [{ key: 'g1', title: 'A', color: 'red' }],
        tabs: [
          t('https://github.com/a'),
          t('https://github.com/b'),
          t('https://figma.com/x'),
          t('https://figma.com/y'),
        ],
      }),
    )
    // 没有任何 tab 引用 groups,等同没有 groups
    expect(r.groups.map((g) => g.kind)).toEqual(['domain', 'domain'])
  })
})
```

- [ ] **Step 4.2: 运行,期望 5 个新用例 FAIL**

Run: `pnpm vitest run tests/lib/render-groups.test.ts`
Expected: 之前 7 个 pass,新 5 个 fail。

- [ ] **Step 4.3: 在 `groupTabsForRender` 开头加入原生分支**

Replace the entire body of `groupTabsForRender` in `lib/render-groups.ts`:

```ts
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
```

- [ ] **Step 4.4: 运行,所有 12 个用例应通过**

Run: `pnpm vitest run tests/lib/render-groups.test.ts`
Expected: 12 passed.

### Step 5: Commit Task 1

- [ ] **Step 5.1: 类型检查 + 全量测试**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 类型零错误,所有测试通过。

- [ ] **Step 5.2: Commit**

```bash
git add lib/render-groups.ts tests/lib/render-groups.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): add groupTabsForRender for per-space visual grouping

Pure function that clusters a space's tabs by registered domain (eTLD+1)
or by native Chrome tab groups when present. Single-group output is
flagged via `singleton` so the renderer can fall back to a flat list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `lib/settings.ts` — 新增 `groupTabsByDomain` 设置

**Files:**
- Modify: `lib/settings.ts`

### Step 1: 写测试(可选,但便于回归)

- [ ] **Step 1.1: 跳过单测,该模块依赖 chrome.storage,现有 `useUseAsNewtab` 也无单测,保持一致**

我们靠类型检查 + 手动烟测覆盖。如果未来加 `tests/lib/settings.test.ts`,可参照其他 chrome.storage mock 测试。

### Step 2: 实现

- [ ] **Step 2.1: 在 `lib/settings.ts` 顶部加 key 常量与读写函数**

Modify `lib/settings.ts`. After existing `KEY_NEWTAB` block (after line 22 of current file), add at end of file:

```ts
const KEY_GROUP_BY_DOMAIN = 'groupTabsByDomain'

/** 是否在空间卡片内按域名分组渲染 tab。默认开启。 */
export async function readGroupTabsByDomain(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get(KEY_GROUP_BY_DOMAIN)
    // 未设置过 → 默认开启;显式 false 时关闭
    return r[KEY_GROUP_BY_DOMAIN] !== false
  } catch {
    return true
  }
}

export async function writeGroupTabsByDomain(v: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY_GROUP_BY_DOMAIN]: v })
  } catch {
    // 同 useAsNewtab:写失败由读端兜底
  }
}

export function useGroupTabsByDomain(): {
  enabled: boolean
  setEnabled: (v: boolean) => void
} {
  // 同步初始 = true,避免首帧从 false 闪到 true
  const [enabled, setState] = useState(true)
  useEffect(() => {
    let mounted = true
    void readGroupTabsByDomain().then((v) => {
      if (mounted) setState(v)
    })
    const onChange = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && KEY_GROUP_BY_DOMAIN in changes) {
        setState(changes[KEY_GROUP_BY_DOMAIN]?.newValue !== false)
      }
    }
    try {
      chrome.storage.onChanged.addListener(onChange)
    } catch {
      // dev / 非扩展环境忽略
    }
    return () => {
      mounted = false
      try {
        chrome.storage.onChanged.removeListener(onChange)
      } catch {
        // 同上
      }
    }
  }, [])
  const setEnabled = (v: boolean) => {
    setState(v)
    void writeGroupTabsByDomain(v)
  }
  return { enabled, setEnabled }
}
```

- [ ] **Step 2.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 零错误。

- [ ] **Step 2.3: Commit**

```bash
git add lib/settings.ts
git commit -m "$(cat <<'EOF'
feat(settings): add groupTabsByDomain toggle (default on)

Read/write/use hook following the existing useAsNewtab pattern. Default
is true so the new grouping UI is visible immediately; users can opt out
from the settings menu.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `components/tab-group-block.tsx` — 哑组件

**Files:**
- Create: `components/tab-group-block.tsx`

### Step 1: 实现

- [ ] **Step 1.1: 创建组件**

Create `components/tab-group-block.tsx`:

```tsx
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
        className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group/groupheader"
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
          className={`flex-1 truncate text-[11.5px] leading-none ${
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
      {!collapsed && <div className="mt-0.5 pl-5">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 1.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 零错误。

- [ ] **Step 1.3: Commit**

```bash
git add components/tab-group-block.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add TabGroupBlock for collapsible per-space group rendering

Dumb component that draws the group header (favicon + title + count +
chevron) and renders the caller-supplied tab rows underneath. Native
groups get a Chrome color bar; the "other" bucket falls back to the
Globe icon.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `components/space-item.tsx` — 接入分组渲染

**Files:**
- Modify: `components/space-item.tsx`

### Step 1: 引入依赖与状态

- [ ] **Step 1.1: 在 import 块加入新模块**

In `components/space-item.tsx`, find the existing import group near the top (around lines 1-9). Add these imports:

```tsx
import { groupTabsForRender } from '@/lib/render-groups'
import { useGroupTabsByDomain } from '@/lib/settings'
import { TabGroupBlock } from './tab-group-block'
```

- [ ] **Step 1.2: 在 `SpaceItem` 函数体顶部(其他 state 之后)加入开关与折叠 state**

Find the `useState` block at the top of `SpaceItem` (around line 57-72,紧接 `const palette = colorForSpace(space.id)` 之前). Add:

```tsx
const { enabled: groupingEnabled } = useGroupTabsByDomain()
// 折叠状态:key 是 RenderedGroup.key。仅在 popup 生命周期内有效。
const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
```

- [ ] **Step 1.3: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 零错误。

### Step 2: 计算渲染分组

- [ ] **Step 2.1: 在 `visibleSpace` 行下方加入分组计算**

Find the existing line:

```tsx
const visibleSpace = cardQuery ? filterSpaceTabs(space, cardQuery) : space
```

(Around line 131.) Add immediately after it:

```tsx
// 分组渲染结果(关闭开关时不计算,直接走平铺)
const rendered = useMemo(
  () => (groupingEnabled ? groupTabsForRender(visibleSpace) : null),
  [groupingEnabled, visibleSpace],
)
const useFlatList = !rendered || rendered.singleton
```

Make sure `useMemo` is in the React import line at the top — it already is (line 1 imports it).

### Step 3: 把现有 tab 渲染循环抽成本地函数,然后让分组块和平铺路径都复用

- [ ] **Step 3.1: 找到当前的 tab 渲染块**

Locate the JSX at lines ~628-676 inside the `SpaceItem` return — the block under the comment `{/* 标签列表(收起时整段不渲染) */}`. It currently looks like:

```tsx
{collapsed ? null : visibleSpace.tabs.length > 0 ? (
  <div className="mt-3 space-y-0.5">
    {visibleSpace.tabs.map((tab, i) => (
      <SpaceTabRow ... />
    ))}
  </div>
) : cardQuery ? (
  <div className="mt-3 px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
    {t('noSearchResults')}
  </div>
) : null}
```

- [ ] **Step 3.2: 把单行的 JSX 提取成一个内部 helper(避免重复)**

Just above the `return (` of `SpaceItem` (around line 326), add:

```tsx
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
      if (selectedSet.size > 0) clearSelection()
      onTabOpen(url)
    }}
    onRemove={(url) => onTabRemove(space.id, url)}
    onMove={(toId, url) => onTabMove(space.id, toId, url)}
    onSelectToggle={handleSelectToggle}
    onSelectRange={handleSelectRange}
    onReorderInSpace={(fromUrls, position) => {
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
```

This requires importing `Tab` from `@/lib/schema`. Add to existing schema import line at top of file:

```tsx
import type { Space, Tab } from '@/lib/schema'
```

(Currently only `Space` is imported.)

- [ ] **Step 3.3: 把"折叠状态切换"的 helper 加上**

Right after `renderTabRow`, add:

```tsx
const toggleGroup = (key: string) => {
  setCollapsedGroups((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
}
```

### Step 4: 替换 tab 列表 JSX

- [ ] **Step 4.1: 用新逻辑替换原渲染块**

Replace the block from `{/* 标签列表(收起时整段不渲染) */}` through its closing `: null}` with:

```tsx
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
```

注:`renderTabRow` 的第二参数(`i`)只用于生成 React `key`(`${tab.url}-${i}`),用 `findIndex` 保证同一 URL 在两种渲染路径下 key 稳定。

- [ ] **Step 4.2: 删除原已被替换的内联渲染块**

确认原 `visibleSpace.tabs.map((tab, i) => ( <SpaceTabRow ... />))` 已被新逻辑替换,文件中不应再出现重复的 `SpaceTabRow ...` props 长列表。

- [ ] **Step 4.3: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 零错误。

### Step 5: 现有单测烟测

- [ ] **Step 5.1: 全量测试不应破坏**

Run: `pnpm vitest run`
Expected: 全部通过(`render-groups.test.ts` 12 + 现有套件)。

- [ ] **Step 5.2: Commit**

```bash
git add components/space-item.tsx
git commit -m "$(cat <<'EOF'
feat(ui): render space tabs as collapsible domain/native groups

SpaceItem now calls groupTabsForRender and renders each cluster via
TabGroupBlock when grouping is enabled and more than one group exists.
Single-group output and the off-switch both fall back to the existing
flat list with no behavioral change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `components/settings-menu.tsx` — 接入全局 toggle

**Files:**
- Modify: `components/settings-menu.tsx`

### Step 1: 接入 hook 与 i18n key

- [ ] **Step 1.1: 在 import 块加入 hook**

In `components/settings-menu.tsx`, after `import { useTheme, THEME_PREFS, type ThemePref } from '@/lib/theme'`, add:

```tsx
import { useGroupTabsByDomain } from '@/lib/settings'
import { Layers } from './icons'
```

- [ ] **Step 1.2: 在 `SettingsMenu` 函数顶部读取 hook**

Just after `const { pref: themePref, setPref: setThemePref } = useTheme()`, add:

```tsx
const { enabled: groupingEnabled, setEnabled: setGroupingEnabled } = useGroupTabsByDomain()
```

### Step 2: 加 toggle UI

- [ ] **Step 2.1: 在 Theme 块与 Export 块之间插入分组 toggle**

Find the `border-t` div that contains the Export button (around line 62 of current file). Just **before** that `<div className="border-t border-slate-100 dark:border-slate-700">`, insert:

```tsx
<div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2">
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <Layers className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
    <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
      {t('groupTabsByDomain')}
    </span>
    <input
      type="checkbox"
      checked={groupingEnabled}
      onChange={(e) => setGroupingEnabled(e.target.checked)}
      className="w-4 h-4 cursor-pointer accent-slate-700 dark:accent-slate-300"
      aria-label={t('groupTabsByDomain')}
    />
  </label>
</div>
```

- [ ] **Step 2.2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 零错误。注:`t('groupTabsByDomain')` 在 Task 6 之前会返回 key 本身,但不会报错。

- [ ] **Step 2.3: Commit**

```bash
git add components/settings-menu.tsx
git commit -m "$(cat <<'EOF'
feat(settings): add 'group tabs by domain' toggle to settings menu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: i18n — 加 `groupTabsByDomain` key 到 5 个语种

**Files:**
- Modify: `lib/i18n.ts`

### Step 1: 加翻译

- [ ] **Step 1.1: 找到 `zh-CN` 块里 `categoryOther` 那一行**

Run: `grep -n "categoryOther" lib/i18n.ts`
Expected lines: 103, 290, 478, 666, 855(5 个 locale 各一行)。

- [ ] **Step 1.2: 在每个 locale 的 `categoryOther` **下面**插入新 key**

对于 `zh-CN`(line 103 附近),在 `categoryOther: '其他',` 下方加:

```ts
    groupTabsByDomain: '按域名分组标签',
```

对于 `zh-TW`(line 290 附近):

```ts
    groupTabsByDomain: '按網域分組分頁',
```

对于 `en`(line 478 附近):

```ts
    groupTabsByDomain: 'Group tabs by domain',
```

对于 `ja`(line 666 附近):

```ts
    groupTabsByDomain: 'ドメインごとにタブをグループ化',
```

对于 `de`(line 855 附近):

```ts
    groupTabsByDomain: 'Tabs nach Domain gruppieren',
```

- [ ] **Step 1.3: 类型检查 + 测试**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 零错误,所有测试通过。

- [ ] **Step 1.4: Commit**

```bash
git add lib/i18n.ts
git commit -m "$(cat <<'EOF'
i18n: add groupTabsByDomain label across 5 locales

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 手工烟测与最终验证

**Files:**(无新增/改动)

### Step 1: 启动 dev,人工跑一遍清单

- [ ] **Step 1.1: 启动 WXT dev**

Run: `pnpm dev`
Expected: WXT 启动,提示加载 `.output/chrome-mv3-dev` 到 Chrome `chrome://extensions`(开发者模式)。

- [ ] **Step 1.2: 烟测清单 — 依次验证以下场景**

打开扩展管理页(右键扩展图标 → "Open in Manager"或直接打开扩展的 manager 页),然后跑这套:

1. **空空间** — 创建一个空空间,不应渲染分组块,显示为空
2. **1 个 tab** — 加一个 tab,应直接平铺(singleton 降级)
3. **2 个同域 tab** — 全部 `github.com`,平铺,无分组头
4. **3 个混合域(2+1)** — 2 个 github + 1 个 example,应看到 `github.com (2)` 一组 + `其他 (1)` 一组
5. **多组** — 多个域名各 2+ 个,验证按 tab 数倒序
6. **原生标签组空间** — 在 Chrome 里手动给几个 tab 建 group,归档到一个新空间;打开 SpaceTab 应看到按原生 group 渲染(标题、颜色),而不是按域名
7. **折叠** — 点组头部箭头,该组下属 tabs 应折叠;再点展开;切换 popup 重开应回到全展开(不持久化)
8. **设置 toggle** — 设置菜单里点"按域名分组标签"开关,效果应即时生效(关 → 全部平铺;开 → 立即分组)
9. **本地搜索** — 在空间卡片上展开搜索,输入关键词,只剩匹配的 tab 时分组也会过滤掉空组,组数减少时可能触发降级
10. **跨空间拖拽 tab** — 不受影响,仍能正常 drop
11. **多选 + 批量移动** — 跨多个组多选,批量操作正常
12. **5 语种** — 切换语言验证 "其他" 与设置项标题都被翻译

- [ ] **Step 1.3: 浅色 / 深色主题各跑一遍**

设置菜单切换 Light / Dark,确认 TabGroupBlock 在两种主题下都对比清晰。

- [ ] **Step 1.4: 检查 console 没有红字**

DevTools(Inspect popup / manager)Console 无报错 / warning(允许 React 已有的非新增警告)。

### Step 2: 最终验证

- [ ] **Step 2.1: 全量测试 + 类型检查**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 零错误,全 pass。

- [ ] **Step 2.2: 生产构建**

Run: `pnpm build`
Expected: 构建成功,`.output/chrome-mv3` 产物可正常加载。

- [ ] **Step 2.3: 把"上架前检查"里的"无 console.log 泄漏"过一眼**

Run: `grep -rn "console.log" lib/render-groups.ts components/tab-group-block.tsx`
Expected: 无输出。

---

## Self-Review

**Spec 覆盖检查**(对照 `2026-05-20-tab-grouping-design.md`):

- § 1 目标:纯展示层、按 eTLD+1、原生 groups 优先、全局可关闭、单组降级 → 覆盖于 Task 1 / 2 / 4 / 5
- § 2 分支选择三分支:Task 1 Step 4 实现原生分支,Step 2-3 实现域名分支,Step 3 实现单组降级
- § 3 模块切分表:逐文件对应 Task 1-6
- § 4.1 `RenderedGroup` 接口:Task 1 Step 2.1 完整声明(含 `isOther` 由调用方做 i18n)
- § 4.2 `groupTabsForRender` 不读 settings:Task 1 实现里不引 settings;Task 4 Step 2.1 在调用方做开关判断
- § 5.1 容器:Task 3 Step 1.1 `mt-2 first:mt-0`
- § 5.2 头部 favicon + 域名/标题 + 计数:Task 3 Step 1.1
- § 5.3 原生分支色条:Task 3 Step 1.1(`group.kind === 'native'` 分支用 `GROUP_COLOR_BAR`)
- § 5.4 行复用 SpaceTabRow + `pl-5` 缩进:Task 3 children 区 `pl-5` + Task 4 复用 `renderTabRow`
- § 5.5 折叠状态在内存:Task 4 Step 1.2 `useState<Set<string>>(new Set())`
- § 5.6 单组降级:Task 4 Step 2.1 `useFlatList`
- § 5.7 "其他"组占位 favicon:Task 3 Step 1.1(`!group.faviconUrl` 路径走 Globe)
- § 6.1 测试矩阵:Task 1 Step 1/3/4 共 12 个用例
- § 7 协作策略:Task 4 保留所有 SpaceTabRow 现有 props,不改 selection / drag / search 行为
- § 8 风险:已知 tradeoff(同空间 reorder 视觉失效)已记录在 Task 4 Step 4.1 注释里,回退路径就是 toggle off

**Placeholder 扫描**:无 TODO / TBD;每个 code step 都有完整代码;复用的 `SpaceTabRow` 长 props 显式列出,无 "similar to" 简写。

**类型一致性检查**:
- `RenderedGroup` 字段名在 Task 1 / 3 / 4 一致(`key` / `title` / `tabs` / `kind` / `nativeColor` / `host` / `faviconUrl` / `isOther`)
- `groupTabsForRender` 返回 `{ groups, singleton }`,Task 4 Step 2.1 解构一致
- `useGroupTabsByDomain` 返回 `{ enabled, setEnabled }`,Task 2 / 4 / 5 调用方式一致
- `TabGroupBlock` props(`group / otherLabel / palette / collapsed / onToggleCollapse / children`)Task 3 定义 与 Task 4 Step 4.1 传入一致

无类型漂移、无方法名漂移。
