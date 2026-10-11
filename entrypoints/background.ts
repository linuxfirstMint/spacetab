import { readDatabase, writeDatabase } from '@/lib/storage'
import { readSessionState } from '@/lib/session-state'
import { sortedForDisplay, updateTabCurrentUrl } from '@/lib/space'
import { onTabRemovedHandler, onWindowRemovedHandler, readActiveSpaceForWindow, restoreLastActiveSpaceOnStartup, switchToSpace } from '@/lib/vault'
import { appendStartupDiagnostic } from '@/lib/startup-diagnostics'
import { readLastActiveTab, writeLastActiveTab } from '@/lib/last-active-tab'

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
  // Chrome may activate another tab while it is removing tabs from a window
  // that is closing. Those transient activations must not replace the user's
  // last deliberate selection.
  const closingWindowIds = new Set<number>()
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
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
      if (win.id === undefined) return
      const state = await readSessionState()
      if (win.id === state.vaultWindowId) return
      const currentSpaceId = await readActiveSpaceForWindow(win.id)
      const index = spaces.findIndex(s => s.id === currentSpaceId)
      const delta = command === 'next-space' ? 1 : -1
      const target = spaces[index < 0 ? 0 : (index + delta + spaces.length) % spaces.length]!
      await switchToSpace(target.id, target.tabs, target.groups ?? [], win.id)
    })().catch(console.error)
  })

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) closingWindowIds.add(removeInfo.windowId)
    void onTabRemovedHandler(tabId, removeInfo.isWindowClosing)
  })

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (closingWindowIds.has(windowId)) return
    // Queue behind a Space switch, then verify this event still describes the
    // active tab. That drops stale activation events from rapid tab changes.
    void navigator.locks.request('spacetab-switch', async () => {
      try {
        const [state, tab] = await Promise.all([
          readSessionState(),
          chrome.tabs.get(tabId),
        ])
        const spaceId = await readActiveSpaceForWindow(windowId)
        if (!spaceId || tab.windowId !== windowId || tab.active !== true) return
        if (state.vaultWindowId === windowId) return
        if (!(state.spaceIdToTabIds[spaceId] ?? []).includes(tabId)) return
        const url = tab.url || tab.pendingUrl
        if (!url || url.startsWith('chrome-extension://')) return
        const spaceTabIds = new Set(state.spaceIdToTabIds[spaceId] ?? [])
        const matchingTabs = (await chrome.tabs.query({ windowId }))
          .filter(candidate => typeof candidate.id === 'number'
            && spaceTabIds.has(candidate.id)
            && (candidate.url || candidate.pendingUrl) === url)
        const urlOccurrence = matchingTabs.findIndex(candidate => candidate.id === tabId)
        await writeLastActiveTab(spaceId, { tabId, url, urlOccurrence: Math.max(0, urlOccurrence) })
      } catch {
        // Tabs can close while an activation event is being processed.
      }
    })
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url
    if (!url || !tab.active || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return
    void navigator.locks.request('spacetab-switch', async () => {
      try {
        const state = await readSessionState()
        const spaceId = await readActiveSpaceForWindow(tab.windowId)
        const selection = spaceId ? await readLastActiveTab(spaceId) : null
        if (!spaceId || selection?.tabId !== tabId || state.vaultWindowId === tab.windowId) return
        const { db } = await readDatabase()
        const savedTab = db.spaces.find(space => space.id === spaceId)?.tabs.find(item => item.url === selection.url || item.currentUrl === selection.url)
        if (!savedTab?.pinned) return
        const next = updateTabCurrentUrl(db, spaceId, savedTab.url, url)
        if (next !== db) await writeDatabase(next)
        const sameUrlTabs = (await chrome.tabs.query({ windowId: tab.windowId })).filter(candidate =>
          typeof candidate.id === 'number' && (state.spaceIdToTabIds[spaceId] ?? []).includes(candidate.id)
          && (candidate.url || candidate.pendingUrl) === url,
        )
        const urlOccurrence = sameUrlTabs.findIndex(candidate => candidate.id === tabId)
        await writeLastActiveTab(spaceId, { tabId, url, urlOccurrence: Math.max(0, urlOccurrence) })
      } catch {
        // The tab can navigate or close while its Space metadata is updated.
      }
    })
  })

  chrome.tabs.onMoved.addListener((tabId, { windowId }) => {
    void navigator.locks.request('spacetab-switch', async () => {
      try {
        const state = await readSessionState()
        const spaceId = await readActiveSpaceForWindow(windowId)
        if (!spaceId || state.vaultWindowId === windowId) return
        const previous = await readLastActiveTab(spaceId)
        const ids = new Set(state.spaceIdToTabIds[spaceId] ?? [])
        if (!previous || !ids.has(tabId) || !ids.has(previous.tabId)) return
        const [movedTab, selectedTab] = await Promise.all([
          chrome.tabs.get(tabId),
          chrome.tabs.get(previous.tabId),
        ])
        const movedUrl = movedTab.url || movedTab.pendingUrl
        const url = selectedTab.url || selectedTab.pendingUrl
        if (!movedUrl || movedUrl !== previous.url || !url || url !== previous.url) return
        if (movedTab.windowId !== windowId || selectedTab.windowId !== windowId) return
        const matchingTabs = (await chrome.tabs.query({ windowId }))
          .filter(candidate => typeof candidate.id === 'number'
            && ids.has(candidate.id)
            && (candidate.url || candidate.pendingUrl) === url)
        const urlOccurrence = matchingTabs.findIndex(candidate => candidate.id === previous.tabId)
        await writeLastActiveTab(spaceId, { ...previous, url, urlOccurrence: Math.max(0, urlOccurrence) })
      } catch {
        // Tabs can close while a move event is being processed.
      }
    })
  })

  chrome.windows.onRemoved.addListener((winId) => {
    closingWindowIds.delete(winId)
    void onWindowRemovedHandler(winId)
  })
})
