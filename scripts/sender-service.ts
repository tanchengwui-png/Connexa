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
  getWhatsAppSenderNodeMetrics,
  getWorkspaceWhatsAppRuntimeStatus,
  listWhatsAppMentionCandidates,
  resolveWhatsAppContacts,
  restoreWorkspaceWhatsAppClient,
  setWhatsAppWebChatMute,
  sendWhatsAppWebChatSeen,
  sendWhatsAppWebMessage,
  syncWorkspaceHistory
} = await import("../lib/whatsapp-web.ts");

const host = process.env.SENDER_SERVICE_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.SENDER_SERVICE_PORT || "3101");
const expectedToken = process.env.SENDER_SERVICE_TOKEN?.trim() || "";

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

const server = createServer(async (request, response) => {
  try {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Invalid request." });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, { ok: true });
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
      const metrics = getWhatsAppSenderNodeMetrics();
      sendJson(response, 200, { ok: true, metrics });
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

      await ensureWorkspaceWhatsAppClient({ workspaceId, agentId, channelId });
      sendJson(response, 200, { ok: true });
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
      }>(request);
      const workspaceId = body?.workspaceId?.trim();
      const channelId = body?.channelId?.trim() || null;

      if (!workspaceId) {
        sendJson(response, 400, { error: "workspaceId is required." });
        return;
      }

      const result = await syncWorkspaceHistory(workspaceId, channelId, {
        triggeredBy: body?.triggeredBy
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

server.listen(port, host, () => {
  console.info(`Connexa sender service listening on http://${host}:${port}`);
  void restorePersistedWhatsAppSessions();
});

async function restorePersistedWhatsAppSessions() {
  const channels = await prisma.whatsAppChannel.findMany({
    where: {
      connectedByAgentId: {
        not: null
      },
      sessionClientId: {
        not: null
      },
      connectionStatus: {
        in: ["AUTHENTICATED", "CONNECTED", "SYNCING_HISTORY", "READY"]
      }
    },
    select: {
      id: true,
      workspaceId: true
    }
  });

  for (const channel of channels) {
    restoreWorkspaceWhatsAppClient(channel.workspaceId, channel.id)
      .then(() => {
        console.info(
          `[sender] restored WhatsApp runtime for workspace ${channel.workspaceId} channel ${channel.id}`
        );
      })
      .catch((error: unknown) => {
        console.error(
          `[sender] failed to restore WhatsApp runtime for workspace ${channel.workspaceId} channel ${channel.id}: ${
            error instanceof Error ? error.message : "Unknown restore error."
          }`
        );
      });
  }
}

process.on("unhandledRejection", (error) => {
  console.error(
    `[sender] unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  );
});

process.on("uncaughtException", (error) => {
  console.error(`[sender] uncaught exception: ${error.stack ?? error.message}`);
});

async function shutdown(signal: string) {
  console.info(`Shutting down sender service on ${signal}`);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
