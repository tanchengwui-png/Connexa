# Connexa Inbox Sync — Root Cause & Performance Investigation

Investigation date: 20 October 2026 (Malaysia time, UTC+8)  
Repository revision inspected: `80f397aa6e25` plus the existing uncommitted working-tree changes  
Scope: source inspection and lightweight, read-only staging diagnostics. No code, database records, services, deployments, or configuration were changed.

## 1. Executive summary

### Overall conclusion

Connexa is not repeatedly importing the literal, unlimited WhatsApp history in one operation. It is, however, repeatedly doing broad and expensive history-reconciliation work when a lightweight incremental check would usually be sufficient.

For a connected personal WhatsApp channel, the sender service:

1. lists the entire browser-side chat collection on every synchronization pass;
2. chooses a batch (24 chats after initial history is considered established);
3. calls WhatsApp history loading for every chosen chat;
4. fetches up to 200 recent messages per chat, or more when unread count exceeds 180;
5. resolves contacts and profile photos;
6. downloads media before checking whether its message is already in Connexa;
7. rechecks each message in PostgreSQL and rewrites its envelope on conflict;
8. rewrites contact and conversation records even when the imported messages are unchanged; and
9. schedules the next batch, normally after three minutes.

Live incoming and outgoing messages already use event-driven handlers, so routine delivery does not depend on the history sweep. The periodic sweep is principally reconciliation and history import, but it uses no durable per-chat message watermark and therefore repeats far more work than necessary.

The long-running indicator is partly genuine and partly a status-model/UI problem. The UI shows its sync component whenever `historySyncFullyCaughtUp` is false, even between actual batches. That flag, the cursor, completion time, deferred-chat list, and attempted-chat set live only in sender-process memory and reset on runtime recreation. The indicator can therefore say “Syncing history” while no history call is currently running, and its displayed “Last progress” is the channel row's update time rather than the runtime's history-progress timestamp.

There is a second, independent performance problem in the web application. Every visible inbox tab refreshes the entire conversation-list data assembly every eight seconds and then reloads the entire selected conversation. The global dashboard notification component also polls history status every eight seconds. An idle visible inbox with an open conversation therefore makes about 22.5 application GETs per minute per tab, before focus events or realtime events. Realtime events trigger the same broad refreshes, so polling and push are additive rather than alternative mechanisms.

### Confirmed top three performance bottlenecks

1. **Critical — broad history reconciliation without a durable incremental message checkpoint.** Every pass discovers all chats and selected chats can process up to 200 messages each. Evidence: `lib/whatsapp-web.ts:5205-5302`, `lib/whatsapp-web.ts:5343-5474`, and `lib/whatsapp-web.ts:5673-5771`.
2. **High — repeated work for unchanged messages, especially media downloads and envelope writes.** Media is downloaded before database deduplication, and existing message envelopes are always upserted with an `ON CONFLICT DO UPDATE`. Evidence: `lib/whatsapp-web.ts:5402-5459`, `lib/whatsapp-web.ts:592-633`, `lib/whatsapp.ts:900-1043`, and `lib/whatsapp-message-envelope.ts:251-329`.
3. **High — full inbox over-fetching every eight seconds, plus realtime-triggered duplicates.** The list endpoint calls the full `getInboxData` assembler and discards most of its result; the selected thread is unbounded and refetched separately. Evidence: `components/inbox-workspace.tsx:304-440`, `components/inbox-workspace.tsx:658-695`, `app/api/conversations/route.ts:5-10`, `lib/inbox.ts:40-117`, and `lib/db-conversations.ts:345-412`.

### Runtime snapshot

At approximately 9:03–9:05 PM Malaysia time on 20 October 2026:

| Measurement | Observed value | Qualification |
| --- | ---: | --- |
| Sender container CPU | 27.68%, 37.38%, and one 300.24% sample | Docker percentage can exceed 100% across CPU cores. |
| Sender container memory | 1.066–1.182 GiB | Includes Chromium children. |
| Sender PIDs | 151–157 | One active warm runtime was reported by sender metrics. |
| Largest Chromium process | about 792 MiB RSS; 56.3% CPU at one process snapshot | Point-in-time process reading. |
| Sender Node process | 150.7 MiB RSS; 53.9 MiB heap used | Built-in metrics exclude Chromium child memory. |
| Sender runtime state | 1 active warm, 1 connected, 1 syncing history | A second tracked channel was `REAUTH_REQUIRED`. |
| Active-account chat discovery | 466–467 importable chats | From metadata-only sync logs. |
| “Unseen” chats | 387, 363, then 340 across the first three observed batches | “Unseen” means no matching imported remote ID in this runtime's selection logic, not necessarily no messages in the database. |
| Batch size | 24 chats | Default mature/background size. |
| Observed batch-start spacing | about 130–152 seconds | Includes processing time and the 15-second unseen-batch retry delay. |
| Profile-photo resolution log entries | 81 in the observed startup interval | One log entry is emitted per attempted identity resolution. |
| PostgreSQL connections | 3 total; 1 active only for the diagnostic query | No connection-pool exhaustion observed. |
| PostgreSQL CPU | 2.12% and 42.64% in two samples | The high sample coincided with ongoing sender work, but the snapshot alone cannot attribute all CPU to sync. |
| PostgreSQL deadlocks | 0 cumulative | Since the current statistics epoch. |

The sender's built-in metrics do not currently record sync duration, messages inspected, database operations, media bytes, event-loop lag, or per-endpoint latency. `pg_stat_statements` is not installed, so query-level totals and p95 latency could not be verified.

## 2. Current architecture and sync lifecycle

### 2.1 Processes and ownership

The staging deployment has separate PostgreSQL, web, outbound worker, billing worker, and WhatsApp sender containers. The sender owns the personal WhatsApp Web/Chromium sessions; the web application calls it over HTTP. Evidence: `docker-compose.stg.yml:1-92`.

The sender exposes runtime status, sync, send, seen, mute, and health routes. The web-side runtime facade chooses the remote sender when `SENDER_SERVICE_URL` is configured. Evidence: `scripts/sender-service.ts:149-325`, `lib/sender-service-client.ts:43-156`, `lib/sender-service-client.ts:330-354`, and `lib/whatsapp-runtime.ts:112-121`.

