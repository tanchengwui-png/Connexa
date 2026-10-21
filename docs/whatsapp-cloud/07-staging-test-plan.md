# Staging test plan

Use a Meta test number and synthetic contacts with written participant consent. Never point staging at a production Web session directory.

1. Capture the Web baseline: QR, phone pairing, saved-session restart, inbound/outbound, reconnect, history, inbox and campaign scheduling.
2. Run `prisma migrate deploy` only on a disposable staging copy; inspect new tables and confirm existing `WhatsAppChannel` Web rows are unchanged.
3. With all Cloud flags off, confirm Cloud controls are disabled and every Web scenario matches baseline.
4. Enable Cloud for one test workspace only. Test signup cancellation, missing code, expired/replayed state, cross-workspace/channel attempt and missing permissions.
5. Standard path: require registration consent and valid PIN. Coexistence path: mocked eligible phone has `is_on_biz_app=true`; assert `/register` is never called. Test ineligible phone and another-partner routing conflict.
6. Verify valid/invalid raw-body signatures, batches, duplicate events, out-of-order statuses and same WAAC with two distinct PMAs/app identities.
7. Verify app echoes never trigger automation. History/state sync must remain visibly deferred until the async importer is released.
8. Verify outbound denial independently for inactive subscription, unverified funding, wrong route, disabled billing, absent/stale/cross-tenant reservation, missing rate context, cap and prepaid exhaustion.
9. Reconcile mocked delivery estimates with a mocked invoice; test release, settlement replay and discrepancy reporting.
10. Re-run the protected Web suite and production build. Record screenshots and exact commands/results.

Live staging end-to-end is blocked until Meta permissions, eligible assets and authorized funding exist. Use mocks for those gates; never claim a mocked connection is live.
