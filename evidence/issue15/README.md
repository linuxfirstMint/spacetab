# Issue #15 — link quick preview

Issue #15 adds a right-click action for opening an HTTP(S) link in a small top-level Chrome popup. The source page remains open. Repeated preview actions reuse the current popup. A second context-menu action opens its current HTTP(S) page as a regular tab in the source window, another normal window, or a newly created normal window when none remains. This is a separate browser window, not an embedded or Arc-style peek.

The popup and source window IDs live in `chrome.storage.session` only. The URL and page contents are not persisted by the preview feature. Closing the popup or ending the browser session clears the marker. Preview popups are excluded from automatic archiving so they are not accidentally saved into a Space. No host permission, content script, cookie access, external preview service, or framing workaround was added.

## Validation

- 328 tests across 23 files passed after the fallback fix.
- `tsc --noEmit`, WXT production build, and `git diff --check` passed.
- Windows CRD UI: a real right-click on an MDN HTTPS link initially showed only Chrome items. After reloading SpaceTab from `chrome://extensions`, its native preview menu appeared; selecting it opened MDN in a popup. A second actual right-click from the source window reused that popup.
- The regular-tab action was exercised after the source normal window had closed. The service worker logged `Could not move preview into a tab Error: No last-focused window`. The conversion handler now creates a new normal window if neither the source nor another normal window is available. The new fallback is covered by unit cases for a missing source and missing last-focused normal window.
- The corrected build was copied to the dedicated extension directory. The remote worker SHA-256 was `5CDCD6EF359408963436FA4465F4360F7C20457EC191ACCBFD8B156A91BC29FE`, matching the local built worker. The committed code passed CI: [run 38213472252](https://github.com/linuxfirstMint/spacetab/actions/runs/38213472252).

The post-fix worker has not yet been reloaded in the browser UI, so the fixed conversion path and normal Chrome shutdown/restart are not counted as real-browser passes. The machine-readable result records these limits. No PR was created, and main or the issue was not changed.
