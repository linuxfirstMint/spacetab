import { describe, expect, it } from 'vitest'
import { addFavorite, mergeFavorites, normalizeFavorites, reorderFavorites, removeFavorite, updateFavorite, MAX_FAVORITES } from '@/lib/favorites'
import type { Favorite } from '@/lib/schema'

const make = (n: number): Favorite => ({ url: `https://site${n}.example/`, title: `Site ${n}` })

describe('profile favorites', () => {
  it('adds once by saved URL and enforces the 12-item limit', () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, index) => make(index))
    expect(addFavorite(full, make(0))).toBe(full)
    expect(addFavorite(full, make(12))).toBe(full)
    expect(addFavorite([], make(0))).toEqual([make(0)])
  })

  it('removes, edits, and reorders without dropping entries', () => {
    const initial = [make(1), make(2), make(3)]
    expect(removeFavorite(initial, make(2).url)).toEqual([make(1), make(3)])
    expect(updateFavorite(initial, make(2).url, { url: 'https://edited.example/', title: 'Edited' })[1]?.title).toBe('Edited')
    expect(reorderFavorites(initial, [make(3).url, make(1).url])).toEqual([make(3), make(1), make(2)])
  })

  it('merges imports by URL, preserves local entries, and normalizes duplicates', () => {
    expect(mergeFavorites([make(1)], [{ ...make(1), title: 'Imported' }, make(2)])).toEqual([make(1), make(2)])
    expect(normalizeFavorites([make(1), { ...make(1), title: 'duplicate' }])).toEqual([make(1)])
  })
})
