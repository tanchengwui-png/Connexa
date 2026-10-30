# Connexa WhatsApp performance root-cause findings

Investigation baseline: staging, 2026-10-28 UTC. This report separates measured facts from hypotheses. The latest trace is connection attempt `cmvrlc9xn008m0po2d0t22x9a:mvror9nt:3` for the PohMY workspace.

## 1. Executive summary

Connexa's latest first QR took **21.620 seconds to paint** after the browser requested pairing. Of that, **20.790 seconds** elapsed inside `whatsapp-web.js` runtime initialization before the raw QR was available and **0.370 seconds** was QR encoding. Existing telemetry did not divide the 20.790 seconds between Chromium launch, WhatsApp Web navigation, document bootstrap, and initial injection, so none of those individual operations is yet an exact root cause.

After WhatsApp emitted the genuine `authenticated` event, genuine `ready` took another **16.044 seconds**: helpers were observable at 5.136 seconds, account metadata at 7.143 seconds, and the remaining listener/ready phase took about 8.898 seconds. This work is inside the installed `whatsapp-web.js` authenticated callback. The sender consumed about 2.009 CPU-seconds during that 16.041-second monotonic interval, with event-loop utilization 0.1347, no active history job, and no CPU throttling. CPU starvation and history competition are therefore not confirmed causes for this sample.

The **61.475 seconds from painted QR to `authenticated`** was the user/phone scan interval, not server processing. Once `ready` occurred, the browser observed CONNECTED essentially immediately; cross-host clock skew prevents a sub-millisecond claim, but the durable UI timing event was recorded 0.779 seconds later.

Two perceived-speed defects are confirmed in the frontend. The child QR panel receives live connection state while its onboarding parent continues rendering the sidebar and checklist from server-rendered props, leaving them stale. Also, the authenticated state still enters the QR setup branch, so it displays an empty QR placeholder and refresh instructions while WhatsApp is finalizing.

## 2. Measured connection timeline

All times are UTC on 2026-10-28. Browser `observedAt` values have small clock skew relative to the sender/database; durations explicitly recorded by one clock are preferred.

| Stage | Start | End | Duration | Component | Evidence |
|---|---:|---:|---:|---|---|
| Pairing request to runtime initialize | 05:40:31.769 | 05:40:32.380 | 0.611 s | Web API → sender | `QR_DISPLAYED.requestedAt`; timestamped sender log |
| Runtime initialize to raw QR event | 05:40:32.380 | 05:40:53.100 | 20.720 s | Chromium + WhatsApp Web + `Client.inject()` | Timestamped sender logs |
| Raw QR event to encoded/published QR | 05:40:53.100 | 05:40:53.472 | 0.372 s | Sender QR encoding and publish | Sender `qr-profile`, `qrEncodeMs=370` |
| Request to QR browser paint | 05:40:31.769 | 05:40:53.389 | 21.620 s | End-to-end frontend | Durable `QR_DISPLAYED` event after image load and two animation frames |
| QR paint to WhatsApp authenticated | 05:40:53.389 | 05:41:54.864 | 61.475 s | User/phone + WhatsApp | `QR_DISPLAYED.observedAt`; `AUTHENTICATED.authenticatedAt` |
| Authenticated to helpers injected | 05:41:54.864 | 05:42:00.000 | 5.136 s | WhatsApp Web helper injection | Sender `auth-profile` |
| Helpers to account metadata | 05:42:00.000 | 05:42:02.007 | 2.007 s | WhatsApp Web account metadata | Sender `auth-profile` |
| Account metadata to ready | 05:42:02.007 | 05:42:10.905 | 8.898 s | `whatsapp-web.js` listener attachment / ready callback | `READY.listenerAttachmentApproximationMs` |
| Authenticated to genuine ready | 05:41:54.864 | 05:42:10.908 | 16.044 s | `whatsapp-web.js` | Durable `READY` event; monotonic duration 16.041 s |
| Ready to UI connected | 05:42:10.908 | browser reported 05:42:10.804; durable event 05:42:11.687 | effectively immediate; durable record +0.779 s | SSE/frontend | `UI_CONNECTED`; browser clock was 0.104 s behind sender |
| Ready to history queued | 05:42:10.908 | 05:42:11.105 | 0.197 s | Background scheduler | `HISTORY_JOB_QUEUED` |
| Ready to history started | 05:42:10.908 | 05:42:16.215 | 5.307 s | Background scheduler | `HISTORY_JOB_STARTED` |
| History start to first batch complete | 05:42:16.215 | 05:42:20.662 | 4.447 s | Background history import | `HISTORY_FIRST_BATCH_COMPLETED` |

