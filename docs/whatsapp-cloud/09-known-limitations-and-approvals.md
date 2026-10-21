# Known limitations and approvals

## Not shipped

- No real Meta/partner credentials, permissions or live signup were available.
- No Solution Partner proof, approved credit line, reseller agreement or credit attachment workflow is present.
- Approved-partner transport is deliberately disabled.
- No current rate-card importer/admin confirmation UI or official invoice importer exists.
- Coexistence history and app-state webhook batches are durably deferred; the async ordered importer is not implemented.
- Cloud media download/upload, template catalogue/status management, contact-window enforcement and campaign dry-run pricing are not integrated end-to-end.
- The existing admin package editor has message/contact/automation/campaign limits but does not yet expose all requested draft catalogue fields, seats, flow count, top-up products or historical entitlement snapshots.
- No customer credit dashboard, admin reconciliation screen, two-person funding approval screen or alerting integration is shipped.
- Live E2E (signup to funded inbound/outbound to suspend/renew) could not run without external approvals.

## Manual actions

Obtain Meta App Review; verify the production app and public legal URLs; confirm current Graph/Embedded Signup/WAME fields; contract an authorized funding route; load a signed current rate card; complete privacy/security review; implement/operate async sync and invoice reconciliation; apply the migration to a staging copy; run the full plan; review baseline test debt; approve a PR; then explicitly enable one cohort.

## Production status

**STOP — NOT READY FOR LIVE MESSAGING.** Keep `WHATSAPP_CLOUD_ENABLED`, `WHATSAPP_COEXISTENCE_ENABLED` and `WHATSAPP_CLOUD_BILLING_ENABLED` false until every applicable funding, consent, Meta approval, webhook, compliance, monitoring, security and Web regression gate is verified.
