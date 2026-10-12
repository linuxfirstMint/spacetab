import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = 'C:\\Users\\yamas\\spacetab-win-test-20261010'
const artifacts = path.join(root, 'artifacts')
const profile = path.join(artifacts, 'profile-issue9-url-routing-v16-20261011')
const extension = path.join(root, 'issue9-extension')
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const output = path.join(artifacts, 'issue11-ui-result.json')
const screenshots = path.join(artifacts, 'issue11-screenshots')
const result = { profile, extension, checks: [], chromePids: [], status: 'running', directStorageWritesByTestCode: 0, directStorageClearsByTestCode: 0 }
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let context, manager, worker
const pids = () => {
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Contains('${profile}') } | Select-Object -ExpandProperty ProcessId`], { encoding: 'utf8' }).trim()
  return raw ? raw.split(/\s+/).map(Number) : []
}
async function launch() {
  return chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'], locale: 'en-US', viewport: { width: 1440, height: 1000 }, args: [] })
}
async function waitFor(label, fn, timeout = 20000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { last = await fn(); if (last) return last } catch (error) { last = String(error) } await delay(100) }
  throw new Error(`${label}: ${JSON.stringify(last)}`)
}
async function getWorker() {
  worker = await waitFor('extension service worker', () => context.serviceWorkers().findLast(item => item.url().endsWith('/background.js')))
  return worker
}
async function openManager() {
  const id = new URL(worker.url()).host
  const url = `chrome-extension://${id}/manager.html`
  await worker.evaluate(url => chrome.tabs.create({ url, active: true }), url)
  manager = await waitFor('manager tab', () => context.pages().find(page => page.url() === url))
  await manager.getByRole('button', { name: 'Confirm', exact: true }).click().catch(() => manager.keyboard.press('Escape'))
  await manager.getByRole('button', { name: 'Settings' }).waitFor({ state: 'visible' })
  return id
}
async function openShortcutSettings() {
  await manager.getByRole('button', { name: 'Settings' }).click()
  await manager.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click()
  await manager.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor({ state: 'visible' })
}
async function sourceHash() {
  const cdp = await manager.context().newCDPSession(manager)
  const workerUrl = worker.url()
  const targets = (await cdp.send('Target.getTargets')).targetInfos
  const target = targets.find(item => item.type === 'service_worker' && item.url === workerUrl)
  assert(target, 'Service worker target missing in CDP')
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
  const receive = (expectedId, expectedMethod) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP ${expectedMethod} timed out`)), 10000)
    const listener = event => {
      if (event.sessionId !== sessionId) return
      try {
        const message = JSON.parse(event.message)
        if (message.method === 'Debugger.scriptParsed' && expectedMethod === 'Debugger.scriptParsed' && message.params.url === workerUrl) { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener); resolve(message.params) }
        if (message.id === expectedId) { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener); resolve(message.result) }
      } catch {}
    }
    cdp.on('Target.receivedMessageFromTarget', listener)
  })
  const parsedPromise = receive(0, 'Debugger.scriptParsed')
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Debugger.enable' }) })
  const parsed = await parsedPromise
  const sourcePromise = receive(2, 'source')
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 2, method: 'Debugger.getScriptSource', params: { scriptId: parsed.scriptId } }) })
  const source = await sourcePromise
  await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {})
  await cdp.detach()
  assert(typeof source?.scriptSource === 'string', 'Executed worker source unavailable')
  return crypto.createHash('sha256').update(source.scriptSource).digest('hex')
}
try {
  await fs.mkdir(screenshots, { recursive: true })
  result.diskWorkerHash = crypto.createHash('sha256').update(await fs.readFile(path.join(extension, 'background.js'))).digest('hex')
  context = await launch()
  result.chromePids.push(pids())
  assert(result.chromePids[0].length > 0, 'Dedicated Chrome root process missing')

  const extensionsPage = await context.newPage()
  await extensionsPage.goto('chrome://extensions')
  const itemData = await waitFor('enabled extension card', async () => {
    const items = await extensionsPage.locator('extensions-item').evaluateAll(items => items.map(item => {
      const root = item.shadowRoot
      const name = root?.querySelector('#name')?.textContent?.trim() || ''
      const toggle = root?.querySelector('#enableToggle')
      return { id: item.getAttribute('id'), name, enabled: Boolean(toggle && (toggle.checked || toggle.hasAttribute('checked') || toggle.getAttribute('aria-pressed') === 'true')) }
    }))
    return items.find(item => item.name === 'SpaceTab' && item.enabled)
  })
  result.extensionId = itemData.id
  assert(itemData?.id && itemData.enabled, 'Extension card is missing or disabled in chrome://extensions')
  result.extensionCard = itemData
  const card = extensionsPage.locator(`extensions-item#${result.extensionId}`)
  await card.locator('#detailsButton').click()
  const loadPath = await waitFor('extension load path in Details', () => extensionsPage.locator('extensions-detail-view').evaluate(element => element.shadowRoot?.querySelector('#load-path')?.innerText))
  assert(loadPath.toLowerCase().includes('\\issue9-extension'), `Unexpected registered unpacked folder: ${loadPath}`)
  result.registeredUnpackedPath = loadPath
  await extensionsPage.screenshot({ path: path.join(screenshots, 'extension-details-path.png'), fullPage: true })
  await extensionsPage.goto('chrome://extensions')
  const cardToReload = extensionsPage.locator(`extensions-item#${result.extensionId}`)
  await cardToReload.locator('#dev-reload-button').click()
  await getWorker()
  result.checks.push('registered_folder_verified_and_extension_reloaded_from_that_path')
  await extensionsPage.screenshot({ path: path.join(screenshots, 'extensions-enabled.png'), fullPage: true })
  result.checks.push('chrome_extensions_card_present_and_enabled')

  const id = await openManager()
  assert(id === result.extensionId, 'Manager extension ID does not match the enabled card')
  const search = manager.getByRole('textbox', { name: 'Search spaces or tabs…' })
  await search.focus()
  await manager.keyboard.press('j')
  await manager.keyboard.press('k')
  assert(await search.inputValue() === 'jk', 'Focused search input did not retain J/K text')
  result.checks.push('focused_input_receives_navigation_letters_without_global_handling')
  const managerUrl = `chrome-extension://${id}/manager.html`
  await worker.evaluate(url => chrome.windows.create({ url, type: 'normal', focused: true }), managerUrl)
  const manager2 = await waitFor('second manager window', () => context.pages().find(page => page !== manager && page.url() === managerUrl))
  await manager2.getByRole('button', { name: 'Settings' }).click()
  await manager2.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click()
  const dialog2 = manager2.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await dialog2.getByText('Ctrl+K', { exact: true }).waitFor({ state: 'visible' })
  result.checks.push('second_window_loaded_shared_shortcut_setting')
  await manager.bringToFront()
  await openShortcutSettings()
  const dialog = manager.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await dialog.getByText('Open command palette', { exact: true }).waitFor({ state: 'visible' })
  await dialog.getByText('Chrome · managed by Chrome', { exact: true }).waitFor({ state: 'visible' })
  await dialog.getByText('Next Space', { exact: true }).waitFor({ state: 'visible' })
  await dialog.getByText('Previous Space', { exact: true }).waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: 'Open Chrome shortcut settings' }).waitFor({ state: 'visible' })
  const settingsTabPromise = context.waitForEvent('page')
  await dialog.getByRole('button', { name: 'Open Chrome shortcut settings' }).click()
  const settingsTab = await settingsTabPromise
  await waitFor('Chrome shortcut settings tab', () => settingsTab.url().startsWith('chrome://extensions/shortcuts'))
  result.chromeShortcutSettingsUrl = settingsTab.url()
  await settingsTab.close()
  await manager.bringToFront()
  result.shortcutListText = (await dialog.innerText()).slice(0, 2400)
  await manager.screenshot({ path: path.join(screenshots, 'shortcut-list-default.png'), fullPage: true })
  result.checks.push('in_app_and_chrome_managed_shortcuts_listed_with_settings_link')

  await dialog.getByRole('button', { name: 'Change', exact: true }).click()
  await manager.keyboard.press('Control+M')
  await dialog.getByText('Ctrl+M', { exact: true }).waitFor({ state: 'visible' })
  await dialog2.getByText('Ctrl+M', { exact: true }).waitFor({ state: 'visible' })
  result.checks.push('custom_shortcut_changed_through_ui')
  result.checks.push('storage_change_synced_to_second_manager_window')
  await manager.screenshot({ path: path.join(screenshots, 'shortcut-changed.png'), fullPage: true })

  await dialog.getByRole('button', { name: 'Reset to default' }).click()
  await dialog.getByText('Ctrl+K', { exact: true }).waitFor({ state: 'visible' })
  await dialog2.getByText('Ctrl+K', { exact: true }).waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await manager2.close()
  await manager.keyboard.press('Control+K')
  await manager.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'visible' })
  result.checks.push('reset_restores_default_palette_shortcut')
  await manager.keyboard.press('Escape')
  const shortcutButton = manager.getByRole('button', { name: 'Keyboard shortcuts', exact: true })
  if (!(await shortcutButton.isVisible().catch(() => false))) await manager.getByRole('button', { name: 'Settings' }).click()
  await shortcutButton.click()
  await manager.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor({ state: 'visible' })
  await manager.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByRole('button', { name: 'Change', exact: true }).click()
  await manager.keyboard.press('Control+M')
  await manager.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByText('Ctrl+M', { exact: true }).waitFor({ state: 'visible' })
  await manager.screenshot({ path: path.join(screenshots, 'shortcut-changed-final.png'), fullPage: true })
  await manager.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByRole('button', { name: 'Close' }).click()
  await manager.keyboard.press('Control+M')
  await manager.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'visible' })
  result.checks.push('custom_shortcut_invokes_palette')
  await manager.keyboard.press('Escape')

  const executedHash = await sourceHash()
  result.executedWorkerHash = executedHash
  assert(executedHash === result.diskWorkerHash, `Executing worker hash ${executedHash} differs from deployed file ${result.diskWorkerHash}`)
  result.checks.push('executed_service_worker_sha_matches_deployed_build')

  result.chromePidsBeforeExit = pids()
  await context.close(); context = null
  for (let i = 0; i < 180 && pids().length; i++) await delay(100)
  result.chromePidsAfterExit = pids()
  assert(result.chromePidsAfterExit.length === 0, 'Dedicated Chrome process did not exit cleanly')
  result.checks.push('dedicated_profile_chrome_exited_cleanly')

  context = await launch()
  await getWorker()
  await openManager()
  await manager.keyboard.press('Control+M')
  await manager.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'visible' })
  result.checks.push('custom_shortcut_persisted_after_normal_restart')
  result.postRestartWorkerHash = await sourceHash()
  assert(result.postRestartWorkerHash === result.diskWorkerHash, 'Restarted worker hash differs from deployed build')
  await manager.screenshot({ path: path.join(screenshots, 'post-restart-palette.png'), fullPage: true })
  result.chromePidsAfterRestart = pids()
  await manager.keyboard.press('Escape')
  await manager.getByRole('button', { name: 'Settings' }).click()
  await manager.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click()
  const finalShortcutDialog = manager.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await finalShortcutDialog.getByRole('button', { name: 'Reset to default' }).click()
  await finalShortcutDialog.getByText('Ctrl+K', { exact: true }).waitFor({ state: 'visible' })
  await finalShortcutDialog.getByRole('button', { name: 'Close' }).click()
  result.checks.push('shortcut_reset_to_default_after_restart_verification')
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = error?.stack || String(error)
  result.chromePidsAtFailure = pids()
} finally {
  if (context) await context.close().catch(() => {})
  result.chromePidsAtEnd = pids()
  result.completedAt = new Date().toISOString()
  await fs.writeFile(output, JSON.stringify(result, null, 2))
}
if (result.status !== 'passed') process.exitCode = 1
