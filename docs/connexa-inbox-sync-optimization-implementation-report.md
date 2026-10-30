# Connexa Inbox Sync Performance Optimization — Implementation Report

Implementation date: 20–21 October 2026 (Malaysia time, UTC+8)  
Branch: `codex/inbox-sync-performance-optimization`  
Starting revision: `80f397aa6e25` plus the pre-existing uncommitted working tree  
Deployment scope: staging only; production was not changed

## A. Executive summary

All three implementation phases are present in the working tree and the web and sender services have been built and deployed to staging. The deployment preserves the existing WhatsApp LocalAuth data and sessions. No message history was deleted and no production service or production data was changed.

The main results are:

- Inbox status now distinguishes `initial_import`, `catch_up`, `reconcile`, `idle`, `deferred`, `error`, and `disconnected`, with a separate `active` flag. Animation occurs only while a leased job is active. An expired lease converts an interrupted durable job to a non-animated deferred state.
- The conversation list and selected conversation use separate, purpose-built queries. Conversation and message results use stable keyset pagination rather than loading the entire history.
- SSE is the primary Inbox update path. Event bursts are coalesced, acknowledgement events update local state directly, hidden tabs defer refreshes, and a jittered 90–105 second fallback replaces the former eight-second broad polling loop.
- Historical message IDs are batch-classified before media extraction. Complete stored media is not downloaded again; failed/incomplete media remains eligible for repair.
- Message envelopes and message/contact/conversation state use conditional updates, including PostgreSQL `IS DISTINCT FROM`, so unchanged records no longer receive unconditional writes.
- History work has sender-wide bounded concurrency (default one), per-channel single-flight, an expiring database lease, owner/generation fencing, wall-clock budgets, retry/backoff, and scheduling jitter.
- Durable channel state and per-chat checkpoints survive sender, Chromium, and web restarts. Checkpoints record successful boundaries and deferred identity work without advancing past failed ingestion.
- A metadata-signature/checkpoint incremental path is implemented behind `WHATSAPP_INCREMENTAL_SYNC_MODE`. Staging remains in the safe default `shadow` mode while the legacy selection remains authoritative. `on` mode changes routine reconciliation to a 30-minute default and retains a daily deep audit.

The focused regression suite passes 50/50. Prisma format, validation, and client generation pass. The production Docker build passes Next compilation and type validation. Staging health checks return HTTP 200 for web login, sender liveness, and sender readiness.

## B. Before-and-after architecture

### Before

```text
Visible Inbox tab
  -> every 8 seconds: broad conversation/inbox assembly
  -> every 8 seconds: unbounded selected conversation
  -> every 8 seconds: history status
  -> SSE events trigger more broad refreshes

Each sender channel
  -> enumerate every WhatsApp chat
  -> choose 24 chats
  -> fetch up to 200+ messages per chat
  -> resolve profile/media before database deduplication
  -> rewrite envelopes/contact/conversation state
  -> keep cursor/status only in process memory
  -> repeat, normally every 3 minutes
```

### After

```text
Live inbound/outbound events (priority path, independent of web browser)
  -> message ingestion and automation
  -> scoped SSE event
  -> small/coalesced Inbox update

Inbox recovery path
  -> visibility/focus-aware fallback every 90–105 seconds
  -> paginated conversation list + selected 50-message window + status
  -> ETag/304 for unchanged first-page conversation lists

History reconciliation (low-priority path)
  -> sender-wide queue (default concurrency 1)
  -> per-channel single-flight
  -> expiring DB lease + owner/generation fence
  -> durable phase/state generation
  -> lightweight chat metadata/signature comparison
  -> checkpoint candidate selection (shadow or authoritative)
  -> bounded message fetch with overlap/trusted provider-ID boundary
  -> tenant/channel-scoped batch lookup of stored provider IDs/media state
  -> process only new, changed, or repair-needed messages
  -> conditional database persistence
  -> advance checkpoint only after successful persistence
  -> durable completion/deferred state and scheduled retry
```

