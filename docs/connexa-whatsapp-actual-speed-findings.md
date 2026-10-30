# Connexa WhatsApp actual speed findings

**Investigation date:** 28 October 2026  
**Staging result:** **NO VERIFIED PERFORMANCE IMPROVEMENT**

This report intentionally separates fresh QR pairing from restored-session startup. It does not claim an improvement from a healthy build, container status, UI transition, or a restored LocalAuth session.

## A. Why the latest connection is still slow

The referenced recording (`Screen Recording 2026-10-28 145707.mp4`) was not present in the available attachments. The nearest and only fresh pairing matching its Malaysia timestamp was correlated from the browser timing events, database runtime events, and sender logs. Video frame timings were not invented.

- Workspace: `01385196535247f78af8c4aea44538d0`
- Channel: `cmvrlc9xn008m0po2d0t22x9a`
- Attempt: `cmvrlc9xn008m0po2d0t22x9a:mvrrfgke:3`
- Malaysia interval: 14:55:19.629 request, 14:55:43.107 QR painted, 14:56:52.244 authenticated, 14:57:01.877 genuine READY
- UTC interval: 06:55:19.629 request, 06:55:43.107 QR painted, 06:56:52.244 authenticated, 06:57:01.877 genuine READY

### Latest fresh-pairing timeline

| Stage | Duration | Evidence / qualification |
|---|---:|---|
| Page request -> QR painted | **23.478 s** | Browser timing event (`requestedAt` -> `observedAt`) |
| Request -> sender initialization | 0.649 s | Browser request timestamp -> profiler `initialize:start` |
| LocalAuth pre-browser preparation | 0.001 s | Profiler; not a material cost |
| Chromium launch | **2.695 s** | `browser-launch:start` -> `browser-available` |
| LocalAuth after-browser setup | 0.016 s | Profiler |
| Web-version cache lookup | 0.004 s | Lookup only; it missed the requested version |
| WhatsApp Web navigation | **5.338 s** | `navigation:start` -> `navigation:complete` |
| Injection start -> raw QR event | **14.164 s** | Sender log timestamps |
| Complete initial injection/bootstrap | **15.193 s** | `inject:start` -> `inject:complete`; QR arrived 1.029 s before the method returned |
| QR encoding | 0.689 s | Sender QR profiler |
| Sender request -> encoded QR ready | **22.346 s** | Durable `QR_READY` event |
| Encoded QR -> browser paint | Effectively immediate, but not positively separable | The two containers' clocks differ by about 77 ms. Total browser request -> paint exceeds sender request -> ready by 1.132 s, which also includes dispatch and clock skew. |
| AUTHENTICATED -> helpers injected | **4.335 s** | Monotonic auth profiler |
| Helpers -> account metadata | **1.209 s** | 5.544 s cumulative minus 4.335 s |
| Account metadata -> listeners attached | **4.084 s** | 9.628 s cumulative minus 5.544 s |
| Listeners attached -> READY | 0.001 s | READY was emitted only after listener attachment |
| AUTHENTICATED -> genuine READY | **9.633 s** | Durable READY event; monotonic value 9.629 s |
| READY -> connected UI | **0 ms observed** | UI event clamps the accepted snapshot to zero; durable timing POST arrived later |
| READY -> Inbox usable | **Not measured** | The matching timing stream contains no `INBOX_USABLE` event and the recording file was unavailable |
| READY -> history first batch complete | 10.815 s | History started 5.170 s after READY and completed independently |

The controllable pre-QR time is dominated by WhatsApp injection/bootstrap, not by QR encoding or frontend polling. Injection to the raw QR consumed 14.164 seconds (60% of page-to-paint time), navigation consumed 5.338 seconds (23%), and Chromium launch consumed 2.695 seconds (11%).

History was not the cause in this attempt. `activeHistoryJobs=0` at AUTHENTICATED and READY. The pairing's bootstrap history job was queued only after READY.

### CDP and host evidence

A read-only Chrome DevTools Protocol inspection of the same PohMY page retained its initial navigation timing:

- navigation 5.626 s, closely matching the 5.338 s sender profiler;
- main-document TTFB 0.289 s, so DNS/TLS/main-response latency does not explain the five-second navigation;
- 404 retained resource entries, 281 with zero transfer size (69.6%), and 6.36 MB transferred across retained entries;
- initial `static.whatsapp.net` JavaScript bundles included 1.31 MB in 2.848 s, 233 KB in 2.026 s, and 599 KB in 1.078 s;
- additional injection-time bundles began around 8.1 s, including 1.56 MB in 2.430 s and 364 KB in 1.442 s.