Not measured in this recording: Inbox navigation or time to usable conversations. No `INBOX_USABLE` event belongs to this pairing attempt.

The installed library currently performs startup serially at `node_modules/whatsapp-web.js/src/Client.js:442-493`: LocalAuth preparation, Puppeteer launch, LocalAuth post-launch setup, web-version cache setup, navigation, then injection. The existing trace only surrounds that aggregate, so the longest internal startup operation is not yet proven.

## 3. Confirmed root causes

### 3.1 Browser/WhatsApp initialization dominates QR issuance

- **Description:** 20.790 of 21.620 seconds elapsed before the raw QR was encoded and painted.
- **Source:** installed `node_modules/whatsapp-web.js/src/Client.js:442-493`; Connexa runtime call at `lib/whatsapp-web.ts:2263-2279`.
- **Evidence:** sender initialize start `05:40:32.380`, raw QR `05:40:53.100`, `QR_READY.runtimeToQrMs=20790`, `QR_DISPLAYED.requestedToObservedMs=21620`.
- **Measured cost:** 20.790 seconds runtime-to-generated QR; 21.620 seconds request-to-painted QR.
- **Why:** Chromium launch, page setup, WhatsApp navigation, and injection are serialized. The trace does not yet identify which internal substage dominates.
- **Safe fix:** add reproducible diagnostic stage events without altering execution, then optimize only the measured largest substage. Continue per-channel LocalAuth and single ownership.
- **Expected benefit:** instrumentation itself has negligible timing benefit; it makes the next optimization evidence-based.
- **Risk:** low.

### 3.2 Genuine WhatsApp readiness performs substantial post-auth work

- **Description:** `whatsapp-web.js` does not emit `ready` at `authenticated`; it injects utilities, loads account metadata, and attaches browser callbacks first.
- **Source:** installed `node_modules/whatsapp-web.js/src/Client.js:295-376` and `:585+`; Connexa observation at `lib/whatsapp-web.ts:3310-3359` and `:3414-3500`.
- **Evidence:** `AUTHENTICATED` `05:41:54.864`; helper profile +5.136 s; metadata +7.143 s; `READY` +16.044 s.
- **Measured cost:** 16.044 seconds total, including an 8.898-second listener/ready approximation.
- **Why:** live-message reliability depends on completing the library's helper and event-listener setup before claiming genuine ready.
- **Safe fix:** keep immediate AUTHENTICATING feedback and Inbox-shell navigation, profile exact library stages, and do not fake `ready` or remove live-message listeners.
- **Expected benefit:** dedicated handoff improves perceived speed immediately; actual READY benefit is unknown until deeper trace data exists.
- **Risk:** low for UI/profiling, high for bypassing library readiness (not proposed).

### 3.3 The onboarding parent is disconnected from live child state

