# Implementation report

Date: 20 October 2026 (Asia/Kuala Lumpur context)

## Current stack

Next.js 15/React 19/TypeScript, PostgreSQL 17, Prisma 7, Billplz billing, `whatsapp-web.js` sender service, existing shared inbox/campaign/automation modules.

## Delivered

- Feature flags default off and require explicit workspace cohort membership.
- WAME-compatible connection identity for legacy WABA plus WAAC, PMA/messaging account, integration identity and service-routing partner.
- Durable expiring one-time signup state bound to workspace, channel and initiating manager.
- Separate standard and Coexistence consent paths. Coexistence requires Meta server evidence and never calls phone registration.
- Direct Meta raw-body HMAC verification, app/PMA/phone routing, durable event idempotency and status processing.
- App-echo automation suppression; unsupported large sync types are deferred honestly.
- Funding account, atomic credit reservation and estimate/final ledger foundation. Cloud sends fail closed without every subscription/funding/pricing/reservation gate.
- Provider capability matrix and disabled approved-partner transport.
- Customer UI distinguishes API-only registration from Meta-hosted Coexistence and shows awaiting-funding state.
- Sanitized environment template, operating documentation, business-owner handoff and public competitor comparison.

## Migration

`20261020120000_add_isolated_whatsapp_cloud_foundation` is additive except that it drops the obsolete global unique phone-number-ID index. Existing Web columns/rows are not transformed. New tables are tenant-scoped. The migration was schema-validated but was not applied to the running staging database.

## Verification

- `npx prisma validate`: passed.
- `node --experimental-strip-types --test tests/whatsapp-cloud-foundation.test.mjs`: 8/8 passed.
- Post-change `npm run build`: passed; compiled, type/lint checked and generated 127/127 routes. Existing CSS compatibility warnings remain.
- Protected Web baseline: 42 pass / 3 fail.
- Protected Web post-change: 42 pass / 3 fail, same source-shape assertions in `whatsapp-basic-functions.test.mjs`.
- Standalone typecheck still fails only on the pre-existing fixture/type issues recorded in the audit; the production build type gate passes.

## Configuration names

`WHATSAPP_CLOUD_ENABLED`, `WHATSAPP_COEXISTENCE_ENABLED`, `WHATSAPP_CLOUD_BILLING_ENABLED`, `WHATSAPP_CLOUD_ALLOWED_WORKSPACE_IDS`, `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_GRAPH_API_VERSION`, `META_REDIRECT_URI`, `META_CALLBACK_PUBLIC_BASE_URL`, `META_WEBHOOK_VERIFY_TOKEN`, `META_BUSINESS_ID`, `APP_ENCRYPTION_KEY`, `WHATSAPP_CLOUD_TRANSPORT`, and approved-partner variables if contracted.

## Missing external and product gates

Meta App Review/permissions, verified production assets, Coexistence eligibility, an authorized funding contract, current signed rate cards, partner adapter, sync worker, invoice reconciliation, admin approval/monitoring surfaces and live E2E are outstanding. The expanded seats/flows/top-up catalogue and historical entitlement snapshots are also not implemented in this safe foundation.

## Next human action

Review this change and migration, choose/contract the funding route, complete Meta App Review, then apply to a disposable staging copy with all flags off and execute `07-staging-test-plan.md`. Do not activate a production cohort until the approval, funding, consent, security, monitoring and Web regression gates are signed off.

**STOP — NOT READY FOR LIVE MESSAGING.**