This supports a resource-download plus browser parsing/module-bootstrap bottleneck. The historic WebSocket transition and historic main-thread long tasks were not recoverable after the fact, so their individual shares inside the 15.193-second injection stage remain unknown.

The host also has limited headroom when several accounts are active:

- 4 vCPUs and 3.8 GiB RAM, with 305 MiB free and 2.0 GiB swap in use at inspection time;
- three active WhatsApp browser owners, 35 Chromium processes, and about 1.97 GiB aggregate Chromium RSS;
- sampled renderers at approximately 81%, 27%, and 15% CPU;
- sender container approximately 1.6 GiB at the sampled point;
- four LocalAuth profiles total about 1.58 GiB; PohMY's profile is about 194 MiB.

Those host measurements were taken after the latest pairing and prove material multi-browser contention exists, but they must not be presented as the exact resource snapshot at 06:55. During the latest auth interval, Node event-loop P95 was only 23.9 ms, event-loop utilization was 0.1023, active history jobs were zero, and two browser owners were reported. The earlier metrics measured Node well but did not measure total Chromium CPU/RSS.

## B. Previous changes versus actual benefits

| Previous work | Actual benefit | Backend startup reduction demonstrated? |
|---|---|---|
| Decoupled READY from history import and moved scheduling to the sender | Reliability and nonblocking Inbox/history behavior | No QR or AUTHENTICATED -> READY reduction |
| Progressive bootstrap, checkpoints, leases, fairness, and one heavy-history slot | Reduced background interference and preserved resumability | No reduction in the latest sample; no history job was active |
| Minimal connection-status endpoint, SSE snapshot, stale-response fencing, polling fallback | Faster and more reliable UI state delivery | UI only; latest READY -> connected UI was already effectively immediate |
| Removed critical-path `router.refresh()` and rendered CONNECTED/AUTHENTICATING locally | Removed misleading/stale UI and navigation refreshes | UI only |
| QR expiry/recovery, single client ownership, profile-lock recovery, and session persistence work | Reliability; fewer failed or duplicated sessions | No demonstrated cold-start speed reduction |
| Pairing priority over newly dispatched heavy history work | Prevents a new heavy job from starting during pairing | Protective, but no measured benefit when `activeHistoryJobs=0` |
| QR/READY/runtime metrics and stage profiler | Located navigation, injection, helper, metadata, and listener costs | Instrumentation only |
| Latest onboarding parent-state and AUTHENTICATING panel release | Clearer perceived completion | No backend work was removed or reordered |

The immediately preceding equivalent fresh PohMY pairing is the only valid direct comparison:

| Fresh QR metric | Prior attempt | Latest attempt | Change |
|---|---:|---:|---:|
| Sender request -> QR ready | 20.822 s | 22.346 s | **1.524 s slower (7.3%)** |
| AUTHENTICATED -> READY | 16.044 s | 9.633 s | 6.411 s faster (40.0%) |
| READY -> connected UI | Effectively immediate | Effectively immediate | No material change |

There is one sample per side and the intervening release was observational/UI-focused. Therefore the 40% auth-to-READY change is normal operational variance, not a verified causal improvement. Restored-session results of 4.811-6.721 seconds are not used as fresh-pairing comparisons.

## C. Actual bottleneck

The largest measured operation is **WhatsApp Web injection/bootstrap before QR**, at 14.164 seconds to the raw QR and 15.193 seconds to full injection return. It includes waiting for WhatsApp modules, AuthStore exposure, WebSocket state movement out of opening/pairing states, QR callback registration, and QR material generation.

The second pre-QR cost is **WhatsApp navigation and resource execution**, at 5.338 seconds. A 289 ms main-document TTFB rules out the main HTTP request as the dominant delay. Several large, cache-missed WhatsApp JavaScript bundles continue loading during initial injection.

After authentication, required whatsapp-web.js initialization is sequential:

1. `LoadUtils` / helper injection: 4.335 seconds.
2. Account connection serialization: another 1.209 seconds.
3. Registration of required live-message, ACK, revoke, edit, state, call, reaction, poll, and chat listeners: another 4.084 seconds.
4. READY emission: 1 ms later.

