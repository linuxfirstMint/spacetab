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
    expect(titles[titles.length - 1]).toBe('other')
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

  it('多组+其他组同时存在时不降级', () => {
    const r = groupTabsForRender(
      makeSpace({
        tabs: [
          t('https://github.com/a'),
          t('https://github.com/b'),
          t('https://lonely.example.com/z'),
        ],
      }),
    )
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
    expect(r.groups.map((g) => g.kind)).toEqual(['domain', 'domain'])
  })
})
