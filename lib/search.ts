import type { Database, Space, Tab } from './schema'

/**
 * 把搜索词归一化:trim + lowercase。空字符串视为"不搜索"。
 * 多个空格分隔的词全部要命中(AND 语义)。
 */
function normalizeQuery(raw: string): string[] {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return []
  return trimmed.split(/\s+/)
}

function tabMatches(tab: Tab, terms: string[]): boolean {
  const haystack = `${tab.title} ${tab.url}`.toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

function spaceNameMatches(space: Space, terms: string[]): boolean {
  const haystack = space.name.toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

function folderMatches(folderName: string, terms: string[]): boolean {
  const haystack = folderName.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/**
 * 过滤一个空间的标签:仅保留命中所有 term 的。
 * 如果空间名本身命中所有 term,则返回原 space(全部 tab 保留),让用户能浏览这个匹配空间的全貌。
 */
export function filterSpaceTabs(space: Space, query: string): Space {
  const terms = normalizeQuery(query)
  if (terms.length === 0) return space
  if (spaceNameMatches(space, terms)) return space
  const matchedFolderIds = new Set((space.folders ?? []).filter((folder) => folderMatches(folder.name, terms)).map((folder) => folder.id))
  const tabs = space.tabs.filter((tab) => tabMatches(tab, terms) || (tab.folderId && matchedFolderIds.has(tab.folderId)))
  const usedFolderIds = new Set(tabs.flatMap((tab) => tab.folderId ? [tab.folderId] : []))
  const folders = (space.folders ?? []).filter((folder) => usedFolderIds.has(folder.id) || matchedFolderIds.has(folder.id))
  if (tabs.length === space.tabs.length && folders.length === (space.folders ?? []).length) return space
  return { ...space, tabs, folders }
}

/**
 * 跨空间过滤:返回(空间名命中)或(至少有一条 tab 命中)的空间。
 * 命中空间内的 tab 也按 query 过滤(空间名命中时则保留全部 tab)。
 */
export function filterDatabase(db: Database, query: string): Database {
  const terms = normalizeQuery(query)
  if (terms.length === 0) return db

  const filteredSpaces: Space[] = []
  for (const space of db.spaces) {
    if (spaceNameMatches(space, terms)) {
      // 空间名命中:整空间纳入,所有 tab 保留
      filteredSpaces.push(space)
      continue
    }
    const filtered = filterSpaceTabs(space, query)
    if (filtered.tabs.length > 0 || filtered.folders?.length) {
      filteredSpaces.push(filtered)
    }
  }
  return { ...db, spaces: filteredSpaces }
}

/**
 * 给 live tabs 也提供 filter:只保留 url/title 命中的。
 */
export function filterLiveTabs<T extends { url: string; title: string }>(
  tabs: T[],
  query: string,
): T[] {
  const terms = normalizeQuery(query)
  if (terms.length === 0) return tabs
  return tabs.filter((t) => tabMatches(t, terms))
}
