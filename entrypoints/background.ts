import { readDatabase } from '@/lib/storage'
import { readSessionState } from '@/lib/session-state'
import { sortedForDisplay } from '@/lib/space'
import { onTabRemovedHandler, onWindowRemovedHandler, switchToSpace } from '@/lib/vault'

export default defineBackground(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)

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
