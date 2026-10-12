import { describe, expect, it, vi } from 'vitest'
import { splitLiveSpaceTabs, unsplitLiveSpaceTabs, type SplitApi, type SplitTab } from '@/lib/split-view'

function makeApi(tabs: SplitTab[], createSplit = vi.fn(async () => 17)): SplitApi {
  return {
    tabs: {
      getCurrent: vi.fn(async () => ({ id: 1, windowId: 8, index: 2 })),
      query: vi.fn(async () => tabs),
      createSplit,
    },
  }
}

const adjacent: [SplitTab, SplitTab] = [
  { id: 10, url: 'https://one.test', windowId: 8, index: 0, pinned: false, groupId: -1, splitViewId: -1 },
  { id: 11, url: 'https://two.test', windowId: 8, index: 1, pinned: false, groupId: -1, splitViewId: -1 },
]
const urls = ['https://one.test', 'https://two.test']

describe('splitLiveSpaceTabs', () => {
  it('uses native split view for exactly two adjacent eligible live tabs', async () => {
    const api = makeApi([...adjacent])
    await expect(splitLiveSpaceTabs(urls, api)).resolves.toEqual({ ok: true, splitViewId: 17 })
    expect(api.tabs.createSplit).toHaveBeenCalledWith([10, 11])

    const crossWindow = makeApi([{ ...adjacent[0] }, { ...adjacent[1], windowId: 9 }])
    await expect(splitLiveSpaceTabs(urls, crossWindow)).resolves.toEqual({ ok: false, reason: 'different-window' })
    expect(crossWindow.tabs.createSplit).not.toHaveBeenCalled()
  })

  it('checks feature availability and refuses non-live, non-adjacent, pinned/group mismatches and existing splits', async () => {
    const unsupported = makeApi([...adjacent])
    delete (unsupported.tabs as { createSplit?: unknown }).createSplit
    await expect(splitLiveSpaceTabs(urls, unsupported)).resolves.toEqual({ ok: false, reason: 'unsupported' })
    await expect(splitLiveSpaceTabs(['https://missing.test', 'https://two.test'], makeApi([...adjacent]))).resolves.toEqual({ ok: false, reason: 'tabs-not-live' })
    await expect(splitLiveSpaceTabs(urls, makeApi([{ ...adjacent[0]! }, { ...adjacent[1]!, index: 3 }]))).resolves.toEqual({ ok: false, reason: 'not-adjacent' })
    await expect(splitLiveSpaceTabs(urls, makeApi([{ ...adjacent[0]! }, { ...adjacent[1]!, pinned: true }]))).resolves.toEqual({ ok: false, reason: 'pinned-mismatch' })
    await expect(splitLiveSpaceTabs(urls, makeApi([{ ...adjacent[0]! }, { ...adjacent[1]!, groupId: 3 }]))).resolves.toEqual({ ok: false, reason: 'group-mismatch' })
    await expect(splitLiveSpaceTabs(urls, makeApi([{ ...adjacent[0]!, splitViewId: 4 }, { ...adjacent[1]! }]))).resolves.toEqual({ ok: false, reason: 'already-split' })
  })

  it('reports a Chrome API failure without mutating tab properties itself', async () => {
    const api = makeApi([...adjacent], vi.fn(async () => { throw new Error('unsupported') }))
    await expect(splitLiveSpaceTabs(urls, api)).resolves.toEqual({ ok: false, reason: 'api-error' })
    expect(api.tabs.query).toHaveBeenCalledWith({ windowId: 8 })
  })

  it('unsplits the selected pair only when both belong to the same native Split View', async () => {
    const api = makeApi([{ ...adjacent[0], splitViewId: 9 }, { ...adjacent[1], splitViewId: 9 }])
    api.tabs.unsplit = vi.fn(async () => undefined)
    await expect(unsplitLiveSpaceTabs(urls, api)).resolves.toEqual({ ok: true, splitViewId: 9 })
    expect(api.tabs.unsplit).toHaveBeenCalledWith(9)

    const mismatch = makeApi([{ ...adjacent[0], splitViewId: 9 }, { ...adjacent[1], splitViewId: 10 }])
    mismatch.tabs.unsplit = vi.fn(async () => undefined)
    await expect(unsplitLiveSpaceTabs(urls, mismatch)).resolves.toEqual({ ok: false, reason: 'not-split-together' })
    expect(mismatch.tabs.unsplit).not.toHaveBeenCalled()

    const unsupported = makeApi([...adjacent])
    delete (unsupported.tabs as { unsplit?: unknown }).unsplit
    await expect(unsplitLiveSpaceTabs(urls, unsupported)).resolves.toEqual({ ok: false, reason: 'unsupported' })
  })
})