The sender remains independent from the Next.js web process. Closing or logging out of Connexa removes browser polling/SSE but does not stop server-side WhatsApp event handlers, outbound workers, or reconciliation.

## C. Phase-by-phase implementation

### Phase 0 — baseline and safeguards

- Read and used `docs/connexa-inbox-sync-root-cause-performance-investigation.md` as the baseline.
- Created branch `codex/inbox-sync-performance-optimization` from revision `80f397aa6e25`.
- Captured container/runtime measurements and confirmed the documented 24-chat/200-message broad batch behavior and the approximately 22.5 GET/minute selected-Inbox request pattern.
- Preserved the existing dirty worktree. It contained extensive overlapping user changes and generated/upload deletions before this task, so no reset, cleanup, or destructive Git operation was performed.
- Confirmed staging and production separation. Only `docker-compose.stg.yml` services and the staging database were touched.

### Phase 1 — status, APIs, pagination, and realtime

Primary files:

- `lib/inbox-pagination.ts`: stable base64url cursors containing `(timestamp,id)` and bounded page-size parsing.
- `lib/db-conversations.ts`: tenant/channel-scoped keyset queries for conversation pages and message pages.
- `lib/conversations.ts`: bounded recent-message detail loading and conversation-scoped teammate/reaction work.
- `lib/inbox-conversation-list.ts`: lightweight list formatting and deterministic list versions for ETags.
- `app/api/conversations/route.ts`: purpose-built paginated list with `ETag` and `304 Not Modified` support.
- `app/api/conversations/[id]/route.ts`: purpose-built selected-conversation detail.
- `app/api/inbox/unread-summary/route.ts`: compact dashboard notification count.
- `app/api/inbox/history-sync-status/route.ts`: explicit phase, active state, progress, counters, timestamps, and error data.
- `components/inbox-workspace.tsx`: paginated state merging, load-more behavior, scroll preservation, SSE coalescing, direct acknowledgement updates, visibility-aware fallback/focus recovery, and overlapping-request prevention.
- `components/inbox/queue-panel.tsx`, `components/inbox/thread-panel.tsx`, `components/inbox/types.ts`: conversation/message page controls and contracts.
- `components/inbox/status-strip.tsx`: explicit non-animated queued/idle/deferred/error display and animation only for active work.
- `components/dashboard-notifications.tsx`: compact unread endpoint and 60-second non-Inbox fallback instead of broad eight-second conversation polling.
- `lib/inbox.ts`, `lib/whatsapp-health.ts`, and `lib/sender-service-client.ts`: scoped aggregation and the new status contract.

The initial message window is 50 messages. Older messages and older conversations are loaded on demand with keyset cursors. Ordering uses the timestamp and ID together to remain stable when timestamps match.

### Phase 2 — early deduplication, conditional persistence, and resource limits

Primary files:

- `lib/whatsapp-web.ts`: preloads existing provider IDs/media state before extraction, skips complete historical media, retains incomplete-media repair, records privacy-safe per-batch metrics, and applies time/resource limits.
- `lib/whatsapp.ts`: consumes preloaded message state; conditionally updates changed messages, contacts, conversations, and chat state; avoids repeated inbound recounting for already-hot leads; preserves manual names/tags and monotonic last-interaction semantics.
- `lib/whatsapp-message-envelope.ts`: conditional conflict updates and an explicit `written` result.
- `lib/whatsapp-history-resource-control.ts`: sender-global queue/concurrency and per-channel single-flight telemetry.
- `.env.example`: documented history budgets, scheduling, incremental mode, and profile-photo cache controls.

Default controls:

| Control | Default |
| --- | ---: |
| Sender-wide heavy history concurrency | 1 |
| Per-channel concurrency | 1 (single-flight) |
| Per-operation timeout | 30 seconds |
| Per-chat timeout | 120 seconds |
| Batch wall budget | 180 seconds |
| Lease TTL | at least 300 seconds and at least wall budget + 60 seconds |
| Schedule jitter | up to 30 seconds |
| Retry base / maximum | 15 / 120 seconds |
| Deferred retry | 300 seconds |
| Positive / negative profile cache | 300 / 30 seconds |

