import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n'
import { filterCommands, groupCommands, type Command, type CommandGroup } from '@/lib/commands'
import { Search } from './icons'

interface Props {
  commands: Command[]
  open: boolean
  onClose: () => void
}

export function CommandPalette({ commands, open, onClose }: Props) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 打开时清空 query 并聚焦
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // 延迟一帧让 DOM 准备好
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query])
  const groups = useMemo(() => groupCommands(filtered), [filtered])

  // 扁平索引(用于上下导航 - groups 跨段也能连续选择)
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // query 变化时把选中重置到第一个
  useEffect(() => {
    setSelected(0)
  }, [query])

  // 选中越界时纠偏
  useEffect(() => {
    if (selected >= flatItems.length) setSelected(Math.max(flatItems.length - 1, 0))
  }, [flatItems.length, selected])

  // 键盘
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, flatItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = flatItems[selected]
        if (cmd) {
          cmd.perform()
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, flatItems, selected, onClose])

  // 选中变化时,把选中行滚到视口
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const groupLabel = (g: CommandGroup): string =>
    g === 'action' ? t('commandGroupAction') : t('commandGroupSpace')

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette')}
        className="w-full max-w-[600px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('commandPalettePlaceholder')}
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
          />
        </div>

        <div ref={listRef} className="max-h-[400px] overflow-y-auto py-1">
          {flatItems.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
              {t('cmdNoResults')}
            </div>
          ) : (
            (() => {
              let runningIndex = 0
              return groups.map((g) => (
                <div key={g.group}>
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {groupLabel(g.group)}
                  </div>
                  {g.items.map((cmd) => {
                    const idx = runningIndex++
                    const isSelected = idx === selected
                    return (
                      <button
                        key={cmd.id}
                        data-cmd-index={idx}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => {
                          cmd.perform()
                          onClose()
                        }}
                        className={`w-full text-left flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        {cmd.accent && (
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: cmd.accent }}
                          />
                        )}
                        <span className="flex-1 truncate">{cmd.label}</span>
                        {cmd.description && (
                          <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                            {cmd.description}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            })()
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500 font-mono">
          {t('cmdHintFooter')}
        </div>
      </div>
    </div>,
    document.body,
  )
}
