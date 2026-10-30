import "dotenv/config";
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";

function resolveAlias(specifier: string) {
  const basePath = path.join(process.cwd(), specifier.slice(2));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  return pathToFileURL(basePath).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(resolveAlias(specifier), context);
    }

    return nextResolve(specifier, context);
  }
});

const {
  deleteWhatsAppWebMessageForEveryone,
  deleteWorkspaceWhatsAppClientSession,
  disconnectWorkspaceWhatsAppClient,
  ensureWorkspaceWhatsAppClient,
  freshStartWorkspaceWhatsAppClient,
  getWhatsAppSenderNodeMetrics,
  getWhatsAppRuntimeWatchdogSnapshot,
  getWhatsAppRuntimeHealthSummary,
  getWorkspaceWhatsAppRuntimeStatus,
  listWhatsAppMentionCandidates,
  resolveWhatsAppContacts,
  requestWhatsAppWebClientPairingCode,
  restoreWorkspaceWhatsAppClient,
  runWhatsAppRuntimeHealthWatchdog,
  setWhatsAppWebChatMute,
  sendWhatsAppWebChatSeen,
  sendWhatsAppWebMessage,
  syncWorkspaceHistory,
  shutdownAllWhatsAppRuntimes
} = await import("../lib/whatsapp-web.ts");

const host = process.env.SENDER_SERVICE_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.SENDER_SERVICE_PORT || "3101");
const expectedToken = process.env.SENDER_SERVICE_TOKEN?.trim() || "";
const watchdogIntervalMs = Math.max(
  15_000,
  Number.parseInt(process.env.WHATSAPP_RUNTIME_WATCHDOG_INTERVAL_MS ?? "60000", 10) || 60_000
);
const watchdogMaxFailures = Math.max(
  1,
  Number.parseInt(process.env.SENDER_WATCHDOG_MAX_FAILURES ?? "3", 10) || 3
);
let restoreSweepComplete = false;
let initialWatchdogComplete = false;
let shuttingDown = false;
let watchdogTimer: NodeJS.Timeout | null = null;
let watchdogConsecutiveFailures = 0;

function isAuthorized(request: IncomingMessage) {
  if (!expectedToken) {
    return true;
  }

  const headerToken = request.headers["x-sender-token"]?.toString().trim();
  const bearerToken = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
  return headerToken === expectedToken || bearerToken === expectedToken;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function getRequiredSearchParam(url: URL, key: string) {
  return url.searchParams.get(key)?.trim() || null;
}

function getSafePhonePairingFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("oncodereceivedevent")) {
    return "CODE_BRIDGE_UNAVAILABLE";
  }
  if (message.includes("execution context") || message.includes("context was destroyed")) {
    return "BROWSER_CONTEXT_RESET";
  }
  if (message.includes("target closed") || message.includes("session closed")) {
    return "BROWSER_SESSION_CLOSED";
  }
  if (message.includes("pairingcodelinkutils") || message.includes("altlinking")) {
    return "PAIRING_MODULE_UNAVAILABLE";
  }
  if (message.includes("protocol error") || message.includes("runtime.callfunctionon")) {
    return "BROWSER_PROTOCOL_ERROR";
  }

  return "UNKNOWN";
}

function getSafePhonePairingFailureDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error.");
  return message
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted-number]")
    .replace(/\b[A-Z0-9]{8,}\b/g, "[redacted-code]")
    .slice(0, 240);
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Invalid request." });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, { ok: true, status: "live", uptimeSec: Math.round(process.uptime()) });
      return;
    }

    if (url.pathname === "/ready" && request.method === "GET") {
      const watchdog = getWhatsAppRuntimeWatchdogSnapshot();
      const ready = restoreSweepComplete && initialWatchdogComplete && !shuttingDown && !watchdog.lastError;
      sendJson(response, ready ? 200 : 503, {
        ok: ready,
        status: ready ? "ready" : "starting",
        restoreSweepComplete,
        watchdog
      });
      return;
    }

    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized sender request." });
      return;
    }

    if (url.pathname === "/whatsapp/runtime" && request.method === "GET") {
      const workspaceId = getRequiredSearchParam(url, "workspaceId");
      const agentId = getRequiredSearchParam(url, "agentId");
      const channelId = getRequiredSearchParam(url, "channelId");

      if (!workspaceId || !agentId) {
        sendJson(response, 400, { error: "workspaceId and agentId are required." });
        return;
      }

      const status = await getWorkspaceWhatsAppRuntimeStatus({ workspaceId, agentId, channelId });
      sendJson(response, 200, { status });
      return;
    }

    if (url.pathname === "/sender/health" && request.method === "GET") {
      const [metrics, channelHealth] = await Promise.all([
        Promise.resolve(getWhatsAppSenderNodeMetrics()),
        getWhatsAppRuntimeHealthSummary()
      ]);
      sendJson(response, 200, {
        ok: true,
        metrics,
        restoreSweepComplete,
        channelHealth,
        watchdog: getWhatsAppRuntimeWatchdogSnapshot()
      });
      return;
    }

    if (url.pathname === "/whatsapp/runtime/start" && request.method === "POST") {
      const body = await readJsonBody<{ workspaceId?: string; agentId?: string; channelId?: string | null }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const agentId = body?.agentId?.trim();
      const channelId = body?.channelId?.trim() || null;

      if (!workspaceId || !agentId) {
        sendJson(response, 400, { error: "workspaceId and agentId are required." });
        return;
      }

      // Pairing initialization owns a long-lived Chromium task. Acknowledge
      // dispatch immediately so the web request never sits behind WhatsApp Web
      // startup; single-flight/runtime generation fencing remains in the
      // sender and QR progress is delivered over SSE plus status snapshots.
      void ensureWorkspaceWhatsAppClient({ workspaceId, agentId, channelId }).catch((error) => {
        console.error(
          `[sender-service] WhatsApp runtime start failed workspace=${workspaceId} channel=${channelId ?? "default"}: ${
            error instanceof Error ? error.message : "Unknown runtime start error."
          }`
        );
      });
      sendJson(response, 202, { ok: true, accepted: true });
      return;
    }

    if (url.pathname === "/whatsapp/runtime/fresh-start" && request.method === "POST") {
      const body = await readJsonBody<{ workspaceId?: string; agentId?: string; channelId?: string }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const agentId = body?.agentId?.trim();
      const channelId = body?.channelId?.trim();

      if (!workspaceId || !agentId || !channelId) {
        sendJson(response, 400, { error: "workspaceId, agentId, and channelId are required." });
        return;
      }

      void freshStartWorkspaceWhatsAppClient({ workspaceId, agentId, channelId }).catch((error) => {
        console.error(
          `[sender-service] WhatsApp fresh start failed workspace=${workspaceId} channel=${channelId}: ${
            error instanceof Error ? error.message : "Unknown fresh-start error."
          }`
        );
      });
      sendJson(response, 202, { ok: true, accepted: true });
      return;
    }

    if (url.pathname === "/whatsapp/pairing" && request.method === "POST") {
      const body = await readJsonBody<{
        workspaceId?: string;
        agentId?: string;
        channelId?: string;
        phoneNumber?: string;
      }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const agentId = body?.agentId?.trim();
      const channelId = body?.channelId?.trim();
      const phoneNumber = body?.phoneNumber?.trim();

      if (!workspaceId || !agentId || !channelId || !phoneNumber) {
        sendJson(response, 400, { error: "workspaceId, agentId, channelId, and phoneNumber are required." });
        return;
      }

      let pairingCode: string;
      try {
        pairingCode = await requestWhatsAppWebClientPairingCode({
          workspaceId,
          agentId,
          channelId,
          phoneNumber
        });
      } catch (error) {
        const failureCode = getSafePhonePairingFailureCode(error);
        const failureDetail = getSafePhonePairingFailureDetail(error);
        console.warn(
          `[sender][phone-pairing] failed workspace=${workspaceId} channel=${channelId} reason=${failureCode} detail=${failureDetail}`
        );
        throw new Error(`WHATSAPP_PHONE_PAIRING_${failureCode}`);
      }
      sendJson(response, 200, { pairingCode });
      return;
    }

    if (url.pathname === "/whatsapp/runtime" && request.method === "DELETE") {
      const workspaceId = getRequiredSearchParam(url, "workspaceId");
      const channelId = getRequiredSearchParam(url, "channelId");

      if (!workspaceId) {
        sendJson(response, 400, { error: "workspaceId is required." });
        return;
      }

      await disconnectWorkspaceWhatsAppClient(workspaceId, channelId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/whatsapp/runtime/session" && request.method === "DELETE") {
      const workspaceId = getRequiredSearchParam(url, "workspaceId");
      const channelId = getRequiredSearchParam(url, "channelId");

      if (!workspaceId) {
        sendJson(response, 400, { error: "workspaceId is required." });
        return;
      }

      await deleteWorkspaceWhatsAppClientSession(workspaceId, channelId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/whatsapp/runtime/sync" && request.method === "POST") {
      const body = await readJsonBody<{
        workspaceId?: string;
        channelId?: string | null;
        triggeredBy?: "manual" | "background";
        priority?: "bootstrap" | "incremental" | "routine" | "media";
      }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const channelId = body?.channelId?.trim() || null;

      if (!workspaceId) {
        sendJson(response, 400, { error: "workspaceId is required." });
        return;
      }

      const result = await syncWorkspaceHistory(workspaceId, channelId, {
        triggeredBy: body?.triggeredBy,
        priority: body?.priority
      });
      sendJson(response, 200, { ok: true, result });
      return;
    }

    if (url.pathname === "/whatsapp/contacts/resolve" && request.method === "POST") {
      const body = await readJsonBody<{ workspaceId?: string; mentionIds?: string[] }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const mentionIds = Array.isArray(body?.mentionIds)
        ? body!.mentionIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
        : [];

      if (!workspaceId) {
        sendJson(response, 400, { error: "workspaceId is required." });
        return;
      }

      const contacts = await resolveWhatsAppContacts({ workspaceId, mentionIds });
      sendJson(response, 200, { contacts });
      return;
    }

    if (url.pathname === "/whatsapp/mentions" && request.method === "POST") {
      const body = await readJsonBody<{ workspaceId?: string; conversationId?: string; query?: string | null }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const conversationId = body?.conversationId?.trim();

      if (!workspaceId || !conversationId) {
        sendJson(response, 400, { error: "workspaceId and conversationId are required." });
        return;
      }

      const candidates = await listWhatsAppMentionCandidates({
        workspaceId,
        conversationId,
        query: body?.query ?? null
      });
      sendJson(response, 200, { candidates });
      return;
    }

    if (url.pathname === "/messages/send" && request.method === "POST") {
      const body = await readJsonBody<{
        conversationId?: string;
        channelId?: string | null;
        workspaceId?: string;
        to?: string;
        body?: string;
        mentions?: Array<{
          id?: string;
          label?: string;
          token?: string;
        }> | null;
        quotedProviderMessageId?: string | null;
        simulateTyping?: boolean;
        interactiveButtons?: string[] | null;
        interactiveListButtonText?: string | null;
        interactiveListOptions?: string[] | null;
        attachmentPath?: string | null;
        attachmentUrl?: string | null;
        attachmentMimeType?: string | null;
        attachmentName?: string | null;
        sendAudioAsVoice?: boolean;
      }>(request);

      const workspaceId = body?.workspaceId?.trim();
      const conversationId = body?.conversationId?.trim();
      const channelId = body?.channelId?.trim() || null;
      const to = body?.to?.trim();
      const messageBody = body?.body ?? "";

      if (!workspaceId || !conversationId || !to) {
        sendJson(response, 400, { error: "workspaceId, conversationId, and to are required." });
        return;
      }

      const result = await sendWhatsAppWebMessage({
        workspaceId,
        channelId,
        conversationId,
        to,
        body: messageBody,
        mentions: Array.isArray(body?.mentions)
          ? body.mentions
              .map((mention) => ({
                id: mention?.id?.trim() ?? "",
                label: mention?.label?.trim() ?? "",
                token: mention?.token?.trim() ?? ""
              }))
              .filter((mention) => mention.id && mention.label && mention.token)
          : null,
        quotedProviderMessageId: body?.quotedProviderMessageId ?? null,
        simulateTyping: body?.simulateTyping ?? false,
        interactiveButtons: body?.interactiveButtons ?? null,
        interactiveListButtonText: body?.interactiveListButtonText ?? null,
        interactiveListOptions: body?.interactiveListOptions ?? null,
        attachmentPath: body?.attachmentPath ?? null,
        attachmentUrl: body?.attachmentUrl ?? null,
        attachmentMimeType: body?.attachmentMimeType ?? null,
        attachmentName: body?.attachmentName ?? null,
        sendAudioAsVoice: body?.sendAudioAsVoice === true
      });

      sendJson(response, 200, { result });
      return;
    }

    if (url.pathname === "/messages/delete-for-everyone" && request.method === "POST") {
      const body = await readJsonBody<{
        workspaceId?: string;
        channelId?: string | null;
        providerMessageId?: string;
      }>(request);

      const workspaceId = body?.workspaceId?.trim();
      const channelId = body?.channelId?.trim() || null;
      const providerMessageId = body?.providerMessageId?.trim();

      if (!workspaceId || !providerMessageId) {
        sendJson(response, 400, { error: "workspaceId and providerMessageId are required." });
        return;
      }

      const result = await deleteWhatsAppWebMessageForEveryone({
        workspaceId,
        channelId,
        providerMessageId
      });

      sendJson(response, 200, { result });
      return;
    }

    if (url.pathname === "/messages/seen" && request.method === "POST") {
      const body = await readJsonBody<{
        workspaceId?: string;
        channelId?: string | null;
        conversationId?: string;
      }>(request);

      const workspaceId = body?.workspaceId?.trim();
      const channelId = body?.channelId?.trim() || null;
      const conversationId = body?.conversationId?.trim();

      if (!workspaceId || !conversationId) {
        sendJson(response, 400, { error: "workspaceId and conversationId are required." });
        return;
      }

      const result = await sendWhatsAppWebChatSeen({
        workspaceId,
        channelId,
        conversationId
      });

      sendJson(response, 200, { result });
      return;
    }

    if (url.pathname === "/chats/mute" && request.method === "POST") {
      const body = await readJsonBody<{
        workspaceId?: string;
        channelId?: string | null;
        conversationId?: string;
        mute?: boolean;
        muteUntil?: string | null;
      }>(request);

      const workspaceId = body?.workspaceId?.trim();
      const channelId = body?.channelId?.trim() || null;
      const conversationId = body?.conversationId?.trim();

      if (!workspaceId || !conversationId || typeof body?.mute !== "boolean") {
        sendJson(response, 400, { error: "workspaceId, conversationId, and mute are required." });
        return;
      }

      const muteUntil = body.muteUntil ? new Date(body.muteUntil) : null;
      if (body.mute && body.muteUntil && Number.isNaN(muteUntil?.getTime?.() ?? Number.NaN)) {
        sendJson(response, 400, { error: "muteUntil must be a valid date." });
        return;
      }

      const result = await setWhatsAppWebChatMute({
        workspaceId,
        channelId,
        conversationId,
        mute: body.mute,
        muteUntil
      });

      sendJson(response, 200, {
        result: {
          isMuted: result.isMuted,
          muteExpiration: result.muteExpiration?.toISOString() ?? null
        }
      });
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Sender service request failed."
    });
  }
});

