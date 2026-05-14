import "dotenv/config";
import os from "os";

const workerUrl = (process.env.AUTOMATION_WORKER_URL || process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const workerToken = (process.env.AUTOMATION_WORKER_TOKEN || process.env.OUTBOUND_WORKER_TOKEN || "").trim();
const pollMs = Math.max(1000, Number(process.env.AUTOMATION_WORKER_POLL_MS || "3000"));
const batchSize = Math.max(1, Math.min(50, Number(process.env.AUTOMATION_WORKER_BATCH_SIZE || "10")));
const workerLabel = process.env.AUTOMATION_WORKER_LABEL?.trim() || `${os.hostname()}#automation#${process.pid}`;

if (!workerToken) {
  console.error("AUTOMATION_WORKER_TOKEN or OUTBOUND_WORKER_TOKEN is required.");
  process.exit(1);
}

let shuttingDown = false;
let hasLoggedWaitingMessage = false;

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

while (!shuttingDown) {
  try {
    const response = await fetch(`${workerUrl}/api/internal/automation-jobs/process?limit=${batchSize}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-token": workerToken
      },
      body: JSON.stringify({
        workerLabel
      })
    });

    const payload = await response.json().catch(() => null);

    if (response.status === 404 || response.status === 502 || response.status === 503) {
      if (!hasLoggedWaitingMessage) {
        console.info("Automation worker is waiting for the app server to finish starting.");
        hasLoggedWaitingMessage = true;
      }
    } else if (!response.ok) {
      console.error("Automation worker request failed.", payload ?? response.statusText);
    } else {
      hasLoggedWaitingMessage = false;
      if (payload?.claimed || payload?.failed || payload?.sent || payload?.canceled || payload?.rescheduled) {
        console.info("Automation worker cycle", payload);
      }
    }
  } catch (error) {
    console.error("Automation worker cycle crashed.", error);
  }

  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
