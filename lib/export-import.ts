import { z } from 'zod'
import { DatabaseSchema, safeParseDatabase, type Database } from './schema'
import { mergeFavorites, normalizeFavorites } from './favorites'

export const ExportFileSchema = z.object({
  format: z.literal('spacetab-export'),
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.number(),
  app: z.literal('SpaceTab'),
  db: DatabaseSchema,
})
export type ExportFile = z.infer<typeof ExportFileSchema>

export function serializeForExport(db: Database, now: number = Date.now()): string {
  const normalized = db.favorites === undefined
    ? db
    : { ...db, favorites: normalizeFavorites(db.favorites) }
  const payload: ExportFile = {
    format: 'spacetab-export',
    formatVersion: 2,
    exportedAt: now,
    app: 'SpaceTab',
    db: normalized,
  }
  return JSON.stringify(payload, null, 2)
}

export type ParseResult =
  | { ok: true; file: ExportFile }
  | { ok: false; reason: 'invalid-json' | 'invalid-shape' }

export function parseImport(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  const result = ExportFileSchema.safeParse(parsed)
  if (!result.success) return { ok: false, reason: 'invalid-shape' }
  const db = safeParseDatabase(result.data.db)
  if (!db.ok) return { ok: false, reason: 'invalid-shape' }
  return { ok: true, file: { ...result.data, db: db.db } }
}

// 合并:同 id 比较 updatedAt,较新者整空间替换;新 id 直接加入。
export function mergeDatabase(current: Database, incoming: Database): Database {
  const byId = new Map(current.spaces.map((s) => [s.id, s]))
  for (const incomingSpace of incoming.spaces) {
    const existing = byId.get(incomingSpace.id)
    if (!existing || incomingSpace.updatedAt > existing.updatedAt) {
      byId.set(incomingSpace.id, incomingSpace)
    }
  }
  return {
    version: 1,
    spaces: Array.from(byId.values()),
    favorites: mergeFavorites(current.favorites ?? [], incoming.favorites ?? []),
  }
}

export function replaceDatabase(_current: Database, incoming: Database): Database {
  if (incoming.favorites === undefined) return incoming
  const favorites = normalizeFavorites(incoming.favorites)
  return favorites.length === incoming.favorites.length ? incoming : { ...incoming, favorites }
}

export interface ImportSummary {
  incomingSpaces: number
  newSpaces: number
  updatedSpaces: number
  unchangedSpaces: number
}

export function summarizeImport(current: Database, incoming: Database): ImportSummary {
  const byId = new Map(current.spaces.map((s) => [s.id, s]))
  let newCount = 0
  let updatedCount = 0
  let unchangedCount = 0
  for (const s of incoming.spaces) {
    const existing = byId.get(s.id)
    if (!existing) newCount++
    else if (s.updatedAt > existing.updatedAt) updatedCount++
    else unchangedCount++
  }
  return {
    incomingSpaces: incoming.spaces.length,
    newSpaces: newCount,
    updatedSpaces: updatedCount,
    unchangedSpaces: unchangedCount,
  }
}

export function exportFilename(now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `spacetab-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

// 副作用工具(浏览器 API,不进单测)
export function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.opacity = '0'

    let settled = false
    const cleanup = () => {
      if (input.parentNode) document.body.removeChild(input)
    }
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : null
        finish(text)
      }
      reader.onerror = () => finish(null)
      reader.readAsText(file)
    })

    // 现代浏览器原生 cancel 事件(Chrome 113+ / Firefox 91+);取消时直接收到
    input.addEventListener('cancel', () => finish(null))

    document.body.appendChild(input)
    // 必须在用户点击的同一同步链上调用,才能通过浏览器的 user-activation 检查
    input.click()
  })
}
