import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { execFileSync, spawn } from 'node:child_process'

const root = 'C:\\Users\\yamas\\spacetab-win-test-20261010'
const profile = path.join(root, 'artifacts', 'profile-issue9-url-routing-v16-20261011')
const extension = path.join(root, 'issue9-extension')
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 19284
const output = path.join(root, 'artifacts', 'issue15-ui-result.json')
const screenshots = path.join(root, 'artifacts', 'issue15-screenshots')
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
class Cdp {
  nextId = 1
  pending = new Map()
  events = []
  constructor(url) {
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } else this.events.push(message)
    })
  }
  async send(method, params = {}, sessionId) {
    await this.ready
    const id = this.nextId++
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return promise
  }
  async close() { this.socket.close() }
}

let browser, server, chrome, sourceTarget, sourceSession, previewTarget, previewSession
const result = { profile, extension, checks: [], directStorageWritesByTestCode: 0, directStorageClearsByTestCode: 0, status: 'running' }
try {
  await fs.mkdir(screenshots, { recursive: true })
  assert(profilePids().length === 0, 'Dedicated profile is already running; refusing to attach to or close it')
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/final' }); res.end(); return }
    if (req.url === '/final') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>ISSUE15 REDIRECT TARGET</title><h1>Redirect target</h1>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><title>ISSUE15 SOURCE</title><style>body{height:2000px}</style><h1>Source fixture</h1><input id="keep" value="preserved"><a id="target" href="http://127.0.0.1:${server.address().port}/redirect">Preview target</a><a id="second" href="http://127.0.0.1:${server.address().port}/final">Second target</a>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const sourceUrl = `http://127.0.0.1:${server.address().port}/source`
  chrome = spawn(chromePath, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' })
  result.startedProfilePids = await delayUntil('dedicated Chrome process', () => { const pids = profilePids(); return pids.length ? pids : null })
  const version = await delayUntil('Chrome DevTools endpoint', async () => fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.ok ? response.json() : null))
  browser = new Cdp(version.webSocketDebuggerUrl)
  await browser.send('Target.setDiscoverTargets', { discover: true })
  const targets = await browser.send('Target.getTargets')
  const workerInfo = targets.targetInfos.find(target => target.type === 'service_worker' && target.url.endsWith('/background.js'))
  assert(workerInfo, 'SpaceTab worker is not running in the dedicated profile')
  result.extensionId = new URL(workerInfo.url).host
  const workerSession = (await browser.send('Target.attachToTarget', { targetId: workerInfo.targetId, flatten: true })).sessionId
  await browser.send('Runtime.enable', {}, workerSession)
  const getValue = async expression => (await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, workerSession)).result.value
  result.permissions = await getValue('chrome.runtime.getManifest().permissions')
  assert(result.permissions.includes('contextMenus'), 'contextMenus permission is not present in the loaded manifest')
  result.checks.push('context_menus_permission_loaded')

  sourceTarget = (await browser.send('Target.createTarget', { url: sourceUrl, newWindow: true })).targetId
  sourceSession = (await browser.send('Target.attachToTarget', { targetId: sourceTarget, flatten: true })).sessionId
  await browser.send('Page.enable', {}, sourceSession)
  await browser.send('Runtime.enable', {}, sourceSession)
  const sourceWindowId = (await browser.send('Browser.getWindowForTarget', { targetId: sourceTarget })).windowId
  result.sourceWindowId = sourceWindowId
  await delayUntil('source fixture loaded', async () => (await browser.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sourceSession)).result.value === 'complete')
  await browser.send('Runtime.evaluate', { expression: "document.querySelector('#keep').value='preserved input'; scrollTo(0,400)", returnByValue: true }, sourceSession)
  const clickContext = async selector => {
    const rect = (await browser.send('Runtime.evaluate', { expression: `(() => { const r=document.querySelector('${selector}').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`, returnByValue: true }, sourceSession)).result.value
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y }, sourceSession)
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'right', buttons: 2, clickCount: 1 }, sourceSession)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'right', buttons: 0, clickCount: 1 }, sourceSession)
  }
  const press = async (session, key, code, vkey) => {
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vkey }, session)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vkey }, session)
  }
  const invokeMenuItem = titlePattern => {
    const ps = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; $root=[System.Windows.Automation.AutomationElement]::RootElement; $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::MenuItem); $items=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition); $names=@($items | ForEach-Object { $_.Current.Name }); $target=$items | Where-Object { $_.Current.Name -match '${titlePattern}' } | Select-Object -First 1; if($null -eq $target){ $names | ConvertTo-Json -Compress; exit 4 }; try { $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { $target.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand(); Start-Sleep -Milliseconds 200; $children=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition); $child=$children | Where-Object { $_.Current.Name -match '${titlePattern}' } | Select-Object -Last 1; $child.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }; Write-Output ('INVOKED=' + $target.Current.Name)`
    const encoded = Buffer.from(ps, 'utf16le').toString('base64')
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8' }).trim()
  }
  await clickContext('#target')
  result.previewMenuUiAutomation = invokeMenuItem('Preview with SpaceTab|SpaceTabでプレビュー')
  previewTarget = await delayUntil('popup target', async () => {
    const { targetInfos } = await browser.send('Target.getTargets')
    return targetInfos.find(target => target.type === 'page' && target.targetId !== sourceTarget && target.url.includes('/final'))
  }, 10000)
  assert(previewTarget, 'Right-click keyboard selection did not open a preview window')
  result.checks.push('context_menu_opened_http_redirect_in_popup')
  const previewTabInfo = await delayUntil('preview identity saved', async () => {
    const value = await getValue("chrome.storage.session.get('linkPreviewWindow').then(value => value.linkPreviewWindow)")
    return value && Number.isInteger(value.windowId) ? value : null
  })
  const original = await browser.send('Runtime.evaluate', { expression: "({url:location.href,value:document.querySelector('#keep').value,scroll:scrollY})", returnByValue: true }, sourceSession)
  assert(original.result.value.url === sourceUrl && original.result.value.value === 'preserved input' && original.result.value.scroll === 400, 'Original URL, input, or scroll position changed')
  result.checks.push('source_url_input_and_scroll_preserved')

  const popupCountBefore = (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.targetId !== sourceTarget).length
  await clickContext('#second')
  invokeMenuItem('Preview with SpaceTab|SpaceTabでプレビュー')
  await delayUntil('reused preview remains live', async () => {
    const { targetInfos } = await browser.send('Target.getTargets')
    return targetInfos.some(target => target.targetId === previewTarget.targetId && target.url.includes('/final'))
  })
  const popupCountAfter = (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.targetId !== sourceTarget).length
  assert(popupCountAfter === popupCountBefore, 'Repeated preview created another page window')
  result.checks.push('repeated_preview_reused_single_popup')

  previewSession = (await browser.send('Target.attachToTarget', { targetId: previewTarget.targetId, flatten: true })).sessionId
  await browser.send('Page.enable', {}, previewSession)
  await browser.send('Runtime.enable', {}, previewSession)
  const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' }, previewSession)
  await fs.writeFile(path.join(screenshots, 'preview-target.png'), Buffer.from(screenshot.data, 'base64'))
  const popupPageWindowId = (await browser.send('Browser.getWindowForTarget', { targetId: previewTarget.targetId })).windowId
  const previewRect = { x: 20, y: 20 }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...previewRect }, previewSession)
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...previewRect, button: 'right', buttons: 2, clickCount: 1 }, previewSession)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...previewRect, button: 'right', buttons: 0, clickCount: 1 }, previewSession)
  result.convertMenuUiAutomation = invokeMenuItem('Open preview as a regular tab|プレビューを通常タブとして開く')
  await delayUntil('preview popup closed after tab conversion', async () => !(await browser.send('Target.getTargets')).targetInfos.some(target => target.targetId === previewTarget.targetId))
  const tabs = await getValue(`chrome.tabs.query({windowId:${sourceWindowId}}).then(items => items.map(({url}) => url))`)
  assert(tabs.includes(`http://127.0.0.1:${server.address().port}/final`), `Regular tab was not created in source window: ${JSON.stringify(tabs)}`)
  result.checks.push('preview_converted_to_normal_tab_in_source_window')
  result.popupAfterConvert = await getValue("chrome.storage.session.get('linkPreviewWindow').then(value => value.linkPreviewWindow ?? null)")
  assert(!result.popupAfterConvert, 'Preview marker remained after conversion')
  result.checks.push('preview_marker_cleared_after_conversion')
  result.popupWindowId = popupPageWindowId
  result.workerSha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(extension, 'background.js'))).digest('hex')
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = String(error?.stack || error)
} finally {
  if (browser) {
    await browser.send('Browser.close').catch(() => {})
    await browser.close().catch(() => {})
  } else chrome?.kill()
  server?.close()
  await delayUntil('dedicated profile cleanup', () => profilePids().length === 0, 20000).catch(() => undefined)
  result.finalProfilePids = profilePids()
  result.completedAt = new Date().toISOString()
  await fs.writeFile(output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed' || result.finalProfilePids.length) process.exitCode = 1
}
