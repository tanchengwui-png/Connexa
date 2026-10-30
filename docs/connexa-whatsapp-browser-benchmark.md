# Connexa WhatsApp browser benchmark

Date: 2026-10-28 (UTC)

Status: **PREPARED, NOT RUN — NO VERIFIED PERFORMANCE IMPROVEMENT**

The controlled A/B/C/D benchmark cannot begin until an isolated staging sender, an explicitly authorized disposable WhatsApp account, an available operator, and a second authorized validation number exist. Existing PohMY, Joey, and `pohh` sessions were not used or modified.

The complete audit, instrumentation, experiment design, safety gates, commands, and current measurements are in `docs/connexa-whatsapp-performance-next-phase.md`.

## Results table

| Variant | Browser | Capacity | User-agent | Completed fresh samples | QR P50/P95 | Authenticated to READY P50/P95 | Reliability | Result |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| A | Chromium 156 | Current sender | Library default | 0 | Not measured | Not measured | Not tested | Blocked |
| B | Chromium 156 | Dedicated | Library default | 0 | Not measured | Not measured | Not tested | Blocked |
| C | Chrome 146 | Dedicated | Library default | 0 | Not measured | Not measured | Not tested | Blocked |
| D | Chrome 146 | Dedicated | Chrome 146 aligned | 0 | Not measured | Not measured | Not tested | Blocked |

The latest valid single fresh-pairing baseline remains 23.478 seconds from request to visible QR and 9.633 seconds from AUTHENTICATED to genuine READY. A single attempt is not a P50/P95 benchmark.

## Required answers

1. **Did resource isolation improve speed?** Not measured. The current host shows CPU saturation, only about 0.7-0.8 GiB available RAM, active paging, and about 1.65 GiB Chromium RSS, so isolation is a justified experiment but not a verified improvement.
2. **Did Chrome 146 outperform Chromium 156?** Not measured.
3. **Did user-agent alignment help?** Not measured.
4. **What operation is now the slowest?** In the latest valid trace, WhatsApp injection/bootstrap to the first raw QR was slowest at 14.164 seconds. The precise internal substage remains unmeasured until the prepared profiler runs on an authorized fresh pairing.
5. **What are the verified before/after timings?** There is no verified after timing. The verified current single-attempt values are 23.478 seconds request-to-QR and 9.633 seconds authenticated-to-READY.
6. **Can Connexa reliably display QR within five seconds?** Not with the verified cold-start path. Chromium launch plus navigation alone measured 8.033 seconds.
7. **What is the safest production architecture?** Keep exactly one persistent LocalAuth owner per channel, preserve all required listeners and durable session data, and shard accounts across resource-isolated sender capacity. Validate a disposable staging canary before changing browser/UA. Do not share a profile between senders, synthesize READY, or promote an untested web-version cache pin.

No browser or user-agent configuration was deployed from this benchmark preparation.
