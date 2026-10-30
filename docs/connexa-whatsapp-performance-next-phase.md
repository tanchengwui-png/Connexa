# Connexa WhatsApp performance: benchmark-ready next phase

Date: 2026-10-28 (UTC)

Status: **NO VERIFIED PERFORMANCE IMPROVEMENT**. This work adds low-overhead diagnostics, safety gates, resource monitoring, and result aggregation. It does not change the active browser, WhatsApp authentication strategy, LocalAuth data, listener behavior, or customer sessions. No new performance configuration was deployed.

## A. Current confirmed bottleneck

The most recent valid fresh-pairing trace remains the only comparable end-to-end measurement:

| Stage | Measured time | Share of request to QR paint |
| --- | ---: | ---: |
| Chromium launch | 2.695 s | 11.5% |
| WhatsApp Web navigation | 5.338 s | 22.7% |
| Injection/bootstrap to raw QR | 14.164 s | 60.3% |
| Remaining QR encode/delivery/paint overhead | about 1.281 s | 5.5% |
| **Request to QR visible** | **23.478 s** | **100%** |

The injection call completed at 15.193 seconds, after the first raw QR was emitted. QR encoding itself took 0.689 seconds. The largest controllable pre-QR stage is therefore WhatsApp Web module/injection/bootstrap, not frontend polling, QR rendering, or history import.

The same attempt measured **AUTHENTICATED to genuine READY at 9.633 seconds**. The observed post-authentication subdivisions were 4.335 seconds to helpers, 1.209 seconds to account metadata, and 4.084 seconds to listener completion. READY to connected UI was effectively immediate.

These are single-attempt values, not P50/P95. Earlier results and the detailed trace are in `docs/connexa-whatsapp-actual-speed-findings.md`.

## B. Findings from existing infrastructure

### Runtime and compatibility

- Sender runtime: Node.js 22.23.4.
- whatsapp-web.js: 1.34.7.
- Puppeteer: 24.38.0, whose managed browser target is Chrome 146.
- System browser: Chromium 156.0.8078.47.
- The existing library-default user-agent advertised Chrome 101 in the prior trace. Browser and user-agent alignment are therefore legitimate compatibility hypotheses, but neither is a verified speed improvement.
- Connexa starts one persistent LocalAuth Chromium client per channel. `lib/whatsapp-web.ts:476-494` contains the unchanged client construction and `lib/whatsapp-web.ts:422-439` contains the browser flags.
- whatsapp-web.js initializes sequentially: browser launch, LocalAuth post-browser setup, web-version cache, navigation, then injection (`node_modules/whatsapp-web.js/src/Client.js:552-675`). Skipping or reordering these steps is not considered safe without an authenticated canary.

### CPU, memory, swap, and browser processes

A read-only snapshot on 2026-10-28 was taken during normal staging operation, not during the historical pairing attempt:

- Host capacity: 4 CPU, 3.8 GiB RAM, 8 GiB swap.
- Available memory ranged around 0.68-0.86 GiB during the audit.
- Swap in use ranged around 2.5-2.7 GiB.
- `vmstat` showed live swap-in of 652-968 KiB/s and swap-out bursts of 3.3-9.7 MiB/s in the sampled interval.
- CPU idle fell to 4-8% in that interval, with run queue values up to 10.
- The sender container briefly measured 146% CPU and about 1.35 GiB resident memory.
- The host-level monitor observed 41 Chromium processes, about 1.65 GiB aggregate Chromium RSS, and about 1.67 GiB aggregate Chromium swap. Browser-owner counting is diagnostic only because Chromium helper command lines can resemble owners.

This proves that the current host experiences material contention and paging. It does **not** prove how many seconds isolation will save. Variant B exists to measure that causal question.

### Storage and LocalAuth profiles

- The filesystem is 81% full (52 GiB used of 64 GiB, 13 GiB available).
- The four preserved Chromium profiles measured 186, 216, 468, and 757 MiB when read as root inside the sender container.
- Their HTTP cache, code cache, and service-worker data are material parts of those totals.
- No profile, cache, cookie, credential, or session file was edited or deleted.
- Profile size can affect I/O and cache behavior, but profile compaction is deliberately excluded from this experiment because safe boundaries have not been proven.

### Navigation, network, and resource cache

The existing passive CDP trace measured:

