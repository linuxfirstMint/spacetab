# 空间内按相似域名分组显示 — 设计

> Date: 2026-05-20
> Status: Approved (pending implementation plan)
> Scope: 在每个空间(SpaceItem)内,把同一注册域名的 tab 视觉上聚拢成分组块,提升浏览清晰度。

---

## 1. 目标与非目标

### 目标

- 在 `SpaceItem` 卡片里,将 `space.tabs` 按"注册域名(eTLD+1)"自动聚拢成若干**分组块**渲染,每块可独立折叠。
- 已有 Chrome 原生标签组(`space.groups`)的空间,**优先用原生 groups 渲染**,保留用户在 Chrome 里的显式分组意图。
- 全局可关闭(`settings` 里加一个 toggle),关闭后退回到现有平铺渲染。
- 不修改 `Space` / `Tab` / `Database` 的 schema,不写入持久化数据,纯展示层。

### 非目标

- 不引入新的语义分类逻辑(不复用 `lib/clustering.ts` 的"开发 / 设计 / AI" 等预设类别)。
- 不为分组提供持久化的折叠状态(popup 关闭即丢失)。
- 不修改 Chrome 原生标签组的持久/恢复逻辑(`tab-groups.ts` 保持不动)。
- 不在归档对话框(`SmartArchiveDialog`)做任何改动,它继续用 `clustering.ts`。
- 不引入新的 npm 依赖。

---

## 2. 整体策略

每次渲染一个空间时,在内存里对 `space.tabs` 算出 `RenderedGroup[]`,渲染层据此画分组块。

**分支选择**(每个空间独立):

1. 若 `settings.groupTabsByDomain === false` → 不分组,平铺(等同当前行为)。
2. 否则,若 `space.groups` 非空 → **原生 groups 分支**:按 `groups` 数组顺序产出分组块;`tabs` 里没有 `groupKey` 或 `groupKey` 不在 `groups` 里的统一进末尾的"其他"组。
3. 否则 → **域名聚类分支**:按注册域名聚类。聚类后单 tab 的"碎组"全部汇入"其他"组。组间按组内 tab 数倒序排;组内保持原 `tabs` 数组相对顺序。

**降级**:任何分支聚类后只有 1 组 → 不画分组 chrome,平铺渲染,等同当前行为。这避免空间小却包一层多余的视觉块。

---

## 3. 模块切分

| 路径 | 新增/改动 | 职责 |
|---|---|---|
| `lib/render-groups.ts` | **新增** | 纯函数 `groupTabsForRender(space): RenderedGroup[]`。零 Chrome API 依赖,可直接单测。 |
| `lib/settings.ts` | 改动 | 沿用现有 per-key 的 `read/write/use*` 模式,新增 `groupTabsByDomain`(默认 `true`),不破坏 `useAsNewtab` 已有 API。 |
| `components/tab-group-block.tsx` | **新增** | 哑组件。渲染一个分组块:头部(箭头 + favicon + 域名/标题 + 计数)+ 子 `SpaceTabRow` 列表。 |
| `components/space-item.tsx` | 改动 | 用 `groupTabsForRender` + `TabGroupBlock` 替换当前平铺循环;接入 `useGroupTabsByDomain`。 |
| `components/settings-menu.tsx` | 改动 | 加一个 toggle 项 `t('groupTabsByDomain')`。 |
| `lib/i18n.ts`(及对应 locale 资源) | 改动 | 加一个 i18n key:`groupTabsByDomain`(用于设置项名)。`categoryOther` 已存在,复用作为"其他"组标题。 |
| `tests/lib/render-groups.test.ts` | **新增** | 覆盖第 6 节列出的所有边界。 |

`render-groups.ts` 独立、纯函数、可测;`tab-group-block.tsx` 哑组件;`space-item.tsx` 不会显著膨胀(只是把循环体从 `SpaceTabRow` 换成"组循环 → 组块 → 行循环")。

---

## 4. 数据契约

### 4.1 `RenderedGroup`(`lib/render-groups.ts` 导出)

