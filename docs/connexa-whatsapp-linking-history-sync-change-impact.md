# WhatsApp QR Linking and History Synchronization — Change Impact

## Scope and invariants

- `whatsapp-web.js`, LocalAuth/session storage, existing session directories, durable per-chat checkpoints, message deduplication, SSE, pagination, and live-message handlers remain in place.
- No authentication records or saved sessions are migrated, deleted, or rewritten by this change.
- Automatic history work has one owner: the sender runtime schedules it after the `ready` event. Setup polling is read-only.

## Connection path

- The `ready` handler persists `CONNECTED` (including `connectedAt`, display name, and phone) before queueing any history work.
- The first bounded history bootstrap is queued on the next timer turn by default; it no longer adds an artificial five-second delay after `ready`.
- The setup UI no longer calls the history endpoint or waits for imported chat/message counts. It exposes an **Open Inbox** action as soon as the linked state is visible.
- Removing the UI request also removes the component-unmount/navigation cancellation boundary from background history work. The sender process and its saved WhatsApp session own the lifecycle.

## Progressive history stages

1. `fast_bootstrap`: five most-recent active chats, twenty messages per chat by default.
2. `incremental_sync`: remaining or changed chats in five-chat work units, using existing checkpoints, signatures, overlap windows, deduplication, and fenced leases.
3. `media_enrichment`: missing historical media and profile metadata. Earlier stages reuse already stored media but do not eagerly download missing historical media.

Chats are processed serially from most-recent activity to oldest activity. Within
each chat, fetched messages are normalized and persisted one at a time from
newest to oldest. Checkpoints still record the newest successfully observed
provider message, while the overlap window continues walking backward across
older history without delaying the connected state.

The stage names are additive. Legacy durable phases are still accepted, and existing checkpoints remain valid.

## Scheduling and failure containment

- Global heavy-history concurrency stays at `1` by default.
- Bootstrap work has priority over recurring work; same-priority work rotates account keys.
- A queue slot is released after every bounded work unit instead of after an account-wide reconciliation.
- Per-chat and batch timeout values remain configurable. A timed-out operation increments a client-operation fence, stops the unit, releases its lease, and restarts that client while preserving the saved session. A new operation cannot intentionally reuse the timed-out client generation.
- Deferred retry timestamps, lease generations, durable state generations, and conditional persistence checks remain authoritative.

## Incremental rollout

- `WHATSAPP_INCREMENTAL_SYNC_MODE` remains `shadow` by default.
- `WHATSAPP_INCREMENTAL_ROLLOUT_PERCENT` provides deterministic workspace bucketing when mode is `on`.
- An incremental batch with a persistent error falls back to the legacy selector for the next pass, then retries incremental mode after a successful fallback pass.
- Sync summaries compare legacy and incremental selected-conversation counts, new messages, shadow misses, incomplete transfers, duration, write time, and avoided writes.

## Inbox path

- Conversation list/detail, pagination, and SSE remain on the critical path.
- Media-library data, scheduled-message badges, and automation-derived metadata hydrate after the initial interactive render.
- WhatsApp health/count work is cached for five seconds. Inbox waits at most 300 ms for live sender health before using saved channel state; the browser refreshes background sync status afterward.

## Observability

Runtime events now timestamp QR generation, authentication, ready, history queued/started, first batch, bootstrap completion, full completion, and per-chat timeout. Sender health exposes process memory, cumulative CPU time, event-loop lag, and active Chromium process count. Sync summaries include media bytes and PostgreSQL persistence duration.

## Timing report

- Authentication/QR completion: no safe live re-link was performed because preserving successful sessions is an acceptance requirement. Structurally, history synchronization has been removed entirely from this critical path; setup observes the next 3-second status poll after `ready` persistence.
- Inbox availability: the worst-case synchronous sender-health wait is reduced from 2,500 ms to 300 ms, a 2,200 ms (88%) reduction. Media, schedule-stat, and automation queries no longer block the initial response.
- History completion: no production account was re-imported during implementation, so a real full-history before/after duration is intentionally not claimed. The new milestone events and comparison counters provide deploy-time measurement without sacrificing existing sessions.
- Verification: 34 targeted tests completed in 2.68 seconds; the production Next.js build completed successfully.

