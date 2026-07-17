import "dotenv/config";
import os from "os";
import pg from "pg";
import {
  activeWhatsAppStatuses,
  runnableOutboundStatuses,
  targetWorkspaceIdsQuery
} from "./outbound-worker-query.mjs";

const { Client: PgClient } = pg;

const workerUrl = (process.env.OUTBOUND_WORKER_URL || process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const workerToken = process.env.OUTBOUND_WORKER_TOKEN?.trim();
const workspaceId = process.env.WORKSPACE_ID?.trim() || null;
const pollMs = Math.max(1000, Number(process.env.OUTBOUND_WORKER_POLL_MS || "3000"));
const batchSize = Math.max(1, Math.min(50, Number(process.env.OUTBOUND_WORKER_BATCH_SIZE || "10")));
const workerLabel = process.env.OUTBOUND_WORKER_LABEL?.trim() || `${os.hostname()}#${process.pid}`;
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!workerToken) {
  console.error("OUTBOUND_WORKER_TOKEN is required.");
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

let shuttingDown = false;
let hasLoggedWaitingMessage = false;
let pgClient = null;

async function getPgClient() {
  if (pgClient) {
    return pgClient;
  }

  pgClient = new PgClient({
    connectionString: databaseUrl
  });

  await pgClient.connect();
  return pgClient;
}

async function getTargetWorkspaceIds() {
  const client = await getPgClient();
  const result = await client.query(targetWorkspaceIdsQuery, [activeWhatsAppStatuses, runnableOutboundStatuses]);

  const workspaceIds = result.rows
    .map((row) => row.workspaceId?.trim() || "")
    .filter(Boolean);

  if (workspaceId && !workspaceIds.includes(workspaceId)) {
    workspaceIds.unshift(workspaceId);
  }

  return workspaceIds;
}

async function getHeartbeatWorkspaceIds() {
  return getTargetWorkspaceIds();
}

async function postHeartbeat(targetWorkspaceId) {
  await fetch(`${workerUrl}/api/internal/outbound-message-jobs/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-token": workerToken
    },
    body: JSON.stringify({
      workspaceId: targetWorkspaceId,
      workerLabel
    })
  });
}

async function postWorkerJson(path) {
  const response = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: {
      "x-worker-token": workerToken
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  const responseText = payload ? null : await response.text().catch(() => "");
  return { response, payload, responseText };
}

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

while (!shuttingDown) {
  try {
    const [heartbeatWorkspaceIds, targetWorkspaceIds] = await Promise.all([
      getHeartbeatWorkspaceIds(),
      getTargetWorkspaceIds()
    ]);

    for (const heartbeatWorkspaceId of heartbeatWorkspaceIds) {
      await postHeartbeat(heartbeatWorkspaceId);
    }

    for (const targetWorkspaceId of targetWorkspaceIds) {
      const { response, payload, responseText } = await postWorkerJson(
        `/api/internal/outbound-message-jobs/process?limit=${batchSize}&workspaceId=${encodeURIComponent(targetWorkspaceId)}`
      );

      if (response.status === 404 || response.status === 502 || response.status === 503) {
        if (!hasLoggedWaitingMessage) {
          console.info("Outbound worker is waiting for the app server to finish starting.");
          hasLoggedWaitingMessage = true;
        }
      } else if (!response.ok) {
        console.error("Outbound worker request failed.", {
          status: response.status,
          statusText: response.statusText,
          payload,
          responseText: responseText?.slice(0, 500) || null
        });
      } else {
        hasLoggedWaitingMessage = false;
        if (payload?.claimed || payload?.failed) {
          console.info("Outbound worker cycle", {
            workspaceId: targetWorkspaceId,
            ...payload
          });
        }
      }
    }

    const automation = await postWorkerJson(`/api/internal/automation-jobs/process?limit=${batchSize}`);

    if (automation.response.status === 404 || automation.response.status === 502 || automation.response.status === 503) {
      if (!hasLoggedWaitingMessage) {
        console.info("Automation jobs are waiting for the app server to finish starting.");
        hasLoggedWaitingMessage = true;
      }
    } else if (!automation.response.ok) {
      console.error("Automation worker request failed.", {
        status: automation.response.status,
        statusText: automation.response.statusText,
        payload: automation.payload,
        responseText: automation.responseText?.slice(0, 500) || null
      });
    } else {
      hasLoggedWaitingMessage = false;
      if (
        automation.payload?.claimed ||
        automation.payload?.failed ||
        automation.payload?.sent ||
        automation.payload?.canceled ||
        automation.payload?.rescheduled
      ) {
        console.info("Automation worker cycle", automation.payload);
      }
    }
  } catch (error) {
    console.error("Outbound worker cycle crashed.", error);
  }

  await new Promise((resolve) => setTimeout(resolve, pollMs));
}

await pgClient?.end().catch(() => {});
