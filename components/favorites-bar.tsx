import { useState } from 'react'
import type { Favorite, Tab } from '@/lib/schema'
import { MAX_FAVORITES } from '@/lib/favorites'
import { useT } from '@/lib/i18n'
import { Pencil, Plus, StarFilled, Trash } from './icons'

interface Props {
  favorites: Favorite[]
  onOpen: (url: string) => void
  onAdd: (tab: Pick<Tab, 'url' | 'title'>) => void
  onRemove: (url: string) => void
  onEdit: (url: string, favorite: Favorite) => void
  onReorder: (urls: string[]) => void
}

export function FavoritesBar({ favorites, onOpen, onAdd, onRemove, onEdit, onReorder }: Props) {
  const { t } = useT()
  const [url, setUrl] = useState('')
  const [editingUrl, setEditingUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState({ title: '', url: '' })
  const [draggedUrl, setDraggedUrl] = useState<string | null>(null)

  const add = () => {
    try {
      const parsed = new URL(url.trim())
      if (!['http:', 'https:'].includes(parsed.protocol)) return
      onAdd({ url: parsed.href, title: parsed.hostname })
      setUrl('')
    } catch {
      // Invalid URL stays in the field so it can be corrected.
    }
  }

  const saveEdit = (favorite: Favorite) => {
    try {
      const parsed = new URL(draft.url.trim())
      if (!['http:', 'https:'].includes(parsed.protocol) || !draft.title.trim()) return
      onEdit(favorite.url, { ...favorite, url: parsed.href, title: draft.title.trim() })
      setEditingUrl(null)
    } catch {
      // Keep the editor open on invalid input.
    }
  }

  return (
    <section aria-label={t('favorites')} className="mb-6 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
          <StarFilled className="w-3.5 h-3.5" /> {t('favorites')}
        </h2>
        <span className="text-[10px] font-mono text-slate-400">{favorites.length}/{MAX_FAVORITES}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {favorites.map((favorite) => (
          <div
            key={favorite.url}
            draggable={editingUrl !== favorite.url}
            onDragStart={() => setDraggedUrl(favorite.url)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (!draggedUrl || draggedUrl === favorite.url) return
              const ordered = [...favorites]
              const from = ordered.findIndex((item) => item.url === draggedUrl)
              const to = ordered.findIndex((item) => item.url === favorite.url)
              if (from < 0 || to < 0) return
              const [moving] = ordered.splice(from, 1)
              if (moving) ordered.splice(to, 0, moving)
              onReorder(ordered.map((item) => item.url))
              setDraggedUrl(null)
            }}
            className="group flex max-w-full items-center gap-1 rounded-lg border border-white/80 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-2 py-1"
          >
            {editingUrl === favorite.url ? (
              <div className="flex min-w-0 items-center gap-1">
                <input aria-label={t('favoriteTitle')} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-24 rounded border px-1 py-0.5 text-xs dark:bg-slate-800 dark:border-slate-600" />
                <input aria-label={t('favoriteUrl')} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} className="w-40 rounded border px-1 py-0.5 text-xs dark:bg-slate-800 dark:border-slate-600" />
                <button onClick={() => saveEdit(favorite)} className="text-xs text-indigo-600">{t('favoriteSave')}</button>
                <button onClick={() => setEditingUrl(null)} className="text-xs text-slate-500">{t('cancel')}</button>
              </div>
            ) : (
              <>
                <button onClick={() => onOpen(favorite.url)} title={favorite.url} className="max-w-44 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{favorite.title || favorite.url}</button>
                <button aria-label={t('editFavorite')} title={t('editFavorite')} onClick={() => { setDraft({ title: favorite.title, url: favorite.url }); setEditingUrl(favorite.url) }} className="p-1 text-slate-400 hover:text-indigo-600"><Pencil className="h-3 w-3" /></button>
                <button aria-label={t('removeFavorite')} title={t('removeFavorite')} onClick={() => onRemove(favorite.url)} className="p-1 text-slate-400 hover:text-red-600"><Trash className="h-3 w-3" /></button>
              </>
            )}
          </div>
        ))}
        {favorites.length === 0 && <span className="py-1 text-xs text-slate-500 dark:text-slate-400">{t('favoritesEmpty')}</span>}
      </div>
      <form className="mt-2 flex max-w-lg gap-2" onSubmit={(event) => { event.preventDefault(); add() }}>
        <input aria-label={t('favoriteUrl')} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" disabled={favorites.length >= MAX_FAVORITES} className="min-w-0 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs outline-none focus:border-amber-400 disabled:opacity-50" />
        <button type="submit" disabled={!url.trim() || favorites.length >= MAX_FAVORITES} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"><Plus className="h-3 w-3" />{t('addFavorite')}</button>
      </form>
    </section>
  )
}
