import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

const root = 'C:\\Users\\yamas\\spacetab-win-test-20261010'
const profile = path.join(root, 'artifacts', 'profile-issue9-url-routing-v16-20261011')
const extension = path.join(root, 'issue9-extension')
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const output = path.join(root, 'artifacts', 'issue14-ui-result.json')
const screenshots = path.join(root, 'artifacts', 'issue14-screenshots')
const profilePids = () => {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Contains('${profile}') } | Select-Object -ExpandProperty ProcessId`
  const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim()
  return text ? text.split(/\s+/).map(Number) : []
}
const assert = (value, message) => { if (!value) throw new Error(message) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const delayUntil = async (label, fn, timeout = 20000) => {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last } catch (error) { last = String(error) }
    await wait(100)
  }
  throw new Error(`${label} timed out: ${String(last)}`)
}

const spaceName = `Issue 14 Split QA ${Date.now()}`
const spareSpaceName = `${spaceName} Spare`
const fixtureId = crypto.randomUUID()
const spareFixtureId = crypto.randomUUID()
let context, manager, worker, server, serverUrl, tabs = [], windowId
const result = { profile, extension, spaceName, checks: [], directStorageWritesByTestCode: 0, directStorageClearsByTestCode: 0, status: 'running' }

async function launch() {
  assert(profilePids().length === 0, 'Dedicated profile already has Chrome processes; refusing to attach to or close an existing session')
  return chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: false, ignoreDefaultArgs: ['--disable-extensions'], locale: 'en-US', viewport: { width: 1440, height: 1000 } })
}
async function getWorker() {
  worker = await delayUntil('SpaceTab service worker', () => context.serviceWorkers().findLast(item => item.url().endsWith('/background.js')))
  return worker
}
async function openManager() {
  const id = new URL(worker.url()).host
  const url = `chrome-extension://${id}/manager.html`
  await worker.evaluate(url => chrome.tabs.create({ url, active: true }), url)
  manager = await delayUntil('manager page', () => context.pages().find(page => page.url() === url))
  await manager.getByRole('button', { name: 'Settings' }).waitFor({ state: 'visible' })
  return id
}
async function cleanupPreviousIssue14Fixtures() {
  await manager.evaluate(async () => {
    const testTabs = (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith('http://127.0.0.1:') && tab.title?.startsWith('ISSUE14 TEST '))
    if (testTabs.length) await chrome.tabs.remove(testTabs.map(tab => tab.id).filter(Number.isInteger))
  })
  const cards = manager.locator('[class*="group/card"]')
  const names = []
  for (const card of await cards.all()) {
    for (const name of await card.getByRole('heading').allTextContents()) {
      if (name.startsWith('Issue 14 Split QA ')) names.push(name)
    }
  }
  for (const name of names) {
    const heading = manager.getByRole('heading', { name, exact: true })
    const card = cards.filter({ has: heading }).first()
    let confirmed = false
    manager.once('dialog', async dialog => { confirmed = true; await dialog.accept() })
    await card.getByRole('button', { name: 'Delete', exact: true }).click()
    await delayUntil('old Issue 14 test Space deletion prompt', () => confirmed)
    await heading.waitFor({ state: 'detached' })
  }
}
async function currentTestTabs(urls = []) {
  return manager.evaluate(async urls => {
    const managerTab = await chrome.tabs.getCurrent()
    const all = await chrome.tabs.query({ windowId: managerTab.windowId })
    return all.filter(tab => urls.includes(tab.url)).map(({ id, url, windowId, index, pinned, groupId, splitViewId }) => ({ id, url, windowId, index, pinned: pinned ?? false, groupId: groupId ?? -1, splitViewId: splitViewId ?? -1 }))
  }, urls)
}
async function toast(text) { await manager.getByText(text, { exact: true }).last().waitFor({ state: 'visible', timeout: 10000 }) }
async function selectTwo(card, firstTitle = 'ISSUE14 TEST A', secondTitle = 'ISSUE14 TEST B') {
  const clear = card.getByRole('button', { name: 'Cancel', exact: true })
  if (await clear.count()) await clear.click()
  await card.locator('[role="button"]').filter({ hasText: firstTitle }).first().click({ modifiers: ['Control'] })
  await card.locator('[role="button"]').filter({ hasText: secondTitle }).first().click({ modifiers: ['Control'] })
  await card.getByRole('button', { name: 'Split view' }).waitFor({ state: 'visible' })
}
async function clickSplit(card) { await card.getByRole('button', { name: 'Split view' }).click() }
async function clickUnsplit(card) { await card.getByRole('button', { name: 'Unsplit' }).click() }
async function workerSourceHash() {
  const cdp = await manager.context().newCDPSession(manager)
  const target = (await cdp.send('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url === worker.url())
  assert(target, 'Service worker target missing from Chrome DevTools Protocol')
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
  const receive = (expectedId, expectedMethod) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP ${expectedMethod} timed out`)), 10000)
    const listener = event => {
      if (event.sessionId !== sessionId) return
      try {
        const message = JSON.parse(event.message)
        if (message.method === expectedMethod && message.params.url === worker.url()) { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener); resolve(message.params) }
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
  return crypto.createHash('sha256').update(source.scriptSource).digest('hex')
}

try {
  await fs.mkdir(screenshots, { recursive: true })
  result.deployedWorkerHash = crypto.createHash('sha256').update(await fs.readFile(path.join(extension, 'background.js'))).digest('hex')
  server = http.createServer((req, res) => {
    const name = req.url?.includes('tab-b') ? 'ISSUE14 TEST B' : req.url?.includes('tab-c') ? 'ISSUE14 TEST C' : 'ISSUE14 TEST A'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><title>${name}</title><body><h1>${name}</h1><p>Dedicated Issue 14 test data</p></body>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  serverUrl = `http://127.0.0.1:${address.port}`
  const urls = [`${serverUrl}/tab-a`, `${serverUrl}/tab-b`]
  result.testUrls = urls

  context = await launch()
  result.initialProfilePids = profilePids()
  assert(result.initialProfilePids.length > 0, 'Dedicated Chrome process did not start')
  const initialPage = context.pages()[0]
  result.chromeUserAgent = await context.pages()[0].evaluate(() => navigator.userAgent).catch(() => 'unavailable')

  const extensionsPage = await context.newPage()
  await extensionsPage.goto('chrome://extensions')
  const extensionCard = await delayUntil('enabled SpaceTab extension', async () => {
    const items = await extensionsPage.locator('extensions-item').evaluateAll(nodes => nodes.map(node => {
      const shadow = node.shadowRoot
      const name = shadow?.querySelector('#name')?.textContent?.trim() || ''
      const toggle = shadow?.querySelector('#enableToggle')
      return { id: node.getAttribute('id'), name, enabled: Boolean(toggle && (toggle.checked || toggle.hasAttribute('checked') || toggle.getAttribute('aria-pressed') === 'true')) }
    }))
    return items.find(item => item.name === 'SpaceTab' && item.enabled)
  })
  result.extensionCard = extensionCard
  const extCard = extensionsPage.locator(`extensions-item#${extensionCard.id}`)
  await extCard.locator('#detailsButton').click()
  result.registeredUnpackedPath = await delayUntil('registered unpacked path', () => extensionsPage.locator('extensions-detail-view').evaluate(node => node.shadowRoot?.querySelector('#load-path')?.innerText))
  assert(result.registeredUnpackedPath.toLowerCase().includes('issue9-extension'), `Unexpected registered unpacked path: ${result.registeredUnpackedPath}`)
  await extensionsPage.screenshot({ path: path.join(screenshots, 'extension-details-path.png'), fullPage: true })
  await extensionsPage.goto('chrome://extensions')
  await extensionsPage.locator(`extensions-item#${extensionCard.id} #dev-reload-button`).click()
  await getWorker()
  result.nativeApiAvailable = await worker.evaluate(() => ({ createSplit: typeof chrome.tabs.createSplit, unsplit: typeof chrome.tabs.unsplit }))
  assert(result.nativeApiAvailable.createSplit === 'function' && result.nativeApiAvailable.unsplit === 'function', `Chrome Split View APIs unavailable: ${JSON.stringify(result.nativeApiAvailable)}`)
  result.checks.push('chrome155_native_api_feature_detected_after_real_extension_reload')
  const extensionId = await openManager()
  await extensionsPage.close()
  if (initialPage && ['about:blank', 'chrome://newtab/', 'chrome://newtab'].includes(initialPage.url())) await initialPage.close().catch(() => {})
  await cleanupPreviousIssue14Fixtures()
  result.executedWorkerHash = await workerSourceHash()
  assert(result.executedWorkerHash === result.deployedWorkerHash, 'Executing worker source does not match deployed background.js')
  result.checks.push('executing_worker_source_matches_deployed_worker_sha256')
  assert(extensionId === extensionCard.id, 'Manager page ID differs from enabled extension card')

  const first = await context.newPage()
  await first.goto(urls[0])
  const second = await context.newPage()
  await second.goto(urls[1])
  result.testWindowBefore = await currentTestTabs(urls)
  assert(result.testWindowBefore.length === 2, 'Expected exactly two dedicated test tabs in the manager window')
  assert(Math.abs(result.testWindowBefore[0].index - result.testWindowBefore[1].index) === 1, 'Test tabs are not adjacent in the dedicated test window')
  assert(result.testWindowBefore[0].windowId === result.testWindowBefore[1].windowId, 'Test tabs are not in the same dedicated window')

  const fixture = {
    format: 'spacetab-export', formatVersion: 2, exportedAt: Date.now(), app: 'SpaceTab',
    db: { version: 1, spaces: [
      { id: fixtureId, name: spaceName, createdAt: Date.now(), updatedAt: Date.now(), tabs: [
        { url: urls[0], title: 'ISSUE14 TEST A' }, { url: urls[1], title: 'ISSUE14 TEST B' },
      ] },
      { id: spareFixtureId, name: spareSpaceName, createdAt: Date.now(), updatedAt: Date.now(), tabs: [] },
    ], favorites: [] },
  }
  await manager.getByRole('button', { name: 'Settings' }).click()
  const fileChooserPromise = manager.waitForEvent('filechooser')
  await manager.getByText('Import JSON', { exact: true }).click()
  // The user-facing import picker is the only fixture ingestion path; no storage APIs are used by the harness.
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({ name: 'issue14-test-space.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
  await manager.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  const card = manager.locator('[class*="group/card"]').filter({ hasText: spaceName }).first()
  await card.waitFor({ state: 'visible' })
  const spareCard = manager.locator('[class*="group/card"]').filter({ hasText: spareSpaceName }).first()
  await spareCard.waitFor({ state: 'visible' })
  result.checks.push('dedicated_fixture_space_created_through_import_ui')

  for (const title of ['ISSUE14 TEST A', 'ISSUE14 TEST B']) {
    const liveRow = manager.locator('li').filter({ hasText: title }).first()
    await liveRow.getByRole('button', { name: 'Add to a space' }).click()
    await manager.getByRole('button', { name: spaceName, exact: true }).click()
  }
  result.checks.push('test_tabs_added_to_spaces_using_live_tab_ui')
  await card.getByRole('button', { name: 'Switch', exact: true }).click()
  await delayUntil('test Space selected', async () => (await currentTestTabs(urls)).length === 2)
  result.checks.push('test_space_selected_before_comparison')

  await selectTwo(card)
  await clickSplit(card)
  await toast('Selected tabs are now side by side')
  let live = await currentTestTabs(urls)
  assert(live.length === 2 && live[0].splitViewId >= 0 && live[0].splitViewId === live[1].splitViewId, `Native split state not reflected on both tabs: ${JSON.stringify(live)}`)
  result.splitViewId = live[0].splitViewId
  result.checks.push('selected_two_live_space_tabs_native_split_created')
  await manager.screenshot({ path: path.join(screenshots, 'split-created.png'), fullPage: true })

  await clickSplit(card)
  await toast('One of the selected tabs is already in Split View')
  result.checks.push('existing_split_refused_with_clear_ui_message')
  await clickUnsplit(card)
  await toast('Split View was removed')
  live = await currentTestTabs(urls)
  assert(live.every(tab => tab.splitViewId < 0), `Unsplit action did not separate tabs: ${JSON.stringify(live)}`)
  result.checks.push('selected_pair_unsplit_through_space_ui')

  await spareCard.getByRole('button', { name: 'Switch', exact: true }).click()
  await delayUntil('test tabs stashed while switching Spaces', async () => (await currentTestTabs(urls)).length === 0)
  await card.getByRole('button', { name: 'Switch', exact: true }).click()
  await delayUntil('test tabs restored after switching Spaces', async () => (await currentTestTabs(urls)).length === 2)
  assert((await first.title()) === 'ISSUE14 TEST A' && (await second.title()) === 'ISSUE14 TEST B', 'Space switching changed the test page contents')
  result.checks.push('switching_to_other_space_and_back_preserved_test_pages')

  const [tabA, tabB] = live
  const cUrl = `${serverUrl}/tab-c`
  await manager.evaluate(async url => {
    const current = await chrome.tabs.getCurrent()
    await chrome.tabs.create({ url, windowId: current.windowId, active: false })
  }, cUrl)
  await delayUntil('test tab C', () => context.pages().find(page => page.url() === cUrl))
  const ids = await manager.evaluate(async urls => {
    const current = await chrome.tabs.getCurrent()
    const all = await chrome.tabs.query({ windowId: current.windowId })
    return Object.fromEntries(all.filter(tab => urls.includes(tab.url)).map(tab => [tab.url, { id: tab.id, index: tab.index, windowId: tab.windowId }]))
  }, [...urls, cUrl])
  const aInfo = ids[urls[0]], bInfo = ids[urls[1]], cInfo = ids[cUrl]
  assert(aInfo && bInfo && cInfo, `A dedicated test tab is missing from the manager window: ${JSON.stringify(ids)}`)
  await manager.evaluate(async ({ id, index }) => chrome.tabs.move(id, { index }), { id: cInfo.id, index: aInfo.index + 1 })
  const nonAdjacentBefore = await currentTestTabs(urls)
  await selectTwo(card)
  await clickSplit(card)
  await toast('The selected tabs are not adjacent')
  live = await currentTestTabs(urls)
  assert(live.every(tab => tab.splitViewId < 0), 'Non-adjacent test tabs were unexpectedly split')
  assert(live.every(tab => nonAdjacentBefore.some(before => before.id === tab.id && before.index === tab.index)), 'Non-adjacent refusal changed test tab positions')
  result.checks.push('non_adjacent_pair_refused_without_tab_reordering')

  await manager.evaluate(async ({ id }) => chrome.tabs.update(id, { pinned: true }), { id: aInfo.id })
  await clickSplit(card)
  await toast('Tabs with different pinned states cannot be split')
  live = await currentTestTabs(urls)
  assert(live.find(tab => tab.id === aInfo.id)?.pinned === true && live.find(tab => tab.id === bInfo.id)?.pinned === false, 'Pinned mismatch refusal changed either tab pin state')
  await manager.evaluate(async ({ id }) => chrome.tabs.update(id, { pinned: false }), { id: aInfo.id })
  const groupId = await manager.evaluate(async ({ id }) => chrome.tabs.group({ tabIds: [id] }), { id: aInfo.id })
  await clickSplit(card)
  await toast('Tabs in different tab groups cannot be split')
  live = await currentTestTabs(urls)
  assert(live.find(tab => tab.id === aInfo.id)?.groupId === groupId && live.find(tab => tab.id === bInfo.id)?.groupId !== groupId, 'Group mismatch refusal changed the test group state')
  await manager.evaluate(async ({ id }) => chrome.tabs.ungroup(id), { id: aInfo.id })
  result.checks.push('pinned_and_group_mismatch_refused_without_state_changes')

  const beforeMultiWindow = await currentTestTabs(urls)
  windowId = beforeMultiWindow[0].windowId
  const moved = await manager.evaluate(async ({ id }) => chrome.windows.create({ tabId: id, focused: false }), { id: bInfo.id })
  await clickSplit(card)
  await toast('Open both selected tabs in the current window first')
  await manager.evaluate(async ({ id, windowId }) => chrome.tabs.move(id, { windowId, index: -1 }), { id: bInfo.id, windowId })
  result.checks.push('tab_in_another_window_refused_with_current_window_guidance')

  // Return the two test tabs to adjacent positions at the end of the dedicated window.
  live = await currentTestTabs(urls)
  const reordered = [...live].sort((a, b) => a.index - b.index)
  await manager.evaluate(async ({ id, index }) => chrome.tabs.move(id, { index }), { id: reordered[0].id, index: 100000 })
  await manager.evaluate(async ({ id, index }) => chrome.tabs.move(id, { index }), { id: reordered[1].id, index: 100001 })
  live = await currentTestTabs(urls)
  assert(Math.abs(live[0].index - live[1].index) === 1, `Could not restore test tab adjacency: ${JSON.stringify(live)}`)
  await clickSplit(card)
  await toast('Selected tabs are now side by side')
  result.checks.push('native_split_and_unsplit_remain_repeatable_after_constraint_checks')

  const current = await currentTestTabs(urls)
  await manager.evaluate(async id => chrome.tabs.remove(id), current[0].id)
  live = await currentTestTabs(urls)
  assert(live.length === 1 && live[0].splitViewId < 0, `Closing one side did not leave the other independent: ${JSON.stringify(live)}`)
  result.checks.push('closing_one_test_side_leaves_remaining_tab_unsplit')

  // Restart the dedicated profile naturally and verify the UI-created/imported Space persists.
  result.beforeExitPids = profilePids()
  await context.close(); context = null
  for (let i = 0; i < 180 && profilePids().length > 0; i++) await wait(100)
  result.afterExitPids = profilePids()
  assert(result.afterExitPids.length === 0, 'Dedicated Chrome process tree did not exit normally')
  context = await launch()
  await getWorker()
  await openManager()
  const restoredCard = manager.locator('[class*="group/card"]').filter({ hasText: spaceName }).first()
  await restoredCard.waitFor({ state: 'visible' })
  await restoredCard.getByText('ISSUE14 TEST A', { exact: true }).waitFor({ state: 'visible' })
  await restoredCard.getByText('ISSUE14 TEST B', { exact: true }).waitFor({ state: 'visible' })
  result.checks.push('space_and_both_saved_tab_rows_persist_after_natural_profile_restart')
  await manager.screenshot({ path: path.join(screenshots, 'post-restart-space.png'), fullPage: true })

  for (const name of [spaceName, spareSpaceName]) {
    const heading = manager.getByRole('heading', { name, exact: true })
    const cardToDelete = manager.locator('[class*="group/card"]').filter({ has: heading }).first()
    let deleteConfirmed = false
    manager.once('dialog', async dialog => { deleteConfirmed = true; await dialog.accept() })
    await cardToDelete.getByRole('button', { name: 'Delete', exact: true }).click()
    await delayUntil('test Space deletion prompt', () => deleteConfirmed)
    await heading.waitFor({ state: 'detached' })
  }
  result.checks.push('temporary_issue14_space_removed_through_normal_ui')

  // Close only this run's remaining local test tab through the normal Chrome tab API.
  const remaining = await currentTestTabs(urls)
  if (remaining.length) await manager.evaluate(async id => chrome.tabs.remove(id), remaining[0].id)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = error?.stack || String(error)
} finally {
  if (context) await context.close().catch(() => {})
  if (server) await new Promise(resolve => server.close(resolve))
  result.finalProfilePids = profilePids()
  result.completedAt = new Date().toISOString()
  await fs.writeFile(output, JSON.stringify(result, null, 2))
}
if (result.status !== 'passed') process.exitCode = 1