```ts
export interface RenderedGroup {
  /** 稳定 key,用作折叠 state 的 key 与 React 的 key */
  key: string
  /** 组标题文本来源:原生 group 的 title / 注册域名 / "其他"国际化文案 */
  title: string
  /** 组内 tabs,保持原数组的相对顺序 */
  tabs: Tab[]
  /** 视觉用的来源信息 */
  kind: 'native' | 'domain' | 'other'
  /** 原生分支:Chrome group 的颜色(用于色条);其他分支:undefined,由 UI 决定 */
  nativeColor?: TabGroupColor
  /** 域名分支:用于组头展示的代表性 favicon URL(取组内第一个非空 favIconUrl) */
  faviconUrl?: string
  /** 域名分支:eTLD+1,例如 'github.com';原生分支不填 */
  host?: string
}
```

### 4.2 `groupTabsForRender(space): { groups: RenderedGroup[]; singleton: boolean }`

返回 `singleton: true` 表示"只产出 1 组"(渲染层据此降级为平铺)。`groups.length === 0` 表示空间为空。

该函数不读 `settings`、不感知全局开关 — 由调用方 `SpaceItem` 根据 `useGroupTabsByDomain()` 决定是否调用;关闭时调用方直接走原平铺路径。

### 4.3 注册域名提取

复用思路与 `lib/clustering.ts` 的 `registeredDomain`(取末尾两段)一致 — 后续可考虑提取成共享工具,但本次 spec 不做此重构(YAGNI),`render-groups.ts` 自带一份私有实现。

---

## 5. UI 视觉规格

### 5.1 分组块容器

- 不画外边框、不加背景色,保持卡片整体的轻盈感
- 组之间 `mt-2` 间距;首组无 `mt-2`
- 左右内边距与现有平铺行对齐

### 5.2 组头部行(高度约 24px,与现有 tab 行视觉重量接近)

- 左:折叠箭头 `ChevronDown`(展开朝下、折叠 `-rotate-90`,复用 `icons.tsx`)
- 中:**代表性 favicon**(`RenderedGroup.faviconUrl`,16×16,失败时显示占位灰块);后接**域名/标题**(原生组:`group.title || '#color'`;域名组:`host`;其他组:`t('categoryOther')`)
  - 域名/标题文案样式:`text-[11px] font-medium`,域名分支用 monospace,标题分支用普通字体
- 右:计数 chip,复用 `palette.countBg / countText / countRing` 系列
- 鼠标 hover:背景 `bg-slate-50/60 dark:bg-slate-800/40`,光标 `cursor-pointer`
- 整行点击 → 切换该组折叠

### 5.3 原生分支的色条

- 原生组在组头部左侧多画一条 4×16 的色条(用 `GROUP_COLOR_BAR[nativeColor]`),保留与 Chrome 颜色一致的识别性
- 同时 `SpaceTabRow` 内现有的 `groupBarClass` 仍生效(每个 tab 行左侧的细色条)

### 5.4 组内 tab 行

- 完全复用现有 `SpaceTabRow`(props 不变)
- 容器多加 `pl-6` 缩进,让分组层次更清晰
- 拖拽、选择、批量等交互完全不变

### 5.5 折叠状态

- `SpaceItem` 内 `useState<Set<string>>(new Set())`(默认全展开),key 是 `RenderedGroup.key`
- popup 关闭即丢失;不持久化到 storage,不污染 schema
- 当空间整体被折叠(已有的 `collapsed`)时,分组块不渲染

### 5.6 单组降级

- `singleton === true` 时,跳过 `TabGroupBlock`,直接渲染原有的 `SpaceTabRow` 循环
- 这处理了"空间小"、"全部同域"两种情形

### 5.7 "其他"组

- 标题用 `t('categoryOther')`(已有 i18n key)
- `faviconUrl` 留空,组头部 favicon 位用占位灰块(避免选取不具代表性的 favicon 误导)

---

## 6. 测试与边界

### 6.1 `tests/lib/render-groups.test.ts` 必覆盖