The listener code performs 24 `exposeFunctionIfAbsent` operations in the library, each currently checking the browser before exposing a binding. Parallelizing, skipping, or deferring these without an authenticated canary could lose live events, so it is not a safe unmeasured patch.

### Configuration and compatibility findings

- Connexa uses whatsapp-web.js **1.34.7**, the current npm stable release as of this investigation.
- whatsapp-web.js brings Puppeteer **24.38.0**, whose declared Chrome revision is **146.0.7680.31**.
- Staging executes system Chromium **156.0.8078.47** while advertising the library default **Chrome 101** user-agent.
- This three-way version/user-agent mismatch is a compatibility risk worth a controlled canary, but it is not proven to cause the measured delay.
- The default requested WhatsApp Web version is `2.3000.1017054665`. Runtime cache files are `2.3000.1052015443` and `2.3000.1052023215`; therefore the LocalWebCache lookup misses on every normal startup.
- The two runtime versions changed within about one hour. Pinning one current HTML file could quickly become stale, and upstream issue reports show that pinning an older web build can restore one behavior while breaking message reception. A cache pin is not safe to deploy from one synthetic timing.
- LocalAuth JavaScript preparation took only 1 ms. Profile I/O can be part of Chromium's 2.695-second launch, but it does not explain the 15.193-second injection.