## Rollout guidance

1. Deploy with incremental mode `shadow`, global concurrency `1`, bootstrap `5`, and bootstrap message limit `20`.
2. Compare shadow misses, transfer completeness, write duration/volume, event-loop lag, CPU/RSS, and Chromium count by account size.
3. Enable `on` for a small deterministic percentage and retain fallback.
4. Increase rollout percentage only after missed-message and completeness counters remain acceptable. Do not increase global concurrency without resource measurements.

## Staging deployment verification — 2026-10-27

- Deployed `connexa-stg-web:wa-history-sync-20261027` and `connexa-stg-sender:wa-history-sync-20261027`, built from release `94845f8fa2bf4c27089eb62b9db915458d684608` plus the reviewed WhatsApp synchronization patch.
- Preserved the absolute `/app/.wwebjs_auth` bind mount. Three session directories existed before and after deployment; no QR re-link or authentication-storage mutation was performed.
- Both database-connected saved clients restored successfully. Their observed `authenticated`-to-`ready` durations were 15.21 seconds and 12.51 seconds. `CONNECTED` is now available at those `ready` milestones, independently of history completion.
- The sender-owned history scheduler began shadow reconciliation 2.90 seconds after the second client emitted `ready`; it selected 18 incremental candidates from 496 conversations and skipped unchanged metadata for 478 conversations. History continued after the web container was replaced.
- Warm smoke timings were 0.231 seconds for the local root, 0.178 seconds for local login, and 0.530 seconds for the public HTTPS root. The new deferred media endpoint returned its expected unauthenticated `401` in 0.028 seconds.
- Full-history completion was not reached during the deployment observation window and is therefore not reported as an improvement. It remains background work with durable checkpoints and new completion metrics.
- The isolated production build passed compilation, lint/type validation, page generation, and image packaging. The deployed sender image passed 23 targeted regression tests with no failures.

## QR responsiveness deployment — 2026-10-27

- Removed `router.refresh()` from QR and phone-pairing success transitions. The connected panel now renders from the tenant-scoped persisted status, shows `AUTHENTICATED` as **Authenticating**, and exposes a prominent **Go to Inbox** action while history remains a separate background status.
- Added `/api/settings/whatsapp/status`, a select-only channel snapshot with no joins, counts, history queries, or sender-health call. Connection changes are relayed over the existing workspace/channel-scoped Inbox SSE stream; visibility-aware polling is a fallback (750 ms while pairing, 15 seconds while hidden or connected). Requests are single-flight, abort on unmount, and reject older `updatedAt` snapshots.
- Added browser timing events for `UI_CONNECTED` and `INBOX_USABLE`. Reconnection takes a fresh snapshot, listeners are removed on unmount, and navigation never owns or destroys the sender runtime.
- Added a bounded pairing-priority gate for newly dispatched history units, while leaving in-flight work untouched and retaining global history concurrency `1`. Chat worklists are reused for 60 seconds and safely merge live/changed chats. Bootstrap continues to skip profile-photo and historical-media downloads.
- Deployed `connexa-stg-web:wa-qr-speed-20261027` and `connexa-stg-sender:wa-qr-speed-20261027`. Rollback tags point to the exact preceding images. Four saved session directories were present before and after replacement; three active sessions all returned to `READY`, while the pre-existing reauthentication-required record remained unchanged.
- Pre-deploy authenticated-to-ready samples were P50 **11.73 s** and P95 **25.14 s** (`n=8`). Post-deploy restored-session samples were P50 **8.89 s** and P95 **12.66 s** (`n=3`). These restored-session numbers are not presented as a fresh-QR benchmark; the last fresh QR baseline remains **10.95 s**.
- The public HTTPS root returned `200` in **0.86 s**. The minimal status route rejected an unauthenticated public request in **0.27 s** (local container path: **0.046 s**), confirming that it is independently available without a synchronous sender-health call.
- At the final restored `ready` event, instrumentation recorded event-loop lag P95 **24.2 ms**, three active Chromium roots, RSS **159.9 MB**, and zero active history jobs. A concurrent-import container snapshot reached 306% CPU, so heavy-history concurrency remains `1`.
- No authenticated browser opened onboarding after this rollout, so `ready → UI connected` and `connected → Inbox usable` do not yet have honest post-deploy browser samples. No new account was imported, so the previous fresh-link `ready → first batch` baseline of **11.95 s** has no comparable post-deploy value yet. The new durable timing events will capture those values on the next scan without synthetic data or session deletion.
- Verification passed the production Next.js build, TypeScript validation, diff checks, 24 deployed-image wiring/UI tests, and 18 runtime/history lifecycle tests. Existing CSS/lint warnings remain non-blocking.