### Phase 3 — durable checkpoints and incremental architecture

Primary files:

- `prisma/schema.prisma`: `WhatsAppHistorySyncState`, `WhatsAppHistoryCheckpoint`, and `WhatsAppHistoryLease`, all tenant/channel scoped.
- `prisma/migrations/20261020170000_inbox_sync_optimization/migration.sql`: additive tables, indexes, unique keys, and foreign keys; no drop, truncate, or message rewrite.
- `lib/whatsapp-history-sync-state.ts`: durable phase/progress, checkpoint success/failure, metadata signatures, incremental selection policy, tenant-scoped stored-message batch lookup, expiring leases, and generation fencing.
- `lib/whatsapp-web.ts`: resumable initial import, catch-up, reconciliation, checkpoint seeding, overlap boundaries, daily audit eligibility, unresolved `@lid` deferral, and post-persistence checkpoint advancement.

The modes are:

- `off`: legacy candidate selection and three-minute cadence; Phase 2 deduplication/resource safety remains active.
- `shadow` (default and current staging setting): compute/record incremental candidates and checkpoints, but retain legacy candidate selection and the three-minute cadence as authoritative.
- `on`: metadata/checkpoint candidate selection is authoritative; unchanged chats are skipped; overlap defaults to 50 messages; routine reconciliation defaults to 30 minutes; deep audit defaults to daily.

The initial import resumes from completed per-chat checkpoints. `@lid` chats without a safe phone identity are checkpointed as deferred with a retry time instead of being silently skipped or incorrectly merged. Self/status/newsletter and group/direct behavior retain the existing category rules.

## D. Performance comparison

### Frontend requests

| Measurement | Before | After | Result |
| --- | ---: | ---: | ---: |
| Selected visible Inbox, idle fallback | about 22.5 GET/min/tab | about 1.85 GET/min/tab | about 91.8% fewer |
| Conversation detail payload | all messages | newest 50, older on demand | bounded |
| Conversation list | full broad inbox assembly | purpose-built keyset page, ETag/304 | bounded/cached |
| Non-Inbox notification refresh | broad conversation model every 8s | compact unread summary every 60s | substantially smaller and less frequent |

The after request rate is code-derived: three recovery resources per average 97.5-second interval. Immediate updates still arrive by SSE and therefore do not wait for that fallback. Authenticated browser request timing was not available, so no invented latency or p95 figure is reported.

### Staging sender batch observation

The first post-deploy shadow batch processed 24 of 467 chats in 137,205 ms:

| Counter | Observed |
| --- | ---: |
| Message objects fetched | 285 |
| Already-known messages | 271 |
| Existing messages updated | 2 |
| Existing messages skipped | 269 |
| Database writes avoided | 576 |
| Media downloads avoided | 2 |
| Media attempts / failures | 53 / 53 |
| Deferred identities | 1 |

Subsequent shadow observations demonstrated metadata filtering while legacy selection remained authoritative. Examples included 438 of 467 chats and 461 of 1,015 chats classified unchanged by signature/checkpoint metadata. Across the two observed workspaces, 933 durable checkpoints were present (931 complete, 2 deferred) after the extended run.

These staging counters demonstrate reduced writes and candidate classification, but they do not prove the final `on`-mode steady-state CPU reduction because staging intentionally remains in `shadow` mode.

### CPU and memory

| Point-in-time snapshot | Sender CPU | Sender memory | Qualification |
| --- | ---: | ---: | --- |
| Investigation active reconciliation | 27.68–300.24% | 1.066–1.182 GiB | Includes Chromium; three CPU samples |
| First post-deploy shadow catch-up | 39.62% | 1.089 GiB | Active checkpoint-seeding batch; not an idle comparison |
| Extended observation after runtime idle eviction | 0.02% | 263.6 MiB | No Chromium child; not comparable to active reconciliation |