At sender startup, persisted personal-web channels are restored with concurrency two. A health watchdog runs every 60 seconds by default and examines channels with concurrency three. Evidence: `scripts/sender-service.ts:569-675` and `lib/whatsapp-web.ts:4347-4395`.

### 2.2 Personal WhatsApp live-message lifecycle

1. `whatsapp-web.js` emits `message` for inbound/live messages and `message_create` for messages sent from the linked account. Evidence: `lib/whatsapp-web.ts:3148-3161`.
2. `persistLiveWhatsAppWebMessage` resolves the chat/contact identity, profile picture, media, and normalized message data. Evidence: `lib/whatsapp-web.ts:3231-3371`.
3. `ingestWhatsAppClientMessage` validates and delegates to `createInboundConversationMessage`. Evidence: `lib/whatsapp.ts:673-729`.
4. The ingest path deduplicates on the globally unique `Message.providerMessageId`, finds or creates the contact/conversation, inserts the message, updates unread and last-message state, persists the envelope, emits a realtime inbox event, and runs inbound automation. Evidence: `lib/whatsapp.ts:1150-1161`, `lib/whatsapp.ts:1383-1498`, and `lib/whatsapp.ts:1521-1543`.
5. The sender relays the event to the web service when `INBOX_REALTIME_RELAY_URL` is configured. Evidence: `lib/inbox-realtime.ts:112-137` and `docker-compose.stg.yml:30-32`.
6. The inbox holds an SSE connection to `/api/inbox/events`. On a message event, it refetches both the conversation list and active conversation. Evidence: `app/api/inbox/events/route.ts:20-112` and `components/inbox-workspace.tsx:682-695`.

This path is event-driven and immediate. A periodic history sweep is not required for ordinary live delivery while the WhatsApp client and event handlers are healthy.

### 2.3 Personal WhatsApp history/reconciliation lifecycle

1. A ready client schedules its first background sync after eight seconds. Evidence: `lib/whatsapp-web.ts:2968-3030`.
2. The scheduler uses one `setTimeout` per runtime. A completed pass schedules the next pass after `WHATSAPP_PERIODIC_SYNC_MS`, whose default is 180,000 ms. Evidence: `lib/whatsapp-web.ts:271-274`, `lib/whatsapp-web.ts:2457-2462`, and `lib/whatsapp-web.ts:5890-5929`.
3. `syncWorkspaceHistory` restores/gets the runtime, prevents a second same-runtime sync with `isSyncingHistory`, and sets runtime status to `SYNCING_HISTORY`. Evidence: `lib/whatsapp-web.ts:5164-5198`.
4. Every pass enumerates the browser's entire chat collection and sorts all importable chats. Evidence: `lib/whatsapp-web.ts:1335-1482` and `lib/whatsapp-web.ts:5205-5243`.
5. It reads every imported conversation remote ID from PostgreSQL, prioritizes remote IDs not present in that set, and otherwise uses an in-memory cursor. Evidence: `lib/whatsapp-web.ts:5244-5299`.
6. The initial batch defaults to eight chats. A runtime considered to have imported history uses 24. Evidence: `lib/whatsapp-web.ts:202-210` and `lib/whatsapp-web.ts:5279-5281`.
7. For each selected chat, it requests history and fetches `max(200, unread + 20)` recent messages. The browser loader pages backward until that limit is reached and then truncates to the latest limit. Evidence: `lib/whatsapp-web.ts:2509-2576`, `lib/whatsapp-web.ts:2579-2705`, and `lib/whatsapp-web.ts:5343-5349`.
8. It resolves identity/profile data and, concurrently across messages in that chat, extracts media. Evidence: `lib/whatsapp-web.ts:5351-5457`.
9. `syncWhatsAppHistoryConversation` checks every message by provider ID. Existing messages still receive a full envelope upsert; new messages are inserted. After the loop it counts inbound messages and updates contact, conversation, and chat state. Evidence: `lib/whatsapp.ts:731-1126`.
10. If more chats remain, it schedules another batch. Unseen/initial work uses short retry timing; mature ordinary batches use the three-minute interval. Evidence: `lib/whatsapp-web.ts:5681-5794`.

### 2.4 Cloud API lifecycle

Cloud API inbound traffic is separate and event-driven. The verified Meta webhook reserves an idempotency event, ingests each message, records statuses/control events, and emits realtime events. It does not use the personal-Web periodic history loop. Evidence: `app/api/webhooks/whatsapp/route.ts:372-500`.

The staging channels observed during this investigation were personal-web channels; one was active and one required reauthentication. No Cloud API channel was observed as contributing to the current resource use.

### 2.5 Inbox read lifecycle

The initial `/inbox` server render calls `getInboxData`, which concurrently fetches workspace summary, agents, quick replies, WhatsApp health, media library, tags, scheduled-message statistics, automation configuration, and channel rows, then loads the full conversation list and optionally the full selected conversation. Evidence: `app/inbox/page.tsx:15-27` and `lib/inbox.ts:40-117`.

The same broad assembler is used by `/api/conversations`, even though that endpoint returns only conversations and WhatsApp status. Evidence: `app/api/conversations/route.ts:5-10`.

For a selected conversation, all messages are returned with no page size or time boundary. Evidence: `lib/db-conversations.ts:345-412`. Conversation detail also loads all workspace teammate rows and filters them in application memory. Evidence: `lib/conversations.ts:102-181`.

There is no response cache on these client refreshes (`cache: "no-store"`).

## 3. Answers to the 10 sync-frequency questions