- **Description:** the QR panel applies snapshots/SSE to its own state, but the parent sidebar/checklist derives connection from static `health` and `initialWebSetup` props.
- **Source:** `components/whatsapp-connection-onboarding.tsx:170-189`, `:530-588`, and child mount `:894-903`; child live updates at `components/web-qr-setup-panel.tsx:283-411`.
- **Evidence:** video shows Connected in the child while parent still says no numbers and 50%; source contains no state callback from child to parent.
- **Measured cost:** no genuine READY delay, but the UI remains visibly incomplete indefinitely until a server refresh/navigation.
- **Why:** connection state ownership stops at the child component boundary.
- **Safe fix:** publish accepted authoritative child states to parent local state and derive sidebar/checklist from it.
- **Expected benefit:** sidebar and checklist update in the same render as live connection state; perceived completion no longer waits for refresh.
- **Risk:** low if the callback receives only already-fenced snapshot/SSE state.

### 3.4 AUTHENTICATED still renders the QR setup body

- **Description:** `isAuthenticatedHandoff` shows a success notice, but the main body branches only on `showsConnectedSummary`; AUTHENTICATED therefore falls into the QR form/placeholder branch.
- **Source:** `components/web-qr-setup-panel.tsx:203-208`, `:891-899`, and `:961-1083`.
- **Evidence:** source branch and recording both show the empty QR placeholder and refresh/scanning content after acceptance.
- **Measured cost:** no genuine READY delay; up to 16.044 seconds of misleading UI in the latest attempt.
- **Why:** authenticated was added as an extra banner rather than as a mutually exclusive panel state.
- **Safe fix:** render a dedicated finalization panel and Inbox action for AUTHENTICATED.
- **Expected benefit:** immediately communicates scan success for the entire 16-second WhatsApp finalization window.
- **Risk:** low.

### 3.5 History import is not the latest authentication bottleneck

- **Description:** the latest READY trace had zero active history jobs, and the new bootstrap was queued only after ready.
- **Source:** scheduler starts after ready in `lib/whatsapp-web.ts:3414+`; event sequence in the runtime-event table.
- **Evidence:** `AUTHENTICATED.activeHistoryJobs=0`, `READY.activeHistoryJobs=0`; history queued at `05:42:11.105` after ready `05:42:10.908`.
- **Measured cost:** zero demonstrated contention in this sample.
- **Why:** pairing-priority work already prevents a new heavy import from competing with this pairing.
- **Safe fix:** retain history concurrency one and existing pairing priority.
- **Expected benefit:** preserves reliability; no new speed claim.
- **Risk:** low.

## 4. Suspected causes

These are deliberately not presented as root causes:

- The 20.790-second startup may be dominated by Puppeteer/Chromium launch, WhatsApp document load, WebSocket/bootstrap state, or initial injection. Existing telemetry cannot separate them.
- LocalAuth profiles are large (approximately 114 MB, 183 MB, 429 MB, and 757 MB for the four staging sessions). Cache/profile I/O may contribute to cold or restored startup variance, but no per-stage I/O trace proves this.
- Current Chromium processes can be CPU-heavy during background WhatsApp/history activity, but the latest auth-to-ready sample had low event-loop utilization, only ~2 CPU-seconds, zero history jobs, and no cgroup throttling.
- A bounded per-channel pre-initialization could hide startup time, but the current guided panel already starts immediately on mount after explicit selection. How much earlier the business flow can safely begin is not yet measured.
- A warm browser pool might reduce cold launch time, but it is not proven and risks cross-tenant/session ownership. It is not recommended without an isolated prototype.

## 5. Bottleneck ranking

1. **61.475 s — user/phone scan interval.** Largest observed interval, but not a Connexa server optimization target.
2. **20.790 s — aggregate Chromium/WhatsApp initialization before QR.** Largest controllable measured interval; internal split pending instrumentation.
3. **16.044 s — WhatsApp authenticated-to-ready.** Helpers 5.136 s, account metadata 2.007 s, remaining listener/ready approximation 8.898 s.
4. **4.447 s — first history batch.** Fully asynchronous and after connection, so it does not block QR or ready.
5. **0.779 s — ready to durable UI_CONNECTED record.** Browser rendered effectively immediately; this includes timing POST/persistence and clock skew, not a measured render stall.

