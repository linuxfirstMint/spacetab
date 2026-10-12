# Issue #14 — native two-tab Split View

The extension uses Chrome's native `tabs.createSplit([tabA, tabB])` and `tabs.unsplit(splitViewId)` APIs. The manager exposes split and unsplit actions after selecting exactly two saved tabs. It acts only on tabs live in the manager's current window. The UI reports unavailable API support, missing live tabs, non-adjacent tabs, pin/group mismatches, existing Split View membership, and Chrome API failures. It does not move, unpin, regroup, duplicate, or navigate tabs to satisfy Chrome's preconditions.

Chrome's documented API is available from Chrome 155 and requires exactly two adjacent tabs that share window, pinned, and group state and are not already split. The implementation checks those conditions before calling Chrome.

## Validation

- 316 unit/regression tests across 22 files passed; `tsc --noEmit`, WXT production build, and `git diff --check` passed.
- Windows Chrome 155 real-profile UI run passed 16 checks covering extension reload/path, API availability, executing worker hash, selecting and splitting two dedicated local test pages, repeat-split refusal, UI unsplit, Space switching and return, non-adjacent/pinned/group/other-window refusal, repeat operation, closing one side, natural profile restart, persisted Space/tab rows, and cleanup through the UI.
- Test harness used an isolated Windows profile and only local loopback pages. It made zero direct storage writes or clears. The dedicated Chrome process tree reached zero after natural shutdown.
- `Debugger.getScriptSource` SHA-256 for the executing worker equals the deployed file hash: `8413daefc303ee09c774f8eedec678c19e19f27515cd533de00fa1b8f82b76a9`.

Evidence files:

- [Machine-readable UI result](windows-ui-result.json)
- [Windows Playwright harness](windows-ui-harness.mjs)
- [Registered unpacked path](screenshots/extension-details-path.png)
- [Split action](screenshots/split-created.png)
- [Saved Space after restart](screenshots/post-restart-space.png)

Scope is two tabs in Chrome's standard Split View. Three-way layouts and custom pane sizing are not offered.
