import "dotenv/config";
import os from "os";
import pg from "pg";

const { Client: PgClient } = pg;

const workerUrl = (process.env.OUTBOUND_WORKER_URL || process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const workerToken = process.env.OUTBOUND_WORKER_TOKEN?.trim();
const workspaceId = process.env.WORKSPACE_ID?.trim();
const pollMs = Math.max(1000, Number(process.env.OUTBOUND_WORKER_POLL_MS || "3000"));
const batchSize = Math.max(1, Math.min(50, Number(process.env.OUTBOUND_WORKER_BATCH_SIZE || "10")));
const workerLabel = process.env.OUTBOUND_WORKER_LABEL?.trim() || `${os.hostname()}#${process.pid}`;
const databaseUrl = process.env.DATABASE_URL?.trim();
const tan1Email = (process.env.OUTBOUND_WORKER_TAN1_EMAIL || "tanchengwui@hotmail.com").trim().toLowerCase();
const activeWhatsAppStatuses = ["AUTHENTICATED", "CONNECTED", "SYNCING_HISTORY", "READY"];

if (!workerToken) {
  console.error("OUTBOUND_WORKER_TOKEN is required.");
  process.exit(1);
}

if (!workspaceId) {
  console.error("WORKSPACE_ID is required.");
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

let shuttingDown = false;
let hasLoggedWaitingMessage = false;
let pgClient = null;
let tan1WorkspaceId;

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

async function resolveTan1WorkspaceId() {
  if (tan1WorkspaceId !== undefined) {
    return tan1WorkspaceId;
  }

  const client = await getPgClient();
  const result = await client.query(
    `
      select "workspaceId"
      from "Agent"
      where lower(email) = $1
         or lower(name) = 'tan1'
      order by case when lower(email) = $1 then 0 else 1 end, "createdAt" asc
      limit 1
    `,
    [tan1Email]
  );

  tan1WorkspaceId = result.rows[0]?.workspaceId?.trim() || "";
  return tan1WorkspaceId;
}

async function getTargetWorkspaceIds() {
  const resolvedTan1WorkspaceId = await resolveTan1WorkspaceId();

  if (!resolvedTan1WorkspaceId || workspaceId !== resolvedTan1WorkspaceId) {
    return [workspaceId];
  }

  const client = await getPgClient();
  const result = await client.query(
    `
      select "workspaceId"
      from "WhatsAppChannel"
      where "connectedByAgentId" is not null
        and "sessionClientId" is not null
        and "connectionStatus" = any($1::text[])
      order by "workspaceId" asc
    `,
    [activeWhatsAppStatuses]
  );

  const workspaceIds = result.rows
    .map((row) => row.workspaceId?.trim() || "")
    .filter(Boolean);

  return workspaceIds.length ? workspaceIds : [workspaceId];
}

async function getHeartbeatWorkspaceIds() {
  const targetWorkspaceIds = await getTargetWorkspaceIds();
  return Array.from(new Set([workspaceId, ...targetWorkspaceIds]));
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

  const payload = await response.json().catch(() => null);
  return { response, payload };
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
      const { response, payload } = await postWorkerJson(
        `/api/internal/outbound-message-jobs/process?limit=${batchSize}&workspaceId=${encodeURIComponent(targetWorkspaceId)}`
      );

      if (response.status === 404 || response.status === 502 || response.status === 503) {
        if (!hasLoggedWaitingMessage) {
          console.info("Outbound worker is waiting for the app server to finish starting.");
          hasLoggedWaitingMessage = true;
        }
      } else if (!response.ok) {
        console.error("Outbound worker request failed.", payload ?? response.statusText);
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
      console.error("Automation worker request failed.", automation.payload ?? automation.response.statusText);
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