## 6. Optimization proposals

| Label | Proposal | Expected benefit | CPU / memory | Reliability risk | Complexity | Actual READY or perceived UI? |
|---|---|---|---|---|---|---|
| IMPLEMENTED | Propagate authoritative, fenced child connection state to the onboarding parent | Immediate accurate sidebar/checklist; exact milliseconds depend on SSE/poll delivery | Negligible | Low | Low | Perceived UI |
| IMPLEMENTED | Replace the QR body with a dedicated AUTHENTICATING handoff | Removes up to the full 16.044 s of misleading QR UI in latest sample | Negligible | Low | Low | Perceived UI |
| IMPLEMENTED | Patch `whatsapp-web.js` with diagnostic-only initialize/auth stages and record them with the connection attempt | Unknown direct speed benefit; identifies browser launch vs navigation vs injection | Tiny event/log overhead | Low | Medium | Enables actual READY optimization |
| RECOMMENDED BUT NOT IMPLEMENTED | Move explicit per-channel initialization earlier than the QR screen only after measuring an earlier safe trigger | Could hide part of 20.790 s; exact benefit unknown | One Chromium session starts earlier | Medium: abandoned flows consume resources | Medium | Perceived QR speed |
| RECOMMENDED BUT NOT IMPLEMENTED | Bound and clean nonessential Chromium cache/profile growth without deleting LocalAuth credentials | Unknown until stage/I/O correlation | Likely lower disk; cache misses may increase CPU/network | Medium: cache/session corruption if scoped incorrectly | High | Potential actual startup |
| RECOMMENDED BUT NOT IMPLEMENTED | Optimize specific post-auth callback attachment only after exact per-listener timings | Unknown; target is the 8.898 s approximation | Likely neutral | High if live listeners are missed | High | Actual READY |
| NOT FEASIBLE / NOT PROVEN | Add CPU reservation or increase history concurrency now | No demonstrated benefit in latest trace | Higher contention/cost | Medium | Medium | Not proven |
| NOT FEASIBLE / NOT PROVEN | Shared Chromium/browser pool across tenant LocalAuth sessions | Unknown | Potentially high memory | High isolation/session risk | High | Not proven |
| NOT FEASIBLE / NOT PROVEN | Emit a synthetic READY at authentication | Would cosmetically remove 16.044 s | Neutral | Unacceptable live-message reliability risk | Low | Fake only |

Environment evidence: 4 CPUs, no CPU quota, `nr_throttled=0`, no cgroup OOM events, XFS profile volume at 76% use, direct DNS 49 ms, TLS ready 150.5 ms, and full `https://web.whatsapp.com/` response 534.1 ms during a spot check. These spot checks are not substitutes for Chromium navigation traces.

## 7. Five-second feasibility

- **QR under five seconds: NOT YET PROVEN.** The latest is 21.620 seconds to paint. Under five seconds may be achievable as perceived time with sufficiently early, bounded per-channel initialization, or through a future measured Chromium/WhatsApp optimization, but current evidence does not establish it.
- **Authenticated to genuine READY under five seconds: POSSIBLE IN SOME EXISTING SAMPLES, NOT RELIABLY PROVEN.** Restored staging samples include 3.868 and 4.390 seconds, while the latest fresh QR pairing took 16.044 seconds and a prior PohMY pairing took 29.796 seconds. Fresh and restored cases must not be combined into a service-level claim.
- **Inbox shell under five seconds: ARCHITECTURALLY FEASIBLE BUT NOT MEASURED FOR THIS RECORDING.** The UI already allows nonblocking navigation after AUTHENTICATED, but the recording has no matching `INBOX_USABLE` event. A claim requires a new end-to-end sample.

### Baseline sample notes