- navigation: 5.626 seconds, close to the sender's 5.338-second measurement;
- main-document TTFB: 0.289 seconds;
- 404 retained resource entries;
- 281 zero-transfer entries (69.6%);
- 6.36 MiB transferred across retained entries;
- several large JavaScript bundles still loading/executing during bootstrap.

The main HTTP response is not the dominant navigation cost. Resource download, JavaScript parse/execute, module readiness, cache behavior, and CPU contention remain plausible contributors.

The requested WhatsApp Web version was `2.3000.1017054665`, while observed local cache files contained other rapidly changing builds. The normal exact-version cache lookup missed. A prior uncontrolled synthetic comparison did not produce a safe or repeatable improvement, so no cache pin is recommended or deployed.

### Recommended isolated benchmark capacity

The prepared preflight requires, at minimum:

- 4 dedicated vCPU;
- 8 GiB nominal RAM (at least 7 GiB visible to the process);
- at least 4 GiB available before a run;
- no more than 256 MiB swap in use;
- no competing Chromium owners;
- sufficient disk for an isolated image and disposable profile;
- the same region/network path for equivalent A/B comparisons.

This is a test boundary, not a production sizing claim.

## C. Detailed bootstrap analysis

### Already measured

| Operation | Evidence | Result |
| --- | --- | ---: |
| Chromium launch | initialization lifecycle event | 2.695 s |
| navigation | navigation start/complete | 5.338 s |
| injection start to first raw QR | sender lifecycle event | 14.164 s |
| full injection return | sender lifecycle event | 15.193 s |
| QR encoding | QR handler timing | 0.689 s |
| authenticated to helpers | authentication profiler | 4.335 s |
| helpers to account metadata | authentication profiler | 1.209 s |
| metadata to listener completion | authentication profiler | 4.084 s |

### Newly instrumented, not yet measured on an authorized fresh pairing

`scripts/patch-whatsapp-web-media-id.mjs:138-258` now emits correlated observational stages for:

- bootstrap start;
- Debug module readiness;
- device-name setup;
- resolved WhatsApp Web version;
- AuthStore exposure;
- WebSocket-state wait start and completion;
- authentication-strategy completion;
- QR callback binding;
- QR generation and first raw QR;
- core binding registration;
- app-state listener registration;
- bootstrap completion.

It also installs a browser `PerformanceObserver` before navigation and records only aggregate navigation, resource, script, long-task, and JavaScript heap values. It does not record resource URLs, QR contents, credentials, tokens, messages, or contact data. The browser snapshot runs one second after bootstrap completion, keeping the diagnostic CDP call off the QR-paint critical path.

`lib/whatsapp-web.ts:3260-3321` fences these events to the active client and bootstrap ID, retains them in runtime state, and includes them in existing QR/READY diagnostics. This prevents late events from an obsolete client being attributed to a new operation.

Until an authorized fresh pairing runs with this instrumentation, the exact split of the historical 14.164 seconds remains **unmeasured**. Module readiness, AuthStore, WebSocket wait, QR generation, main-thread long tasks, and resource execution are hypotheses, not established causes.

## D. Safe improvements completed now

| Source | Change | Evidence/test | Risk |
| --- | --- | --- | --- |
| `scripts/patch-whatsapp-web-media-id.mjs:138-258` | Added fine bootstrap and aggregate browser diagnostics; delayed the single browser snapshot until after bootstrap | Patch/idempotency/privacy tests pass | Low; observational events and one delayed aggregate evaluation |
| `lib/whatsapp-web.ts:3260-3321` | Correlated diagnostic events to the current client/bootstrap and persisted them in existing runtime metadata | Type-shaped integration and focused tests; no session mutation | Low |
| `lib/whatsapp-web.ts:476-494` | Added optional browser user-agent override only when explicitly configured | Default remains unchanged when unset | Low while unset; requires full pairing regression if enabled |
| `.env.example:93-96` | Documented optional browser path and user-agent experiment variables | Static configuration review | None while unset |
| `config/whatsapp-performance-variants.json` | Defined A/B/C/D one-variable-at-a-time variants and reliability gates | Parsed by tests | None |
| `config/whatsapp-performance-authorization.example.json` | Added fail-closed authorization schema with no credentials | Preflight refusal test passes | None |
| `config/whatsapp-performance-samples.example.json` | Defined lifecycle, resource, and reliability sample shape | Summary fixture test | None |
| `scripts/whatsapp-performance-benchmark.mjs` | Added preflight, host/Chromium monitor, percentile/resource summary, comparisons, and recommendation eligibility | Focused tests and live read-only monitor smoke test pass | Low; benchmark-only tool |
| `package.json:34` | Added `npm run benchmark:whatsapp` entry point | Test invokes script directly | None |

