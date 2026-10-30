# Connexa WhatsApp QR speed — change impact

## Pre-change staging diagnosis — 2026-10-28

- Scope is the QR issuance and pairing lifecycle only. LocalAuth storage, existing linked sessions, live-message handling, history checkpoints, SSE transport, and whatsapp-web.js remain in place.
- The installed `whatsapp-web.js` version is `1.34.7`. Its installed source treats both `UNPAIRED` and `UNPAIRED_IDLE` as authentication states, emits the initial QR, subscribes to future QR references, refreshes on `UNPAIRED_IDLE`, and defaults `qrMaxRetries` to unlimited. Connexa does not need a destructive QR-refresh workaround.
- Recent staging cold/fresh Chromium attempts reached the first sender `qr` event in 14.9s, 17.5s, 19.0s, and 25.8s after `initialize:start`. This establishes Chromium/WhatsApp Web startup as the largest measured pre-QR delay; the current data does not support claiming a 3–5 second cold-start target.
- Connexa adds avoidable delay before and after Chromium startup:
  - runtime creation performs a channel-wide imported-message count before creating the WhatsApp client;
  - the sender start request waits for `Client.initialize()` to return;
  - onboarding waits up to three seconds for sender health plus conversation/message/outbound counts;
  - first guided navigation can reload the page merely to add the sole channel ID;
  - the QR SSE notification is emitted only after QR encoding and PostgreSQL persistence, and it does not carry the QR image, forcing a follow-up status request before rendering.
- The stale UI is an ordering problem: QR expiry is derived from a persisted timestamp, but connection SSE lacks an event sequence and QR generation version. A delayed snapshot can therefore compete with a newer authentication event. The QR handler also does not explicitly reject QR events after the same runtime has entered `AUTHENTICATED`.
- Existing per-channel lifecycle serialization and runtime generation fencing already provide the correct single-flight foundation. They should be extended, not replaced.

## Intended safe changes

- Start a new guided QR session once on mount and acknowledge the sender request immediately while initialization continues in the sender.
- Remove imported-message counts and full health aggregation from the QR critical path; durable history state remains authoritative when background synchronization begins.
- Publish each QR and `AUTHENTICATED` transition immediately from the sender runtime, before persistence latency, with connection-attempt ID, monotonic event sequence, QR version, expiry, and QR image.
- Reject post-authentication QR noise and stale attempt/version events in the frontend; keep a lightweight snapshot for SSE reconnection and polling fallback.
- Keep fresh-session deletion and disconnect operations explicit and place them under troubleshooting UI.
- Add click/open-to-QR and QR-render timing events. Report warm and cold measurements separately after deployment.

## Risk and rollback

- No schema migration is required. QR attempt/version data is runtime/SSE metadata; PostgreSQL remains the reconnect snapshot.
- Auto-start uses the existing non-destructive ensure operation and is limited to an unlinked guided channel. It never invokes fresh-start or deletes LocalAuth.
- If direct SSE is missed, the existing tenant-scoped status endpoint and polling fallback still return the persisted QR.
- Deployment must retain the current web/sender image tags as rollback images and verify the count and paths of LocalAuth session directories before and after restart.

## Staging implementation and release verification — 2026-10-28

- Built and deployed `connexa-stg-web:qr-speed-20261028` and `connexa-stg-sender:qr-speed-20261028` to staging only.
- Preserved rollback images `connexa-stg-web:rollback-before-qr-speed-20261028` and `connexa-stg-sender:rollback-before-qr-speed-20261028`.
- The production web build completed successfully, including Next.js compilation, lint/type validation, and static generation.
- The exact release sender image passed 45/45 WhatsApp channel-hardening, Phase 3 reliability, responsive-onboarding, and QR lifecycle regression tests.
- All four LocalAuth session directories remained mounted after deployment. The two saved sessions selected by the sender restore sweep reached `READY`; no session was deleted or reset.
- After restore, sender health reported two active Chromium processes, two connected runtimes, zero initializing runtimes, one asynchronous history job, and global heavy-history concurrency still fixed at one.
- The public staging home returned HTTP 200 after deployment. At the release-health sample, sender RSS was 142.4 MB and event-loop lag P95 was 26.9 ms while a background history unit was active.
- After that work unit released its slot, Docker reported the sender (Node plus two Chromium processes) at 31.9% CPU and 1.79 GiB memory; history active/queued returned to 0/0 and event-loop lag P95 was 26.6 ms.
- The simultaneous post-deploy saved-session restore encountered stale Chromium profile locks. Existing bounded recovery cleared the stale locks without deleting LocalAuth; the two sessions became ready in 57.8s and 160.2s. These are restart/session-restore measurements, not QR-display measurements.

## Timing result boundary

- Pre-change fresh Chromium `initialize:start` to first QR samples were 14.862s, 17.503s, 19.006s, and 25.755s (median 18.255s; observed-sample P95 25.755s).
- The release removes measured application-side serialization around that interval: no imported-message count before client creation, immediate 202 dispatch, no duplicate runtime-status query, no full health aggregation in guided onboarding, and direct QR delivery over SSE before database persistence.
- A truthful post-change QR P50/P95 requires new human pairing attempts. Deployment validation deliberately did not reset a saved session or create a new unattended QR merely to manufacture a benchmark. The new `QR_DISPLAYED` timing event records request-to-browser-observed latency on the next staging pairings.
- Therefore this release is expected to make the UI react earlier, but it does not yet prove the 3–5 second cold Chromium target. Warm and cold observations must be kept separate when the next staging pairing samples are collected.
