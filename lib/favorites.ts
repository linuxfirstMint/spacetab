import type { Favorite, Tab } from './schema'

export const MAX_FAVORITES = 12

export function addFavorite(favorites: Favorite[], tab: Pick<Tab, 'url' | 'title' | 'favIconUrl'>): Favorite[] {
  if (favorites.some((favorite) => favorite.url === tab.url) || favorites.length >= MAX_FAVORITES) return favorites
  return [...favorites, {
    url: tab.url,
    title: tab.title,
    ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
  }]
}

export function removeFavorite(favorites: Favorite[], url: string): Favorite[] {
  return favorites.filter((favorite) => favorite.url !== url)
}

export function updateFavorite(favorites: Favorite[], url: string, next: Favorite): Favorite[] {
  return favorites.map((favorite) => favorite.url === url ? next : favorite)
}

export function reorderFavorites(favorites: Favorite[], orderedUrls: string[]): Favorite[] {
  const byUrl = new Map(favorites.map((favorite) => [favorite.url, favorite]))
  const ordered = orderedUrls.flatMap((url) => {
    const favorite = byUrl.get(url)
    return favorite ? [favorite] : []
  })
  const included = new Set(ordered.map((favorite) => favorite.url))
  return [...ordered, ...favorites.filter((favorite) => !included.has(favorite.url))]
}

/** Merge imported favorites by saved URL; current-profile entries keep their metadata and order. */
export function mergeFavorites(current: Favorite[], incoming: Favorite[]): Favorite[] {
  const result = [...current]
  const urls = new Set(current.map((favorite) => favorite.url))
  for (const favorite of incoming) {
    if (urls.has(favorite.url) || result.length >= MAX_FAVORITES) continue
    urls.add(favorite.url)
    result.push(favorite)
  }
  return result
}

export function normalizeFavorites(favorites: Favorite[]): Favorite[] {
  const seen = new Set<string>()
  return favorites.filter((favorite) => {
    if (seen.has(favorite.url) || seen.size >= MAX_FAVORITES) return false
    seen.add(favorite.url)
    return true
  })
}