Validation completed:

- focused Node tests: **7 passed, 0 failed**;
- benchmark preflight: confirmed fail-closed with the example authorization;
- monitor smoke test: captured host/Chromium snapshots without changing a session;
- `git diff --check`: passed for the touched files;
- sender health after the audit: healthy (`/health` returned `ok: true`).

A full repository TypeScript check was attempted but stopped after it consumed about 1 GiB and one full CPU for several minutes on the already paging staging host. It produced no diagnostic before termination. This is an **inconclusive resource-protection stop**, not a pass or a source failure. A production build was not run because it would add more contention and, by itself, cannot validate WhatsApp speed or reliability.

### Safe optimization review

| Location | Opportunity | Current evidence | Proposed action | Expected benefit | Risk | Pairing test required |
| --- | --- | --- | --- | --- | --- | --- |
| `node_modules/whatsapp-web.js/src/Client.js:552-675` | Long serial launch/navigation/injection path | 22.197 s of the 23.478 s QR path | Measure the new internal stages first | Unknown | High if reordered | Yes |
| `lib/whatsapp-web.ts:422-439` | Browser flags may influence renderer behavior | No equivalent A/B flag benchmark | Keep flags fixed in first A-D series | Unknown | Medium | Yes |
| `lib/whatsapp-web.ts:476-494` | Browser/UA mismatch | Chrome 146 target, Chromium 156 runtime, default UA previously Chrome 101 | Compare C, then D separately | Unknown | Medium | Yes |
| WhatsApp Web local cache | Exact-version miss and repeated resource work | 6.36 MiB transfer; uncontrolled cache test failed to verify gain | Observe first; do not pin or clear | Unknown | High | Yes |
| LocalAuth profiles | Large and variable profile/cache footprint | 186-757 MiB profiles | Excluded from first experiments | Unknown | High | Yes |
| Post-auth listeners | 4.084 s aggregate | Listener group is a large READY subdivision | Add per-listener timing in canary before any parallelization | Unknown | High reliability risk | Yes |

No initialization behavior, listener ordering, LocalAuth logic, web-version pin, or cache policy was changed.

## E. Prepared benchmark experiments

The variants are defined in `config/whatsapp-performance-variants.json`:

- **A — equivalent baseline:** current Chromium 156, library-default user-agent, current sender behavior.
- **B — resource isolation:** Chromium 156 and the same default user-agent on dedicated capacity.
- **C — browser compatibility:** dedicated capacity, Puppeteer-supported Chrome 146, default user-agent.
- **D — user-agent alignment:** the validated Chrome 146 setup plus an aligned Chrome 146 user-agent.

This sequence changes one variable at a time: A to B changes capacity; B to C changes browser; C to D changes user-agent.

For each variant, collect at least ten completed fresh pairing samples, subject to WhatsApp linking restrictions, plus failed attempts. Record QR-visible time, authenticated-to-READY time, every internal stage, CPU user/system time, peak RSS, swap deltas, minor/major faults, browser long tasks, script transfer/cache counts, and all nine reliability checks.

The result generator uses nearest-rank P50/P95, labels fewer than ten completed samples provisional, reports failures, and calculates exact percentage changes only against the equivalent preceding variant. A variant cannot be recommended unless it is non-provisional, has zero failed attempts, and every critical reliability check passed.

The harness intentionally does not start, link, unlink, restart, or destroy a WhatsApp session. An operator performs the approved disposable pairing through the normal staging flow while lifecycle events and resource snapshots are collected.

## F. Blocked experiments

The following are genuinely unavailable and therefore deferred:

1. A dedicated 8 GiB staging sender with equivalent network placement.
2. An explicitly authorized disposable WhatsApp account.
3. An approved test-phone operator present for at least ten fresh attempts per approved variant.
4. A second distinct authorized WhatsApp number for send/receive, media, and ACK validation.
5. Explicit approval to install/use Chrome 146 on the isolated host.

PohMY, Joey, and `pohh` are forbidden as benchmark accounts. The `pohh` channel shares the PohMY number and must never be used as a fallback. No existing LocalAuth session was unlinked, copied, reset, or modified.

## G. Expected performance opportunities

