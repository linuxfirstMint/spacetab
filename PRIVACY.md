# Privacy Policy · SpaceTab

**Effective:** 2026-05-10
**Last updated:** 2026-05-10

> **TL;DR** — SpaceTab does not collect, transmit, or sell any data. Everything you create stays on your device, in your browser, and never leaves it.

---

## 1. What we collect

**Nothing.** SpaceTab has no analytics, no telemetry, no crash reporting, no remote logging, and no servers. We never see your tabs, browsing history, or any activity.

## 2. What is stored, and where

The data SpaceTab creates lives entirely in your browser's local storage (`chrome.storage.local` and `chrome.storage.session`). It is bound to your installation of Chrome on this device and is **not** synchronized to any cloud service or other browser by SpaceTab.

The stored data includes:

- **Spaces** — names, emoji, notes, pinned/order metadata
- **Tabs in spaces** — URL, title, favicon URL, optional tab-group association
- **Preferences** — theme (system / light / dark), language, whether you enabled the new-tab-page override
- **Runtime state** — the id of the hidden vault window and which Chrome tab IDs currently belong to which space (cleared when you sign out of Chrome or clear browsing data)

You can export everything as a JSON file at any time, or import a JSON file you previously exported. Export files only go where you put them — they are never uploaded.

## 3. Permissions

SpaceTab requests five Chrome permissions. Each is used only for the feature it enables:

| Permission | Why we need it |
|---|---|
| `tabs` | Read and arrange the tabs in your current window so you can archive them into spaces, switch between spaces, move tabs between spaces, and discard inactive tabs. |
| `storage` | Save your spaces locally (`chrome.storage.local`) so they persist across browser restarts. |
| `tabGroups` | Read and recreate Chrome's native tab groups (color + title) when you archive a window or switch to a space, so your visual organization survives the round-trip. |
| `sidePanel` | Open the SpaceTab manager in Chrome's side panel when you click the extension action. |
| `contextMenus` | Add an explicit “Preview with SpaceTab” action on HTTP(S) links and an action to move the active preview into a regular tab. |

Link previews open the selected HTTP(S) URL in a small top-level Chrome popup window. This is not an embedded preview and does not bypass site framing, login, or other security restrictions. Chrome loads the selected site normally, so the site may set cookies or perform its ordinary page behavior after the user explicitly opens it. SpaceTab does not copy cookies, strip security headers, or send the URL or page contents to an external preview service. A temporary popup/source window ID pair is kept in `chrome.storage.session` so repeated previews can reuse the popup and offer a regular-tab action; the URL and page contents are not saved by this feature. The marker clears when the popup closes or the browser session ends. Closing the popup returns focus to Chrome's prior window when Chrome permits it.

We never request `<all_urls>`, host permissions, or content scripts.

## 4. Third parties

SpaceTab does **not** integrate any third-party SDK, analytics service, A/B testing tool, or advertising network. It does not send data to Anthropic, Google, or any other party.

When SpaceTab renders a saved favicon, your browser fetches the favicon URL the same way Chrome would for any open tab — typically from the original website's server. SpaceTab does not proxy or intercept these requests.

## 5. Network

