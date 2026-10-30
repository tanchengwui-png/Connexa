# Package-payment reconciliation

`PAYMENT_PROCESSING` expires after `PAYMENT_PROCESSING_TIMEOUT_MINUTES` (20 by default). The billing worker invokes the protected billing-maintenance endpoint every minute and processes up to `PAYMENT_RECONCILIATION_BATCH_SIZE` expired attempts per run.

The reconciler reads Billplz only after expiry. It completes confirmed payments, deletes and expires confirmed unpaid due bills, and leaves the attempt unchanged when Billplz cannot be confirmed. Every reconciliation action is recorded in `WorkspacePackagePaymentReconciliation`.

Manual reconciliation uses the same code path:

```sh
npm run billing:reconcile:package-payment -- DWN-20260715-7C8965
```

Deploy the database migration before deploying the application and billing worker. The migration backfills expiry timestamps for existing `PAYMENT_PROCESSING` records, so old abandoned bills become eligible on the first worker pass.