## Final sub-five-second handoff deployment — 2026-10-27

- Deployed `connexa-stg-web:wa-sub5-final-20261027` and `connexa-stg-sender:wa-sub5-final-20261027`. Exact rollback images are tagged `rollback-before-wa-sub5-final-20261027` for both services.
- The sender now emits display/phone/connected fields and a connection-attempt correlation ID in the existing tenant/channel-scoped connection event. Onboarding applies that event directly, while the lightweight status snapshot remains the reconnect and polling fallback. Event and snapshot timestamps share the existing stale-response guard.
- `AUTHENTICATED` remains visibly **Authenticating**, not Connected, but immediately shows a **Continue to Inbox** action. Sending is still gated by genuine `ready`; navigation neither owns nor tears down the sender client.
- An in-flight history unit now cooperatively yields after its current chat if another account enters an interactive pairing state. It retains its cursor/checkpoints, releases the normal work-unit slot, and retries through the existing sender-owned scheduler. Global heavy-history concurrency remains `1`.
- Added monotonic post-authentication stage timing for helper injection, account metadata, and the remaining listener/ready interval, plus event-loop utilization, process CPU, page faults, RSS, active history jobs, and Chromium roots under the same connection-attempt ID.
- Three successful saved sessions were restored without relinking or deleting auth state. Four auth directories existed before and after deployment. The fourth unfinished QR-only record transitioned to `REAUTH_REQUIRED` on sender restart as designed; it was not a previously successful session.
- Restored-session authenticated-to-ready samples were **4.139 s**, **8.333 s**, and **21.370 s**: P50 **8.333 s**, P95 **21.370 s** (`n=3`, nearest-rank). All had zero active history jobs. This is not a fresh-QR benchmark and does not establish a sub-five-second genuine-ready result.
- Stage timing isolated the current tail: helper injection P50/P95 **2.894/3.160 s**, account metadata **3.962/8.861 s**, and the post-metadata listener/ready interval **4.371/12.509 s**. The 21.370-second sample spent 12.509 seconds after account metadata, so Connexa history and database work were not its cause.
- After restoration, sender health reported three warm connected runtimes, three Chromium roots, no initializing/authenticated runtime, RSS **166.6 MB**, event-loop lag P95 **26.6 ms**, and one background history job with concurrency still capped at one.
- The production Next.js build completed compilation, lint/type validation, page generation, and image packaging. The combined deployed-image channel, QR/SSE, runtime, and history reliability suite passed 40/40 tests. Existing repository lint warnings are non-blocking and unchanged in nature.
- No authenticated browser performed a fresh scan during this deployment. Therefore fresh QR scan-to-authenticated, authenticated-to-visible handoff, connected-to-Inbox-usable, and first-batch P50/P95 are intentionally not claimed; the next real scan will populate the added correlated timing events.
