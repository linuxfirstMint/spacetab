import { UrlRuleSchema, type UrlRule } from './schema'

/** URL rules are globs over the complete http(s) URL. * matches any characters. */
export function normalizeUrlPattern(pattern: string): string | null {
  const value = pattern.trim()
  if (!value || value.length > 500 || !/^https?:\/\//i.test(value)) return null
  return value
}

export function matchesUrlPattern(pattern: string, url: string): boolean {
  const valid = normalizeUrlPattern(pattern)
  if (!valid) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const escaped = valid.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
    return new RegExp(`^${escaped}$`, 'i').test(url)
  } catch {
    return false
  }
}

/** First enabled rule by ascending priority wins; ties preserve array order. */
export function selectUrlRule(rules: UrlRule[], url: string, existingSpaceIds: Set<string>): UrlRule | null {
  const candidates = UrlRuleSchema.array().safeParse(rules)
  if (!candidates.success) return null
  return candidates.data
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled && existingSpaceIds.has(rule.spaceId) && matchesUrlPattern(rule.pattern, url))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index)[0]?.rule ?? null
}

export function upsertUrlRule(rules: UrlRule[], next: UrlRule): UrlRule[] {
  const parsed = UrlRuleSchema.safeParse(next)
  if (!parsed.success) return rules
  return [...rules.filter(rule => rule.id !== parsed.data.id), parsed.data]
}