SpaceTab does not make any outbound network requests on its own. The extension is a single static page bundle plus a service worker; neither contacts a SpaceTab server (we don't have one).

The browser loads the site you explicitly choose to preview or open as a tab. That is normal browsing to the destination site, not telemetry or a request to a SpaceTab service.

## 6. Children

SpaceTab is a productivity tool with no user accounts and no targeted content. We do not knowingly direct it at users under 13.

## 7. Changes to this policy

If we ever change how SpaceTab handles data, this file will be updated and the "Last updated" date above will change. Because the policy is hosted in the project's git history, you can always see exactly what changed and when.

## 8. Contact

Issues, questions, or concerns: open an issue at <https://github.com/tashuo/spacetab/issues>.

---

# 隐私政策 · SpaceTab(中文)

**生效日期:** 2026-05-10
**最后更新:** 2026-05-10

> **简而言之** — SpaceTab 不收集、不上传、不出售任何数据。你创建的所有内容都留在你自己的浏览器里,从不离开你的设备。

---

## 1. 收集什么

**什么都不收集**。SpaceTab 没有埋点、没有遥测、没有崩溃上报、没有远程日志,也没有任何服务器。我们看不到你的标签、浏览记录或任何使用行为。

## 2. 存储什么、存到哪里

SpaceTab 创建的数据完全保存在你浏览器本地的存储里(`chrome.storage.local` 和 `chrome.storage.session`)。它绑定在你这台设备上的 Chrome 安装中,**不会** 被 SpaceTab 同步到任何云服务,也不会同步到你其他设备的 Chrome。

存储内容包括:

- **空间** — 名称、emoji、备注、置顶 / 排序元数据
- **空间内的标签** — URL、标题、favicon 地址、可选的标签组归属
- **偏好** — 主题(跟随系统 / 浅色 / 深色)、语言、是否启用新标签页接管
- **运行时状态** — 隐藏 vault 窗口的 id,以及哪些 Chrome 标签 id 当前属于哪个空间(退出 Chrome 或清除浏览数据后会被清空)

你可以随时把全部数据导出成一个 JSON 文件,也可以把之前导出的 JSON 重新导入。导出的文件只去你指定的地方,绝不会被上传。

## 3. 权限

SpaceTab 申请 5 个 Chrome 权限,每个权限只服务于它启用的功能:

| 权限 | 为什么需要 |
|---|---|
| `tabs` | 读取并整理当前窗口的标签:归档到空间、切换空间、跨空间移动、休眠非活动标签。 |
| `storage` | 把你的空间保存在本地(`chrome.storage.local`)以便重启浏览器后还能恢复。 |
| `tabGroups` | 读取和重建 Chrome 原生的标签组(颜色 + 标题),让你归档窗口或切换空间时分组结构不丢失。 |
| `sidePanel` | 点击扩展程序按钮时在 Chrome 侧边栏打开 SpaceTab 管理器。 |
| `contextMenus` | 在 HTTP(S) 链接菜单中添加明确的预览操作,并提供将预览移为普通标签页的操作。 |

链接预览会在小型 Chrome 顶层弹出窗口中打开所选 HTTP(S) URL。这不是嵌入式预览,也不会绕过网站的框架、登录或其他安全限制。Chrome 会像平常一样加载网站,因此用户明确打开后,网站可能设置 Cookie 或执行正常页面行为。SpaceTab 不会复制 Cookie、移除安全响应头,也不会把 URL 或页面内容发送给外部预览服务。临时弹窗和来源窗口 ID 保存在 `chrome.storage.session`,用于重用弹窗和提供普通标签页操作;此功能不会保存 URL 或页面内容。关闭弹窗或浏览器会话结束后,标记会清除。

我们从不申请 `<all_urls>`、宿主权限或内容脚本。

## 4. 第三方

SpaceTab **不** 集成任何第三方 SDK、分析服务、A/B 测试工具或广告网络。不向 Anthropic、Google 或任何其他方发送数据。

SpaceTab 渲染保存的 favicon 时,浏览器以正常方式去原网站抓取图标 — 这和你打开任何普通标签页时浏览器做的事完全一样。SpaceTab 不会代理或拦截这些请求。

## 5. 网络

SpaceTab 自己不发起任何对外网络请求。整个扩展只是一个静态页面包加一个 service worker,两者都不向任何 SpaceTab 服务器联络(因为我们根本没有服务器)。

SpaceTab 引起的唯一网络流量,是你点击标签打开它时浏览器去取那个网站 — 这属于你正常的浏览行为,不是遥测。

## 6. 儿童

SpaceTab 是一款生产力工具,没有用户账号,没有针对性的内容。我们不会刻意把它面向 13 岁以下的儿童。

## 7. 政策变更

如果 SpaceTab 处理数据的方式有任何变化,本文档会被更新,顶部的「最后更新」日期会随之变化。由于政策托管在项目 git 历史中,你随时可以查看每一次具体改动。

## 8. 联系方式

任何问题、疑问或反馈,请到 <https://github.com/tashuo/spacetab/issues> 开 issue。
