# Connexa PohMY QR fix — staging release 2026-10-28

## Account identification and recorded attempt

- Authorized staging records identify PohMY as workspace `01385196535247f78af8c4aea44538d0`, channel `cmvrlc9xn008m0po2d0t22x9a`.
- The relevant runtime generation was `cmvrlc9xn008m0po2d0t22x9a:mvrlcbw9:3`.
- Pairing was requested at approximately `2026-10-28T04:04:57.064Z` based on the sender's monotonic request-to-QR measurement.
- The first QR was generated at `04:05:39.507Z`: request-to-QR 42.443s, runtime-to-QR 42.386s, encoding 601ms.
- The browser posted its first QR-displayed acknowledgement at `04:05:40.639Z`. The browser-supplied observation timestamp was `04:05:39.478Z`; because it precedes the durable event timestamp by 29ms, it is not reliable as a paint measurement. The old telemetry ran on React state change, not image paint.
- QR versions 2 and 3 were observed by the browser at `04:06:38.040Z` and `04:06:58.159Z`.
- WhatsApp emitted `AUTHENTICATED` at `04:08:59.910Z` and `READY` at `04:09:29.706Z`, an authenticated-to-ready duration of 29.796s.

The evidence does not show that the sender generated a QR which the browser permanently lost. It shows a 42.4s WhatsApp/Chromium generation delay, followed by browser receipt around the time of the refresh. The original `QR_DISPLAYED` metric confirms React had QR data but did not prove the image had painted visibly. The new measurement is tied to image load plus two animation frames.

## Confirmed defects

1. The SSE stream subscribed to live events but had no authoritative replay. A subscriber opening or reconnecting after a QR event depended on PostgreSQL polling and could remain in `PREPARING` until a snapshot arrived.
2. A direct `AUTHENTICATED` event was published before persistence, while an older serialized QR persistence could finish later. The resulting newer PostgreSQL `updatedAt` allowed a polling snapshot to move the frontend backward from `AUTHENTICATED` to `QR_READY`/expired.
3. whatsapp-web.js 1.34.7 contains the reported `UNPAIRED_IDLE` defect: an exposed Puppeteer callback invokes `window.require(...)` from Node. The rejection can be silent and prevent the next QR refresh.

## Changes

- The connection SSE route now registers its tenant/channel-scoped listener first, then asynchronously fetches and emits the sender's authoritative runtime snapshot.
- Runtime snapshots include connection-attempt ID, runtime event sequence, QR version, and the last runtime connection timestamp. Live events racing the snapshot are reconciled by the browser using this ordering metadata.
- SSE responses explicitly disable proxy buffering and provide a reconnect interval.
- The frontend rejects delayed QR/preparation states after `AUTHENTICATED`, `CONNECTED`, or `READY`, while still accepting explicit disconnect, failure, or later re-auth states.
- Older event sequences and QR versions are rejected within an attempt. Authentication clears QR data and cannot be overwritten by its expiry path.
- QR-visible telemetry now fires from image `onLoad` after two animation frames, and aborts if authentication or rotation changed the QR before paint.
- The existing postinstall patch script now reproducibly patches whatsapp-web.js 1.34.7 so `UNPAIRED_IDLE` executes `refreshQR()` through `pupPage.evaluate()` in Chromium. No manual node_modules edit is required.

## Validation

- Production Next.js build passed compilation, lint/type validation, and 129-page static generation.
- 50/50 WhatsApp regression tests passed inside `connexa-stg-sender:pohmy-qrfix-20261028`.
- The exact sender image was inspected and contains the browser-context QR refresh patch.
- Deployed staging images:
  - `connexa-stg-web:pohmy-qrfix-20261028`
  - `connexa-stg-sender:pohmy-qrfix-20261028`
- Rollback images preserved:
  - `connexa-stg-web:rollback-before-pohmy-20261028`
  - `connexa-stg-sender:rollback-before-pohmy-20261028`
- All four LocalAuth directories remained present.
- After deployment PohMY restored without relinking and reached `READY`/`HEALTHY` at `2026-10-28T05:17:24.978Z`; its saved session and phone identity were preserved.
- At the first post-restore health sample: two connected runtimes, two Chromium processes, history concurrency one, Node RSS 153.2MB, event-loop-lag P95 27.3ms. Docker sender usage during active reconciliation was 1.69GiB and 225.5% CPU; that is an active-work sample, not idle usage.
- After the reconciliation unit released its slot, sender usage was 1.69GiB and 20.2% CPU, with history active/queued at 0/0 and event-loop-lag P95 at 26.5ms.
- Public staging returned HTTP 200 with 1.29s TTFB at the deployment smoke test.

## Honest timing boundary

- There is no post-fix fresh PohMY QR sample in this release because PohMY is now an active, healthy linked session. Producing another QR would require unlinking/resetting that session, which was explicitly prohibited.
- The next authorized staging pairing will measure browser-visible QR only after actual image paint. That sample is required before reporting an after-change QR-visible P50/P95.
- The fix removes missed-event/replay and stale-state failures, but it does not make the measured 42.4s cold WhatsApp/Chromium QR generation into a 5s operation. That remaining interval is provider/browser controlled and must be profiled separately from event delivery.
