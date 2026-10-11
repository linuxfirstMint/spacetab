# SpaceTab cross-device Space sync design

**Status:** design only; no sync implementation is enabled by this document

**Baseline reviewed:** `feat/arc-spaces` at `f9d7caf69de90beb2fdfc6882395a15510f7bb7c`

**Scope:** Chrome extension profiles and their SpaceTab data. This does not replace Chrome's tab bar and does not isolate cookies by Space.

## Recommendation

If automatic sync is pursued, start with an explicit, opt-in Chrome Sync adapter backed by `chrome.storage.sync`, while keeping `chrome.storage.local` as the source of truth for local use. It uses the already-requested `storage` permission and Chrome's signed-in profile sync rather than a SpaceTab server, OAuth flow, account system, or new permission. Make the trust boundary clear before opt-in: the selected Space metadata, URLs, and titles leave this device through Chrome Sync; SpaceTab does not provide application-level end-to-end encryption.

This is a constrained first step, not a promise that every library will fit. Chrome documents a 102,400-byte total quota, 8,192 bytes per item, 512 items, 120 writes/minute, and 1,800 writes/hour. Large Spaces will exceed the per-item quota if stored whole; the database will exceed the total quota as it grows. Before enabling or applying any remote change, preflight the complete serialized payload against these limits with a safety margin. If it will not fit, keep all data local, report that sync is unavailable because of capacity, and provide manual Export as the user-controlled transfer path. Never silently drop Spaces, tabs, or Favorites to make it fit.

The design is viable only if product accepts a hard capacity ceiling and possible eventual local-only operation. If supporting a large, unbounded collection is a requirement, select a separately reviewed encrypted sync service and its account, key recovery, cost, retention, and privacy model before implementation. Do not start that service or connect an account as part of this design issue.

## Existing behavior and data

SpaceTab persists the database under the `db` key in `chrome.storage.local`; profile-wide Favorites have their own `favorites` key. The current schema has Spaces with URL/title tabs, optional favicon URLs, `currentUrl`, Space pin/folder membership, group keys, Space name/emoji/color/note/pin/order/timestamps, group title/color, flat folder names/collapse state, and Favorites (URL/title/optional favicon). The current database schema version is 1. Storage-local data remains device/profile-local unless the user manually moves it.

Manual JSON Import/Export is a user-initiated snapshot transfer. Export downloads a JSON file; the user chooses where to transfer it and when to import it. Import supports Merge or Replace. Merge adds unknown Space IDs and replaces an existing whole Space only when the incoming `updatedAt` is later; Favorites are merged. Replace overwrites the database. Neither mode continuously propagates edits or deletions, and the current merge rule is not a multi-device conflict protocol. A JSON file is readable by anyone who can read that file.

Automatic sync would be an ongoing replicated copy: after explicit opt-in, changes would flow through Chrome Sync whenever Chrome profile sync is available. The destination is Chrome Sync for the signed-in Chrome profile, not a SpaceTab-operated server. Availability depends on Chrome sync being enabled and the same SpaceTab extension being installed in the relevant Chrome profiles. Developer/unpacked builds can have a different extension ID from the store build, and each browser profile has separate local state. Installation, profile, Chrome account, and sync-state mismatches must be explained in the UI; sync must never be inferred merely from Import/Export use.

## Data boundary

| Include in an opted-in Space sync | Exclude |
| --- | --- |
| Space ID and user-authored Space metadata: name, emoji, theme color, note, pinned state, order, created/updated times | Chrome `tabId`, `windowId`, `groupId`, active-window mappings, vault-window IDs, focus/last-active selection, runtime/session state |
| Saved tab URL and title; optional favicon URL; saved/current destination URL; Space pin, folder ID and logical group key | Cookies, session tokens, browsing history, page contents, form inputs, passwords, autofill, or any data read from a page |
| Logical group definitions (key, title, color), flat folder definitions (ID, name, collapsed state), and Favorites URL/title/favicon | Open tab/window state, native Chrome tab/window/group identifiers, per-device diagnostics, ephemeral auto-archive queue/state, or unrelated browser settings |

