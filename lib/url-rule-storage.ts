import { UrlRuleSchema, type UrlRule } from './schema'

const KEY = 'urlRoutingRules'
export async function readUrlRules(): Promise<UrlRule[]> {
  try {
    const data = await chrome.storage.local.get(KEY)
    const parsed = UrlRuleSchema.array().safeParse(data[KEY] ?? [])
    return parsed.success ? parsed.data : []
  } catch { return [] }
}
export async function writeUrlRules(rules: UrlRule[]): Promise<boolean> {
  const parsed = UrlRuleSchema.array().safeParse(rules)
  if (!parsed.success) return false
  try { await chrome.storage.local.set({ [KEY]: parsed.data }); return true } catch { return false }
}
