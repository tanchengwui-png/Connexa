# MVP Architecture

## Current structure
- One `Next.js` app router project for UI and server-side data loading
- `Prisma + SQLite` for local development
- Existing domain still includes a real-estate-oriented `Lead` model used by dashboard screens

## Recommended MVP modules
- `workspace`: tenancy boundary
- `users`: current `Agent` model acts as the first user/role foundation
- `contacts`: customer profile, tags, last interaction, hot-lead flag
- `conversations`: shared inbox state, assignment, unread count, status
- `messages`: inbound/outbound message history behind a provider-agnostic gateway later
- `notes`: internal collaboration notes
- `quick-replies`: canned responses
- `automations`: add after inbox flow is stable
- `dashboard`: read models for counts and SLA-style summaries

## Key entities for phase 1
- `Workspace`
- `Agent`
- `Contact`
- `Conversation`
- `Message`
- `Note`
- `QuickReply`

## API surface to add next
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations/:id/messages`
- `PATCH /api/conversations/:id`
- `GET /api/contacts`
- `GET /api/quick-replies`
- `POST /api/notes`

## UI screens
- `Dashboard`
- `Inbox`
- `Contacts`
- `Quick replies`
- `Team`
- `Settings`

## Data flow
1. Provider webhook receives inbound WhatsApp event
2. Normalize event behind a provider adapter
3. Upsert `Contact`
4. Create/update `Conversation`
5. Persist `Message`
6. Recompute unread count, last preview, hot-lead signals
7. Inbox and dashboard read server-side query models

## Safe implementation order
1. Add generic inbox domain models
2. Seed realistic contact/conversation/message data
3. Replace inbox screen with real conversation reads
4. Add conversation detail read model
5. Add send-message API contract and stub provider gateway
6. Add contacts screen
7. Add quick replies
8. Add basic automations