URLs and titles can reveal browsing interests, work projects, and private document names even without page content. Favicon URLs can identify sites. `currentUrl` also contains a URL. The opt-in copy must enumerate these fields and name Chrome Sync as the recipient. Chrome's Storage API documentation describes use of Chrome Sync but does not establish an app-provided end-to-end encryption guarantee; SpaceTab must not claim E2EE or treat a synced value as secret from the sync provider. `setAccessLevel('TRUSTED_CONTEXTS')` should be applied to sync storage to avoid exposing the area to content scripts by default, but this only narrows extension-context access and does not encrypt the synced content.

## Candidate behavior if implementation is approved

1. **Off by default.** Local storage continues to work unchanged. A settings toggle starts a disclosure/consent screen. It explains the fields and destination above, Chrome account/profile prerequisites, capacity cap, and how to pause and remove this device's sync copy.
2. **Bootstrap is deliberate.** When enabling on a profile with local data, compare local and remote state first. If remote state is empty, offer to seed from this device. If it is populated, show a preview and ask for Merge or Replace; never pick a side silently. Apply the chosen initial state only after the full resulting payload passes the quota preflight.
3. **Local-first and bounded.** Continue writing to `storage.local` first. Serialize only the allowlisted schema, validate it, and measure Chrome's JSON/key quota usage. A conservative initial active-generation target is 40 KiB, leaving room to stage a second generation and metadata under the 100 KiB hard cap; always preflight the exact combined active + staged + tombstone footprint rather than relying on the target alone. Divide sync records into bounded items; split a large Space by tab chunks if that is retained as a supported shape. Keep under both the item and item-count limits. Publish/apply a generation only after all of its records are written and validated; Chrome storage operations across keys are not a transaction. Use generation metadata so readers ignore incomplete generations. If any write fails, preserve local state and the prior complete remote generation, show “local changes not synced”, and retry with backoff rather than looping or deleting the prior copy.
4. **Conflicts are per logical Space.** Use stable Space IDs. For simultaneous edits to different Spaces, retain both. For the same Space, compare a logical revision `(updatedAt, deviceId)` and choose the greater tuple deterministically; expose a conflict notice and retain a recoverable prior copy. Device wall clocks can be skewed, so `updatedAt` alone is insufficient. Edits within one Space are whole-Space last-writer-wins in the first version, not field-level merges. This policy and conflict copy format require validation before implementation.
5. **Deletes are data.** Represent each deleted Space with a tombstone containing its ID and revision; do not interpret absence from one device as deletion. Keep tombstones until all active devices have acknowledged the deletion, or until the user explicitly resets that sync set. Chrome Sync offers no application-level acknowledgement from every offline device, so safe automatic tombstone expiry cannot be assumed; this limitation consumes the same small quota. Removing one synced record without a tombstone can resurrect a stale Space when an offline device returns.
6. **Offline and interruption.** Local edits remain available offline and mark the device pending. Chrome Sync queues offline storage changes and resumes when online, but app code must still handle quota/API failures and partial multi-key writes. On reconnect, validate and reconcile a complete generation before exposing it; show stale/pending/error status. Local read/write failure must not be disguised as successful sync. The extension must not block Space switching while the network is unavailable.
7. **Disable and revoke.** Pause stops new sync writes and incoming application while preserving local data. “Remove this device's synced copy” requires an explicit confirmation and removes this device's extension sync keys; describe that another offline device may later republish stale data unless the shared dataset is reset with tombstones. Disabling Chrome Sync is controlled by Chrome and makes the area local-only there; SpaceTab reports that condition rather than trying to change Chrome settings. Full revocation/reset semantics across devices need a user decision because there is no SpaceTab account/server to issue a revocation epoch.
8. **Schema evolution.** Keep sync envelope version separate from `DatabaseSchema.version`. Reject unknown future versions without overwriting local data; preserve/export the unknown remote payload where possible and tell the user an update is needed. Migrate a copy, validate it, preflight it, then publish a new complete generation. Never destructively migrate the only copy. Keep current local version-1 reads working when sync is not enabled.

## Capacity check (synthetic, local only)

A Node-only sizing exercise built ten fictional Spaces with ten fictional tabs each and twelve fictional Favorites. Each tab included the current optional URL/title/favicon/currentUrl/pinned/folder/group fields; each Space included representative name, note, emoji/color, timestamps, pin/order, one group, and one folder. All URLs used `example.invalid`; no browser profile, Chrome storage area, network endpoint, account, or real user data was accessed.

