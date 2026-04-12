# Sender Service Boundary

Connexa now routes WhatsApp runtime-dependent operations through `lib/whatsapp-runtime.ts`.

## Modes

- Embedded mode:
  - Default when `SENDER_SERVICE_URL` is empty
  - App server owns `whatsapp-web.js`, Chromium, QR state, and message sending
- Remote sender mode:
  - Enabled when `SENDER_SERVICE_URL` is set
  - App server calls a dedicated sender service over HTTP for runtime-dependent operations

## App-side environment variables

- `SENDER_SERVICE_URL`
- `SENDER_SERVICE_TOKEN`

If `SENDER_SERVICE_URL` is not set, the app falls back to the existing embedded `whatsapp-web.js` runtime.

## Sender service process

Run the sender service from the same repo:

```bash
npm run sender:service
```

Sender service environment variables:

- `SENDER_SERVICE_HOST`
- `SENDER_SERVICE_PORT`
- `SENDER_SERVICE_TOKEN`

Recommended local setup:

```env
SENDER_SERVICE_URL="http://127.0.0.1:3101"
SENDER_SERVICE_TOKEN="dev-sender-token"
SENDER_SERVICE_HOST="127.0.0.1"
SENDER_SERVICE_PORT="3101"
```

## HTTP contract expected from a sender service

### `GET /whatsapp/runtime?workspaceId=<id>&agentId=<id>`

Returns:

```json
{
  "status": {
    "channel": null,
    "qrCodeDataUrl": null,
    "runtimeStatus": "DISCONNECTED",
    "lastError": null,
    "connectedByCurrentAgent": false,
    "isSyncingHistory": false
  }
}
```

### `POST /whatsapp/runtime/start`

Request:

```json
{
  "workspaceId": "workspace-id",
  "agentId": "agent-id"
}
```

Response:

```json
{
  "ok": true
}
```

### `DELETE /whatsapp/runtime?workspaceId=<id>`

Response:

```json
{
  "ok": true
}
```

### `POST /whatsapp/runtime/sync`

Request:

```json
{
  "workspaceId": "workspace-id"
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "importedChats": 0,
    "importedMessages": 0
  }
}
```

### `POST /messages/send`

Request:

```json
{
  "workspaceId": "workspace-id",
  "to": "60123456789",
  "body": "Hello",
  "interactiveButtons": [],
  "interactiveListButtonText": null,
  "interactiveListOptions": [],
  "attachmentPath": null,
  "attachmentUrl": null,
  "attachmentMimeType": null,
  "attachmentName": null
}
```

Response:

```json
{
  "result": {
    "providerMessageId": "provider-message-id",
    "status": "accepted"
  }
}
```

## Authentication

The app sends both:

- `x-sender-token: <token>`
- `authorization: Bearer <token>`

The sender service should validate either header against `SENDER_SERVICE_TOKEN`.

## Current scope

This is the app-side extraction step. It moves the app onto a sender-service boundary without
breaking existing embedded mode. A dedicated sender service process can now be built against this
HTTP contract without changing inbox, automation, or worker call sites again.
