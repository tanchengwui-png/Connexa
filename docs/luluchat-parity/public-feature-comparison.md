# Public LuluChat feature comparison

Comparison based only on LuluChat's public pages referenced in the implementation brief. It makes no claim about their private code, contracts or billing relationship.

| Public capability | Connexa status | Provider note |
| --- | --- | --- |
| Shared multi-agent inbox | Shipped | Existing Web inbox; Cloud inbound foundation is partial. |
| Assignment, internal notes, tags, canned replies | Shipped | Connexa metadata; notes are never sent to WhatsApp. |
| Teams and round robin | Partial | Assignment/workflow primitives exist; package gating needs completion. |
| Keyword automation / flow editor | Shipped for existing provider | Cloud echo suppression shipped; full Cloud interaction parity is partial. |
| Buttons and lists | Partial | Must follow official Cloud message/context rules. |
| Campaigns, segmentation and scheduling | Shipped for existing provider | Cloud requires templates, consent, window checks and funded reservation integration. |
| Analytics and delivery/read metrics | Partial | Existing logs plus Cloud status foundation; financial reconciliation UI missing. |
| Website click-to-chat link/QR | Planned | Marketing QR only; never a login or Coexistence QR. |
| Business App Coexistence | Partial / approval required | Safe signup path and echo suppression; Meta eligibility and async sync remain gated. |
| Third-party integrations | Partial | Existing internal hooks; no claim of thousands of integrations. |
| Monthly SaaS limits | Partial | Existing package quotas; expanded seats/flows/top-up catalogue and snapshots not complete. |
| Meta usage funding/top-ups | Foundation only | Reservations/ledger shipped; checkout, partner contract and reconciliation UI blocked. |
| Group automation on Cloud API | Not supported | Do not work around official API limits. |

The three QR types remain distinct: existing WhatsApp Web linked-device QR, Meta-hosted Coexistence verification, and customer-facing `wa.me` marketing QR.