Upstream references: [Client/webVersionCache documentation](https://docs.wwebjs.dev/Client.html), [LocalWebCache documentation](https://docs.wwebjs.dev/LocalWebCache.html), [whatsapp-web.js releases](https://github.com/wwebjs/whatsapp-web.js/releases), and [1.34.7 initialization-hang report](https://github.com/wwebjs/whatsapp-web.js/issues/201818). An issue report is compatibility evidence, not proof that Connexa has the same defect.

## D. Optimization experiments

| Experiment | Baseline | Variant | Result | Conditions / sample count | CPU and memory | Reliability decision |
|---|---:|---:|---|---|---|---|
| Equivalent fresh pairing before/after the UI/profiler release | 20.822 s request -> QR; 16.044 s auth -> READY | 22.346 s request -> QR; 9.633 s auth -> READY | QR 7.3% slower; auth -> READY 40.0% faster, but not attributable | Fresh PohMY, n=1 each | Latest: Node CPU 0.815 s over auth interval, RSS 180.6 MB, event-loop P95 23.9 ms, 2 Chromium owners | No backend speed claim |
| Local web-version cache miss versus exact current-version cache hit, disposable unpaired profiles | Cache miss: 10.095 s navigation; no QR by 65 s | Cache hit: 7.514 s navigation; QR at 38.731 s | Hit beat a censored timeout but remained 73% slower than the real latest pairing; no valid percentage against a completed baseline | Synthetic, sequential n=1 each; live staging host; no account/session touched; background load and WhatsApp rate limiting uncontrolled | Load average 5.7-6.5; sender roughly 1.6 GiB and 59-67% CPU before/after; a large history job overlapped part of testing | **Rejected.** Not repeatable/controlled, stale-version risk, no message send/receive validation |
| Passive CDP navigation/cache inspection | N/A | Active profiles navigated in 5.626 s, 9.056 s, and 13.551 s | Shows wide account/profile/resource variance and large JS bundle costs; not an optimization | Restored active sessions, n=3; read-only aggregation; no content/QR/token captured | No extra browser; momentary diagnostics only | Observational only |
| Align Puppeteer with Chrome 146 and test modern user-agent | Current is Puppeteer target 146 / system Chromium 156 / advertised UA 101 | Not run | No timing result | No explicitly authorized test account was available for scan, send, receive, reconnect, and media reliability validation | Would require another browser binary and canary capacity on a memory-constrained host | Deferred; do not change production browser blindly |
| Parallelize or omit post-auth listener bindings | 4.084 s metadata -> listeners | Not run | No timing result | Requires an authenticated canary capable of validating every critical live event | Likely lower latency, neutral memory, but unknown browser/CDP behavior | Rejected until per-listener timings and reliability tests exist |

No QR secret, authentication token, or message content was captured. Disposable synthetic profiles were removed and no healthy LocalAuth session was reset.

## E. Before versus after

There is **no deployed after-state for an actual backend speed optimization** in this phase because no experiment met the safety and repeatability threshold.

| User-visible milestone | Before (previous fresh PohMY) | Current (latest fresh PohMY) | Verified improvement? |
|---|---:|---:|---|
| Request -> encoded QR ready | 20.822 s | 22.346 s | **No; 7.3% slower** |
| Page request -> QR painted | 21.620 s in the prior recorded attempt | 23.478 s | **No; 8.6% slower** |
| AUTHENTICATED -> genuine READY | 16.044 s | 9.633 s | One sample is faster, but **not verified as causal/repeatable** |
| READY -> connected UI | Effectively immediate | 0 ms observed | Already solved; no meaningful speed gain remains |
| READY -> Inbox usable | Not measured | Not measured | Unknown |

Combining the two backend-controlled intervals while excluding the user's phone/scan time gives 36.866 seconds before versus 31.979 seconds now (13.3% lower). With n=1 per side and a longer QR wait, this is not a release-level performance claim.

**Conclusion: NO VERIFIED PERFORMANCE IMPROVEMENT.** The user still waits longer to see the QR. Genuine READY was faster in this one attempt, but the change is not tied to a proven backend optimization.

## F. Five-second feasibility

### QR visible within five seconds

**Not achievable reliably as a cold request in the current single-sender setup.** Chromium launch alone consumed 2.695 seconds, leaving 2.305 seconds for 5.338 seconds of navigation and 14.164 seconds of injection. A sub-five-second perceived QR requires starting this work earlier from explicit user intent or keeping an isolated unpaired runtime warm; both need strict tenant ownership and resource limits.

### Genuine WhatsApp READY within five seconds

**Not achievable reliably for fresh pairing with the current upstream initialization path.** The latest fresh auth-to-READY time is 9.633 seconds. Restored sessions have occasionally reached 4.811 seconds, but they are a different lifecycle and cannot establish a fresh-pairing target. Emitting CONNECTED before required live listeners are attached would be a fake READY and is not acceptable.

### Usable Inbox within five seconds

**From genuine READY: yes, architecturally, and the connected UI is already immediate. From page open or AUTHENTICATED: not yet proven.** The latest attempt did not record `INBOX_USABLE`. The Inbox may render its shell while WhatsApp finalizes, but live-send/receive readiness must remain explicitly distinct from that shell state.

## G. Final recommendation

The next change most likely to create a significant, measurable improvement is **resource isolation plus an authorized browser-compatibility canary**, not another frontend change and not an unvalidated web-version pin.

1. **Give pairing a dedicated resource boundary.** Shard sender accounts across containers/hosts or provide a dedicated pairing worker with explicit CPU and memory reservation, then hand ownership to exactly one persistent sender without copying or concurrently opening LocalAuth. The current 3.8 GiB host has about 2 GiB of live Chromium RSS and uses swap; it is not a credible platform for a reliable cold-start SLO across several accounts.
2. **Add finer diagnostic stages before changing behavior.** Split injection into Debug/module wait, device-name setup, AuthStore exposure, WebSocket-state wait, QR binding, and initial QR generation. Split listener attachment per binding. Capture CDP network/cache/CPU metrics from navigation start, not after the attempt. This is instrumentation, not a speed claim.
3. **Use one explicitly authorized staging test account for controlled A/B runs.** Run at least 10 fresh pairings per variant under the same idle and active-import conditions. Compare current Chromium 156 against Puppeteer's supported Chrome 146, then compare the default UA against an aligned supported UA. Validate text/media send, inbound messages, ACKs, reconnect, QR refresh, SSE reconnect, and session restore after every candidate.
4. **Test earlier initialization only after isolation.** Start the channel-specific client on an explicit “Connect WhatsApp” intent before the QR panel finishes rendering. Measure both action -> QR and page -> QR. Cancel only an unpaired disposable runtime after a bounded idle timeout; never delete LocalAuth.
5. **Do not pin the observed WhatsApp Web build now.** The build changed within an hour, the synthetic result was not controlled, and stale HTML can compromise live-message behavior.
6. **Do not parallelize or defer required live listeners without an authenticated reliability canary.** The potential four-second gain is real, but missed events would violate the primary acceptance criterion.

No sender/web application image was rebuilt or deployed for this phase because there is no proven safe performance change to deploy. Staging remains on `connexa-stg-web:wa-perf-profile-20261028` and `connexa-stg-sender:wa-perf-profile-20261028`; all existing sessions remain intact.
