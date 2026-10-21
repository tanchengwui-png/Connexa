# Existing system audit

Audited 20 October 2026. The workspace was already heavily modified on branch `develop`; it was not a clean Stage 0 baseline. All pre-existing changes were preserved.

## Stack and repository map

- Next.js 15 App Router, React 19, TypeScript 5.8.
- PostgreSQL 17 through Prisma 7 and `@prisma/adapter-pg`.
- Existing recurring billing uses Billplz and the `WorkspacePackageSubscription`, transaction and invoice models.
- The shared inbox, contacts, assignments, notes, quick replies, campaigns, automations and realtime relay already exist.
- WhatsApp Web uses `whatsapp-web.js` 1.34.7 in the sender service. Cloud code existed partially in `providers/cloud`, `services/whatsappRouter.js`, Meta signup endpoints and the Cloud webhook.

## Protected WhatsApp Web inventory

Do not migrate or rewrite these modules as part of Cloud rollout:

- `lib/whatsapp-web.ts`: LocalAuth lifecycle, QR/pairing, restored sessions, retries, history sync and inbound events.
- `lib/whatsapp-runtime.ts`, `lib/whatsapp-runtime-supervisor.ts`, `lib/whatsapp-runtime-events.ts`, `lib/whatsapp-runtime-metrics.ts`.
- `providers/personal/provider.js`, `scripts/sender-service.ts`, `services/whatsappRouter.js` personal branch.
- `lib/whatsapp-channel.ts` Web methods and `WhatsAppChannel.sessionClientId`/QR fields.
- `components/web-qr-setup-panel.tsx`, `components/web-phone-pairing-panel.tsx` and the pairing API.
- `data/wwebjs_auth` session storage; it contains live-style runtime data and was not read or changed.

Baseline protection tests include `web-qr-refresh-guard`, `whatsapp-channel-hardening`, `whatsapp-web-phone-pairing-wiring`, `whatsapp-new-conversation-capability` and `whatsapp-basic-functions`.

## Baseline evidence

- `prisma generate`: passed, with the image's pre-existing OpenSSL detection warning.
- Production `next build`: compiled, type/lint checked, and generated 126/126 routes. Docker image export was cancelled after the builder stage completed because exporting the large layer was not needed for the baseline.
- Focused Web test command: 42 passed, 3 failed. The failures are source-shape assertions in `whatsapp-basic-functions.test.mjs`; they pre-date this change and do not indicate runtime failures.
- Standalone `npm run typecheck`: pre-existing failures in password-reset, platform-security, profile-picture/push-name and workspace-package-management test fixtures. No application-source error was reported.

## Existing Cloud gaps found

The former signup setup state was held in process memory and was not bound to tenant, user, channel, nonce expiry or replay state. Signup automatically called phone registration. The Meta webhook path aliased a generic handler, accepted unsigned traffic when no per-channel secret existed, and looked up tenants by a globally unique phone ID. Cloud sends had no paid-subscription, funding, pricing or credit-reservation preflight.

## Additive implementation boundary

This change adds Cloud-only feature flags, durable onboarding attempts, WAME-compatible WAAC/PMA fields, verified webhook context and idempotency, funding/reservation ledgers, Coexistence-safe UI and outbound gates. It does not alter Web sessions or enable live Cloud traffic.

## External blockers

Meta App Review, required permissions, Business verification, Coexistence eligibility, production phone assets, a public webhook, a current rate card, and an authorized direct/partner funding agreement cannot be proven from this repository. These remain hard production blockers.
