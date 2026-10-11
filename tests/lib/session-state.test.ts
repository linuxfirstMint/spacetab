import { describe, it, expect } from 'vitest'
import {
  untagTabIdInState,
  tagTabIdsForSpace,
  dropSpaceFromState,
  EMPTY_SESSION,
  activeSpaceForWindow,
  setActiveSpaceForWindow,
  removeWindowFromState,
  type SessionState,
} from '@/lib/session-state'

// ---------------------------------------------------------------------------
// untagTabIdInState
// ---------------------------------------------------------------------------
describe('untagTabIdInState', () => {
  it('removes the tabId from the matching space list', () => {
    const state: SessionState = {
      vaultWindowId: 1,
      spaceIdToTabIds: { spaceA: [10, 20, 30] },
    }
    const next = untagTabIdInState(state, 20)
    expect(next.spaceIdToTabIds).toEqual({ spaceA: [10, 30] })
  })

  it('removes the entry entirely when the list becomes empty', () => {
    const state: SessionState = {
      vaultWindowId: 1,
      spaceIdToTabIds: { spaceA: [10] },
    }
    const next = untagTabIdInState(state, 10)
    expect(next.spaceIdToTabIds).toEqual({})
  })

  it('removes the tabId from multiple spaces when it appears in more than one', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [10, 20], spaceB: [20, 30] },
    }
    const next = untagTabIdInState(state, 20)
    expect(next.spaceIdToTabIds).toEqual({ spaceA: [10], spaceB: [30] })
  })

  it('returns the same reference when the tabId is not present anywhere', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [10, 20] },
    }
    const next = untagTabIdInState(state, 99)
    expect(next).toBe(state)
  })

  it('preserves vaultWindowId through the transformation', () => {
    const state: SessionState = {
      vaultWindowId: 42,
      spaceIdToTabIds: { spaceA: [5] },
    }
    const next = untagTabIdInState(state, 5)
    expect(next.vaultWindowId).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// tagTabIdsForSpace
// ---------------------------------------------------------------------------
describe('tagTabIdsForSpace', () => {
  it('appends new ids to an empty space entry', () => {
    const next = tagTabIdsForSpace(EMPTY_SESSION, 'spaceA', [1, 2, 3])
    expect(next.spaceIdToTabIds).toEqual({ spaceA: [1, 2, 3] })
  })

  it('appends ids after existing ones (no duplicates)', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [1, 2] },
    }
    const next = tagTabIdsForSpace(state, 'spaceA', [3, 4])
    expect(next.spaceIdToTabIds['spaceA']).toEqual([1, 2, 3, 4])
  })

  it('deduplicates ids that are already present in the space', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [1, 2, 3] },
    }
    const next = tagTabIdsForSpace(state, 'spaceA', [2, 4])
    // existing 2 is replaced by position, 4 is new
    expect(next.spaceIdToTabIds['spaceA']).toEqual([1, 3, 2, 4])
  })

  it('creates a new entry for a space that did not exist before', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [1] },
    }
    const next = tagTabIdsForSpace(state, 'spaceB', [9])
    expect(next.spaceIdToTabIds['spaceA']).toEqual([1])
    expect(next.spaceIdToTabIds['spaceB']).toEqual([9])
  })

  it('returns the same reference when ids array is empty', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [1] },
    }
    const next = tagTabIdsForSpace(state, 'spaceA', [])
    expect(next).toBe(state)
  })
})

// ---------------------------------------------------------------------------
// dropSpaceFromState
// ---------------------------------------------------------------------------
describe('dropSpaceFromState', () => {
  it('removes the spaceId entry from the map', () => {
    const state: SessionState = {
      vaultWindowId: 1,
      spaceIdToTabIds: { spaceA: [10], spaceB: [20] },
    }
    const next = dropSpaceFromState(state, 'spaceA')
    expect(next.spaceIdToTabIds).toEqual({ spaceB: [20] })
  })

  it('returns the same reference when the spaceId does not exist', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: { spaceA: [10] },
    }
    const next = dropSpaceFromState(state, 'nonexistent')
    expect(next).toBe(state)
  })

  it('preserves vaultWindowId through the transformation', () => {
    const state: SessionState = {
      vaultWindowId: 7,
      spaceIdToTabIds: { spaceA: [1] },
    }
    const next = dropSpaceFromState(state, 'spaceA')
    expect(next.vaultWindowId).toBe(7)
    expect(next.spaceIdToTabIds).toEqual({})
  })

  it('removes the active-window assignment even when the space has no live tabs', () => {
    const state: SessionState = {
      vaultWindowId: null,
      spaceIdToTabIds: {},
      windowIdToSpaceId: { '7': 'spaceA', '8': 'spaceB' },
      currentSpaceId: 'spaceB',
    }
    expect(dropSpaceFromState(state, 'spaceA').windowIdToSpaceId).toEqual({ '8': 'spaceB' })
  })
})

describe('active Space per window', () => {
  it('tracks separate active Spaces without overwriting the other window', () => {
    const first = setActiveSpaceForWindow(EMPTY_SESSION, 7, 'spaceA')
    const next = setActiveSpaceForWindow(first, 8, 'spaceB')
    expect(activeSpaceForWindow(next, 7)).toBe('spaceA')
    expect(activeSpaceForWindow(next, 8)).toBe('spaceB')
    expect(next.currentSpaceId).toBe('spaceB')
  })

  it('removes a closed window mapping without changing another window', () => {
    const state = setActiveSpaceForWindow(
      setActiveSpaceForWindow(EMPTY_SESSION, 7, 'spaceA'),
      8,
      'spaceB',
    )
    const next = removeWindowFromState(state, 7)
    expect(next.windowIdToSpaceId).toEqual({ '8': 'spaceB' })
    expect(activeSpaceForWindow(next, 8)).toBe('spaceB')
    expect(next.currentSpaceId).toBe('spaceB')
  })
})