| Rank | Opportunity | Potential benefit | Confidence | Reliability risk |
| ---: | --- | --- | --- | --- |
| 1 | Dedicated CPU/RAM and no competing browsers | Potentially large because active paging and CPU saturation are confirmed | Medium that it helps; zero confidence on seconds saved until B | Low if implemented as an isolated canary; medium for architecture promotion |
| 2 | Chrome 146 compatibility alignment | Could reduce unsupported browser/library behavior | Low-medium | Medium; full messaging regression required |
| 3 | User-agent alignment | Could remove an obvious compatibility mismatch | Low | Medium; upstream behavior may change |
| 4 | Target the dominant measured bootstrap substage | Potentially large after the new profiler identifies it | Currently unknown | Depends on result; likely medium-high |
| 5 | Web-version/resource cache strategy | Could reduce navigation/resource work | Low after the uncontrolled test failed to verify a safe gain | High due stale-build and message-reception risk |
| 6 | Listener registration changes | At most part of the 4.084-second post-auth group | Medium that the group is costly; unknown per listener | High; can lose live messages/ACKs |

## H. Five-second feasibility

### Request to QR visible

Not currently feasible as a reliable cold-start SLO. Launch plus navigation alone measured 8.033 seconds, before the 14.164-second injection/bootstrap. A five-second target requires a major measured backend change, prewarming with strict tenant ownership, or an architecture that does not cold-start a browser at QR request. None is validated yet.

### AUTHENTICATED to genuine READY

Not currently within five seconds; the last valid attempt was 9.633 seconds. The new stage profiler can identify whether helpers, metadata, listeners, browser contention, or upstream readiness dominates future runs. Connexa must not synthesize READY or omit listeners to make this number look faster.

### Inbox shell availability

Already decoupled from history synchronization and effectively immediate after authoritative CONNECTED/READY. Further frontend changes will not materially reduce Chromium launch, WhatsApp navigation, or injection/bootstrap.

## I. Deployment status

- **Production:** nothing deployed.
- **Staging runtime:** no new browser, user-agent, authentication, LocalAuth, cache, or listener configuration deployed in this phase.
- **Workspace only:** diagnostics, optional unset configuration hooks, benchmark tooling, tests, and this report are prepared and validated locally.
- Existing staging sender/web images and healthy sessions were left running. Rollback state is unchanged.

This phase intentionally does not claim a before/after performance result.

## J. Next actions

Minimum inputs required:

1. Host access to a dedicated staging sender meeting the preflight thresholds.
2. Absolute executable paths for Chromium 156 and the approved Puppeteer-compatible Chrome 146 installation.
3. A completed copy of `config/whatsapp-performance-authorization.example.json` with a unique run ID, expiry, approver, available operator, disposable account identifiers, distinct authorized peer number, approved variants, and at least ten approved attempts.
4. Explicit authorization for fresh disposable pairings and end-to-end messaging validation.

Commands, run from the repository root:

```bash
cp config/whatsapp-performance-authorization.example.json /secure/path/wa-benchmark-authorization.json
cp config/whatsapp-performance-samples.example.json /secure/path/wa-benchmark-samples.json

export WHATSAPP_WEB_EXECUTABLE_PATH=/absolute/path/to/chromium-or-chrome
unset WHATSAPP_WEB_USER_AGENT
export CONNEXA_BENCHMARK_ALLOW_FRESH_PAIRING='AUTHORIZED:<run-id>:A'

npm run benchmark:whatsapp -- preflight \
  --variant A \
  --authorization /secure/path/wa-benchmark-authorization.json \
  --browser "$WHATSAPP_WEB_EXECUTABLE_PATH" \
  --output /secure/path/A-preflight.json

npm run benchmark:whatsapp -- monitor \
  --browser "$WHATSAPP_WEB_EXECUTABLE_PATH" \
  --duration-ms 120000 \
  --interval-ms 1000 \
  --output /secure/path/A-resources.ndjson

npm run benchmark:whatsapp -- summarize \
  --input /secure/path/wa-benchmark-samples.json \
  --output /secure/path/wa-benchmark-summary.json
```

Repeat with B, C, and D in order. For D only, set an approved Chrome 146-aligned `WHATSAPP_WEB_USER_AGENT`; for A-C it must be unset. Change the exact acknowledgement suffix to the active variant each time.

After collection, do not promote the fastest median automatically. Review P50 and P95, failures, bootstrap subdivisions, resource deltas, and every reliability check. Deploy to staging only if the gain is repeatable under equivalent conditions and text, media, ACK, live listener, QR rotation, reconnect, and session persistence checks all pass.