| # | Answer | Status and evidence |
| --- | --- | --- |
| 1 | **Normally every three minutes after a completed/mature batch, but not always.** Ready schedules an initial pass after 8 seconds. Initial or unseen work may retry after 15 seconds, exponential backoff can reach 120 seconds, and deferred work waits 300 seconds. Actual start-to-start time also includes batch duration. | **Confirmed.** `lib/whatsapp-web.ts:202-274`, `lib/whatsapp-web.ts:2968-3030`, `lib/whatsapp-web.ts:5760-5771`, `lib/whatsapp-web.ts:5914-5929`. |
| 2 | **Yes.** The default automatic periodic interval is exactly 180,000 ms. No staging override was present in the sender environment, so the default applied. | **Confirmed.** `lib/whatsapp-web.ts:271-274`. |
| 3 | **Each pass scans the complete chat index, then processes a batch, not all chats at once.** Each selected chat fetches up to 200 recent messages by default, not only new messages. Over successive batches the cursor covers the complete chat set. | **Confirmed.** `lib/whatsapp-web.ts:5205-5302`, `lib/whatsapp-web.ts:5343-5349`, `lib/whatsapp-web.ts:5673-5685`. |
| 4 | **No reliable durable incremental checkpoint exists for personal-web history.** Cursor, caught-up state, attempted IDs, timed-out IDs, and completion time are in-memory fields. The database's existing remote IDs and provider-message uniqueness provide deduplication, not an incremental fetch watermark. | **Confirmed.** `lib/whatsapp-web.ts:87-130`, `lib/whatsapp-web.ts:3889-3931`, `prisma/schema.prisma:705-752`, `prisma/schema.prisma:835-869`. |
| 5 | **Yes.** Already-imported messages are fetched, transformed, looked up, and their envelopes are upserted. | **Confirmed.** `lib/whatsapp-web.ts:5402-5459`, `lib/whatsapp.ts:900-989`. |
| 6 | **Yes.** Existing contacts and conversations are upserted/updated; chat state executes an `UPDATE` even when values are unchanged; existing envelopes execute `DO UPDATE`. | **Confirmed.** `lib/whatsapp.ts:794-878`, `lib/whatsapp.ts:1045-1121`, `lib/whatsapp.ts:475-545`, `lib/whatsapp-message-envelope.ts:281-329`. |
| 7 | **A second sync for the same runtime is rejected, but the lock is in memory only.** A manual request during an active pass returns zero counts. There is no database/distributed single-flight lock against a second sender replica. | **Confirmed for one process; multi-replica overlap is a design risk.** `lib/whatsapp-web.ts:5186-5192`. |
| 8 | **Yes.** Every channel has its own timer and multiple channels may sync concurrently. Startup restore and health checks have limits, but periodic history synchronization has no global semaphore or resource budget. | **Confirmed.** `lib/whatsapp-web.ts:145-153`, `lib/whatsapp-web.ts:2457-2462`, `scripts/sender-service.ts:670-674`, `lib/whatsapp-web.ts:4354-4395`. |
| 9 | **Opening or refreshing Inbox does not directly request history sync.** It does trigger expensive database/API reads. WhatsApp setup can manually call sync via `PATCH /api/settings/whatsapp`; sender readiness/restart schedules sync independently. | **Confirmed.** `app/inbox/page.tsx:15-27`, `app/api/settings/whatsapp/route.ts:265-278`, `lib/whatsapp-web.ts:2968-3030`. |
| 10 | **There is a logical distinction, but it is not durable or strong enough.** Initial and mature batch sizes differ, and `hasCompletedInitialSync` changes retry pacing. After restart, any existing message or `READY` status is used to infer initial completion; the detailed cursor/caught-up state is lost. Both phases still use the same expensive chat/message pipeline. | **Confirmed.** `lib/whatsapp-web.ts:4024-4072`, `lib/whatsapp-web.ts:4203-4246`, `lib/whatsapp-web.ts:5279-5281`. |

### Critical question

**Yes. Connexa repeatedly performs expensive broad history work when an incremental check would usually be sufficient.** It does not fetch an unlimited full archive on every pass, but it repeatedly enumerates the whole chat set, fetches a substantial recent window for selected chats, resolves metadata/media, and revisits existing database rows. This is a rotating full-set reconciliation rather than a new-message-only sync.

At the defaults, one 24-chat batch can materialize up to 4,800 message objects. A complete 466-chat cycle requires at least 20 batches and can revisit up to 93,200 message objects if each chat reaches the 200-message cap. These are source-code maxima, not measured actual message counts. The timer delay alone for 20 mature batches is at least 57 minutes between the first and last batch starts; processing time adds to that.

## 4. Background synchronization behavior

| User/server state | Frontend behavior | Server/sender behavior | Resource consequence |
| --- | --- | --- | --- |
| User viewing Inbox in a visible tab | Every 8 seconds: full conversation-list refresh, then full selected-conversation refresh. A separate global 8-second history-status poll also runs. SSE is open and message/chat events trigger additional broad refreshes. | Personal-web live events and background history timers continue. | About 22.5 GETs/minute/tab with a selected conversation, plus event-triggered requests; repeated React state replacement and database reads. |
| User on another Connexa page in a visible tab | Global history status polls every 8 seconds. The dashboard notification component also polls `/api/conversations` every 8 seconds outside Inbox. | Same sender behavior. | About 15 GETs/minute/tab before focus events. The conversation poll still invokes the full inbox data assembler. |
| Browser tab inactive/hidden | The regular 8-second polling functions check `document.visibilityState` and skip. Inbox SSE remains connected; its event handlers do not check visibility and can still trigger full refreshes on events. | Same sender behavior. | Idle browser/API work falls, but realtime events can still cause reads; server/Chromium sync is unchanged. |
| Connexa tab closed | React timers and SSE are removed. | Sender timers, WhatsApp event handlers, Chromium, and reconciliation continue. | Frontend cost stops; server-side cost continues. |
| User logs out | Authenticated dashboard components unmount, so their polling/SSE stops. | The channel's desired runtime remains `RUNNING`; sender sync is not tied to user login. | Frontend cost stops; server-side cost continues. |
| Web service restarts | Browser clients reconnect; no direct effect on the sender's in-memory runtime if the sender stays up. | Sender continues independently. | Inbox event relay can be briefly unavailable; sync continues. |
| Sender service restarts | No browser dependency. | Persisted sessions are restored. In-memory cursors and caught-up flags reset. A restored ready client schedules sync after becoming ready; a database status of `SYNCING_HISTORY` also causes an immediate resume attempt. | Chromium cold start and renewed history discovery; possible repeat scanning of existing chats. |
| Full server restart | Frontend stops until web returns. | Docker restarts the sender; it restores desired sessions with bounded startup concurrency. | Same sender-restart behavior plus overall service interruption. |