async function ensureSenderDatabaseSchema() {
  // This deployment has historically used both db push and migrations, so a
  // newly generated Prisma client can briefly reach staging before its
  // additive migration. Keep personal WhatsApp history available while the
  // migration ledger is reconciled; the matching migration remains the source
  // of truth for normally provisioned databases.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "whatsappPushName" TEXT`
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PersonalWhatsAppNotificationLedger" (
      "id" TEXT NOT NULL,
      "workspaceId" TEXT NOT NULL,
      "channelId" TEXT NOT NULL,
      "chatId" TEXT NOT NULL,
      "fingerprint" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PersonalWhatsAppNotificationLedger_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PersonalWhatsAppNotificationLedger_workspaceId_channelId_chatId_fingerprint_key"
      ON "PersonalWhatsAppNotificationLedger"("workspaceId", "channelId", "chatId", "fingerprint")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PersonalWhatsAppNotificationLedger_workspaceId_channelId_createdAt_idx"
      ON "PersonalWhatsAppNotificationLedger"("workspaceId", "channelId", "createdAt")
  `);
}

await ensureSenderDatabaseSchema();

server.listen(port, host, () => {
  console.info(`Connexa sender service listening on http://${host}:${port}`);
  void startRuntimeReliabilitySupervisor();
});

