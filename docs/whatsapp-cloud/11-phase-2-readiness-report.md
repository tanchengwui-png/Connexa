# Phase 2 staging readiness report

Date: 21 October 2026 (Asia/Kuala Lumpur)

## 1. Current implementation status

The WhatsApp Cloud API and Business App Coexistence foundation is present and isolated behind feature flags. Staging now has explicit fail-closed values for all three Cloud flags, an allowlist containing only the internal `pohh` workspace (`23c9be2a2f1b4794bbbe350b25168f3f`), and disabled transport. The allowlist code was hardened so an empty cohort never means all tenants.

The tracked staging environment file is prepared for the next reviewed service restart. Running containers were not restarted or redeployed during Phase 2; their flags remain absent, which also evaluates as disabled.

The running staging database contains two existing Web channels and no Cloud onboarding, webhook, funding, reservation or usage-ledger rows. No Cloud identity columns are populated on the Web rows. No real Meta or paid messaging test was attempted.

One Phase 1 UI regression was corrected during this audit: Cloud being disabled had disabled the Web connection card instead of the API card. A regression assertion now keeps WhatsApp Web selectable while Cloud stays unavailable.

## 2. Files changed for Phase 2

- `.env.staging`: explicit false flags, one-workspace cohort and disabled transport; no secret values added or changed.
- `.env.example`: documents that the workspace cohort is mandatory and fail-closed.
- `lib/whatsapp-cloud/feature-flags.ts`: empty allowlists now deny every workspace.
- `components/whatsapp-connection-onboarding.tsx`: existing Web onboarding stays enabled and the Cloud card is disabled when Cloud is unavailable.
- `tests/whatsapp-cloud-foundation.test.mjs`: tests empty-cohort denial, every outbound gate and Web onboarding isolation.
- `docs/whatsapp-cloud/06-environment-variables.md`: required-cohort documentation.
- `docs/whatsapp-cloud/10-implementation-report.md`: corrected cohort wording.
- `docs/whatsapp-cloud/11-phase-2-readiness-report.md`: this report.

The repository also contains extensive unrelated uncommitted work. It was not reset, overwritten or included in the scoped Cloud staging changes.

## 3. Git commit status

The Cloud foundation was committed as `f01ef9f` (`feat(whatsapp): add isolated cloud onboarding foundation`) with 39 reviewed paths. This readiness report and the explicit disabled staging cohort are committed separately. No force push, reset, blanket `git add .` or destructive Git operation was used.

Foundation commit paths:

- `.env.example`
- `app/api/integrations/meta/embedded-signup/callback/route.ts`
- `app/api/integrations/meta/embedded-signup/start/route.ts`
- `app/api/integrations/meta/test-connection/route.ts`
- `app/api/settings/whatsapp/route.ts`
- `app/api/webhooks/whatsapp/route.ts`
- `app/onboarding/page.tsx`
- `app/settings/whatsapp/page.tsx`
- `components/official-api-setup-form.tsx`
- `components/whatsapp-connection-onboarding.tsx`
- `docs/luluchat-parity/public-feature-comparison.md`
- `docs/whatsapp-cloud/00-existing-system-audit.md`
- `docs/whatsapp-cloud/01-meta-dashboard-click-by-click.md`
- `docs/whatsapp-cloud/02-coexistence-customer-journey.md`
- `docs/whatsapp-cloud/03-billing-partner-setup.md`
- `docs/whatsapp-cloud/04-backend-architecture-and-security.md`
- `docs/whatsapp-cloud/05-pricing-ledger-and-spend-controls.md`
- `docs/whatsapp-cloud/06-environment-variables.md`
- `docs/whatsapp-cloud/07-staging-test-plan.md`
- `docs/whatsapp-cloud/08-release-and-rollback.md`
- `docs/whatsapp-cloud/09-known-limitations-and-approvals.md`
- `docs/whatsapp-cloud/10-implementation-report.md`
- `docs/whatsapp-cloud/business-owner-handoff.md`
- `lib/messaging/provider.ts`
- `lib/meta-whatsapp.ts`
- `lib/platform-config.ts`
- `lib/whatsapp-channel.ts`
- `lib/whatsapp-cloud/billing-gate.ts`
- `lib/whatsapp-cloud/billing.ts`
- `lib/whatsapp-cloud/domain.ts`
- `lib/whatsapp-cloud/feature-flags.ts`
- `lib/whatsapp-cloud/onboarding.ts`
- `lib/whatsapp-cloud/security.ts`
- `lib/whatsapp-cloud/transport.ts`
- `prisma/migrations/20261020120000_add_isolated_whatsapp_cloud_foundation/migration.sql`
- `prisma/schema.prisma`
- `providers/cloud/provider.js`
- `services/whatsappRouter.d.ts`
- `tests/whatsapp-cloud-foundation.test.mjs`