Evidence: `components/inbox-workspace.tsx:658-792`, `components/dashboard-notifications.tsx:154-315`, `scripts/sender-service.ts:605-675`, and `docker-compose.stg.yml:20-92`.

The code has a 15-minute idle-eviction feature, but a normal connected runtime schedules history work every three minutes. Starting sync clears the idle timer and completing sync touches activity and reschedules it. Therefore the periodic loop normally prevents the runtime from reaching 15 minutes of qualifying idle time. This is a **confirmed code-path inference**, not a directly timed eviction test. Evidence: `lib/whatsapp-web.ts:2051-2112`, `lib/whatsapp-web.ts:5190-5193`, and `lib/whatsapp-web.ts:5914-5932`.

Background reconciliation is useful as a safety net because WhatsApp Web events or browser sessions can fail. Its present frequency and breadth are not appropriately proportional to that role. Live events should be primary, with durable incremental reconciliation and a much less frequent bounded audit.

## 5. Sync indicator analysis

### Finding 5.1 — “Syncing” includes pending/not-caught-up time, not just active work

- **Severity:** High (accuracy and perceived reliability); Medium direct performance impact.
- **Evidence:** `components/inbox-workspace.tsx:232-239` and `components/inbox/status-strip.tsx:9-46`.
- **Current behavior:** The status component is shown whenever any personal-web channel exists and `historySyncFullyCaughtUp` is false. Its default label is “Syncing history” or “Inbox sync in progress,” even when `isSyncingHistory` is false and the sender is waiting for its next timer.
- **Why problematic:** Users reasonably interpret the animation as active message work. It conflates active batch execution, queued background work, and an in-memory completion flag.
- **Recommended solution:** Model explicit phases: `initial_import`, `catching_up`, `reconciling`, `idle`, `deferred`, `error`, `disconnected`. Only animate during active execution. Show queued reconciliation as non-animated “Up to date; next safety check…” or hide it.
- **Implementation risk:** Low if presentation-only; Medium if the status contract is changed simultaneously.
- **Expected impact:** Removes false continuous-sync perception; negligible server savings unless polling is also reduced.

### Finding 5.2 — caught-up and cursor state is volatile

- **Severity:** High.
- **Evidence:** `lib/whatsapp-web.ts:87-130`, `lib/whatsapp-web.ts:3889-3931`, and `lib/whatsapp-web.ts:4203-4246`.
- **Current behavior:** A new runtime initializes `historySyncFullyCaughtUp=false`, `historySyncCompletedAt=null`, and cursor zero. Existing messages only set `hasCompletedInitialSync`.
- **Why problematic:** Sender recreation makes a previously caught-up account look incomplete and restarts cursor-based scanning. Completion notifications require an in-memory completion timestamp.
- **Recommended solution:** Persist per-channel import phase and per-chat checkpoints, including a schema/version marker and last successful reconciliation. Derive UI state from persisted job state plus live activity.
- **Implementation risk:** Medium; migrations and restart semantics must be carefully tested.
- **Expected impact:** Prevents false reset after restart and eliminates repeat work caused solely by process loss.

### Finding 5.3 — displayed “Last progress” is not history progress

- **Severity:** Medium.
- **Evidence:** `lib/inbox.ts:141-154`, `lib/whatsapp-health.ts:152-159`, and `components/inbox/status-strip.tsx:58-85`.
- **Current behavior:** Health internally considers `historySyncProgressAt`, but Inbox maps `updatedAt` from the channel database row and labels it “Last progress.”
- **Why problematic:** The label can be stale, can advance because of unrelated channel writes, and does not reliably show batch progress.
- **Recommended solution:** Return and display `historySyncProgressAt` explicitly; separately show connection-state update time.
- **Implementation risk:** Low.
- **Expected impact:** Better diagnostics and fewer false “stuck” interpretations.

### Finding 5.4 — cursor progress is misleading during unseen-chat work

- **Severity:** Medium.
- **Evidence:** `lib/whatsapp-web.ts:5262-5299`, `lib/whatsapp-web.ts:5673-5685`, and `components/inbox/status-strip.tsx:21-34`.
- **Current behavior:** Unseen batches set the displayed history cursor back to zero, although chats are being attempted. The UI may show “Syncing history” with no numeric advancement.
- **Why problematic:** Long active imports appear frozen.
- **Recommended solution:** Track durable job counters separately: discovered, eligible, attempted, succeeded, skipped, deferred, failed, and new messages.
- **Implementation risk:** Low to Medium.
- **Expected impact:** Accurate progress; no direct throughput change.

### Finding 5.5 — status polling is excessive

- **Severity:** Medium.
- **Evidence:** `components/dashboard-notifications.tsx:181-253` and `app/api/inbox/history-sync-status/route.ts:8-69`.
- **Current behavior:** Every visible authenticated dashboard tab polls every eight seconds. Each request loads channels and calls sender runtime status for all eligible personal-web channels.
- **Why problematic:** The state changes far less often than the polling interval and the sender already has a relay/event mechanism.
- **Recommended solution:** Push phase changes over SSE; retain a 30–60 second fallback poll with focus refresh and jitter.
- **Implementation risk:** Low.
- **Expected impact:** Changing idle fallback from 8 to 60 seconds cuts this request class by 86.7%; event-driven-only idle behavior can reduce it further.

## 6. Performance bottlenecks

### 6.1 Broad chat discovery and rotating history fetch

- **Severity:** Critical.
- **Evidence:** `lib/whatsapp-web.ts:1335-1482`, `lib/whatsapp-web.ts:5205-5302`, and `lib/whatsapp-web.ts:5343-5349`.
- **Current behavior:** All chats are materialized and sorted on each pass; selected chats request history and fetch a recent message window irrespective of a durable checkpoint.
- **Why problematic:** Cost scales with total chats and recent history, not with new messages. A large account spends long periods in Chromium/Puppeteer evaluation and database reconciliation.
- **Recommended solution:** Persist a per-chat lightweight signature/watermark and fetch messages only for new/changed chats. Stop walking backward when a known provider ID/checkpoint is reached. Run rare full audits separately.
- **Implementation risk:** High if switched abruptly; missed-message recovery must be proven in shadow mode.
- **Expected impact:** On an idle account, per-message reconciliation should approach zero rather than up to 200 messages for each selected chat. Exact CPU/network reduction requires new metrics.

