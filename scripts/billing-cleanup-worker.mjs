import "dotenv/config";

const baseUrl = (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token =
  process.env.BILLING_WORKER_TOKEN?.trim() ||
  process.env.AUTOMATION_WORKER_TOKEN?.trim() ||
  process.env.OUTBOUND_WORKER_TOKEN?.trim() ||
  "";
const intervalMs = Math.max(60_000, Number(process.env.BILLING_CLEANUP_INTERVAL_MS || "86400000"));

if (!token) {
  console.error("BILLING_WORKER_TOKEN, AUTOMATION_WORKER_TOKEN, or OUTBOUND_WORKER_TOKEN is required.");
  process.exit(1);
}

let shuttingDown = false;
process.on("SIGINT", () => { shuttingDown = true; });
process.on("SIGTERM", () => { shuttingDown = true; });

while (!shuttingDown) {
  try {
    const response = await fetch(`${baseUrl}/api/internal/billing/cleanup`, {
      method: "POST",
      headers: { "x-worker-token": token }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Billing cleanup failed.", payload ?? response.statusText);
    } else if (
      payload?.deletedWorkspaceCount ||
      payload?.appliedDowngradeCount ||
      payload?.sentCount ||
      payload?.duplicateCount
    ) {
      console.info("Billing cleanup completed.", payload);
    }
  } catch (error) {
    console.error("Billing cleanup worker crashed.", error);
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
