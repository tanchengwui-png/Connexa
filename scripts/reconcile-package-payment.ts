import "dotenv/config";
import { queryOne } from "../lib/db.ts";
import { reconcileWorkspacePackagePayment } from "../lib/workspace-package-upgrades.ts";

const invoiceNumber = process.argv[2]?.trim();

if (!invoiceNumber) {
  console.error("Usage: npm run billing:reconcile:package-payment -- <internal-reference>");
  process.exit(1);
}

const upgrade = await queryOne<{ id: string }>(
  `SELECT id FROM "PendingWorkspacePackageUpgrade" WHERE "invoiceNumber" = $1 LIMIT 1`,
  [invoiceNumber]
);

if (!upgrade) {
  console.error(`No package payment attempt found for ${invoiceNumber}.`);
  process.exit(1);
}

const result = await reconcileWorkspacePackagePayment({ upgradeId: upgrade.id, source: "manual" });
console.info(JSON.stringify({ invoiceNumber, ...result }));