### 6.2 Media is downloaded before message deduplication

- **Severity:** Critical for media-heavy histories; High generally.
- **Evidence:** `lib/whatsapp-web.ts:5402-5450` and `lib/whatsapp-web.ts:592-633`.
- **Current behavior:** `extractIncomingMediaAttachment` downloads media for every fetched historical media message before `syncWhatsAppHistoryConversation` checks whether the provider message already exists.
- **Why problematic:** Reconciliation can repeat WhatsApp media transfer, decoding/base64 handling, filesystem work, and media-asset registration attempts for unchanged messages.
- **Recommended solution:** Extract provider IDs first, batch-query known IDs and stored media metadata, and download only missing media. Add content/provider-id idempotency at the media layer.
- **Implementation risk:** Medium; must preserve repair behavior for records whose media previously failed.
- **Expected impact:** Eliminates 100% of media downloads for already-complete known messages. Actual bytes were not measured.

### 6.3 Existing envelope rows are rewritten

- **Severity:** High.
- **Evidence:** `lib/whatsapp.ts:914-989` and `lib/whatsapp-message-envelope.ts:251-329`.
- **Current behavior:** A known message still performs an envelope `INSERT ... ON CONFLICT DO UPDATE` covering many columns and always changes `updatedAt`.
- **Why problematic:** Creates WAL, dead tuples, index/heap activity, autovacuum work, and storage churn even when values did not change.
- **Recommended solution:** Batch classify messages as new/changed/unchanged. Skip unchanged envelopes, or add a stable payload hash and `DO UPDATE ... WHERE existing.hash IS DISTINCT FROM excluded.hash`.
- **Implementation risk:** Medium; changes in ack, media repair, reactions, or quoted metadata must still update.
- **Expected impact:** Idle reconciliation envelope writes can fall to near zero. Cumulative table statistics show 6,218,552 envelope updates for 13,931 live rows (about 446 updates per current live row), but this is database-lifetime corroboration, not sync-only attribution.

### 6.4 Contacts and conversations are rewritten on routine scans

- **Severity:** High.
- **Evidence:** `lib/whatsapp.ts:794-878`, `lib/whatsapp.ts:1045-1121`, and `lib/whatsapp.ts:475-545`.
- **Current behavior:** Contact upsert, conversation update, contact update, and chat-state update occur after message inspection. The chat-state CTE performs an `UPDATE` even when it preserves `updatedAt`.
- **Why problematic:** Repeated tuples and transaction work are generated for unchanged chats.
- **Recommended solution:** Compare a compact chat/contact state hash, issue updates only when fields change, and derive hot-lead state incrementally rather than recounting inbound messages every pass.
- **Implementation risk:** Medium; manual-override semantics must remain authoritative.
- **Expected impact:** Removes at least the routine contact/conversation write set for unchanged chats. Cumulative statistics show roughly 1.02 million contact and 1.01 million conversation updates for 767 live rows each; these figures include all historical application activity and deleted/recreated rows.

### 6.5 Profile-photo work is frequent and process-local

- **Severity:** Medium to High.
- **Evidence:** `lib/whatsapp-web.ts:1059-1141`.
- **Current behavior:** Successful profile photos are cached for five minutes, misses for only 30 seconds, and the cache is process memory. Slow cycles and sender restarts cause repeat provider lookups and local caching work.
- **Why problematic:** Accounts with hundreds of chats repeatedly invoke WhatsApp/browser profile APIs. The observed logs contained 81 identity/photo resolution entries during the short startup interval.
- **Recommended solution:** Persist photo ETag/source timestamp or a longer negative cache; refresh photos on a separate low-priority schedule and on identity change.
- **Implementation risk:** Low to Medium; avatars may update less promptly.
- **Expected impact:** Large reduction in browser calls on accounts whose photos rarely change; exact count needs an explicit cache-hit metric.

### 6.6 Full inbox model is rebuilt every eight seconds

- **Severity:** High.
- **Evidence:** `components/inbox-workspace.tsx:304-440`, `components/inbox-workspace.tsx:658-695`, `app/api/conversations/route.ts:5-10`, and `lib/inbox.ts:40-117`.
- **Current behavior:** Conversation polling invokes workspace summary, WhatsApp health/counts, jobs, media assets, tags, quick replies, scheduled stats, channels, and the entire conversation list. With a selected thread, a second request reloads all thread messages and metadata.
- **Why problematic:** Work and JSON payload scale with total workspace data. New realtime events cause immediate duplicate refreshes rather than applying a small delta.
- **Recommended solution:** Split APIs into paginated conversation list, small status summary, and paginated message timeline. Use event payloads or `since` cursors for deltas. Coalesce simultaneous events and make polling only a recovery fallback.
- **Implementation risk:** Medium; client state consistency and selection races require regression tests.
- **Expected impact:** An idle visible inbox can fall from about 22.5 GETs/minute/tab to roughly one fallback request/minute or less, a 95.6%+ idle request reduction.

### 6.7 Selected conversation messages are unbounded

- **Severity:** High for long conversations.
- **Evidence:** `lib/db-conversations.ts:345-412` and `lib/conversations.ts:102-228`.
- **Current behavior:** Every detail refresh returns the whole message history, joins envelopes/replies/outbound jobs, loads reaction envelopes, notes, audits, lead data, automation data, and all workspace teammate rows.
- **Why problematic:** Database, serialization, network, and React reconciliation costs grow indefinitely with thread length.
- **Recommended solution:** Keyset-paginate messages by `(sentAt,id)`, return only the newest page plus a version, and fetch older pages on demand. Query teammates for the selected conversation only.
- **Implementation risk:** Medium; reply targets and reactions across page boundaries need placeholders/backfill.
- **Expected impact:** Converts repeated detail work from O(total thread messages) to O(page size), normally 30–100 messages.