| 场景 | 期望 |
|---|---|
| `space.tabs.length === 0` | `groups: []`, `singleton: false` |
| 全部同 host(只产 1 组) | `groups.length === 1`, `singleton: true` |
| 多 host,无原生 groups | 域名分支:`kind: 'domain'`,组间按 tab 数倒序 |
| 多 host,无原生 groups,部分 host 只 1 个 tab | 那些 tab 进入末尾"其他"组,`kind: 'other'` |
| `space.groups` 非空,全部 tab 都有合法 `groupKey` | 原生分支:组顺序按 `space.groups` 数组顺序,`kind: 'native'` |
| `space.groups` 非空,部分 tab 没有 `groupKey` | 原生分支 + "其他"组兜底 |
| `space.groups` 非空,部分 tab 的 `groupKey` 不在 `groups` 数组里 | 这些 tab 也进末尾"其他"组(防御性) |
| `docs.github.com` 和 `github.com` 都在 tabs 里 | 域名分支:合并为 `github.com` 这一组 |
| 无效 URL 的 tab | 跳过(不计入任何组);若所有 tab 都无效 → `groups: []` |
| 组内顺序 | 保留输入 `space.tabs` 中的相对顺序 |

### 6.2 不在测试范围

- `TabGroupBlock` 与 `SpaceItem` 的 UI 渲染(按 CLAUDE.md:UI 不强制单测)
- `settings.ts` 新加的 `read/write/useGroupTabsByDomain` 复用现有模式,加 1-2 个 happy-path 单测即可(可选)

### 6.3 验证清单(人工烟测)

- 空空间 / 1 个 tab / 2 个同域 / 3 个不同域 / 大量混合
- 有原生标签组的空间(从 Chrome 实窗口归档)
- 设置 toggle 切换效果即时生效
- 折叠 / 展开单个分组
- 跨空间拖拽 tab 到分组块上(应仍能 drop 进所在空间)
- 同空间多选 + 批量移动(不应被分组打断)
- 卡片整体折叠时分组块也不可见

---

## 7. 与已有交互的协作

| 交互 | 结论 |
|---|---|
| 跨空间拖拽 tab | 不受影响。tab 行的拖拽 payload 不变,父卡片仍负责接收 drop。 |
| 同空间内 reorder | **已知 tradeoff**:开了分组后视觉上看不出 reorder 效果(分组重排会盖住)。用户想手排可关闭全局 toggle。后续如有反馈再补"开了分组时禁用同空间 reorder"。 |
| 多选 / 批量栏 | 不受影响。选区是 URL 集合,跨多个分组也能选;批量栏继续在卡片头部展示。 |
| 卡片内本地搜索 (`cardQuery`) | 先过滤 `space.tabs`,再调用 `groupTabsForRender`。空组(过滤后无 tab)自然不会出现。 |
| 空间整体折叠 (`collapsed`) | 优先级最高,折叠整个空间时不渲染分组块。 |
| Chrome 原生标签组导入 / 恢复 | 完全不变;`tab-groups.ts` 不动。 |
| 智能归档对话框 | 完全不变;`SmartArchiveDialog` 与 `clustering.ts` 保持现状。 |

---

## 8. 风险与回退

- **风险**:分组开启时,同空间手动 reorder 视觉失效。缓解:全局 toggle 默认开但可关。
- **风险**:大量小众单 tab 域名导致"其他"组膨胀。缓解:"其他"组也走折叠 chrome,默认与其他组一样展开(用户主动折叠即可)。
- **回退路径**:任何阶段把 `groupTabsByDomain` 改回 `false` 默认即可恢复现行行为;`render-groups.ts` 是新文件,删除无副作用。

---

## 9. 实现顺序提示(供后续 plan 参考)

1. `lib/render-groups.ts` + 单测(可独立完成,无 UI 依赖)
2. `lib/settings.ts` 加 `groupTabsByDomain`
3. `components/tab-group-block.tsx`(哑组件)
4. `components/space-item.tsx` 接入
5. `components/settings-menu.tsx` 加 toggle
6. i18n keys 补齐
7. 人工烟测覆盖第 6.3 节清单
