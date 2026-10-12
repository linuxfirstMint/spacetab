import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n'
import { X, Sparkle } from './icons'

interface Props {
  onClose: () => void
  /** 首次启动场景:头部加一个"欢迎"角标 */
  isWelcome?: boolean
}

export function HelpDialog({ onClose, isWelcome = false }: Props) {
  const { t } = useT()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] max-h-[85vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Sparkle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="help-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('helpTitle')}</h2>
              {isWelcome && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-md bg-violet-100 text-violet-700">
                  {t('welcomeBadge')}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">SpaceTab</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label={t('cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          <p>{t('helpIntro')}</p>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t('helpQuickStartHeading')}
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>{t('helpQuickStart1')}</li>
              <li>{t('helpQuickStart2')}</li>
              <li>{t('helpQuickStart3')}</li>
              <li>{t('helpQuickStart4')}</li>
              <li>{t('helpQuickStart5')}</li>
            </ol>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t('helpConceptsHeading')}
            </h3>
            <dl className="space-y-2.5">
              <div>
                <dt className="font-medium text-slate-900 dark:text-slate-100">{t('helpConceptSpaceTerm')}</dt>
                <dd className="text-slate-600 dark:text-slate-300 mt-0.5">{t('helpConceptSpaceDesc')}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900 dark:text-slate-100">{t('helpConceptVaultTerm')}</dt>
                <dd className="text-slate-600 dark:text-slate-300 mt-0.5">{t('helpConceptVaultDesc')}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900 dark:text-slate-100">{t('helpConceptCurrentTerm')}</dt>
                <dd className="text-slate-600 dark:text-slate-300 mt-0.5">{t('helpConceptCurrentDesc')}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t('helpDndHeading')}
            </h3>
            <ul className="space-y-2">
              <li className="flex items-start gap-2.5">
                <span className="w-3 h-3 rounded-full bg-violet-400 ring-2 ring-violet-200 mt-0.5 shrink-0" />
                <span>{t('helpDndViolet')}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-3 h-3 rounded-full bg-indigo-400 ring-2 ring-indigo-200 mt-0.5 shrink-0" />
                <span>{t('helpDndIndigo')}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-emerald-200 mt-0.5 shrink-0" />
                <span>{t('helpDndEmerald')}</span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t('helpTipsHeading')}
            </h3>
            <ul className="space-y-1.5 list-disc pl-5 text-slate-600 dark:text-slate-300">
              {([
                'helpTipPalette',
                'helpTipMultiSelect',
                'helpTipReorder',
                'helpTipDiscard',
                'helpTipUndo',
                'helpTipNewtab',
                'helpTipGroups',
              ] as const).map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t('helpPrivacyHeading')}
            </h3>
            <p className="text-slate-600 dark:text-slate-300">{t('helpPrivacy')}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              {t('helpFaqHeading')}
            </h3>
            <div className="space-y-3">
              {(
                [
                  ['helpFaqBlankSwitchQ', 'helpFaqBlankSwitchA'],
                  ['helpFaqDeleteQ', 'helpFaqDeleteA'],
                  ['helpFaqChromeUrlQ', 'helpFaqChromeUrlA'],
                  ['helpFaqSyncQ', 'helpFaqSyncA'],
                  ['helpFaqSameNameQ', 'helpFaqSameNameA'],
                  ['helpFaqVaultDockQ', 'helpFaqVaultDockA'],
                ] as const
              ).map(([qKey, aKey]) => (
                <div key={qKey}>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{t(qKey)}</p>
                  <p className="text-slate-600 dark:text-slate-300 mt-0.5">{t(aKey)}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end bg-slate-50 dark:bg-slate-800/40">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            {t('confirm')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
