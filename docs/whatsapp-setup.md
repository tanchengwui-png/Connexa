# WhatsApp Setup

## What is already implemented
- Webhook verification route: `/api/webhooks/whatsapp`
- Workspace-level WhatsApp channel storage in the database
- Inbound text message ingestion into:
  - `Contact`
  - `Conversation`
  - `Message`
- Outbound sending uses the workspace's saved Meta Cloud API credentials
- Webhook signature validation uses the saved app secret for the matching `phone_number_id`

## Required environment variables
- `APP_URL`
- `APP_ENCRYPTION_KEY`

## Local files
- Copy [`.env.example`](C:/Connexa/.env.example) into `.env`
- Keep your existing `DATABASE_URL`

## Meta configuration steps
1. Create a Meta app and enable WhatsApp
2. Get your permanent or system-user access token
3. Get the `phone_number_id`
4. Copy the app secret from Meta
5. Save these values in Connexa for the subscriber workspace:
   - `phone_number_id`
   - `business_account_id`
   - access token
   - app secret
   - verify token
6. Set webhook callback URL to:
   - `https://<your-public-domain>/api/webhooks/whatsapp`
7. Set verify token to the same value saved in Connexa for that workspace
8. Subscribe to message webhook events

## Local testing
- Start app: `.\launch.cmd`
- Expose your local server with a public tunnel like `ngrok`
- Point Meta webhook callback to the public tunnel URL

## Current limitations
- Only inbound `text` messages are handled
- Media, reactions, statuses, and templates are not yet processed
- Each workspace currently supports one WhatsApp channel
- Automation replies are persisted locally, but not yet sent back through Meta automatically