### 6.8 Multiple channel syncs lack a global resource limit

- **Severity:** High at multi-channel scale.
- **Evidence:** `lib/whatsapp-web.ts:145-153`, `lib/whatsapp-web.ts:2457-2462`, and `lib/whatsapp-web.ts:5186-5192`.
- **Current behavior:** Same-runtime overlap is blocked, but each channel independently schedules work. There is no global history semaphore or CPU/memory-aware admission control.
- **Why problematic:** Several Chromium runtimes can simultaneously scan, download media, and write PostgreSQL, competing with sends and the web API.
- **Recommended solution:** Add per-channel distributed single-flight plus a sender-wide semaphore, weighted by operation type. Prioritize live send/event work over reconciliation and apply jitter/backoff.
- **Implementation risk:** Medium; excessive throttling could delay recovery.
- **Expected impact:** Bounds worst-case concurrent load. No exact number is possible until per-channel resource metrics exist.

### 6.9 Excessive per-item logging

- **Severity:** Low to Medium.
- **Evidence:** `lib/whatsapp-web.ts:5385-5392` and the repeated profile-photo log path.
- **Current behavior:** Routine batches emit per-chat/profile results plus batch lines.
- **Why problematic:** Adds log I/O and obscures actionable failures.
- **Recommended solution:** Aggregate per-batch counters and sample debug details behind a level flag.
- **Implementation risk:** Low.
- **Expected impact:** In the observed short interval, 81 profile-photo lines could have been represented by one batch summary.

### 6.10 Index assessment

The most important deduplication and list indexes exist: provider message ID is unique, messages have `(conversationId,sentAt)`, contacts have `(workspaceId,phone)`, and conversations have workspace/status/time indexes. Evidence: `prisma/schema.prisma:700-702`, `prisma/schema.prisma:745-751`, and `prisma/schema.prisma:840-868`.

No missing index was confirmed as a current primary cause. Potential improvements that require `EXPLAIN (ANALYZE, BUFFERS)` on production-shaped data include:

- a tenant/channel-aware conversation remote-ID index for `workspaceId + channelId + whatsAppRemoteId`;
- a message index supporting repeated `conversationId + direction` counts; and
- revised reaction/reply lookup indexes if pagination does not remove those scans.

These are **hypotheses**, not confirmed root causes. `pg_stat_statements` was unavailable, and the present database has only 767 conversations and about 13,170 messages.

## 7. Confirmed root causes and supporting evidence

### Root cause A — recovery logic is being used as routine synchronization

- **Severity:** Critical.
- **Confirmed:** Live events persist messages immediately, yet a three-minute history process still walks the whole chat population in rotating batches.
- **Evidence:** `lib/whatsapp-web.ts:3148-3167`, `lib/whatsapp-web.ts:5164-5302`, `lib/whatsapp-web.ts:5890-5929`.
- **Runtime support:** The active runtime reported `syncingHistory=1`, with 466–467 importable chats and 24-chat batches.
- **Why it causes slowness:** Chromium, network/media, Node orchestration, and PostgreSQL reconciliation share the sender/database with live operations.

### Root cause B — deduplication happens too late

- **Severity:** Critical.
- **Confirmed:** Provider IDs protect final message uniqueness, but expensive message conversion, identity resolution, profile work, and media download happen before or around per-message database checks. Existing envelopes and chat entities are rewritten.
- **Evidence:** `lib/whatsapp-web.ts:5340-5459`, `lib/whatsapp.ts:900-1121`.
- **Why it causes slowness:** Idempotent final data does not mean idempotent cost.

### Root cause C — no durable incremental state

- **Severity:** High.
- **Confirmed:** Runtime cursor and caught-up fields are process memory; schema has no per-chat sync checkpoint for personal WhatsApp.
- **Evidence:** `lib/whatsapp-web.ts:87-130`, `lib/whatsapp-web.ts:3889-3931`, `prisma/schema.prisma:1298-1369`.
- **Why it causes slowness:** Restarts and long-lived periodic operation repeatedly rediscover/scan history.

### Root cause D — frontend polling requests far more data than it needs

- **Severity:** High.
- **Confirmed:** Both Inbox and other dashboard pages poll broad endpoints every eight seconds; Inbox also uses SSE.
- **Evidence:** `components/inbox-workspace.tsx:658-792`, `components/dashboard-notifications.tsx:154-315`.
- **Why it causes slowness:** Normal inbox/API work is repeated even when data is unchanged and competes with sync database work.

### Root cause E — status semantics make queued work look continuously active

- **Severity:** High for the reported symptom.
- **Confirmed:** UI visibility and wording are driven by `!historySyncFullyCaughtUp`; runtime creation resets that flag.
- **Evidence:** `components/inbox-workspace.tsx:232-239`, `components/inbox/status-strip.tsx:9-46`, `lib/whatsapp-web.ts:3904-3909`.
- **Why it causes the symptom:** The indicator can remain visible while waiting between batches and after sender restarts.

### Hypotheses requiring further instrumentation

1. Some “unseen” chats may be repeatedly classified that way because unresolved `@lid` identities do not produce a matching stored `whatsAppRemoteId`. Logs showed many unresolved-LID skips, but the investigation did not inspect message/contact content or correlate identifiers.
2. Repeated historical media download may be a major component of network bandwidth and disk I/O. The code proves it can occur, but byte totals were not instrumented.
3. Long Puppeteer evaluations may delay Node request handling or live event handling. Current metrics have no event-loop delay or route latency, so this was not directly measured.
4. The inbox list/detail SQL may have specific slow plans on larger workspaces. Query-level timing was unavailable.

### Items not verified

- Per-sync duration as recorded by the application (no metric exists).
- Exact messages fetched, messages deduplicated, database statements, WAL bytes, media bytes, and API p50/p95/p99 latency.
- Browser-side network request volume.
- A causal latency comparison with synchronization disabled, because disabling or interrupting sync was outside scope.
- Production behavior beyond this staging snapshot.

