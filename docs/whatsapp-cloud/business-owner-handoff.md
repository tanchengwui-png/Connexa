# Business-owner handoff (single page)

## Meta screens to complete

1. Business Portfolio: legal business details and Business verification.
2. App Dashboard: production app ownership, WhatsApp use case and live-mode readiness.
3. App settings: domains, privacy policy, terms and data deletion URL/contact.
4. Facebook Login for Business: Embedded Signup v4 configuration for standard onboarding and, if eligible, Business App Coexistence.
5. App Review: approved `whatsapp_business_management`, `whatsapp_business_messaging` and any current required scopes.
6. WhatsApp configuration: public `/api/webhooks/meta/whatsapp` callback, verify token and required event subscriptions.

Credentials/IDs needed by name only: Meta App ID, App Secret, Embedded Signup configuration ID, Graph API version, Business Portfolio ID, callback base URL and webhook verify token. Never send their values in chat/email.

## Partner contract capabilities

The contract must explicitly cover multi-partner/WAME WAAC and PMA identifiers, Embedded Signup/Coexistence, service-routing authority, template ownership, send API and authentication, webhook signatures, usage/invoice IDs, currency/FX, prepaid or postpaid liability, refunds/disputes, offboarding and incident support. If Connexa uses direct funding, obtain written proof of Solution Partner and extended-credit authority instead.

## Still blocked

Live App Review, eligible test number, funding contract, current signed rate card, async Coexistence importer, partner adapter, invoice reconciliation, admin approval UI, monitoring/alerts, staging migration and full live E2E. The code leaves all production Cloud flags off and stores a new connection as awaiting funding.

## Owner decision

Choose one authorized funding route and appoint owners for Meta App Review, legal/compliance, rate-card operations and incident response. Do not market "unlimited Meta messages"; package message limits are platform entitlements, not Meta fee coverage.

**STOP — NOT READY FOR LIVE MESSAGING.**