async function startRuntimeReliabilitySupervisor() {
  try {
    await restorePersistedWhatsAppSessions();
  } finally {
    restoreSweepComplete = true;
  }

  await runSupervisedWatchdog("initial");
  initialWatchdogComplete = true;
  watchdogTimer = setInterval(() => {
    void runSupervisedWatchdog("scheduled");
  }, watchdogIntervalMs);
  watchdogTimer.unref?.();
}

async function runSupervisedWatchdog(label: "initial" | "scheduled") {
  try {
    await runWhatsAppRuntimeHealthWatchdog();
    watchdogConsecutiveFailures = 0;
  } catch (error) {
    watchdogConsecutiveFailures += 1;
    console.error(
      `[sender] ${label} runtime watchdog failed (${watchdogConsecutiveFailures}/${watchdogMaxFailures}): ${
        error instanceof Error ? error.message : "Unknown error."
      }`
    );
    if (watchdogConsecutiveFailures >= watchdogMaxFailures) {
      // Docker Compose does not restart an unhealthy-but-running container.
      // Exit after repeated systemic failures so restart: unless-stopped can
      // replace the process. Individual channel failures are contained inside
      // the watchdog and never reach this counter.
      void shutdown("watchdog-failure", 1);
    }
  }
}

async function restorePersistedWhatsAppSessions() {
  const channels = await prisma.$queryRaw<Array<{
    id: string;
    workspaceId: string;
    connectionStatus: string;
    connectedAt: Date | null;
    nextRecoveryAt: Date | null;
  }>>`
    SELECT "id", "workspaceId", "connectionStatus", "connectedAt", "nextRecoveryAt"
    FROM "WhatsAppChannel"
    WHERE ("channelType" = 'web' OR ("channelType" IS NULL AND "phoneNumberId" IS NULL))
      AND "runtimeDesiredState" = 'RUNNING'
      AND "runtimeHealthStatus" <> 'REAUTH_REQUIRED'
      AND "connectedByAgentId" IS NOT NULL
      AND "sessionClientId" IS NOT NULL
  `;

  const restoreChannel = async (channel: (typeof channels)[number]) => {
    if (
      !channel.connectedAt &&
      ["INITIALIZING", "QR_READY"].includes(channel.connectionStatus)
    ) {
      await prisma.$executeRaw`
        UPDATE "WhatsAppChannel"
        SET "runtimeHealthStatus" = 'REAUTH_REQUIRED',
            "connectionStatus" = 'REAUTH_REQUIRED',
            "reauthRequiredAt" = NOW(),
            "lastErrorCode" = 'PAIRING_INTERRUPTED',
            "updatedAt" = NOW()
        WHERE "id" = ${channel.id}
      `;
      return;
    }
    if (channel.nextRecoveryAt && channel.nextRecoveryAt.getTime() > Date.now()) return;

    try {
      await restoreWorkspaceWhatsAppClient(channel.workspaceId, channel.id);
        console.info(
          `[sender] restored WhatsApp runtime for workspace ${channel.workspaceId} channel ${channel.id}`
        );

    } catch (error) {
      console.error(
        `[sender] failed to restore WhatsApp runtime for workspace ${channel.workspaceId} channel ${channel.id}: ${
          error instanceof Error ? error.message : "Unknown restore error."
        }`
      );
    }
  };

  // Restore one Chromium runtime at a time. Parallel browser startup on the
  // 4 GB sender host amplifies navigation and injection latency, and can make
  // a recovered session contend with a fresh QR-linking handshake.
  const concurrency = 1;
  for (let offset = 0; offset < channels.length; offset += concurrency) {
    await Promise.all(channels.slice(offset, offset + concurrency).map(restoreChannel));
  }
}

process.on("unhandledRejection", (error) => {
  console.error(
    `[sender] unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  );
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  console.error(`[sender] uncaught exception: ${error.stack ?? error.message}`);
  void shutdown("uncaughtException", 1);
});

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Shutting down sender service on ${signal}`);
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 20_000));
  await Promise.race([
    Promise.allSettled([
      new Promise<void>((resolve) => server.close(() => resolve())),
      shutdownAllWhatsAppRuntimes()
    ]).then(() => undefined),
    timeout
  ]);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
