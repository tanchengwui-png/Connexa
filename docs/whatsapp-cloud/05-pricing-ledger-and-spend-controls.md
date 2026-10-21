# Pricing ledger and spend controls

Connexa platform quota and Meta/partner money are separate controls. Passing one never bypasses the other.

The [official pricing page](https://whatsappbusiness.com/products/platform-pricing/) says charges are based on delivered messages, category and destination market, with published rates and volume tiers. The [official FAQ](https://whatsappbusiness.com/resources/faq/) states that from 1 October 2026 the first 1,000 service messages per business phone number per month are free and charging starts at message 1,001. Reconcile this against the applicable invoice and current rate card; do not hardcode a MYR rate.

Before enqueue/send, the caller must create an idempotent reservation with currency, category, market, effective date, rate-card version, billing-period key and a conservative maximum amount. Serializable transactions include outstanding reservations when checking prepaid balance and monthly cap. A send requires the matching unexpired reservation and pricing ledger row.

Acceptance changes the ledger to `AWAITING_DELIVERY`; it is not final cost. Settlement increments spend only once. Release/refund is separate. Final reconciliation must use the official Meta/partner invoice and preserve the estimate/final discrepancy.

Monthly active Cloud contact means a distinct WhatsApp ID with qualifying inbound or delivered outbound activity in one tenant and billing cycle. App echoes and retries must not double count. This metric is not a statement that Meta charges are zero.