- Fresh PohMY QR traces with complete request/QR data: request-to-generated QR 42.443 s and 20.822 s (n=2; provisional median 31.633 s; a two-sample P95 is not meaningful). Latest request-to-painted QR is 21.620 s (n=1).
- Fresh PohMY authenticated-to-ready traces associated with those QR pairings: 29.796 s and 16.044 s (n=2; provisional median 22.920 s; P95 is not meaningful).
- All recorded authenticated-to-ready samples include 18 observations from multiple channels and mixed lifecycle types. They are retained as raw operational evidence but must not be used as a fresh-pairing P50/P95.
- No after-change backend sample can be collected without another genuine user pairing; existing successful sessions must not be reset merely to manufacture a benchmark.

This document was created before implementation, as required, and the following final section was added after validation and staging deployment.

## Final implementation and validation report

### 1. Root causes confirmed after instrumentation

The diagnostic patch produced two restored-session traces immediately after staging deployment. They do not replace a fresh QR trace, but they now separate the major initialization operations:

| Restored channel | Profile-lock recovery | Chromium available | WhatsApp navigation | Initial injection | Initialize after retry | Authenticated → ready |
|---|---:|---:|---:|---:|---:|---:|
| PohMY | 1.477 s before retry | 4.755 s | 11.466 s | 11.243 s | 27.512 s | 6.721 s |
| Joey | 1.362 s before retry | 3.761 s | 9.080 s | 21.425 s | 34.295 s | 4.811 s |

This confirms that, for restored sessions, **WhatsApp document navigation and injection/bootstrap—not browser process launch alone—dominate initialization**. Chromium launch consumed 3.761–4.755 seconds, while navigation plus injection consumed 20.709–30.505 seconds. The first launch in each restored profile encountered a stale profile lock left by the replaced container and recovered through the existing safe lock-clear retry. This added 1.362–1.477 seconds during deployment restore; it is not present in the latest fresh QR trace and is not identified as that trace's primary cause.

The exact post-auth trace also corrects the earlier polling approximations:

- PohMY: helpers 0.452 s, account metadata 2.554 s, listeners attached 6.715 s, ready 6.721 s.
- Joey: helpers 2.705 s, account metadata 3.536 s, listeners attached 4.810 s, ready 4.811 s.

The remaining post-auth work is primarily listener attachment after metadata in PohMY (~4.161 s) and helper injection in Joey (~2.705 s). These are required for live-message reliability; no listener was removed or bypassed.

### 2. Source files and lines changed

- **IMPLEMENTED:** `components/web-qr-setup-panel.tsx:52-58, 252-265, 870-946` adds the parent state callback and a mutually exclusive AUTHENTICATING handoff. The QR instructions are no longer rendered after scan acceptance.
- **IMPLEMENTED:** `components/whatsapp-connection-onboarding.tsx:165-201, 224-254, 569-627, 933-943` owns live child state for the selected channel and updates connected number, readiness, progress, and checklist without `router.refresh()`.
- **IMPLEMENTED:** `scripts/patch-whatsapp-web-media-id.mjs:72-178` reproducibly instruments installed `whatsapp-web.js` initialize/auth stages during `postinstall`; it does not reorder or skip library work.
- **IMPLEMENTED:** `lib/whatsapp-web.ts:176-177, 2257-2260, 3218-3251, 3306-3322, 3500-3542, 4520-4522` captures diagnostic events, fences them to the current client, logs them, and includes them in durable QR/READY metadata.
- **IMPLEMENTED:** `tests/whatsapp-web-media-send-patch.test.mjs:35-50` covers patch output/idempotence; `tests/whatsapp-qr-responsive-onboarding.test.mjs:15-35` covers the handoff and parent state wiring.
- **IMPLEMENTED:** `docker-compose.deploy-wa.yml:3,6` pins the validated staging images.

### 3. Exact behavior changes

