> **Experimental Arc-style fork:** toolbar action opens a Chrome side panel.
> Next/previous Space shortcuts are configurable at `chrome://extensions/shortcuts`
> (defaults: Ctrl/Command+Shift+Right/Left).
> Unregistered tabs are saved into a recovery Space before switching, rather than closed.
> Switch operations share a Web Lock across extension pages. No additional host access.
> Build and unit tests pass; Chrome runtime testing is still required.
> Known upstream limitations: session ownership is global rather than per window;
> navigation, tab closure and browser restart restoration need further work.
> Pinned browser tabs remain shared between Spaces. Side panel has a compact Japanese Space picker; full editing remains in the manager.
> Build requirements: Chrome 116+ (Side Panel API), Node, pnpm.

# SpaceTab

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/eibplkakglandhanadkmbhifedkhdmhf?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/eibplkakglandhanadkmbhifedkhdmhf)
[![Users](https://img.shields.io/chrome-web-store/users/eibplkakglandhanadkmbhifedkhdmhf?label=users)](https://chromewebstore.google.com/detail/eibplkakglandhanadkmbhifedkhdmhf)
[![Rating](https://img.shields.io/chrome-web-store/rating/eibplkakglandhanadkmbhifedkhdmhf?label=rating)](https://chromewebstore.google.com/detail/eibplkakglandhanadkmbhifedkhdmhf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Project spaces for your browser tabs. Switch between named workspaces instantly via a hidden vault window. **Local-first, no account, no telemetry, open source.**

[**Install on Chrome Web Store →**](https://chromewebstore.google.com/detail/eibplkakglandhanadkmbhifedkhdmhf) · [Privacy Policy](PRIVACY.md) · [中文文档](#中文)

---

## What it does

SpaceTab organises your tabs into **named spaces** — one per project, side hustle, or personal context. It sits between OneTab (lightweight save) and Workona (full workflow SaaS), with the architecture of the latter and the price/privacy of the former.

### Core

- **Instant space switching** — tabs from inactive spaces stay loaded in a hidden vault window. Switching is a `chrome.tabs.move` between windows, not a reload. No scroll-position loss.
- **Smart archive** — auto-cluster the current window's tabs by domain/category into multiple spaces with one click.
- **Chrome tab groups preserved** — group color + title round-trip through archive and switch.
- **Command palette (⌘K)** — every action one keystroke away.

### Power features

- **Multi-select** — ⌘/Ctrl+click toggles, Shift+click selects ranges. Bulk open, move, delete.
- **Tab discard** — free RAM by sleeping inactive tabs (single or all). Native `chrome.tabs.discard`.
- **Undo switch** — 8-second toast button after every space switch, in case of misclick.
- **Pin spaces** — favourites stay at the top.
- **Emoji + note per space** — visual hint + extra context.
- **Manual reorder** — drag space cards by edge (top/bottom = reorder, middle = merge).
- **In-space tab reorder** — drag tabs within a space.
- **Search** — cross-space full-text + per-space search.
- **5 languages** — English, 简体中文, 繁體中文, 日本語, Deutsch.
- **Themes** — light / dark / follow system.
- **JSON export/import** — your data is portable.

### Privacy

- **Local-only**: `chrome.storage.local` + `chrome.storage.session`. No servers, no network calls, no analytics.
- **3 minimal permissions**: `tabs`, `storage`, `tabGroups`. No host permissions, no content scripts.
- **MIT open source** — audit the code yourself.

See [PRIVACY.md](PRIVACY.md).

---

## Quick start

1. [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/eibplkakglandhanadkmbhifedkhdmhf).
2. Click the SpaceTab toolbar icon (or press `⌘+Shift+S` / `Ctrl+Shift+S`). The manager opens in a tab.
3. In the **Current Window** panel on the left, click **Archive current window** to save your tabs as the first space (name it, e.g., "Work").
4. Click **Smart archive** to auto-cluster, or **+** to file tabs into a named space.
5. Click any space's **Switch** button — or use the command palette (`⌘K`) — to bring its tabs back instantly.

The first time the manager opens, a Welcome dialog walks through a 5-step tour. Reopen it any time via the **?** button.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘+Shift+S` / `Ctrl+Shift+S` | Open SpaceTab manager |
| `⌘K` / `Ctrl+K` | Command palette |
| `/` | Focus global search |
| `j` / `k` | Navigate space cards (in non-input mode) |
| `Enter` | Switch to focused space |
| `Esc` | Clear selection / close dialogs |

---

## Drag-and-drop legend

| Drop indicator | Action |
|---|---|
| 🟣 Violet ring | Move a tab between spaces |
| 🔵 Indigo ring | Add a current-window tab to a space (live window unchanged) |
| 🟢 Emerald ring | Merge spaces — drop card on the centre of another |
| 🟢 Emerald edge bar | Reorder — drop card on top/bottom edge of another, or drop a tab on top/bottom of a row |

When dragging multiple selected tabs, a "+N tabs" badge follows the cursor.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [WXT](https://wxt.dev) (Manifest V3) |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| UI | React 18 + Tailwind CSS v4 |
| State | Zustand (optimistic + rollback) |
| Validation | Zod |
| Tests | Vitest + `@webext-core/fake-browser` (208 tests) |
| Package manager | pnpm |

## Architecture

```
entrypoints/
  manager/        Full-page UI (the only user-facing surface)
  newtab/         Optional new-tab override (opt-in)
  vault-marker/   Static page that labels the hidden vault window
  background.ts   Service worker — keeps vault session state in sync
lib/
  schema.ts            Zod schemas for Tab / Space / Database / TabGroup
  space.ts             Pure space domain logic (no chrome.*)
  storage.ts           chrome.storage.local wrapper with corrupt-data backup
  vault.ts             Hidden window orchestration, archive/switch flows
  session-state.ts     chrome.storage.session wrapper for tab→space tagging
  live-tabs.ts         Real-time current-window tab subscription
  tab-groups.ts        Snapshot + restore Chrome native tab groups
  clustering.ts        Domain → category dictionary for smart archive
  export-import.ts     JSON serialize/parse + merge logic
  search.ts            Cross-space + in-space filtering
  commands.ts          Command palette filtering + grouping
  theme.ts             3-mode theme hook (system / light / dark)
  settings.ts          User toggles (newtab override, etc.)
  ui-utils.ts          Per-space colour palette + relative time
  i18n.ts              5-language dictionary + useT() hook
stores/
  space-store.ts       Zustand store
components/   React components (cards, dialogs, palette, …)
hooks/        React hooks
public/_locales/  Chrome Web Store i18n for extension name/description
```

The "hidden vault window" is a separate, minimised Chrome window labeled "SpaceTab Vault" via a pinned static page. Inactive spaces' tabs sit there fully loaded. Switching spaces = `chrome.tabs.move` between vault and visible window. This is the heart of the architecture.

---

## Build from source

```bash
pnpm install
pnpm build       # → .output/chrome-mv3/
pnpm zip         # → .output/spacetab-X.X.X-chrome.zip
```

Other commands:

```bash
pnpm dev         # WXT dev mode with HMR
pnpm test        # vitest run
pnpm test:watch  # vitest watch
pnpm compile     # tsc --noEmit
```

Loading the unpacked build:

1. `chrome://extensions/` → toggle Developer mode
2. Load unpacked → select `.output/chrome-mv3/`

---

## Roadmap

These are ideas, not commitments. Open an issue if any matter to you.

- BYOK AI cluster naming for smart archive (LLM-generated space titles)
- Multi-device sync (opt-in, end-to-end encrypted)
- Firefox port
- Per-space keyboard shortcut bindings

## Contributing

Bug reports and feature requests via [GitHub issues](https://github.com/tashuo/spacetab/issues). PRs welcome — please run `pnpm test && pnpm compile` before pushing.

## License

MIT

---

## 中文

把浏览器标签整理成命名的「项目空间」,通过隐藏窗口实现毫秒级切换。**完全本地、无账号、零遥测、开源免费。**

[**安装 →**](https://chromewebstore.google.com/detail/eibplkakglandhanadkmbhifedkhdmhf) · [隐私政策](PRIVACY.md)

### 它是什么

SpaceTab 处在 OneTab(轻量收纳)和 Workona(重型工作流 SaaS)之间 — 用 Workona 的架构,OneTab 的体量,完全本地 + 开源。

### 核心

- **瞬间切换空间** — 非活动空间的标签放在一个隐藏窗口里持续加载。切换 = 标签在窗口间搬动,不重新加载,不丢滚动位置。
- **智能归档** — 一键按域名 / 类别把当前窗口的标签聚类成多个空间。
- **保留 Chrome 标签组** — 颜色 + 标题在归档和切换时保留。
- **命令面板(⌘K)** — 所有操作一个按键之间。

### 进阶

多选(⌘/Ctrl+click 切换、Shift+click 选区间)、批量打开 / 移动 / 删除、标签休眠释放内存、撤销切换、空间置顶、emoji + 备注、拖拽排序、空间内标签拖拽、全局 / 空间内搜索、5 语言、深色模式、JSON 导入导出。

### 隐私

- 仅本地存储,无服务器,无网络请求,无统计
- 3 个最小权限:`tabs` / `storage` / `tabGroups`,不申请站点权限
- MIT 开源,可审计

详见 [PRIVACY.md](PRIVACY.md)。