Staging-readiness commit paths:

- `.env.staging`
- `docs/whatsapp-cloud/11-phase-2-readiness-report.md`

## 4. Database migration status

The migration `20261020120000_add_isolated_whatsapp_cloud_foundation` was already recorded as applied to `connexa_staging` at `2026-10-20 05:53:29 UTC` before this audit. Phase 2 did not apply or reapply it.

Migration review findings:

- It adds nullable channel identity/health columns and six new tables.
- It does not rewrite or delete existing channel rows.
- It deliberately drops only the obsolete global unique index on `WhatsAppChannel.phoneNumberId`.
- New records have workspace and channel foreign keys, but the database does not have composite `(workspaceId, channelId)` foreign keys. Application queries enforce the pair; direct database writes could create a cross-tenant pair and therefore require privileged-DB controls.
- Workspace/channel cascade deletion also deletes Cloud event and financial-ledger records. Retention/export policy must be approved before production use.
- A disposable PostgreSQL 17 rehearsal restored the July staging dump and applied the exact Cloud migration. Six of six tables were created, the global phone-ID unique index was absent afterward, and the count/hash of nine Web channel rows was identical before and after.

Migration-history blocker: `prisma migrate status` reports 26 older repository migrations as unapplied even though the database contains newer applied migrations, including the Cloud migration. Do not run `prisma migrate deploy` until a DBA reviews the schema and establishes a correct Prisma baseline.

## 5. Backup verification

A fresh post-migration staging backup was created at:

`backups/connexa_staging_post_cloud_audit_20261021T073245Z.dump`

- Size: 7,029,615 bytes.
- SHA-256: `28517efb5ad4bd141bcbf860f72f6fd00b67611780a76159782dabbf689c36e1`.
- `pg_restore --list` validation: passed with PostgreSQL 17 tooling.

The two July dump files also pass archive validation. No current pre-migration backup was found, so the fresh backup protects the present state but cannot provide a 20 October pre-Cloud restore point.

## 6. Automated test results

- Prisma schema validation: passed.
- Cloud foundation mocks: 9/9 passed.
- Existing onboarding-step test: 1/1 passed.
- Production build: passed, including the Next.js type/lint gate and 128/128 current routes.
- Protected Web command: 45/46 passed with the current unrelated Web work; see section 12.
- Standalone TypeScript check: failed on existing test-fixture/import issues outside the Cloud scope. The current list includes `.ts` import-extension configuration, password-reset fixture shape, platform-security fixture shape, profile-picture target level and package-discount fixture issues.

## 7. Real Meta API results

Not run. Meta App ID, App Secret, Embedded Signup configuration, redirect URI, webhook verification token and approved assets are not configured in staging. Reporting a real onboarding, webhook registration or message result would be false.

## 8. Mock and isolated results

- Feature flags fail closed and only allow an explicitly listed workspace.
- Raw webhook HMAC verification accepts only the exact signed body.
- Webhook idempotency includes integration identity and event semantics.
- Outbound checks deny disabled Cloud, disabled billing, non-active subscription, inactive connection, missing/unverified funding, missing/expired/cross-tenant reservation and missing pricing context.
- Standard onboarding requires registration consent and calls number registration.
- Coexistence requires Meta eligibility evidence and cannot call number registration or silently fall back.
- Provider capability tests keep linked-device QR, Meta-hosted Coexistence QR and Cloud API behavior separate.
- The isolated migration rehearsal preserved Web channel data.

These are mock/source/isolated-database checks, not a successful live Meta connection.

## 9. Outstanding Meta permissions and assets