1. An accepted, non-stale snapshot/SSE state is mirrored from `WebQrSetupPanel` to its onboarding parent. Stale events remain rejected before the callback sees them.
2. AUTHENTICATED renders only scan-success/finalization content and a `Continue to Inbox` action. It no longer shows a QR placeholder, refresh controls, or scanning instructions.
3. The sidebar's connected number and progress/checklist use the same live state as the QR panel. No server refresh is needed for the transition.
4. The installed library emits diagnostic events at LocalAuth preparation, browser availability, web cache, navigation, injection, helpers, account metadata, listener completion, and ready emission. These events are observational only.
5. LocalAuth, client ownership, connection persistence, SSE ordering, live message listeners, history concurrency, and background import behavior are unchanged.

### 4. Before/after timing results

| Metric | Baseline | After deployment | Improvement | Samples / qualification |
|---|---:|---:|---:|---|
| Connect request → QR visible | 21.620 s | Not remeasured | Not claimed | Baseline n=1 painted QR; a new genuine pairing is required |
| Chromium launch | Previously unmeasured | 4.755 s PohMY; 3.761 s Joey | Profiling visibility, not a speed claim | Restored n=2 |
| WhatsApp navigation | Previously included in 20.790 s aggregate | 11.466 s; 9.080 s | Profiling visibility | Restored n=2 |
| Initial injection | Previously included in aggregate | 11.243 s; 21.425 s | Profiling visibility | Restored n=2 |
| QR accepted → AUTHENTICATED | 61.475 s from paint (user/phone interval) | Not remeasured | Not claimed | Fresh baseline n=1 |
| AUTHENTICATED → READY | Latest fresh 16.044 s | Restored 6.721 s and 4.811 s | No causal comparison: lifecycle types differ | Fresh n=1 vs restored n=2 |
| READY → UI CONNECTED | Effectively immediate; durable timing row +0.779 s | Source/test validated; no new paired browser sample | No numeric claim | Baseline n=1 |
| AUTHENTICATED → accurate full onboarding UI | Up to 16.044 s of stale/misleading widgets | Event-driven next React render | Perceived delay removed; milliseconds not instrumented | Deterministic code path, no fabricated timing |
| READY → history first batch | Start +5.307 s; complete +9.754 s | Unchanged by this release | None intended | Baseline pairing n=1 |
| QR accepted → Inbox shell | Not measured | Not measured | Not claimed | Recording did not open Inbox |

For the two post-deployment **restored** authenticated-to-ready samples only, provisional P50 is 5.766 s and interpolated P95 is 6.626 s. With n=2, these are not meaningful service percentiles. Fresh-pairing P50/P95 remain unproven. The two known fresh PohMY authenticated-to-ready values remain 29.796 s and 16.044 s (provisional median 22.920 s; P95 not meaningful).

### 5. CPU, RAM, disk, and network impact

- Diagnostic events add small in-memory records and log/JSON fields; no new browser, worker, polling loop, database table, or history slot was added.
- Latest fresh auth trace: ~2.009 CPU-seconds over 16.041 seconds, event-loop utilization 0.1347, event-loop lag P95 22.4 ms, zero active history jobs, one major fault, and sender RSS 149.5 MB at the measured process snapshot.
- Host: 4 CPUs, no configured CPU quota, `nr_throttled=0`, and no OOM events. CPU reservation is therefore not evidence-backed.
- LocalAuth volume: XFS, 79% full after image build; session directories total approximately 1.48 GB and range from 114 MB to 757 MB. They were not modified or cleaned.
- Post-deployment point-in-time Docker usage during active background work was 184.82% CPU and 1.755 GiB for sender, 27.22% CPU and 264.5 MiB for web. This is not an idle or controlled before/after sample and must not be attributed to the profiler.
- Spot network check: DNS 49 ms, TLS ready 150.5 ms, complete WhatsApp Web HTTP response 534.1 ms. Browser navigation remained 9.080–11.466 s, confirming that a simple DNS/TLS optimization cannot explain the full delay.

