# Environment variables

No real values belong in source control.

| Name | Purpose |
| --- | --- |
| `WHATSAPP_CLOUD_ENABLED` | Master Cloud flag; defaults off. |
| `WHATSAPP_COEXISTENCE_ENABLED` | Coexistence flag; defaults off. |
| `WHATSAPP_CLOUD_BILLING_ENABLED` | Monetary send gate; defaults off. |
| `WHATSAPP_CLOUD_ALLOWED_WORKSPACE_IDS` | Required comma-separated cohort. Empty always fails closed. |
| `META_APP_ID` | Direct Meta integration identity and browser SDK app. |
| `META_APP_SECRET` | OAuth exchange and direct webhook HMAC secret. |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Facebook Login for Business / Embedded Signup v4 config. |
| `META_GRAPH_API_VERSION` | Reviewed supported Graph version. |
| `META_REDIRECT_URI` | Exact registered redirect URI. |
| `META_CALLBACK_PUBLIC_BASE_URL` | Public HTTPS origin. |
| `META_WEBHOOK_VERIFY_TOKEN` | GET challenge token. |
| `META_BUSINESS_ID` | Connexa Business Portfolio ID. |
| `APP_ENCRYPTION_KEY` | Existing at-rest secret encryption key; rotate through a reviewed procedure. |
| `WHATSAPP_CLOUD_TRANSPORT` | Must remain `disabled` until `meta_direct` or an approved partner is authorized. |
| `WHATSAPP_APPROVED_PARTNER_*` | Contract-specific partner identity, Solution ID, URL and webhook secret. |

`META_CONFIG_ID`, `META_GRAPH_VERSION` and `META_VERIFY_TOKEN` remain compatibility aliases. Do not define a separate Meta webhook signing secret: direct Meta webhooks are signed using the app secret. A partner may have its own documented secret and route.