## 8. Recommended architecture and optimizations

### A. Event-driven synchronization

Keep the existing `message`, `message_create`, `message_ack`, reaction, and Cloud webhook paths as the primary delivery path. They already provide the correct foundation.

Add durable event-ingest observability and a small replay queue. A live event should persist an idempotency record before or atomically with business ingestion, then acknowledge success/failure. Cloud already has a durable `MetaWebhookEvent`; personal-web should have an equivalent small event ledger or checkpointed ingestion record rather than depending only on message uniqueness.

Risk: WhatsApp Web is less durable than a server webhook; browser disconnects can still lose event intervals. That is why reconciliation remains necessary, but not every three minutes across broad history.

### B. Incremental synchronization

Add a tenant- and channel-scoped per-chat checkpoint table, for example:

- `workspaceId`, `channelId`, `remoteChatId` unique key;
- latest provider message ID and message timestamp successfully persisted;
- last observed WhatsApp chat timestamp/unread/title/state signature;
- last reconciliation attempt/success/error;
- initial-import boundary and completion version; and
- deferred/quarantined state with retry time.

On discovery, compare the lightweight browser chat timestamp/signature with the checkpoint. Skip unchanged chats. For changed chats, fetch newest messages and stop as soon as the saved provider ID/time boundary is reached, with a small overlap window to handle ordering and edits. Batch-query all fetched provider IDs before profile/media work, and process only new or repair-needed records.

Risk: timestamp-only checkpoints can miss late or reordered messages. Use `(provider ID, timestamp)` plus an overlap window, retain unique constraints, and periodically audit.

### C. Periodic reconciliation

Separate three job classes:

1. **Initial import:** explicit, resumable, durable progress, user-visible.
2. **Catch-up after disconnect/restart:** high priority but incremental from the last durable checkpoint.
3. **Routine reconciliation:** low priority, jittered, and substantially less frequent (for example 15–60 minutes), inspecting lightweight chat metadata first.

Run a bounded deep audit daily or on demand, not a continuous rotating 200-message scan. The exact intervals should be chosen after shadow-mode miss-rate measurement; no fixed interval can be justified from current metrics alone.

### D. Resource control

- Add a database advisory lock or durable lease per channel so two sender processes cannot sync the same channel.
- Add a sender-wide semaphore for history/Puppeteer work; start with one history batch at a time per host and tune from metrics.
- Prioritize live message events and outbound sends over history.
- Add jitter so channels do not synchronize in lockstep.
- Enforce a per-batch wall-time and message/media budget, not just a chat count.
- Check known provider IDs and stored media before any media download.
- Batch provider-ID reads and envelope writes.
- Make all contact/conversation/envelope updates conditional on actual value changes.
- Track event-loop delay and pause low-priority reconciliation when CPU/memory/queue latency crosses thresholds.

### E. Accurate status reporting

Return one explicit status payload per channel:

- phase: `initial_import | catch_up | reconcile | idle | deferred | error | disconnected`;
- active boolean;
- started/progress/completed timestamps;
- discovered/eligible/attempted/succeeded/deferred/failed chat counters;
- fetched/new/updated/unchanged message counters;
- next reconciliation time; and
- last successful live event time.

The UI should animate only when `active=true`. “Idle/up to date” should remain distinct from connection health. “Connected” must not imply all history is imported, and “history deferred” must not imply live delivery is down.

### Frontend/API optimization

- Replace `/api/conversations`' use of `getInboxData` with a purpose-built paginated list query.
- Return a compact version/ETag and `304` or no-op delta when unchanged.
- Keyset-paginate thread messages.
- Apply SSE message/ack/chat-state deltas locally; coalesce a fallback refresh once after a burst.
- Use one 30–60 second visibility-aware recovery poll, with focus refresh and jitter.
- Stop polling `/api/conversations` on non-Inbox pages; use the existing event relay or a compact unread/notification endpoint.
- Ensure hidden tabs do not perform SSE-triggered full refreshes; queue one refresh for visibility restoration.

## 9. Risk analysis and safeguards

| Risk | Safeguard |
| --- | --- |
| Missing a message because a checkpoint advances too far | Advance checkpoints only after committed message/envelope writes; use provider ID plus timestamp overlap; keep unique constraints. |
| Out-of-order or late WhatsApp history | Re-read a bounded overlap window and deduplicate by provider ID. |
| Event lost during Chromium disconnect | On reconnect run incremental catch-up from durable checkpoints before declaring idle. |
| Existing incomplete media never repaired | Store a repair-needed flag; known messages skip media only when the stored asset is complete. |
| Two sender instances duplicate work | Durable per-channel lease/advisory lock with expiry and owner identity. |
| Throttling delays live traffic | Separate priority queues; live event/send paths bypass the low-priority history semaphore. |
| Initial import never completes because of one chat | Durable per-chat quarantine and partial completion; surface failed-chat count rather than blocking the whole channel. |
| Manual contact names/tags overwritten | Preserve the existing manual-override rules and add regression tests before conditional updates. |
| UI becomes stale after reducing polling | SSE delta application plus a slower version-based recovery poll and focus refresh. |
| Tenant data crosses channels/workspaces | Every checkpoint, lease, and batch query must include workspace and channel identifiers; test multi-tenant isolation. |
| Rollout silently changes delivery | Run the new classifier in shadow mode and compare old/new candidate sets before changing fetch behavior. |

## 10. Prioritized implementation plan

No implementation was performed. The safest sequence is:

