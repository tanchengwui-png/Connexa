import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const outputDir = "/tmp/connexa-billing-document-samples";

function loadBillingRenderer() {
  const source = readFileSync(join(repoRoot, "lib", "billing-management.ts"), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const module = { exports: {} };
  const sandboxRequire = (specifier) => {
    if (specifier.startsWith("@/")) {
      return new Proxy({}, { get: () => undefined });
    }
    return require(specifier);
  };

  vm.runInNewContext(transpiled, {
    Buffer,
    console,
    exports: module.exports,
    module,
    process,
    require: sandboxRequire
  });

  return module.exports;
}

function createContext(overrides = {}) {
  return {
    type: "invoice",
    title: "INVOICE",
    invoiceNo: "INV-20260611-B8325F5D",
    receiptNo: "RCT-20260611-B8325F5D",
    orderNo: "ORD-20260611-B8325F5D",
    issueDate: new Date("2026-06-11T10:00:00.000Z"),
    dueDate: new Date("2026-06-18T10:00:00.000Z"),
    paymentDate: new Date("2026-06-11T10:30:00.000Z"),
    paymentMethod: "Billplz",
    currency: "MYR",
    status: "PAID",
    company: {
      name: "Recurvos Connexa",
      registrationNo: "202601234567",
      email: "billing@recurvos.com",
      contactNumber: null,
      addressLines: ["Kuala Lumpur", "Malaysia"]
    },
    customer: {
      name: "Connexa Sample Customer Sdn Bhd",
      registrationNo: "MY-99887766",
      email: "billing@example.com",
      contactNumber: "+60 12-345 6789",
      addressLines: ["Level 20, Sample Tower", "Jalan Ampang", "50450 Kuala Lumpur", "Malaysia"]
    },
    items: [{
      description: "Growth package (Monthly)",
      qty: 1,
      unitPrice: 149,
      lineTotal: 149
    }],
    summaryRows: [
      { label: "Subtotal", amount: 149 },
      { label: "Discount", amount: 0 },
      { label: "Tax", amount: 0 },
      { label: "Total", amount: 149, highlight: true }
    ],
    metaRows: [
      { label: "Invoice No", value: "INV-20260611-B8325F5D" },
      { label: "Invoice Date", value: "11 Jun 2026" },
      { label: "Due Date", value: "18 Jun 2026" },
      { label: "Currency", value: "MYR" }
    ],
    notes: [
      "Please include the invoice number with your payment reference.",
      "This is a system generated invoice."
    ],
    ...overrides
  };
}

function toPdfText(buffer) {
  return buffer.toString("latin1");
}

function extractPdfStream(buffer) {
  const pdf = toPdfText(buffer);
  const match = pdf.match(/stream\n([\s\S]*?)\nendstream/);
  assert.ok(match?.[1], "expected a PDF content stream");
  return match[1];
}

function unescapePdfText(value) {
  return value
    .replaceAll("\\\\", "\\")
    .replaceAll("\\(", "(")
    .replaceAll("\\)", ")");
}

function estimateTextWidth(value, fontSize, isBold) {
  return value.length * fontSize * (isBold ? 0.56 : 0.52);
}

function extractTextCommands(buffer) {
  return extractPdfStream(buffer)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("BT /"))
    .map((line) => {
      const match = line.match(
        /^BT \/(F\d) ([\d.]+) Tf [\d.]+ [\d.]+ [\d.]+ rg 1 0 0 1 ([\d.]+) ([\d.]+) Tm \((.*)\) Tj ET$/
      );
      assert.ok(match, `unable to parse PDF text command: ${line}`);
      const [, font, size, x, y, text] = match;
      return {
        font,
        size: Number(size),
        x: Number(x),
        y: Number(y),
        text: unescapePdfText(text),
        rightEdge:
          Number(x) + estimateTextWidth(unescapePdfText(text), Number(size), font === "F2")
      };
    });
}

function findTextCommand(commands, text, occurrence = 0) {
  const matches = commands.filter((entry) => entry.text === text);
  const command = matches[occurrence];
  assert.ok(command, `missing PDF text command for "${text}"`);
  return command;
}

function findRowValueCommands(commands, label, minX = 0) {
  const labelCommand = findTextCommand(commands, label);
  return commands.filter(
    (entry) =>
      entry.x >= minX &&
      entry.y <= labelCommand.y + 0.01 &&
      entry.y >= labelCommand.y - 20
  );
}

function assertMatchingRightEdges(commands, values, tolerance = 0.01) {
  const seen = new Map();
  const rightEdges = values.map((value) => {
    const occurrence = seen.get(value) ?? 0;
    seen.set(value, occurrence + 1);
    return findTextCommand(commands, value, occurrence).rightEdge;
  });
  const first = rightEdges[0];
  rightEdges.forEach((edge) => {
    assert.ok(
      Math.abs(edge - first) <= tolerance,
      `expected matching right edges, got ${rightEdges.join(", ")}`
    );
  });
}

