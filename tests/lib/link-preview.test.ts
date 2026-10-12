import { describe, expect, it } from 'vitest'
import { choosePreviewDestination, parsePreviewUrl, readLinkPreviewSession } from '@/lib/link-preview'

describe('parsePreviewUrl', () => {
  it.each([
    ['https://example.com/path?q=1#part', 'https://example.com/path?q=1#part'],
    ['http://localhost:3000/test', 'http://localhost:3000/test'],
  ])('accepts %s', (input, expected) => {
    expect(parsePreviewUrl(input)).toBe(expected)
  })

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/page', 'mailto:a@example.com', 'not a url', undefined])(
    'rejects %s', input => expect(parsePreviewUrl(input)).toBeNull(),
  )
})

describe('readLinkPreviewSession', () => {
  it('accepts only integer window identities', () => {
    expect(readLinkPreviewSession({ windowId: 7, sourceWindowId: 3 })).toEqual({ windowId: 7, sourceWindowId: 3 })
    expect(readLinkPreviewSession({ windowId: '7', sourceWindowId: 3 })).toBeNull()
    expect(readLinkPreviewSession(null)).toBeNull()
  })
})

describe('choosePreviewDestination', () => {
  it('prefers the original normal window', () => {
    expect(choosePreviewDestination({ id: 3, type: 'normal' }, { id: 4, type: 'normal' }, 8))
      .toEqual({ kind: 'existing-window', windowId: 3 })
  })

  it('falls back to another focused normal window when the source is unavailable', () => {
    expect(choosePreviewDestination(undefined, { id: 4, type: 'normal' }, 8))
      .toEqual({ kind: 'existing-window', windowId: 4 })
  })

  it('requests a new normal window when no normal window is available', () => {
    expect(choosePreviewDestination(undefined, undefined, 8)).toEqual({ kind: 'new-window' })
    expect(choosePreviewDestination({ id: 8, type: 'popup' }, { id: 8, type: 'popup' }, 8))
      .toEqual({ kind: 'new-window' })
  })
})