| Payload | UTF-8 bytes of compact `JSON.stringify` | Result against documented limit |
| --- | ---: | --- |
| Whole synthetic Database (`db`) | 31,576 | Fits 100 KiB total by itself; fails 8 KiB single-item cap |
| One item per Space + one Favorites item | 10 Spaces at 2,973–3,003 bytes each; Favorites 1,543 bytes; 11 items | Fits the per-item and item-count limits; uses about 30,000 bytes before key names/envelope overhead |

This confirms that the existing single `db` storage shape cannot simply be copied as one sync item, while ordinary small Spaces can fit when split. It does not establish capacity for real collections or guarantee sync acceptance: the API quota calculation includes the key length and Chrome's documented JSON representation, and the actual payload has envelope/generation overhead. The implementation must measure its encoded allowlisted payload at runtime and fail closed. A synthetic payload near 100 KiB, an individual item over 8 KiB, 512 items, write throttling, and partial writes must be covered by local-only tests before rollout.

## Options considered

| Option | Advantages | Costs and limits | Assessment |
| --- | --- | --- | --- |
| `chrome.storage.sync` (recommended only for a bounded opt-in first version) | Native Chrome profile sync; no SpaceTab backend/OAuth; works with existing `storage` permission; offline queueing | 100 KiB/8 KiB/512-item ceilings; same-account/profile and extension-ID prerequisites; no app-provided E2EE; multi-key writes are not transactional; tombstones/old clients consume quota | Smallest product/service surface, but not suitable for unbounded libraries. Require preflight, clear quota failure, and local fallback. |
| User-managed JSON file (current Import/Export) | Transparent, portable, no automatic cloud destination chosen by SpaceTab; current Merge/Replace path already exists | Manual and snapshot-based; the file can be copied to arbitrary cloud storage and read as JSON; no background conflict/deletion protocol | Safest default and fallback. Keep available regardless of future sync choice. |
| SpaceTab-operated encrypted sync service | Can support larger datasets, explicit accounts/devices, richer conflict and revocation semantics | New service, authentication/OAuth, server operations/cost, new permissions/secrets, retention/security response obligations; must design client-side key generation, recovery and E2EE before claiming privacy | Appropriate only if broad/unbounded sync is a committed requirement and product accepts that operational burden. Separate approval and design required. |
| Shared filesystem/cloud-drive file watching | Potentially familiar destination and larger capacity | Browser extension APIs do not provide a portable, reliable cross-device watched-file abstraction; cloud-drive connector/OAuth or native helper is required; concurrent file writes and recovery are hard | Not recommended as a first extension implementation. |

## Decisions required before implementation

1. Is the 100 KiB Chrome Sync ceiling an acceptable limit, with sync pausing before the safety threshold and a clear local-only status, or is larger/unbounded sync a requirement?
2. Is Chrome Sync's provider trust boundary acceptable for URLs and titles, given that SpaceTab will not provide application-level E2EE? If not, defer auto-sync pending an E2EE service and key-recovery design.
3. On an existing remote dataset, should initial setup offer Merge and Replace exactly as Import does, or default to no action until a choice is made? Recommendation: require an explicit choice.
4. Is whole-Space last-writer-wins acceptable for same-Space conflicts, with a recoverable conflict copy, or is field/tab-level merge required?
5. How should users retire offline devices and reset tombstones when Chrome Sync cannot confirm that every device has observed a deletion? Recommendation: make sync-set reset explicit and do not expire tombstones silently.
6. Should `currentUrl` be synced alongside the saved `url`? It is a second destination URL and may be useful for restoring navigated tabs, but also increases sensitivity and payload size.

## References

- [Chrome Storage API: areas and limits](https://developer.chrome.com/docs/extensions/reference/api/storage) — sync behavior, offline resumption, context access, item/byte/write limits, and failure behavior. Accessed 2026-10-11.
- [Chrome StorageArea API](https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea) — access-level configuration and storage operations. Accessed 2026-10-11.
- [SpaceTab issue #8](https://github.com/linuxfirstMint/spacetab/issues/8) — design acceptance criteria and out-of-scope actions.
- [Arc overview](https://arc.net/) — product reference for Spaces; this document does not assume or claim any particular Arc sync implementation.