test("billing document PDFs render A4 pages and preserve normal identifiers", () => {
  const { buildInvoicePdf, buildReceiptPdf } = loadBillingRenderer();
  mkdirSync(outputDir, { recursive: true });

  const invoice = createContext();
  const receipt = createContext({
    type: "receipt",
    title: "RECEIPT",
    summaryRows: [
      { label: "Reference", text: "ORD-20260611-B8325F5D" },
      { label: "Payment Status", text: "PAID" },
      { label: "Amount Received", text: "MYR 149.00" },
      { label: "Balance", text: "MYR 0.00" }
    ],
    metaRows: [
      { label: "Receipt No", value: "-" },
      { label: "Invoice No", value: "INV-20260611-B8325F5D" },
      { label: "Paid On", value: "11 Jun 2026" },
      { label: "Currency", value: "MYR" }
    ]
  });

  const invoicePdf = buildInvoicePdf(invoice);
  const receiptPdf = buildReceiptPdf(receipt);
  writeFileSync(join(outputDir, "current-sample-invoice.pdf"), invoicePdf);
  writeFileSync(join(outputDir, "current-sample-receipt.pdf"), receiptPdf);

  for (const pdf of [invoicePdf, receiptPdf]) {
    const text = toPdfText(pdf);
    assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(text, /\(INV-20260611-B8325F5D\)/);
  }
});

test("billing document metadata uses fixed two-column label and value layout", () => {
  const { buildInvoicePdf, buildReceiptPdf } = loadBillingRenderer();

  const invoiceCommands = extractTextCommands(buildInvoicePdf(createContext()));
  assertMatchingRightEdges(invoiceCommands, [
    "INV-20260611-B8325F5D",
    "11 Jun 2026",
    "18 Jun 2026",
    "MYR"
  ]);

  const receiptCommands = extractTextCommands(
    buildReceiptPdf(
      createContext({
        type: "receipt",
        title: "RECEIPT",
        metaRows: [
          { label: "Receipt No", value: "RCT-20260611-B8325F5D" },
          { label: "Invoice No", value: "INV-20260611-B8325F5D" },
          { label: "Payment Date", value: "11 Jun 2026" },
          { label: "Currency", value: "MYR" }
        ]
      })
    )
  );
  assertMatchingRightEdges(receiptCommands, [
    "RCT-20260611-B8325F5D",
    "INV-20260611-B8325F5D",
    "11 Jun 2026",
    "MYR"
  ]);
});

test("billing document company fallback uses Recurvos Connexa instead of bare Connexa", () => {
  const source = readFileSync(join(repoRoot, "lib", "billing-management.ts"), "utf8");

  assert.match(source, /const DOCUMENT_COMPANY_NAME = "Recurvos Connexa";/);
  assert.match(source, /name\.toLowerCase\(\) === "connexa" \? DOCUMENT_COMPANY_NAME : name/);
});

test("billing document PDFs wrap long values without clipping the page", () => {
  const { buildInvoicePdf, buildReceiptPdf } = loadBillingRenderer();
  mkdirSync(outputDir, { recursive: true });

  const longInvoiceNo = "INV-20260611-B8325F5D-EXTRA-LONG-REFERENCE-999999";
  const longCustomer = {
    name: "A Very Long Customer Name Sdn Bhd With Multiple Business Units And Regional Billing References",
    registrationNo: "MY-1234567890-LONG-TAX-REFERENCE",
    email: "very.long.billing.contact.with.department.and.region@example-customer-domain.test",
    contactNumber: "+60 12-345 6789",
    addressLines: [
      "Suite 88-99, Extremely Long Commercial Address Line For Layout Regression Testing",
      "Persiaran Teknologi, Cyberjaya, Selangor, Malaysia"
    ]
  };
  const invoice = createContext({
    invoiceNo: longInvoiceNo,
    receiptNo: longInvoiceNo.replace(/^INV-/, "RCT-"),
    orderNo: `${longInvoiceNo}-ORDER`,
    customer: longCustomer,
    metaRows: [
      { label: "Invoice No", value: longInvoiceNo },
      { label: "Invoice Date", value: "11 Jun 2026" },
      { label: "Due Date", value: "18 Jun 2026" },
      { label: "Currency", value: "MYR" }
    ],
    items: [{
      description: "Growth package with a deliberately long description for PDF table wrapping validation (Monthly)",
      qty: 1,
      unitPrice: 149,
      lineTotal: 149
    }]
  });
  const receipt = createContext({
    ...invoice,
    type: "receipt",
    title: "RECEIPT",
    summaryRows: [
      { label: "Reference", text: `${longInvoiceNo}-ORDER` },
      { label: "Payment Status", text: "PAID" },
      { label: "Amount Received", text: "MYR 149.00" },
      { label: "Balance", text: "MYR 0.00" }
    ],
    metaRows: [
      { label: "Receipt No", value: "-" },
      { label: "Invoice No", value: longInvoiceNo },
      { label: "Paid On", value: "11 Jun 2026" },
      { label: "Currency", value: "MYR" }
    ]
  });

  const invoicePdf = buildInvoicePdf(invoice);
  const receiptPdf = buildReceiptPdf(receipt);
  writeFileSync(join(outputDir, "long-text-invoice.pdf"), invoicePdf);
  writeFileSync(join(outputDir, "long-text-receipt.pdf"), receiptPdf);

  for (const pdf of [invoicePdf, receiptPdf]) {
    const text = toPdfText(pdf);
    assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(text, /\(INV-20260611-\)/);
    assert.doesNotMatch(text, / 1 0 0 1 [\d.]+ -[\d.]+ Tm /);
    assert.ok(!text.includes(" NaN "), "PDF commands must not contain invalid coordinates");
  }

  const invoiceCommands = extractTextCommands(invoicePdf);
  const invoiceNoFragments = findRowValueCommands(invoiceCommands, "Invoice No", 420);
  assert.ok(invoiceNoFragments.length >= 2, "expected wrapped invoice-number fragments");
  const invoiceNoRightEdge = invoiceNoFragments[0].rightEdge;
  invoiceNoFragments.forEach((fragment) => {
    assert.ok(
      Math.abs(fragment.rightEdge - invoiceNoRightEdge) <= 0.01,
      "wrapped invoice number fragments must share the same right edge"
    );
  });
});

