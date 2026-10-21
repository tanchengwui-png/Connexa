# Meta dashboard setup

Recheck the current [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview) before changing production. Meta documentation returned rate limits during this implementation, so no unverified field or permission was activated automatically.

1. In Meta Business Portfolio settings, confirm the legal Connexa business owns the portfolio and has completed Business verification. Verification alone does not confer App Review approval, Solution Partner status or credit-line authority.
2. In Meta for Developers, create/select the production app owned by that portfolio. Add the WhatsApp use case and Facebook Login for Business.
3. Configure public privacy policy, terms, data deletion instructions/contact, app domains and the exact HTTPS callback domain.
4. Create an Embedded Signup v4 configuration. Record its configuration ID as `META_EMBEDDED_SIGNUP_CONFIG_ID`. Keep standard onboarding and Business App Coexistence intent distinct.
5. Request and pass App Review for `whatsapp_business_management`, `whatsapp_business_messaging`, and any additional permission the current v4 UI explicitly requires. Test-user access is not production approval.
6. Configure the direct Meta webhook URL as `/api/webhooks/meta/whatsapp`. Use `META_WEBHOOK_VERIFY_TOKEN` for the GET challenge. POST signatures are verified with the Meta app secret over the exact raw bytes.
7. Subscribe only the event fields required by the released implementation. Coexistence `history` and `smb_app_state_sync` are recorded/deferred until the async importer is completed; `smb_message_echoes` is recorded and suppressed from automation.
8. Place the app in live mode only after security review and a staging test-number run.

Required identifiers, not values: Meta App ID, App Secret, Embedded Signup configuration ID, Graph API version, webhook verify token, Business Portfolio ID and public callback base URL.

Production review gate: confirm the current Graph version and Embedded Signup response/event shapes against Meta documentation on the day of release. Never paste credentials into tickets, screenshots or client-side code.