The deployed code exposes batch duration, chats/messages processed, known/new/updated/skipped messages, media attempts/failures/avoided/bytes, writes avoided, resource queue depth, and active job counts. A controlled before/after replay with identical account/runtime state is still required to quantify average CPU and memory improvement. The snapshots above must not be interpreted as a controlled percentage improvement.

### Targets

- Approximately 90–95% idle Inbox request reduction: met by code-derived request cadence (91.8%).
- Paginated conversation history: met (50-message initial window).
- Repeat download of already-complete historical media: prevented by classification and covered by regression checks; incomplete media remains repairable.
- Unchanged envelope updates: conditional and skipped; the first batch recorded 576 total writes avoided.
- Avoid unchanged routine message fetches: implemented, but authoritative only in `on`; shadow evidence is still being collected.
- Accurate status: met, including stale/expired-lease handling.
- Zero missed/duplicate messages: no regression found in focused tests and staging observation; longer controlled replay remains required before enabling `on` in production.

## E. Message integrity and reliability

- Provider message IDs and tenant/channel scope remain the primary deduplication boundaries.
- Existing message state is batch-loaded only within the selected workspace/channel.
- Checkpoint success is written after message persistence completes. Failed, timed-out, unresolved-identity, or lease-lost chats receive a deferred/failure checkpoint and do not advance a trusted boundary.
- Timestamp is not used alone. Signatures include stable chat identity/activity data, message walking uses provider IDs, ordering uses timestamp plus ID, and authoritative incremental mode retains an overlap window and periodic deep audit.
- Expiring leases prevent permanent lockout after a crash. Owner and lease generations prevent an old sender from persisting after a replacement acquires ownership. Durable state generations prevent stale progress/final writes.
- Durable `active=true` is accepted by readers only while a matching, unexpired database lease exists. An abrupt sender exit therefore cannot leave the Inbox animation running forever.
- Complete stored media bypasses extraction. Missing/incomplete media continues through the repair path.
- Conditional updates preserve legitimate acknowledgement, edit, deletion, reaction, quote, and media-repair changes while avoiding unchanged updates.
- Manual contact/tag overrides are retained. Older history cannot move last-interaction timestamps backwards.
- Historical ingestion retains the existing no-duplicate-automation behavior; live inbound ingestion remains the automation trigger path.
- Live event handlers, outbound workers, and background synchronization are server-owned. They continue when the Connexa browser is closed.
- Manual disconnect and reauthentication-required states are not automatically overridden by the optimization.

During extended staging observation, one WhatsApp Web client emitted provider `LOGOUT` followed by a detached-frame rejection. Docker restarted the sender and restored the other eligible saved runtime without deleting LocalAuth data. This is not evidence of a data-integrity failure, but it remains an operational reliability risk in the upstream browser/client lifecycle and should be monitored separately.

## F. Tests and validation

### Passed

- Focused Node regression suite: 48/48 passing.
- Cursor/resource-control executable tests: 2/2 passing.
- Total focused result: 50/50 passing.
- Broad JavaScript repository suite: 209/222 passing. The 13 failures are outside the Inbox/history optimization paths and cover pre-existing dirty-worktree expectations in account deletion/billing, campaign create/list wiring, billing PDF layout, expired-billing layout, and package-history modal UI.
- Prisma `format --check`: passed.
- Prisma `validate`: passed.
- Prisma client generation: passed.
- Production Docker build for `web` and `sender`: passed. Next.js compiled, type-validity checks completed, and static pages were generated. Only existing CSS Autoprefixer mixed-support warnings were emitted.
- `git diff --check` for the implementation: passed.
- Staging migration objects verified present.
- Staging `/login`, sender `/health`, and sender `/ready`: HTTP 200.
- Sender readiness reported the restore sweep complete and no watchdog error after deployment.
- Saved runtime restoration was observed; no QR relink or LocalAuth reset was performed.

Covered behaviors include status phases/animation, pagination/query scoping, realtime/fallback behavior, early media deduplication, conditional writes, additive migration safety, leases/fencing, shadow mode, unresolved identity deferral, runtime restart/catch-up semantics, and sender-wide concurrency/single-flight.

### Known quality-gate limitations

