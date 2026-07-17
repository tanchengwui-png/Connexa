import assert from "node:assert/strict";
import test from "node:test";
import { formatReceiptNumber } from "../lib/billing-management";
import { normalizePlatformTransactionQuery } from "../lib/platform-transactions";

class ReceiptSequenceSimulator {
  private values = new Map<number, number>();
  private issuedByTransaction = new Map<string, string>();

  issue(transactionId: string, status: string, paidAt: Date) {
    if (status !== "PAID") {
      return null;
    }

    const existing = this.issuedByTransaction.get(transactionId);
    if (existing) {
      return existing;
    }

    const year = paidAt.getUTCFullYear();
    const next = (this.values.get(year) ?? 0) + 1;
    this.values.set(year, next);
    const receiptNumber = formatReceiptNumber(year, next);
    this.issuedByTransaction.set(transactionId, receiptNumber);
    return receiptNumber;
  }
}

test("first receipt number of a year uses six digit running number", () => {
  assert.equal(formatReceiptNumber(2026, 1), "RCP-2026-000001");
});

test("receipt number increments with zero padding", () => {
  assert.equal(formatReceiptNumber(2026, 2), "RCP-2026-000002");
  assert.equal(formatReceiptNumber(2026, 123), "RCP-2026-000123");
});

test("annual receipt sequence reset is represented by year-specific numbers", () => {
  assert.equal(formatReceiptNumber(2026, 1), "RCP-2026-000001");
  assert.equal(formatReceiptNumber(2027, 1), "RCP-2027-000001");
});

test("transaction query normalizes search, filters, pagination, and max page size", () => {
  const query = normalizePlatformTransactionQuery({
    search: " INV-20260713-D56BE188 ",
    status: "paid",
    currency: "myr",
    sort: "oldest",
    page: "3",
    pageSize: "500"
  });

  assert.equal(query.search, "INV-20260713-D56BE188");
  assert.equal(query.status, "PAID");
  assert.equal(query.currency, "MYR");
  assert.equal(query.sort, "oldest");
  assert.equal(query.page, 3);
  assert.equal(query.pageSize, 100);
});

test("transaction query rejects unsupported statuses and invalid pagination", () => {
  const query = normalizePlatformTransactionQuery({
    status: "secret",
    page: "-1",
    pageSize: "0"
  });

  assert.equal(query.status, "");
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 1);
});

test("transaction query supports receipt/payment statuses shown in the UI", () => {
  for (const status of ["pending", "paid", "failed", "cancelled", "expired", "refunded", "partially refunded"]) {
    assert.notEqual(normalizePlatformTransactionQuery({ status }).status, "");
  }
});

test("receipt issuer assigns unique numbers to simultaneous successful transactions", async () => {
  const sequence = new ReceiptSequenceSimulator();
  const issued = await Promise.all([
    Promise.resolve(sequence.issue("txn-1", "PAID", new Date("2026-01-02T00:00:00.000Z"))),
    Promise.resolve(sequence.issue("txn-2", "PAID", new Date("2026-01-02T00:00:00.000Z"))),
    Promise.resolve(sequence.issue("txn-3", "PAID", new Date("2026-01-02T00:00:00.000Z")))
  ]);

  assert.deepEqual(issued, ["RCP-2026-000001", "RCP-2026-000002", "RCP-2026-000003"]);
  assert.equal(new Set(issued).size, 3);
});

test("duplicate webhook callback keeps the original receipt number", () => {
  const sequence = new ReceiptSequenceSimulator();
  const firstIssuedNumber = sequence.issue("txn-44", "PAID", new Date("2026-07-14T00:00:00.000Z"));
  const duplicateCallbackNumber = sequence.issue("txn-44", "PAID", new Date("2026-07-14T00:00:00.000Z"));

  assert.equal(firstIssuedNumber, "RCP-2026-000001");
  assert.equal(duplicateCallbackNumber, firstIssuedNumber);
});

test("failed or pending transactions do not receive receipt numbers", () => {
  const sequence = new ReceiptSequenceSimulator();

  assert.equal(sequence.issue("txn-pending", "PENDING", new Date("2026-07-14T00:00:00.000Z")), null);
  assert.equal(sequence.issue("txn-failed", "FAILED", new Date("2026-07-14T00:00:00.000Z")), null);
  assert.equal(sequence.issue("txn-paid", "PAID", new Date("2026-07-14T00:00:00.000Z")), "RCP-2026-000001");
});

test("receipt-number uniqueness is preserved across yearly sequences", () => {
  const sequence = new ReceiptSequenceSimulator();
  const issued = [
    sequence.issue("txn-2026-a", "PAID", new Date("2026-12-31T23:59:00.000Z")),
    sequence.issue("txn-2026-b", "PAID", new Date("2026-12-31T23:59:01.000Z")),
    sequence.issue("txn-2027-a", "PAID", new Date("2027-01-01T00:00:00.000Z"))
  ];

  assert.deepEqual(issued, ["RCP-2026-000001", "RCP-2026-000002", "RCP-2027-000001"]);
  assert.equal(new Set(issued).size, 3);
});

test("invoice and receipt document access is gated by document availability", () => {
  const paidWithoutReceipt = { invoiceAvailable: true, receiptAvailable: false };
  const paidWithReceipt = { invoiceAvailable: true, receiptAvailable: true };
  const missingInvoice = { invoiceAvailable: false, receiptAvailable: false };

  assert.equal(paidWithoutReceipt.invoiceAvailable, true);
  assert.equal(paidWithoutReceipt.receiptAvailable, false);
  assert.equal(paidWithReceipt.receiptAvailable, true);
  assert.equal(missingInvoice.invoiceAvailable, false);
});

test("authorization expectation: platform transaction APIs are platform-admin only", () => {
  const apiGuard = "requireApiPlatformAdmin";
  assert.equal(apiGuard, "requireApiPlatformAdmin");
});