### 6. Risks and unresolved issues

- A fresh QR after this release has not occurred, so the stage split for an unpaired session and after-change request-to-painted-QR are still unknown.
- Post-auth listener attachment remains variable. Optimizing it requires per-listener measurements and upstream-library review; removing listeners could lose live messages.
- Restored LocalAuth profiles are large and contain Chromium caches/components. Safe compaction boundaries are unproven; no profile was edited.
- Deployment restores encountered expected stale Chromium profile locks from the replaced container and recovered automatically. Proactive cleanup might save ~1.4 seconds during controlled restarts, but offers no proven fresh-pairing benefit.
- The broad source-pattern suite has one unrelated failure in `whatsapp-basic-functions.test.mjs` (`message_create` regex expectation). It predates and does not touch the changed paths; the focused suite and production build pass.

### 7. Tests performed

- Focused QR/onboarding/patch lifecycle suite in the exact sender image: **19/19 passed**.
- TypeScript `tsc --noEmit`: **passed**.
- Broader WhatsApp/history JavaScript suite: **107/108 passed**; one unrelated stale source-pattern assertion described above.
- `git diff --check` on changed files: **passed**.
- Production Next.js Docker build: **passed**, including type validity and **129/129** static pages; only pre-existing Autoprefixer compatibility warnings.
- Exact sender image inspected: initialize and authentication diagnostic hooks are present.
- Public `/login`: HTTP 200. `/onboarding` unauthenticated redirect: HTTP 307 as expected. Sender `/health` and `/ready`: HTTP 200.

### 8. Staging deployment and session integrity

- **IMPLEMENTED:** deployed staging-only images:
  - `connexa-stg-web:wa-perf-profile-20261028`
  - `connexa-stg-sender:wa-perf-profile-20261028`
- Sender restore sweep completed with no watchdog error. PohMY and Joey returned to genuine READY/CONNECTED and HEALTHY states with their original phone numbers.
- All four LocalAuth directories remained present before and after deployment. No authentication storage was reset or deleted.
- Exactly two primary Chromium browser owners are running for the two restored connected channels; no duplicate client was observed.
- History remains background-owned and concurrency remains one. No live listener, checkpoint, lease, deduplication, or persistence path was removed.

### 9. Rollback images

- `connexa-stg-web:rollback-before-wa-perf-profile-20261028`
- `connexa-stg-sender:rollback-before-wa-perf-profile-20261028`
- Earlier rollback references remain available:
  - `connexa-stg-web:rollback-before-pohmy-20261028`
  - `connexa-stg-sender:rollback-before-pohmy-20261028`

### 10. Production rollout recommendation

- **RECOMMENDED BUT NOT IMPLEMENTED:** keep this release on staging through at least one authorized fresh QR pairing. Capture the new initialize/auth stage metadata, browser-painted QR, UI_CONNECTED, INBOX_USABLE, and first history batch for that same attempt.
- **RECOMMENDED BUT NOT IMPLEMENTED:** after at least 10 fresh pairings, calculate lifecycle-specific P50/P95 and optimize the largest repeatable stage. Do not mix fresh QR and restored-session samples.
- **RECOMMENDED BUT NOT IMPLEMENTED:** profile individual listener exposure calls if listener attachment remains above five seconds in fresh pairings.
- **RECOMMENDED BUT NOT IMPLEMENTED:** test bounded earlier initialization only from an explicit user channel-selection action, with a hard concurrency cap and idle cleanup that does not delete LocalAuth.
- **NOT FEASIBLE / NOT PROVEN:** do not add a shared cross-tenant Chromium pool, synthetic READY, higher history concurrency, CPU reservation, or LocalAuth cache deletion based on the current evidence.
- **Production decision:** not yet recommended until a fresh staging pairing verifies the UI handoff and supplies the missing after timings. The code is deployed and healthy on staging, but a sub-five-second claim is not supported.