- Verified Meta App and Business Portfolio.
- Facebook Login for Business / Embedded Signup configuration.
- App Review for the required WhatsApp and business-management permissions.
- Reviewed Graph API version and current WAME/Coexistence fields.
- Test WABA, verified test phone number and eligible Business App Coexistence number.
- Registered HTTPS redirect URI and public webhook callback.
- Webhook product/field subscription and successful challenge/signature verification.
- Privacy policy, terms, data deletion and other Meta review URLs.

## 10. Outstanding funding requirements

- Written choice between an authorized direct/Solution Partner route and an approved partner transport.
- Solution/partner identifiers, contract and credit/funding attachment evidence.
- Verified tenant funding account and currency.
- Signed current rate card plus an authoritative importer/approval workflow.
- Reservation expiry worker, failed-send release, delivery settlement, invoice reconciliation and discrepancy alerting.
- Business-owner approval before any billing or billable send.

## 11. Security and financial risks

1. Prisma migration history is inconsistent and must be baselined before another deploy.
2. There is no fresh pre-Cloud staging backup; only a verified post-migration backup and stale July archives exist.
3. Tenant pairing is enforced in application queries rather than composite database foreign keys.
4. Pricing context is caller-supplied foundation data; no signed-rate-card authority currently validates it.
5. Failed provider sends are not yet connected to automatic reservation release, and delivery statuses are not connected to final settlement/reconciliation.
6. Financial/event rows cascade on tenant/channel deletion; production retention requirements are not implemented.
7. Coexistence history and app-state batches are deferred because the ordered async importer is not shipped.
8. Live webhook, permission, ownership, routing-partner and Meta error behavior remain unverified.

## 12. WhatsApp Web regression status

The documented Phase 1 baseline was 42/45 with three source-shape failures. The current dirty workspace has since changed unrelated Web runtime code and tests: the protected command now discovers 46 tests and returns 45 passes with one source-shape failure. Therefore the requested “same three failures” comparison cannot be truthfully confirmed from the current tree.

Database inspection found two Web channels, zero Cloud identities on those rows, and no Cloud records. The isolated migration left restored Web row count/content hashes unchanged. The Cloud UI regression that disabled the Web method was fixed and covered by a new assertion.

A new clean Web baseline must be approved after the unrelated Web work is committed or isolated.

## 13. Environment and data still needed

| Setting or data | Status | Owner/action |
| --- | --- | --- |
| `WHATSAPP_CLOUD_ENABLED` | Configured `false` | Keep false until approval |
| `WHATSAPP_COEXISTENCE_ENABLED` | Configured `false` | Keep false until eligible test asset exists |
| `WHATSAPP_CLOUD_BILLING_ENABLED` | Configured `false` | Keep false until funding/reconciliation approval |
| `WHATSAPP_CLOUD_ALLOWED_WORKSPACE_IDS` | One internal staging workspace | Reconfirm business ownership before activation |
| `WHATSAPP_CLOUD_TRANSPORT` | `disabled` | Select authorized route |
| `APP_ENCRYPTION_KEY` | Configured | Security owner to confirm rotation/backup policy |
| Meta App ID | Missing | Meta administrator |
| Meta App Secret | Missing | Meta administrator; secret store only |
| Embedded Signup configuration ID | Missing | Meta administrator |
| Graph API version | Configured in platform settings | Meta owner to confirm it remains reviewed/current |
| Redirect URI / public callback origin | Missing | Platform/Meta administrators |
| Webhook verification token | Missing | Secret store plus Meta dashboard |
| Meta Business Portfolio ID | Missing | Business owner |
| Partner/Solution identifiers and secret | Missing | Funding/Solution Partner owner |
| Verified funding account | Missing; table empty | Finance/business owner |
| Current approved pricing data | Missing | Finance/product owner |
| Paid subscription | Allowlisted workspace is `TRIAL`, not `ACTIVE` | Billing owner; gate correctly blocks send |

## 14. Recommended next action

Keep every Cloud flag false. First repair/baseline Prisma migration history with a DBA and retain the verified backup off-host according to policy. Then obtain the Meta test assets and funding-route decision, load an approved rate card, and rerun this plan on a dedicated staging tenant. Enable only the master Cloud flag for the existing one-workspace cohort after those checks; leave billing and Coexistence false until their independent gates pass.

**STOP — NOT READY FOR LIVE META ONBOARDING OR PAID MESSAGING.**
