# Meta Embedded Signup v4 staging deployment record

Date: 28 October 2026 (Malaysia time)

## Deployment result

- Result: **DEPLOYED WITH EXTERNAL ACTIVATION BLOCKERS**
- Source branch/HEAD: `codex/inbox-sync-performance-optimization` / `42e947a30cb572b311da009436e52849ac73abbb`
- Selected Meta application-file digest recorded before build: `aaf42aa046b90e7c511f8b551cca0df843705a93317d33b23c9168ec4fa456c7`
- Web image: `connexa-stg-web:meta-v4-20261028`
- Web image ID: `sha256:2d26c9c1d18efbdf934a1e9771bb6ed450dbdd69ca8fff0ef2359abf67bdde6e`
- Previous web rollback tag: `connexa-stg-web:rollback-pre-meta-v4-20261028`
- Previous image ID: `sha256:621ff18c197ece16914a151b5c80b43dce790dea6da114e4dfa410e7f809df92`
- Deployment operation: web-only Compose replacement with `--no-deps`
- Sender image/container: unchanged; zero restarts; LocalAuth volume not replaced
- Database migration: none required or executed

The staging database had four Web channels and zero Cloud channels before and after deployment. Four LocalAuth session directories remained present. PostgreSQL, Caddy, sender, outbound worker, and billing worker were not replaced.

## Implemented

- Facebook JavaScript SDK Embedded Signup v4 code flow using configured App ID/config ID and Graph `v26.0`.
- One SDK script instance and lifecycle-safe initialization.
- Strict `WA_EMBEDDED_SIGNUP` event parsing for trusted Meta origins only.
- FINISH WABA/phone capture, CANCEL/ERROR handling, and tenant-bound attempt cancellation.
- Server-side popup identifier verification against Graph-discovered assets.
- Server-side OAuth exchange; App Secret is never sent to the browser.
- WABA `subscribed_apps` call after account/phone verification.
- Encrypted-at-rest platform App Secret and webhook verify token, including legacy read compatibility and key IDs.
- Timing-safe platform webhook-token comparison and fail-closed signed POST behavior.
- Operator-only webhook-token retrieval requiring an interactive TTY and explicit confirmation.
- Exact callback: `https://connexa-stg.recurvos.com/api/webhooks/meta/whatsapp`.

## Verification evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused Meta + Cloud tests | PASS | 15/15 |
| Full WhatsApp regression | PASS | 136/136 |
| Next.js production build | PASS | compile/type validity passed; 130 pages/routes generated |
| Image build | PASS | image ID above |
| Public root/login | PASS | HTTP 200 |
| Protected WhatsApp settings | PASS | HTTP 307 to authentication |
| Public callback, invalid token | PASS | HTTP 403 |
| Public callback, valid encrypted token | PASS | HTTP 200 and exact challenge match; token not printed |
| Unsigned webhook POST without App Secret | PASS (fail closed) | HTTP 503 |
| Sender health | PASS | HTTP 200, `ok=true`, `status=live` |
| Sender/session continuity | PASS | same container/image/start time, zero restarts, four Web channels and four session directories |
| Cloud/Coexistence/billing/transport flags | PASS | `false`, `false`, `false`, `disabled` |
| Runtime web logs | PASS | normal Next.js startup, no new application errors |
| Operator token utility refusal | PASS | non-interactive invocation refused without disclosing token |
| Live Embedded Signup | BLOCKED | real App Secret absent; Cloud remains disabled |
| Signed inbound Meta webhook | BLOCKED | App Secret absent and no authorized Meta delivery performed |
| Meta App Review/permission verification | BLOCKED | external Meta owner evidence required |
| Billable outbound Meta message | NOT RUN | deliberately prohibited while transport/funding gates are disabled |

The standalone repository typecheck still reports pre-existing errors in unrelated test fixtures and TypeScript test-import settings. The production Next.js build's application compile/type-validity stage passed. ESLint 9 is installed but the checkout has no `eslint.config` file, so changed-file ESLint is not runnable until that repository configuration is supplied.

## Dependency risk (not suppressed)

`npm audit --omit=dev` reports 35 production findings: 6 moderate, 28 high, and 1 critical.

- Critical: direct `next` dependency. Audit proposes `next@15.5.28`.
- Direct high findings include `axios`, `nodemailer`, `prisma`, and `whatsapp-web.js`.
- The WhatsApp/Puppeteer chain proposes `whatsapp-web.js@1.34.2` as a breaking change from the deployed `1.34.7`; this was not applied because Web compatibility is a mandatory release condition.
- Transitive high findings include Prisma tooling, Puppeteer/browser/proxy packages, PostCSS/Sharp, archive/parsing libraries, and denial-of-service/path-handling advisories.

This dependency debt is an unresolved production security gate. It requires a dedicated upgrade branch, security review, rebuild, and the complete WhatsApp regression/smoke suite; it is not waived by this staging deployment.

## Rollback

Update the `web` image in `docker-compose.deploy-wa.yml` to `connexa-stg-web:rollback-pre-meta-v4-20261028`, then run:

```bash
cd /srv/recurvos/staging/connexa/repo
docker compose \
  -f docker-compose.stg.yml \
  -f docker-compose.deploy-wa.yml \
  up -d --no-deps web
```

Do not run `docker compose down`, remove volumes, replace the sender, or change the database for this rollback.

## Next authorized activation step

The Meta administrator must enter the real App Secret through the authenticated Connexa platform-admin Meta settings screen and confirm App Review/required permissions plus one authorized Meta test asset. Then enable Cloud only for the single authorized workspace, keep billing/transport disabled, run real Embedded Signup and signed webhook/inbound tests, and repeat the WhatsApp Web browser smoke test. No billable send is authorized by this deployment.