- Standalone `npm run typecheck` still reports pre-existing test-fixture/configuration failures unrelated to this work: TS5097 import-extension errors in several tests, missing fixture properties (`accountDeactivatedAt`, `packageExpiryLabel`), a workspace-package fixture type mismatch, and a profile-test regex target. No new app/lib/component/prisma source error was reported before the final Docker build; the Next production build's source type validation passed.
- The broad JavaScript suite is not fully green: 209 passed and 13 unrelated UI/billing/campaign tests failed. The focused 50-test optimization suite is green, and no broad-suite failure names an optimization source or regression test.
- `npm run lint` invokes the removed/interactive `next lint` workflow in this Next.js version and the repository has no usable non-interactive ESLint configuration. The production build's lint/type stage was used where supported.
- Authenticated visual Inbox interaction and browser timing were not available without user credentials. The staging page and backend health were verified, but no fabricated UI timing is reported.
- The task-specific migration was applied directly and transactionally, then recorded with `prisma migrate resolve`, because the staging database has 26 historical migrations whose schema exists but whose Prisma ledger entries are missing. A blanket `prisma migrate deploy` would have been unsafe. That historical ledger drift remains separate follow-up work.
- Full real-world coverage of fresh/500+ chat accounts, two concurrent sender replicas, deliberate Chromium crashes at every checkpoint boundary, and edited/deleted/reaction replay requires a dedicated staging harness and longer observation.

## G. Deployment and rollback

### Staging deployment performed

1. Applied only `20261020170000_inbox_sync_optimization` in a PostgreSQL transaction.
2. Recorded that migration as applied in Prisma's migration ledger.
3. Built `connexa-stg-web:develop` and `connexa-stg-sender:develop`.
4. Recreated only the staging `web` and `sender` services with no dependency/volume recreation.
5. Left `WHATSAPP_INCREMENTAL_SYNC_MODE` unset in staging, which resolves to `shadow`.
6. Verified HTTP health/readiness and saved-session restoration.

### Immediate behavioral rollback

Set:

```dotenv
WHATSAPP_INCREMENTAL_SYNC_MODE="off"
```

Then rebuild/restart the sender. This immediately restores legacy candidate selection while retaining safe early deduplication, conditional writes, resource limits, and existing checkpoints. No checkpoint or message deletion is required.

### Code/image rollback

Redeploy the previous web/sender images. The migration is additive and old code does not depend on the new tables, so the tables should be left in place during rollback. Do not drop them during an incident; doing so is unnecessary and would discard useful recovery state. Existing message, conversation, contact, media, and LocalAuth data are unchanged by the schema migration.

### Per-phase rollback notes

- Phase 1: roll back web code/image. API and cursor changes have no destructive database dependency.
- Phase 2: roll back sender code/image. Conditional writes and resource controls require no data rollback.
- Phase 3: set mode to `off` first, then roll back sender code if needed. Leave additive state/checkpoint/lease tables intact.

## H. Remaining risks and activation criteria

1. Keep production in `shadow` or `off` until shadow comparisons show no legacy-selected chat with new/changed data is omitted by incremental selection over a representative observation window.
2. Run controlled replay for missed events, restart mid-write, same-timestamp/out-of-order data, edits/deletions/reactions/acks, media repair, group and `@lid` cases, and two replicas.
3. Compare steady-state `shadow` and controlled `on` mode with the same account state. Record batch p50/p95 duration, Chromium/sender CPU and RSS, fetched messages, media bytes, and PostgreSQL writes.
4. Investigate the upstream detached-frame rejection following provider logout; verify it cannot turn a routine client teardown into repeated sender-wide restarts.
5. Repair the historical staging Prisma migration ledger before relying on blanket automated migration deployment.
6. Add a supported non-interactive lint configuration and repair the pre-existing standalone typecheck fixtures.
7. Observe the two deferred identity checkpoints. They should resolve/retry without merging unrelated contacts or blocking other chats.

