# Issue #11 — Windows UI evidence

The test ran in an isolated Chrome profile on `DESKTOP-JOJ9ONF`, separate from the user's personal Chrome profile:

- Profile: `C:\Users\yamas\spacetab-win-test-20261010\artifacts\profile-issue9-url-routing-v16-20261011`
- Chrome's Details page showed the registered unpacked folder as `~\spacetab-win-test-20261010\issue9-extension`.
- `chrome://extensions` showed the SpaceTab card enabled. The harness used the card's normal Reload control after deploying the final build.
- SHA-256 of `background.js` on disk and the executing Service Worker source matched: `bbddc2a59d2081cde94118036b05ac6805ec9134ea1d20c403d60dc18e187c73`.

The UI run verified the shortcut list and Chrome settings link, Ctrl+M recording and invocation, reset to Ctrl+K, focused search receiving `j`/`k` as text, storage change propagation to a second manager window, normal Chrome process exit, custom-key persistence after reopening the same profile, and a final UI reset to the default. Shortcut labels and guidance are translated for all five app languages. The dedicated Chrome process tree reached zero after both the first run and the restart. The test code made no direct storage writes or clears.

The final regression run passed 306 tests across 21 files; type-check and production build also passed. Unit tests cover IME composition flags and keyCode 229. A real IME conversion session and physical macOS keyboard were not available for this Windows-only UI run. OS/other-application conflicts remain inherently outside the extension's detection scope.

Files:

- [Windows UI result](windows-ui-result.json)
- [Windows UI harness](windows-ui-harness.mjs)
- [Enabled extension card](screenshots/extensions-enabled.png)
- [Registered extension path](screenshots/extension-details-path.png)
- [Shortcut list](screenshots/shortcut-list-default.png)
- [Edited shortcut](screenshots/shortcut-changed-final.png)
- [After normal restart](screenshots/post-restart-palette.png)
