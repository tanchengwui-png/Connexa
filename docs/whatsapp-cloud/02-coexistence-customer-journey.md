# Business App Coexistence customer journey

Coexistence is only for an eligible number currently using the WhatsApp Business app. It is not personal WhatsApp and it is not the existing linked-device QR.

1. The manager selects **Keep using WhatsApp Business app (Coexistence)**.
2. Connexa creates a tenant/user/channel-bound, single-use signup attempt.
3. Meta hosts login, eligibility and its QR/confirmation experience. Connexa never creates that QR.
4. Connexa validates the returned phone through Meta and requires `is_on_biz_app=true`. A frontend claim is insufficient.
5. Connexa does not call `/register`, deregister the number, steal service routing or fall back to API-only migration.
6. The connection remains `AWAITING_FUNDING`; inbound verification and funding approval must complete before it can be activated.
7. If the customer explicitly consents to a supported one-time history sync, create a `WhatsAppCoexistenceSyncJob` before Meta's current deadline. The current build records history/state webhook batches as deferred because the asynchronous importer is not shipped.

App echoes are idempotently recorded and never fed to bot automation. Ordinary groups and unsupported Business-app features are not promised. If Meta reports the number ineligible, stop without changing the mobile account and offer the standard API-only path only as a new, separately consented action.
