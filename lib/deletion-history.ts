import { DeletionRecordSchema, type DeletionRecord } from './schema'

const KEY = 'deletionHistory'
export const DELETION_HISTORY_LIMIT = 50

export async function readDeletionHistory(): Promise<DeletionRecord[]> {
  try {
    const raw = (await chrome.storage.local.get(KEY))[KEY]
    const parsed = DeletionRecordSchema.array().safeParse(raw ?? [])
    return parsed.success ? parsed.data : []
  } catch { return [] }
}

export async function appendDeletionRecords(records: DeletionRecord[]): Promise<DeletionRecord[] | null> {
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY]
    const parsed = DeletionRecordSchema.array().safeParse(stored ?? [])
    if (!parsed.success) return null
    return [...parsed.data, ...records].slice(-DELETION_HISTORY_LIMIT)
  } catch { return null }
}

export async function writeDeletionHistory(records: DeletionRecord[]): Promise<boolean> {
  try { await chrome.storage.local.set({ [KEY]: records.slice(-DELETION_HISTORY_LIMIT) }); return true } catch { return false }
}
