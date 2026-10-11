import { describe, expect, it } from 'vitest'
import { matchesUrlPattern, normalizeUrlPattern, selectUrlRule, upsertUrlRule } from '@/lib/url-rules'
import type { UrlRule } from '@/lib/schema'

const first: UrlRule = { id: 'a', pattern: 'https://*.example.com/*', spaceId: 'one', enabled: true, priority: 1 }

describe('URL routing rules', () => {
  it('accepts only explicit HTTP(S) full-URL globs', () => {
    expect(normalizeUrlPattern(' https://example.com/* ')).toBe('https://example.com/*')
    expect(normalizeUrlPattern('file://*')).toBeNull()
    expect(normalizeUrlPattern('example.com')).toBeNull()
    expect(matchesUrlPattern(first.pattern, 'https://docs.example.com/a?q=1')).toBe(true)
    expect(matchesUrlPattern(first.pattern, 'https://evil-example.com/a')).toBe(false)
    expect(matchesUrlPattern(first.pattern, 'chrome://settings')).toBe(false)
  })

  it('uses enabled rules in priority order and ignores deleted Spaces', () => {
    const second = { ...first, id: 'b', spaceId: 'two', priority: 0 }
    expect(selectUrlRule([first, second], 'https://a.example.com/', new Set(['one', 'two']))?.id).toBe('b')
    expect(selectUrlRule([first, second], 'https://a.example.com/', new Set(['one']))?.id).toBe('a')
    expect(selectUrlRule([{ ...first, enabled: false }], 'https://a.example.com/', new Set(['one']))).toBeNull()
    expect(selectUrlRule([first], 'https://other.com/', new Set(['one']))).toBeNull()
  })

  it('replaces a rule by id without duplicates', () => {
    expect(upsertUrlRule([first], { ...first, enabled: false })).toEqual([{ ...first, enabled: false }])
  })
})
