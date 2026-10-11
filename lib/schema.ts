import { z } from 'zod'

/** Chrome 标签组支持的颜色,作为字面量类型直接复用 */
export const TabGroupColorSchema = z.enum([
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
])
export type TabGroupColor = z.infer<typeof TabGroupColorSchema>

/** Theme hues used to color a Space; omitted values keep the legacy ID-derived color. */
export const SpaceColorSchema = z.enum(['indigo', 'emerald', 'amber', 'pink', 'violet', 'cyan'])
export type SpaceColor = z.infer<typeof SpaceColorSchema>

export const TabSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  favIconUrl: z.string().url().optional(),
  /** 标签所在分组的逻辑 key(空间内唯一)。Chrome 的 groupId 不持久,这里用稳定 key */
  groupKey: z.string().optional(),
  /** Current destination after navigation; url remains the saved/original URL. */
  currentUrl: z.string().url().optional(),
  /** Space-specific pin, independent of Chrome's native pinned tab state. */
  pinned: z.boolean().optional(),
  /** Flat Space folder membership. Folder nesting is intentionally unsupported. */
  folderId: z.string().min(1).optional(),
})
export type Tab = z.infer<typeof TabSchema>

/** Profile-local favorite. `url` is the saved destination and never follows navigation. */
export const FavoriteSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  favIconUrl: z.string().url().optional(),
})
export type Favorite = z.infer<typeof FavoriteSchema>

export const SpaceFolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  collapsed: z.boolean().optional(),
})
export type SpaceFolder = z.infer<typeof SpaceFolderSchema>

export const TabGroupSchema = z.object({
  key: z.string().min(1),
  title: z.string().optional(),
  color: TabGroupColorSchema,
})
export type TabGroup = z.infer<typeof TabGroupSchema>

export const SpaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tabs: z.array(TabSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** 可选 emoji / 短字符,作为空间封面图标 */
  emoji: z.string().max(8).optional(),
  /** Optional user-selected theme hue; missing values retain deterministic legacy colors. */
  color: SpaceColorSchema.optional(),
  /** 可选简短备注(用户自由文本,~100 字符内即可) */
  note: z.string().max(500).optional(),
  /** 是否置顶。置顶的空间永远排在最前 */
  pinned: z.boolean().optional(),
  /** 手动排序权重。同 pinned 状态下按 sortIndex 升序;未设置默认按 updatedAt 降序兜底 */
  sortIndex: z.number().optional(),
  /** 标签分组定义。tabs[].groupKey 引用其中之一 */
  groups: z.array(TabGroupSchema).optional(),
  /** User-defined flat folders for Space-pinned tabs. */
  folders: z.array(SpaceFolderSchema).optional(),
})
export type Space = z.infer<typeof SpaceSchema>

/** Explicit user-owned URL routing rules. Empty by default and stored locally. */
export const UrlRuleSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1).max(500),
  spaceId: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int().min(0),
})
export type UrlRule = z.infer<typeof UrlRuleSchema>

export const DatabaseSchema = z.object({
  version: z.literal(1),
  spaces: z.array(SpaceSchema),
  /** Optional for compatibility with existing databases and exports. */
  favorites: z.array(FavoriteSchema).max(12).optional(),
})
export type Database = z.infer<typeof DatabaseSchema>

/** User opts in explicitly; omitted settings keep automatic archiving disabled. */
export const AutoArchiveSettingsSchema = z.object({ enabled: z.boolean(), inactivityHours: z.number().int().min(1).max(720) })
export type AutoArchiveSettings = z.infer<typeof AutoArchiveSettingsSchema>
export const AutoArchivedTabSchema = z.object({
  id: z.string().min(1), url: z.string().url(), title: z.string(), favIconUrl: z.string().url().optional(),
  sourceSpaceId: z.string().nullable(), archivedAt: z.number(),
})
export type AutoArchivedTab = z.infer<typeof AutoArchivedTabSchema>

export const EMPTY_DB: Database = { version: 1, spaces: [] }

export type ParseResult =
  | { ok: true; db: Database }
  | { ok: false; raw: unknown }

export function safeParseDatabase(raw: unknown): ParseResult {
  const result = DatabaseSchema.safeParse(raw)
  if (result.success) return { ok: true, db: result.data }
  return { ok: false, raw }
}
