# Connexa Meta Embedded Signup v4 staging handoff

Updated: 28 October 2026 (staging only)

## Exact Connexa endpoints and configuration

- Staging site: `https://connexa-stg.recurvos.com`
- Facebook App ID: `1103785275978721`
- Embedded Signup configuration ID: `2546731999146244`
- Graph API version: `v26.0`
- Public webhook callback: `https://connexa-stg.recurvos.com/api/webhooks/meta/whatsapp`
- Connexa connection page: `https://connexa-stg.recurvos.com/settings/whatsapp`
- OAuth flow: Facebook JavaScript SDK code-return flow. A redirect URI is optional in this flow; if one is configured, it must be HTTPS and match Meta exactly.

The App Secret and webhook verify token are secrets. Never put either value in source, browser code, tickets, chat, screenshots, or shell history. Connexa stores both platform values encrypted at rest using the application encryption key. The browser receives only the App ID, configuration ID, and Graph version.

## Meta dashboard checklist

1. Confirm the app is a Business app owned by the intended verified Connexa business portfolio.
2. Confirm App ID `1103785275978721` and Embedded Signup configuration `2546731999146244` belong to that app and portfolio.
3. Add `connexa-stg.recurvos.com` to the permitted app domain and add the exact HTTPS staging site URL where Meta requests it.
4. Configure valid public Privacy Policy, Terms, and User Data Deletion URLs.
5. Configure WhatsApp Embedded Signup v4 for standard onboarding. Enable Coexistence only for a separately authorized and eligible test number.
6. Confirm the required permissions and App Review status, including the permissions Meta currently requires for business management and WhatsApp management/messaging.
7. Set the webhook callback to the exact callback above. Obtain the verify token through the secure operator procedure below and enter it directly in Meta.
8. Subscribe the WhatsApp Business Account to the required `messages` webhook field. Connexa also calls `/{WABA_ID}/subscribed_apps` after it verifies the completed signup selection.
9. Enter the App Secret through Connexa's authenticated platform-admin Meta settings screen. Leave the existing encrypted webhook token unchanged.
10. Do not enable production/billable sends until App Review, funding, subscription, pricing, privacy, and tenant-isolation gates pass.

## Secure webhook-token retrieval

The retrieval utility refuses non-interactive output and requires an explicit one-time operator confirmation. Run it from an interactive, private server terminal in the reviewed web container; do not pipe, redirect, log, or paste its output:

```bash
docker exec -it \
  -e CONNEXA_META_TOKEN_ACTION=PRINT_TO_SECURE_TTY \
  connexa-stg-web \
  node --experimental-strip-types scripts/retrieve-meta-webhook-token.mjs
```

The command deliberately uses the running container's already-resolved encryption environment. Never work around a key mismatch by storing the token in plaintext.

## Runtime safety and acceptance

- `WHATSAPP_CLOUD_ENABLED=false`
- `WHATSAPP_COEXISTENCE_ENABLED=false`
- `WHATSAPP_CLOUD_BILLING_ENABLED=false`
- `WHATSAPP_CLOUD_TRANSPORT=disabled`

These remain the mandatory initial deployment values. Existing WhatsApp Web runs in the separate sender container with its existing LocalAuth volume. Replacing the web image must not replace or restart the sender container.

Before enabling one authorized Cloud test workspace:

1. Store the real App Secret securely and confirm App Review/permission readiness.
2. Verify the webhook GET challenge returns the exact challenge and signed POST rejects invalid signatures.
3. Confirm the authorized workspace ID allowlist before setting the Cloud flag.
4. Complete Embedded Signup and verify the popup WABA/phone identifiers match Graph-discovered assets.
5. Confirm WABA webhook subscription, inbound delivery, status updates, and cross-tenant denial.
6. Keep outbound transport and billing disabled until the finance canary has approved funding, sandbox subscription/top-up behavior, pricing, credit reservation, and settlement controls.
7. Re-run WhatsApp Web QR/session/send/receive/reconnect smoke tests after every activation change.

Current external blocker: the real Meta App Secret is not present in staging. App Review/permission approval and an authorized Meta test asset must also be confirmed by their owners. No successful live Embedded Signup or billable Meta send may be claimed until those items are supplied and the real website tests pass.