test("billing document summary amounts share a fixed right edge for invoice and receipt PDFs", () => {
  const { buildInvoicePdf, buildReceiptPdf } = loadBillingRenderer();

  const invoiceCommands = extractTextCommands(
    buildInvoicePdf(
      createContext({
        summaryRows: [
          { label: "Subtotal", amount: 149 },
          { label: "Discount", amount: 25 },
          { label: "Tax", amount: 0 },
          { label: "Paid", amount: 1000 },
          { label: "Balance", amount: 2500 },
          { label: "Total", amount: 3624, highlight: true }
        ]
      })
    )
  );
  assertMatchingRightEdges(invoiceCommands, [
    "MYR 149.00",
    "MYR 25.00",
    "MYR 0.00",
    "MYR 1000.00",
    "MYR 2500.00",
    "MYR 3624.00"
  ]);

  const receiptCommands = extractTextCommands(
    buildReceiptPdf(
      createContext({
        type: "receipt",
        title: "RECEIPT",
        summaryRows: [
          { label: "Subtotal", amount: 149 },
          { label: "Discount", amount: 25 },
          { label: "Tax", amount: 0 },
          { label: "Paid", amount: 1000 },
          { label: "Balance", amount: 0 },
          { label: "Total", amount: 1124, highlight: true }
        ]
      })
    )
  );
  assertMatchingRightEdges(receiptCommands, [
    "MYR 149.00",
    "MYR 25.00",
    "MYR 0.00",
    "MYR 1000.00",
    "MYR 1124.00"
  ]);
});

test("billing document item tables keep headings, values, and totals aligned", () => {
  const { buildInvoicePdf, buildReceiptPdf } = loadBillingRenderer();

  const invoiceCommands = extractTextCommands(
    buildInvoicePdf(
      createContext({
        items: [
          {
            description: "Enterprise annual support and success plan",
            qty: 12,
            unitPrice: 123456,
            lineTotal: 654321
          }
        ]
      })
    )
  );

  const qtyHeading = findTextCommand(invoiceCommands, "Qty");
  const qtyValue = findTextCommand(invoiceCommands, "12");
  const unitPriceHeading = findTextCommand(invoiceCommands, "Unit Price");
  const unitPriceValue = findTextCommand(invoiceCommands, "MYR 123456.00");
  const lineTotalHeading = findTextCommand(invoiceCommands, "Line Total");
  const lineTotalValue = findTextCommand(invoiceCommands, "MYR 654321.00", 0);
  const bottomTotalValue = findTextCommand(invoiceCommands, "MYR 654321.00", 1);

  assert.ok(Math.abs(qtyHeading.rightEdge - qtyValue.rightEdge) <= 0.01);
  assert.ok(Math.abs(unitPriceHeading.rightEdge - unitPriceValue.rightEdge) <= 0.01);
  assert.ok(Math.abs(lineTotalHeading.rightEdge - lineTotalValue.rightEdge) <= 0.01);
  assert.ok(Math.abs(lineTotalValue.rightEdge - bottomTotalValue.rightEdge) <= 0.01);

  const receiptCommands = extractTextCommands(
    buildReceiptPdf(
      createContext({
        type: "receipt",
        title: "RECEIPT",
        items: [
          {
            description: "Enterprise annual support and success plan",
            qty: 1,
            unitPrice: 123456,
            lineTotal: 654321
          }
        ]
      })
    )
  );
  const amountHeading = findTextCommand(receiptCommands, "Amount");
  const amountValue = findTextCommand(receiptCommands, "MYR 654321.00", 0);
  const totalReceivedValue = findTextCommand(receiptCommands, "MYR 654321.00", 1);
  assert.ok(Math.abs(amountHeading.rightEdge - amountValue.rightEdge) <= 0.01);
  assert.ok(Math.abs(amountValue.rightEdge - totalReceivedValue.rightEdge) <= 0.01);
});
