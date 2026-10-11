import { describe, it, expect } from 'vitest'
import { colorForSpace, relativeTime } from '@/lib/ui-utils'

const VALID_HEXES = [
  '#6366F1',
  '#10B981',
  '#F59E0B',
  '#EC4899',
  '#8B5CF6',
  '#06B6D4',
]

const VALID_KEYS = ['indigo', 'emerald', 'amber', 'pink', 'violet', 'cyan']

// t スタブ: キーとパラメータをそのまま文字列化して返す
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key

describe('colorForSpace', () => {
  it('returns a palette whose hex is one of the 6 predefined values', () => {
    const ids = ['abc', 'xyz', '123', 'space-1', 'space-2', 'hello', 'world']
    for (const id of ids) {
      expect(VALID_HEXES).toContain(colorForSpace(id).hex)
    }
  })

  it('returns a palette whose key is one of the 6 predefined keys', () => {
    const ids = ['abc', 'xyz', '123', 'space-1', 'space-2', 'hello', 'world']
    for (const id of ids) {
      expect(VALID_KEYS).toContain(colorForSpace(id).key)
    }
  })

  it('is deterministic: same id always returns same key', () => {
    const id = 'my-space-id'
    const first = colorForSpace(id)
    for (let i = 0; i < 10; i++) {
      expect(colorForSpace(id).key).toBe(first.key)
    }
  })

  it('handles empty string', () => {
    const result = colorForSpace('')
    expect(VALID_HEXES).toContain(result.hex)
    expect(VALID_KEYS).toContain(result.key)
  })

  it('different ids produce at least 3 distinct keys across 20 samples', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `space-${i}`)
    const keys = new Set(ids.map((id) => colorForSpace(id).key))
    expect(keys.size).toBeGreaterThanOrEqual(3)
  })

  it('palette has required Tailwind class fields', () => {
    const palette = colorForSpace('test-space')
    expect(palette.bar).toMatch(/^bg-/)
    expect(palette.dot).toMatch(/^bg-/)
    expect(palette.countBg).toMatch(/^bg-/)
    expect(palette.countText).toMatch(/^text-/)
    expect(palette.countRing).toMatch(/^ring-/)
    expect(palette.switchBg).toMatch(/^bg-/)
    expect(palette.switchRing).toMatch(/^focus-visible:ring-/)
    expect(palette.rowAccent).toMatch(/^group-hover\/row:border-/)
  })
})

describe('relativeTime', () => {
  const NOW = 1_700_000_000_000 // fixed reference point

  it('returns timeJustNow for diff < 1 min', () => {
    expect(relativeTime(NOW - 30_000, t, NOW)).toBe('timeJustNow')
    expect(relativeTime(NOW - 59_999, t, NOW)).toBe('timeJustNow')
    expect(relativeTime(NOW, t, NOW)).toBe('timeJustNow')
  })

  it('returns timeMinutesAgo for 1–59 min', () => {
    expect(relativeTime(NOW - 60_000, t, NOW)).toBe('timeMinutesAgo:{"n":1}')
    expect(relativeTime(NOW - 5 * 60_000, t, NOW)).toBe('timeMinutesAgo:{"n":5}')
    expect(relativeTime(NOW - 59 * 60_000, t, NOW)).toBe('timeMinutesAgo:{"n":59}')
  })

  it('returns timeHoursAgo for 1–23 hours', () => {
    expect(relativeTime(NOW - 3_600_000, t, NOW)).toBe('timeHoursAgo:{"n":1}')
    expect(relativeTime(NOW - 3 * 3_600_000, t, NOW)).toBe('timeHoursAgo:{"n":3}')
    expect(relativeTime(NOW - 23 * 3_600_000, t, NOW)).toBe('timeHoursAgo:{"n":23}')
  })

  it('returns timeYesterday for exactly 1 day', () => {
    expect(relativeTime(NOW - 86_400_000, t, NOW)).toBe('timeYesterday')
    expect(relativeTime(NOW - 1.5 * 86_400_000, t, NOW)).toBe('timeYesterday')
  })

  it('returns timeDaysAgo for 2–6 days', () => {
    expect(relativeTime(NOW - 2 * 86_400_000, t, NOW)).toBe('timeDaysAgo:{"n":2}')
    expect(relativeTime(NOW - 6 * 86_400_000, t, NOW)).toBe('timeDaysAgo:{"n":6}')
  })

  it('returns timeWeeksAgo for 7–29 days', () => {
    expect(relativeTime(NOW - 7 * 86_400_000, t, NOW)).toBe('timeWeeksAgo:{"n":1}')
    expect(relativeTime(NOW - 14 * 86_400_000, t, NOW)).toBe('timeWeeksAgo:{"n":2}')
    expect(relativeTime(NOW - 29 * 86_400_000, t, NOW)).toBe('timeWeeksAgo:{"n":4}')
  })

  it('returns timeMonthsAgo for 30–364 days', () => {
    expect(relativeTime(NOW - 30 * 86_400_000, t, NOW)).toBe('timeMonthsAgo:{"n":1}')
    expect(relativeTime(NOW - 90 * 86_400_000, t, NOW)).toBe('timeMonthsAgo:{"n":3}')
    expect(relativeTime(NOW - 364 * 86_400_000, t, NOW)).toBe('timeMonthsAgo:{"n":12}')
  })

  it('returns timeYearsAgo for 365+ days', () => {
    expect(relativeTime(NOW - 365 * 86_400_000, t, NOW)).toBe('timeYearsAgo:{"n":1}')
    expect(relativeTime(NOW - 730 * 86_400_000, t, NOW)).toBe('timeYearsAgo:{"n":2}')
  })

  it('handles future timestamps (diff = 0)', () => {
    expect(relativeTime(NOW + 60_000, t, NOW)).toBe('timeJustNow')
  })
})