Recommended production activation gate: at least one full deep-audit interval in staging shadow mode, controlled restart/replay tests with zero missed or duplicate messages/automations, and a reviewed rollback drill. Activation is then a configuration change to `WHATSAPP_INCREMENTAL_SYNC_MODE=on`, not a schema change.

## I. Final verification answers

1. **Does the indicator represent actual synchronization accurately?** Yes. It uses explicit phases and a separate `active` flag; only an active job with an unexpired lease animates. Waiting, deferred, error, and disconnected states do not masquerade as active work.
2. **Does routine synchronization still scan all chats and refetch old messages unnecessarily?** In current safe `shadow` mode, legacy selection remains authoritative, so broad selection can still occur while evidence is collected. In `on`, metadata is enumerated but unchanged checkpoint/signature chats do not receive message fetches; bounded overlap and daily audit remain.
3. **How are new or changed messages identified?** Chat metadata signatures and durable checkpoints select candidates; recent messages are walked to a trusted provider-message-ID boundary with overlap, then IDs and stored media state are batch-compared within the workspace/channel.
4. **Are messages received when Connexa is closed?** Yes. WhatsApp runtime handlers and workers are in the sender/worker services, independent of the browser and web process.
5. **What happens after restart?** Eligible saved sessions restore, durable phase/checkpoints are read, an expired old lease is harmless, and catch-up resumes from checkpoint state. Completed progress is not inferred solely from volatile memory.
6. **How are missed messages recovered?** Reconnect/startup catch-up prioritizes active chats, uses bounded overlap and provider IDs, and retains retry/deferred checkpoints plus periodic deep audits.
7. **How are duplicate media downloads avoided?** Stored provider IDs and media completeness are loaded before media extraction. Complete media is skipped; incomplete media is repairable.
8. **Are unnecessary database updates eliminated?** The unconditional hot paths were replaced with comparisons/conditional SQL. Observed staging batch telemetry recorded 576 avoided writes; legitimate state changes still write.
9. **What is the new routine frequency?** `on` defaults to 30 minutes plus up to 30 seconds jitter, with daily deep audit. `shadow`/`off` retain the three-minute legacy cadence for safety.
10. **How are background limits enforced?** Sender-wide semaphore, per-channel single-flight, database lease, owner/generation fences, per-operation/chat/wall timeouts, retries/backoff, and jitter. Default heavy concurrency is one.
11. **How much did frontend frequency decrease?** From about 22.5 to about 1.85 idle GETs/minute for a selected Inbox, a code-derived 91.8% reduction, while SSE remains immediate.
12. **How much did CPU and memory improve?** A defensible steady-state percentage is not yet available because observed post-change work was shadow checkpoint seeding and idle snapshots had no Chromium process. No percentage improvement is claimed; instrumentation is now present for a controlled comparison.
13. **Were message or automation regressions found?** None in the 50 focused tests or staging observation. Longer controlled replay remains an activation requirement.
14. **What is production-ready versus flagged?** Phase 1 pagination/status/realtime recovery and Phase 2 deduplication/conditional writes/resource controls are deployed on staging. Phase 3 storage, checkpoints, leases, and shadow comparison are ready; authoritative incremental skipping remains behind `WHATSAPP_INCREMENTAL_SYNC_MODE=on` and is not enabled by default.
15. **Are migration and rollback ready?** Yes. The task migration is additive, staging-applied, and old code can coexist with its tables. Immediate fallback is `WHATSAPP_INCREMENTAL_SYNC_MODE=off`; code/image rollback does not require data or session deletion.

## J. Source-control handoff

The branch exists, but no optimization commit or pull request was created automatically. The working tree already contained hundreds of unrelated and overlapping modifications/deletions before implementation, including target files. There is no reliable pre-task snapshot for separating those existing hunks from this implementation. Committing the current tree would violate the requirement not to include unrelated work, while committing only new files would produce an incomplete, non-buildable change set.

A clean PR requires either the owner to identify which pre-existing changes belong in the PR or to provide a clean revision/worktree onto which this implementation can be transplanted. Until then, the complete implementation and report remain in the staging working tree on `codex/inbox-sync-performance-optimization` without rewriting or discarding user work.
