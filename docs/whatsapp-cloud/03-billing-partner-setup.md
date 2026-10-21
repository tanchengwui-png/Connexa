# Funding and partner setup

Business verification, Tech Provider status and Solution Partner funding authority are different things.

The implemented routes are:

- `unconfigured`: default; outbound is blocked.
- `solution_partner_direct`: only valid after Connexa proves Solution Partner status, extended-credit authority and a merchant agreement. This code does not attach a credit line.
- `approved_partner`: requires the partner's documented API, Solution ID, webhook signature, routing and invoice/usage interface. The generic partner transport is disabled until one is contracted and implemented.

Before selecting a partner, obtain written answers covering: supported countries and WAME/WAAC/PMA model; Coexistence support; service-routing ownership; template ownership; webhook authentication; message and invoice identifiers; currency and FX; prepaid/postpaid liability; refunds and disputes; rate-card change notice; data processing/subprocessors; incident SLAs; offboarding and whether funding/routing can be detached.

Credit attachment must be a separate privileged, audited, two-person action with written customer authorization and displayed currency/liability. It must never run during Embedded Signup or tests.

The current official [WhatsApp FAQ](https://whatsappbusiness.com/resources/faq/) says direct customers may use card/credit line and that Solution Providers can be billed for customer usage. A signed contract and verified provider capability are still required.
