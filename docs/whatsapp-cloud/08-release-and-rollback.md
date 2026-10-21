# Release and rollback

## Rollout

1. Review the additive migration and back up staging.
2. Deploy schema/code with all three flags false.
3. Verify Web smoke tests and telemetry.
4. Enable Cloud for an internal workspace cohort, leaving billing false.
5. Complete Meta webhook/signature tests and funding contract review.
6. Enable Coexistence only for explicitly eligible test customers.
7. Enable billing only after reservations, invoice reconciliation, alerts and incident response have been exercised.

Monitor onboarding failure codes, webhook invalid signatures/duplicates/backlog, message delivery failures, reservation age, estimate/final variance, funding caps and Web sender health separately. The quick disable is `WHATSAPP_CLOUD_ENABLED=false`; inbound endpoints then fail closed while Web remains unchanged.

## Rollback

Turn flags off first. Do not deregister numbers, detach credit, steal routing, delete Cloud records or modify Web sessions. Application rollback may leave additive tables/columns in place. Dropping them is a separate reviewed maintenance action only after export/retention review and confirmation that no Cloud tenant exists. Restoring the former global phone-ID unique index is unsafe under WAME and is not part of rollback.
