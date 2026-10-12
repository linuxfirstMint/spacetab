# Issue #15 — link quick preview

Issue #15 adds a right-click action for opening an HTTP(S) link in a small top-level Chrome popup. The source page remains open. Repeated preview actions reuse the current popup. A second context-menu action opens its current HTTP(S) page as a regular tab in the source window (or another normal window if the source has closed). This is a separate browser window, not an embedded or Arc-style peek.

The popup and source window IDs live in `chrome.storage.session` only. The URL and page contents are not persisted by the preview feature. Closing the popup or ending the browser session clears the marker. Preview popups are excluded from automatic archiving so they are not accidentally saved into a Space. No host permission, content script, cookie access, external preview service, or framing workaround was added.

## Validation

- 325 tests across 23 files passed.
- `tsc --noEmit`, WXT production build, and `git diff --check` passed.
- On the dedicated Windows Chrome profile, the rebuilt extension started with the new `contextMenus` permission in its loaded manifest. The profile had no pre-existing Chrome processes before the harness started, and all test Chrome processes were gone after each run.
- The SSH-launched Windows UI session did not expose the native context menu items through UI Automation. The harness therefore could not confirm selecting the preview item, redirect handling, repeated-popup reuse, or regular-tab conversion on Windows. Those flows must not be counted as real-browser passes. No permission prompt appeared.

The machine-readable Windows result records the verified manifest and cleanup state. The harness is retained to make the UI attempt reproducible.
