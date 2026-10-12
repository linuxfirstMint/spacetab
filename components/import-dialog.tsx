import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n'
import type { ImportSummary } from '@/lib/export-import'
import { X } from './icons'

interface Props {
  summary: ImportSummary
  onCancel: () => void
  onConfirm: (mode: 'merge' | 'replace') => void
}

export function ImportDialog({ summary, onCancel, onConfirm }: Props) {
  const { t } = useT()
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[480px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <h2 id="import-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('importDialogTitle')}</h2>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={t('cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {t('importSummary', {
              n: summary.incomingSpaces,
              newN: summary.newSpaces,
              updatedN: summary.updatedSpaces,
              unchangedN: summary.unchangedSpaces,
            })}
          </p>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t('importMode')}
            </h3>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'merge'
                    ? 'border-slate-900 bg-slate-50 dark:bg-slate-800'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('importMerge')}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('importMergeDesc')}</div>
                </div>
              </label>
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'replace'
                    ? 'border-red-400 bg-red-50/50'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('importReplace')}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('importReplaceDesc')}</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <footer className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800/40">
          <button
            onClick={onCancel}
            className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => onConfirm(mode)}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
              mode === 'replace'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {t('confirm')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
