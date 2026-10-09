import { useEffect, useState } from 'react'
import { useSpaceStore } from '@/stores/space-store'
import { sortedForDisplay } from '@/lib/space'
import { archiveCurrentWindowToSpace, switchToSpace } from '@/lib/vault'
import { readSessionState } from '@/lib/session-state'
import { useTheme } from '@/lib/theme'

export default function App() {
  useTheme()
  const { db, loaded, load, archiveNew, archive } = useSpaceStore()
  const [current, setCurrent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  useEffect(() => {
    const refresh = async () => {
      await load()
      setCurrent((await readSessionState()).currentSpaceId ?? null)
    }
    const changed = () => { void refresh() }
    void refresh()
    chrome.storage.onChanged.addListener(changed)
    return () => chrome.storage.onChanged.removeListener(changed)
  }, [load])

  const perform = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      setCurrent((await readSessionState()).currentSpaceId ?? null)
    } catch {
      setError('操作を完了できませんでした。タブと保存状態を確認してください。')
    } finally {
      setBusy(false)
    }
  }
  return <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4">
    <header className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold">SpaceTab</h1>
      <button className="text-sm underline" onClick={() => { void chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') }) }}>管理</button>
    </header>
    <p className="text-xs text-slate-500 mb-3">SPACES</p>
    <nav aria-label="Space一覧" className="space-y-2">
      {sortedForDisplay(db.spaces).map(space => <button key={space.id} disabled={busy} aria-current={current === space.id ? 'page' : undefined}
        className={`w-full text-left rounded-xl px-4 py-3 disabled:opacity-50 ${current === space.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 hover:bg-indigo-100 dark:hover:bg-slate-800'}`}
        onClick={() => { void perform(async () => {
          const result = await switchToSpace(space.id, space.tabs, space.groups ?? [])
          if (result.failed.length) throw new Error('Some tabs failed to open')
        }) }}>
        <span className="block font-medium truncate">{space.emoji ?? '◉'} {space.name}</span>
        <span className="block text-xs opacity-70 mt-1">{current === space.id ? '現在のSpace · ' : ''}{space.tabs.length} タブ</span>
      </button>)}
    </nav>
    {loaded && !db.spaces.length && <p className="text-sm my-4 text-slate-500">今のタブを保存して、最初のSpaceを作ろう。</p>}
    <form className="mt-6 space-y-2" onSubmit={event => {
      event.preventDefault()
      if (!name.trim()) return
      void perform(async () => {
        const id = await archiveNew(name.trim(), [])
        if (!id) throw new Error('Cannot create Space')
        const snapshot = await archiveCurrentWindowToSpace(id)
        if (!await archive(id, snapshot.archived, snapshot.groups)) throw new Error('Cannot save tabs')
        setName('')
      })
    }}>
      <label htmlFor="space-name" className="text-sm block">今のタブを新しいSpaceへ保存</label>
      <input id="space-name" required disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder="仕事、個人、プロジェクト…"
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" />
      <button disabled={busy || !name.trim()} className="w-full rounded-lg bg-indigo-600 text-white py-2 disabled:opacity-50">{busy ? '処理中…' : '保存'}</button>
    </form>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
  </main>
}
