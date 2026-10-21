# Backend architecture and security

## Provider boundary

`web` continues through the existing sender and LocalAuth runtime. `cloud_api` uses separate onboarding, direct-Meta webhook context and the Cloud provider. Approved-partner transport is an explicit disabled interface, never a fallback to Graph API.

Connection capabilities are declared in `lib/whatsapp-cloud/domain.ts`. Cloud statuses include authorization, funding, webhook, active, restricted, suspended and failure states. Onboarding writes `AWAITING_FUNDING`, not connected/active.

## Tenant and account routing

All new records include `workspaceId` and `channelId`. Webhooks authenticate raw bytes first, then resolve the channel using provider identity + partner messaging account/legacy WABA context + phone ID. Phone IDs and WAACs are not globally unique. This supports one WAAC shared to distinct partner PMAs without sharing their templates or wallet.

## Endpoints

- `POST /api/integrations/meta/embedded-signup/start`: creates an expiring one-time state.
- `POST /api/integrations/meta/embedded-signup/callback`: consumes state, exchanges code, discovers server-verified assets and finalizes the separately consented path.
- `GET|POST /api/webhooks/meta/whatsapp`: challenge and direct-Meta signed delivery.

Tokens are AES-256-GCM encrypted with the existing server encryption key. Raw authorization codes and webhook message bodies are not written to the new audit tables. Webhook records contain identifiers, event type and a digest; inbox ingestion retains only the existing application payload policy.

## Data model

`MetaOnboardingAttempt`, `MetaWebhookEvent`, `WhatsAppCoexistenceSyncJob`, `TenantFundingAccount`, `UsageCreditReservation` and `WhatsAppUsageLedger` are additive. `WhatsAppChannel` gains WAME-aware identity/context fields. The obsolete global phone-ID unique index is removed.