1. **P0 — Instrument first.** Add batch IDs and metrics for duration, chat counts, messages fetched/new/unchanged, media bytes/cache hits, database operations, event-loop delay, sender/Chromium CPU/RSS, and inbox endpoint latency. Enable safe query statistics in staging.
2. **P0 — Correct status semantics without changing delivery.** Persist/import explicit phases and display active vs queued vs idle accurately. Use the real progress timestamp.
3. **P0 — Remove frontend over-fetching.** Build compact paginated list/status endpoints, paginate messages, coalesce SSE refreshes, and slow fallback polling. This has minimal message-loss risk because it changes reads/UI only.
4. **P0 — Move deduplication before expensive work.** Batch-check provider IDs before media/profile/envelope processing; skip unchanged writes; retain an explicit repair path.
5. **P1 — Add durable per-chat checkpoints in shadow mode.** Record what would be skipped while the old reconciliation continues. Compare missed/new message sets over reconnects and restarts.
6. **P1 — Enable incremental catch-up.** Switch reconnect and routine jobs to checkpoint-based fetch with overlap, guarded by feature flag and channel-level rollback.
7. **P1 — Add global resource controls.** Distributed per-channel lease, sender-wide semaphore, priorities, jitter, and budgets.
8. **P2 — Reduce routine frequency and add deep audit.** Only after shadow validation, move broad reconciliation to a low-frequency audit while retaining event-driven live delivery and incremental reconnect catch-up.
9. **P2 — Tune indexes from measured query plans.** Do not add speculative indexes before the new query shapes are final.

## 11. Expected performance improvements

These are evidence-based bounds or directional expectations, not promises:

- **Frontend requests:** a visible inbox with one selected thread currently generates about 22.5 GETs/minute/tab. One 60-second fallback poll would reduce idle request frequency by about 95.6%; an event-only idle period would reduce it further.
- **History message work:** current source limits permit up to 4,800 message objects per 24-chat batch and 93,200 across a 466-chat cycle. Incremental skip logic changes routine idle work from that bound to approximately the number of new/changed messages plus a small overlap.
- **Media:** checking durable media completeness before download eliminates all repeat downloads for already-complete known messages.
- **Database writes:** conditional envelope/contact/conversation updates make unchanged-chat reconciliation approach zero business-row writes. Current cumulative update counts show substantial amplification but cannot isolate the exact percentage caused by sync.
- **Memory/CPU:** bounding concurrent history jobs and eliminating repeated Chromium/media work should materially reduce the observed 1.1+ GiB sender footprint and CPU spikes. An exact target is not defensible until child-process CPU/RSS and media/message counters are collected.
- **Inbox latency:** pagination changes selected-thread retrieval from total-history-sized to fixed-page-sized. Exact response-time improvement was unavailable because route latency is not instrumented.

## 12. Validation and regression-test strategy

### Correctness tests

1. Fresh account initial import with zero, small, and 500+ chats.
2. Incoming/outgoing live messages while initial import is running.
3. Sender restart at every checkpoint boundary; verify no duplicate or missing messages.
4. Browser disconnect spanning several messages; verify incremental catch-up.
5. Out-of-order, same-timestamp, edited, deleted, reaction, quoted, and ack updates.
6. Media download failure followed by successful repair.
7. Group, `@lid`, direct, archived, muted, pinned, self, status, and newsletter chat behavior.
8. Manual contact/tag overrides remain untouched.
9. Two channels in one workspace and multiple workspaces remain isolated.
10. Two sender instances compete for one channel; exactly one lease holder runs reconciliation.

### UI tests

1. Indicator phases map exactly to active/idle/deferred/error states.
2. Waiting between batches does not animate as active sync.
3. Runtime restart does not erase a durable caught-up state.
4. Hidden tabs do not issue full refreshes on SSE bursts.
5. SSE updates list/thread locally; fallback poll repairs a deliberately dropped event.
6. Paginated threads preserve ordering, replies, reactions, media, unread behavior, and selection races.

### Performance validation

Capture before/after for the same staging account:

- sender and Chromium CPU/RSS, event-loop p95/p99 delay;
- sync batch duration and wait duration;
- chats discovered, metadata-skipped, fetched, deferred, and failed;
- messages materialized, known, new, updated, unchanged;
- media download attempts, cache hits, and bytes;
- PostgreSQL statements, rows read/written, WAL bytes, lock waits, and query p50/p95;
- `/api/conversations`, thread detail, and history-status request rate and p50/p95;
- outbound send latency and inbound-to-inbox latency during reconciliation.

Acceptance should require zero missed messages in replay/restart tests, stable idempotency, lower p95 live-delivery latency under reconciliation load, and the expected order-of-magnitude reduction in idle reads and unchanged-message work.

## Final direct answers

1. **Why does the inbox sync indicator appear to run continuously?** Because real history batches are long and repeated, and because the UI also labels the entire not-fully-caught-up interval as “Syncing,” including waits between batches. Runtime restarts reset the in-memory caught-up flag and cursor, extending that state.
2. **Is the whole inbox repeatedly synchronized?** Not in one unlimited operation, but effectively yes as a rotating reconciliation: every pass lists all chats, batches eventually cover the entire set, and each selected chat refetches up to 200 recent messages rather than only new ones.
3. **Does synchronization continue when Connexa is not open?** Yes. The sender service and Chromium sessions are independent of the browser/login and continue their event handling and scheduled reconciliation. Frontend polling stops when the app is closed.
4. **Is background synchronization causing inbox and overall system slowness?** It is a confirmed major resource consumer and can compete with live sender/database work. During the snapshot the sender dominated resource use and was actively syncing. The frontend's own eight-second broad polling is a separate confirmed cause of inbox/API load. Exact causal latency percentages were not measurable with current instrumentation.
5. **What are the top three confirmed performance bottlenecks?** Broad non-incremental history reconciliation; expensive work and writes for already-known messages (especially media/envelopes); and full inbox/list/thread over-fetching every eight seconds plus realtime-triggered duplicates.
6. **What changes would deliver the greatest improvement?** Put durable per-chat checkpoints and early provider-ID/media deduplication in front of expensive work; replace broad frontend polling with paginated/delta APIs and SSE; then reduce reconciliation frequency under a global resource budget.
7. **Can synchronization be optimized without losing messages or compromising WhatsApp reliability?** Yes. Keep live events as primary, add durable checkpoints with overlap and idempotency, retain reconnect catch-up, and use a less frequent deep audit. Shadow-mode comparison and restart/replay tests are essential before switching.
8. **What is the safest recommended implementation sequence?** Instrument; correct status reporting; remove frontend over-fetching; move deduplication before media/writes; add checkpoints in shadow mode; enable incremental catch-up; add concurrency controls; finally reduce broad reconciliation frequency and tune indexes from measured plans.
