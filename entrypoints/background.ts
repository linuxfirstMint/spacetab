import { readDatabase } from '@/lib/storage'
import { readSessionState } from '@/lib/session-state'
import { sortedForDisplay } from '@/lib/space'
import { onTabRemovedHandler, onWindowRemovedHandler, restoreLastActiveSpaceOnStartup, switchToSpace } from '@/lib/vault'
import { appendStartupDiagnostic } from '@/lib/startup-diagnostics'

const NATURAL_STARTUP_DIAGNOSTIC_BUILD = 'natural-startup-local-diagnostic-v1'
const STARTUP_DIAGNOSTICS_KEY = 'codexNaturalStartupDiagnostics'
const LEGACY_DIAGNOSTIC_PHASES = [
  'background-entered', 'side-panel-behavior-requested', 'side-panel-behavior-rejected',
  'side-panel-behavior-sync-error', 'startup-listener-registered',
  'startup-listener-registration-sync-error', 'startup-event-received', 'startup-restored',
  'startup-skipped', 'startup-error', 'restore-started', 'skipped-current-space',
  'skipped-no-last-active-space', 'skipped-pending-database-events', 'skipped-space-not-found',
  'space-selected', 'waiting-for-normal-window', 'creating-normal-window',
  'skipped-window-create-returned-no-id', 'created-normal-window',
  'skipped-no-destination-window', 'destination-window-selected', 'switch-started', 'switch-finished',
]
let startupDiagnosticWriteTail: Promise<void> = Promise.resolve()

type StartupDiagnosticStage = {
  build: string
  phase: string
  at: string
}

function exposeStartupStage(phase: string): void {
  ;(globalThis as typeof globalThis & { __spaceTabStartupStage?: StartupDiagnosticStage }).__spaceTabStartupStage = {
    build: NATURAL_STARTUP_DIAGNOSTIC_BUILD,
    phase,
    at: new Date().toISOString(),
  }
}

// Ephemeral worker-local marker lets a read-only inspector distinguish module
// evaluation, background entry, listener registration, and startup delivery.
exposeStartupStage('module-evaluated')

function redactDiagnosticText(value: string): string {
  return value
    .replace(/(?:https?|chrome-extension):\/\/[^\s"'`<>]+/gi, '[URL]')
    .replace(/(?:[A-Za-z]:\\Users\\)[^\\\s]+/gi, '<USER_PATH>')
}

function recordStartupDiagnostic(phase: string, details?: Record<string, unknown>): Promise<void> {
  const at = new Date().toISOString()
  const write = startupDiagnosticWriteTail.then(async () => {
    try {
      const entry = {
        phase,
        at,
        build: chrome.runtime.getManifest().version,
        diagnosticBuild: NATURAL_STARTUP_DIAGNOSTIC_BUILD,
        ...(details
          ? {
              details: Object.fromEntries(
                Object.entries(details).map(([key, value]) => [
                  key,
                  typeof value === 'string' ? redactDiagnosticText(value) : value,
                ]),
              ),
            }
          : {}),
      }
      const legacyKeys = LEGACY_DIAGNOSTIC_PHASES.map(name => `codexNaturalStartupDiagnostic_${name}`)
      const stored = await chrome.storage.local.get([STARTUP_DIAGNOSTICS_KEY, 'codexNaturalStartupDiagnosticLast', ...legacyKeys])
      const prior = stored[STARTUP_DIAGNOSTICS_KEY]
      const legacy = [stored.codexNaturalStartupDiagnosticLast, ...legacyKeys.map(key => stored[key])]
      await chrome.storage.local.set({
        [STARTUP_DIAGNOSTICS_KEY]: appendStartupDiagnostic(prior, legacy, entry),
      })
      await chrome.storage.session.set({ codexNaturalStartupDiagnostic: entry }).catch(error => {
        console.error('[SpaceTab] Could not record session startup diagnostic', error)
      })
    } catch (error) {
      console.error('[SpaceTab] Could not record persistent startup diagnostic', error)
    }
  })
  startupDiagnosticWriteTail = write
  return write
}

export default defineBackground(() => {
  exposeStartupStage('background-entered')
  console.info('[SpaceTab] Background entry', NATURAL_STARTUP_DIAGNOSTIC_BUILD, new Date().toISOString())
  void recordStartupDiagnostic('background-entered')

  console.info('[SpaceTab] Requesting side panel behavior', NATURAL_STARTUP_DIAGNOSTIC_BUILD)
  try {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => {
      console.error('[SpaceTab] Side panel behavior request rejected', error)
      void recordStartupDiagnostic('side-panel-behavior-rejected', { message: String(error) })
    })
  } catch (error) {
    console.error('[SpaceTab] Side panel behavior request threw synchronously', error)
    void recordStartupDiagnostic('side-panel-behavior-sync-error', { message: String(error) })
    throw error
  }
  void recordStartupDiagnostic('side-panel-behavior-requested')

  console.info('[SpaceTab] Registering startup listener', NATURAL_STARTUP_DIAGNOSTIC_BUILD)
  exposeStartupStage('registering-startup-listener')
  try {
    chrome.runtime.onStartup.addListener(() => {
      exposeStartupStage('startup-event-received')
      console.info('[SpaceTab] Chrome startup event received; restoring last Space')
      const report = async (entry: { phase: string; at: string; details?: Record<string, unknown> }) => {
        await recordStartupDiagnostic(entry.phase, entry.details)
      }
      void (async () => {
        await report({ phase: 'startup-event-received', at: new Date().toISOString() })
        try {
          const restored = await restoreLastActiveSpaceOnStartup(report)
          exposeStartupStage(restored ? 'startup-restored' : 'startup-skipped')
          await report({ phase: restored ? 'startup-restored' : 'startup-skipped', at: new Date().toISOString() })
          console.info(`[SpaceTab] Startup restore ${restored ? 'completed' : 'skipped'}`)
        } catch (error) {
          exposeStartupStage('startup-error')
          await report({ phase: 'startup-error', at: new Date().toISOString(), details: { message: String(error) } })
          console.error('[SpaceTab] Startup restore failed', error)
        }
      })()
    })
    void recordStartupDiagnostic('startup-listener-registered')
    exposeStartupStage('startup-listener-registered')
    console.info('[SpaceTab] Startup listener registered', NATURAL_STARTUP_DIAGNOSTIC_BUILD, new Date().toISOString())
  } catch (error) {
    exposeStartupStage('startup-listener-registration-sync-error')
    console.error('[SpaceTab] Startup listener registration threw synchronously', error)
    void recordStartupDiagnostic('startup-listener-registration-sync-error', { message: String(error) })
    throw error
  }

  chrome.commands.onCommand.addListener((command) => {
    if (command !== 'next-space' && command !== 'previous-space') return
    void (async () => {
      const { db } = await readDatabase()
      const spaces = sortedForDisplay(db.spaces)
      if (!spaces.length) return
      const state = await readSessionState()
      const index = spaces.findIndex(s => s.id === state.currentSpaceId)
      const delta = command === 'next-space' ? 1 : -1
      const target = spaces[index < 0 ? 0 : (index + delta + spaces.length) % spaces.length]!
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
      if (win.id === undefined || win.id === state.vaultWindowId) return
      await switchToSpace(target.id, target.tabs, target.groups ?? [], win.id)
    })().catch(console.error)
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void onTabRemovedHandler(tabId)
  })

  chrome.windows.onRemoved.addListener((winId) => {
    void onWindowRemovedHandler(winId)
  })
})
