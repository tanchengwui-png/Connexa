import { accessSync } from "fs";
import path from "path";
import QRCode from "qrcode";
import whatsappWebJs from "whatsapp-web.js";
import { prisma } from "@/lib/prisma";
import {
  clearWorkspaceWhatsAppSession,
  getWorkspaceWhatsAppChannelStatus,
  saveWorkspaceWhatsAppChannelConnection
} from "@/lib/whatsapp-channel";
import { ingestWhatsAppClientMessage, syncWhatsAppHistoryConversation } from "@/lib/whatsapp";

const { Buttons, Client, List, LocalAuth, MessageMedia } = whatsappWebJs;
type Message = InstanceType<typeof whatsappWebJs.Message>;

type RuntimeState = {
  client: Client;
  agentId: string;
  workspaceId: string;
  sessionClientId: string;
  initializing: Promise<void> | null;
  qrCodeDataUrl: string | null;
  connectionStatus: string;
  lastError: string | null;
  isSyncingHistory: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var whatsAppRuntimeStates: Map<string, RuntimeState> | undefined;
}

const runtimeStates = global.whatsAppRuntimeStates ?? new Map<string, RuntimeState>();

if (!global.whatsAppRuntimeStates) {
  global.whatsAppRuntimeStates = runtimeStates;
}

function buildRuntimeKey(workspaceId: string) {
  return workspaceId;
}

function buildSessionClientId(workspaceId: string, agentId: string) {
  return `connexa-${workspaceId}-${agentId}`.replace(/[^a-zA-Z0-9-_]/g, "");
}

function logProfilePhotoResult(input: {
  source: "inbound" | "sync";
  displayName?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  fallbackPhotoUrl?: string | null;
  bridgePhotoUrl?: string | null;
}) {
  const label = input.displayName?.trim() || input.phone || "Unknown contact";
  const phone = input.phone ?? "unknown";
  const photoSummary = input.photoUrl ? `${input.photoUrl.slice(0, 96)}...` : "null";
  const fallbackSummary = input.fallbackPhotoUrl
    ? `${input.fallbackPhotoUrl.slice(0, 96)}...`
    : "null";
  const bridgeSummary = input.bridgePhotoUrl ? `${input.bridgePhotoUrl.slice(0, 96)}...` : "null";

  console.info(
    `[whatsapp-web][${input.source}] profile photo primary=${photoSummary} fallback=${fallbackSummary} bridge=${bridgeSummary} for ${label} (${phone})`
  );
}

async function getBridgeProfilePhotoUrl(client: Client, contactId?: string | null) {
  if (!contactId) {
    return null;
  }

  const pupPage = (client as Client & { pupPage?: { evaluate: <T, A>(fn: (arg: A) => Promise<T>, arg: A) => Promise<T> } })
    .pupPage;

  if (!pupPage?.evaluate) {
    return null;
  }

  try {
    return await pupPage.evaluate(async (id) => {
      try {
        const runtimeWindow = window as Window &
          typeof globalThis & {
            WWebJS?: {
              getChat: (contactId: string) => Promise<unknown>;
            };
            require: (moduleName: string) => {
              requestProfilePicFromServer: (chat: unknown) => Promise<{ eurl?: string | null } | null>;
            };
          };

        const chat = await runtimeWindow.WWebJS?.getChat(id);
        if (!chat) {
          return null;
        }

        const pic = await runtimeWindow
          .require("WAWebContactProfilePicThumbBridge")
          .requestProfilePicFromServer(chat);

        return pic?.eurl ?? null;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "ServerStatusCodeError"
        ) {
          return null;
        }

        return null;
      }
    }, contactId);
  } catch {
    return null;
  }
}

function getAuthDataPath() {
  return path.join(process.cwd(), ".wwebjs_auth");
}

function getBrowserExecutablePath() {
  const configuredPath = process.env.WHATSAPP_WEB_EXECUTABLE_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getSessionAuthPath(sessionClientId: string) {
  return path.join(getAuthDataPath(), `session-${sessionClientId}`);
}

function buildPlainTextListFallback(body: string, buttonText: string, options: string[]) {
  const normalizedBody = body.trim();
  const normalizedButtonText = buttonText.trim() || "Choose option";
  const normalizedOptions = options
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (!normalizedOptions.length) {
    return normalizedBody;
  }

  return [normalizedBody, `[${normalizedButtonText}]`, ...normalizedOptions.map((label, index) => `${index + 1}. ${label}`)]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n\n(\d+\.)/g, "\n$1");
}

function buildPlainTextButtonsFallback(body: string, buttons: string[]) {
  const normalizedBody = body.trim();
  const normalizedButtons = buttons
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (!normalizedButtons.length) {
    return normalizedBody;
  }

  return [normalizedBody, "[Buttons]", ...normalizedButtons.map((label, index) => `${index + 1}. ${label}`)]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n\n(\d+\.)/g, "\n$1");
}

function shouldFallbackFromInteractiveList(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("[LT01]") ||
    message.includes("Whatsapp business can't send this yet") ||
    message.includes("Invalid value at currentMsg.body") ||
    message.includes("list") ||
    message.includes("Lists are now deprecated")
  );
}

function shouldFallbackFromInteractiveButtons(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("[BT") ||
    message.includes("Buttons are now deprecated") ||
    message.includes("Invalid value at currentMsg.body") ||
    message.toLowerCase().includes("button")
  );
}

function toPhoneNumber(serializedId?: string | null) {
  return serializedId?.split("@")[0] ?? null;
}

function canImportChat(chat: {
  isGroup?: boolean;
  isChannel?: boolean;
  id?: {
    user?: string;
    _serialized?: string;
  };
}) {
  if (chat.isGroup || chat.isChannel) {
    return false;
  }

  const user = chat.id?.user?.trim();
  const serialized = chat.id?._serialized?.trim();

  if (user) {
    return true;
  }

  return Boolean(serialized && serialized.includes("@"));
}

function bindClientEvents(state: RuntimeState) {
  state.client.on("qr", async (qr) => {
    state.qrCodeDataUrl = await QRCode.toDataURL(qr);
    state.connectionStatus = "QR_READY";
    state.lastError = null;

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "QR_READY",
      displayName: null,
      phoneNumber: null,
      lastError: null,
      connectedAt: null
    });
  });

  state.client.on("authenticated", async () => {
    state.connectionStatus = "AUTHENTICATED";
    state.lastError = null;

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "AUTHENTICATED",
      lastError: null
    });
  });

  state.client.on("ready", async () => {
    state.qrCodeDataUrl = null;
    state.connectionStatus = "CONNECTED";
    state.lastError = null;

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "CONNECTED",
      displayName: state.client.info?.pushname ?? null,
      phoneNumber: toPhoneNumber(state.client.info?.wid?._serialized),
      lastError: null,
      connectedAt: new Date()
    });

    await syncWorkspaceHistory(state.workspaceId).catch(async (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unable to sync WhatsApp history after connect.";
      state.lastError = message;

      await saveWorkspaceWhatsAppChannelConnection({
        workspaceId: state.workspaceId,
        agentId: state.agentId,
        sessionClientId: state.sessionClientId,
        connectionStatus: "CONNECTED",
        lastError: message
      });
    });
  });

  state.client.on("auth_failure", async (message) => {
    state.connectionStatus = "AUTH_FAILED";
    state.lastError = message;
    state.qrCodeDataUrl = null;

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "AUTH_FAILED",
      lastError: message
    });
  });

  state.client.on("disconnected", async (reason) => {
    state.connectionStatus = "DISCONNECTED";
    state.lastError = String(reason);
    state.qrCodeDataUrl = null;
    runtimeStates.delete(buildRuntimeKey(state.workspaceId));

    await clearWorkspaceWhatsAppSession(
      state.workspaceId,
      String(reason),
      getSessionAuthPath(state.sessionClientId)
    );
  });

  state.client.on("message", async (message) => {
    if (message.fromMe) {
      return;
    }

    const body = message.body?.trim();
    if (!body) {
      return;
    }

    const messageData = message as Message & {
      _data?: {
        notifyName?: string;
      };
      rawData?: unknown;
    };
    const contact = await message.getContact().catch(() => null);
    const primaryPhotoUrl = await contact?.getProfilePicUrl().catch(() => null);
    const fallbackPhotoUrl = await state.client.getProfilePicUrl(message.from).catch(() => null);
    const bridgePhotoUrl = await getBridgeProfilePhotoUrl(state.client, message.from);
    const photoUrl = primaryPhotoUrl ?? fallbackPhotoUrl ?? bridgePhotoUrl ?? null;

    logProfilePhotoResult({
      source: "inbound",
      displayName: messageData._data?.notifyName ?? message.from,
      phone: toPhoneNumber(message.from),
      photoUrl: primaryPhotoUrl,
      fallbackPhotoUrl,
      bridgePhotoUrl
    });

    await ingestWhatsAppClientMessage({
      workspaceId: state.workspaceId,
      providerMessageId: message.id._serialized,
      body,
      phone: toPhoneNumber(message.from),
      displayName: messageData._data?.notifyName ?? message.from,
      photoUrl,
      sentAt: message.timestamp ? new Date(message.timestamp * 1000) : new Date(),
      rawPayload: messageData.rawData ?? {
        from: message.from,
        body: message.body
      }
    });
  });
}

async function initializeRuntime(state: RuntimeState) {
  if (!state.initializing) {
    state.initializing = state.client.initialize().catch(async (error: unknown) => {
      state.connectionStatus = "ERROR";
      state.lastError = error instanceof Error ? error.message : "Unable to initialize WhatsApp client.";

      await saveWorkspaceWhatsAppChannelConnection({
        workspaceId: state.workspaceId,
        agentId: state.agentId,
        sessionClientId: state.sessionClientId,
        connectionStatus: "ERROR",
        lastError: state.lastError
      });

      throw error;
    });
  }

  await state.initializing;
}

async function waitForConnectedRuntime(
  runtime: RuntimeState,
  timeoutMs = 15000
): Promise<RuntimeState> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (runtime.connectionStatus === "CONNECTED" && runtime.client.info?.wid?._serialized) {
      return runtime;
    }

    if (runtime.connectionStatus === "AUTH_FAILED" || runtime.connectionStatus === "ERROR") {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("WhatsApp client is not ready yet. Reconnect the QR session and try again.");
}

async function createRuntimeState(input: {
  workspaceId: string;
  agentId: string;
  sessionClientId: string;
}) {
  const state: RuntimeState = {
    client: new Client({
      authStrategy: new LocalAuth({
        clientId: input.sessionClientId,
        dataPath: getAuthDataPath()
      }),
      puppeteer: {
        headless: true,
        protocolTimeout: 120000,
        executablePath: getBrowserExecutablePath(),
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      }
    }),
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    sessionClientId: input.sessionClientId,
    initializing: null,
    qrCodeDataUrl: null,
    connectionStatus: "INITIALIZING",
    lastError: null,
    isSyncingHistory: false
  };

  bindClientEvents(state);
  runtimeStates.set(buildRuntimeKey(input.workspaceId), state);

  await saveWorkspaceWhatsAppChannelConnection({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionClientId: input.sessionClientId,
    connectionStatus: "INITIALIZING",
    lastError: null
  });

  await initializeRuntime(state);
  return state;
}

export async function ensureWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  agentId: string;
}) {
  const runtimeKey = buildRuntimeKey(input.workspaceId);
  const existing = runtimeStates.get(runtimeKey);

  if (existing?.client) {
    return existing;
  }

  if (existing && !existing.client) {
    runtimeStates.delete(runtimeKey);
  }

  const channel = await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
  const sessionClientId =
    channel?.sessionClientId && channel.connectedByAgentId === input.agentId
      ? channel.sessionClientId
      : buildSessionClientId(input.workspaceId, input.agentId);

  return createRuntimeState({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionClientId
  });
}

export async function restoreWorkspaceWhatsAppClient(workspaceId: string) {
  const runtimeKey = buildRuntimeKey(workspaceId);
  const existing = runtimeStates.get(runtimeKey);

  if (existing?.client) {
    return existing;
  }

  if (existing && !existing.client) {
    runtimeStates.delete(runtimeKey);
  }

  const channel = await getWorkspaceWhatsAppChannelStatus(workspaceId);
  if (!channel?.connectedByAgentId || !channel.sessionClientId) {
    return null;
  }

  return createRuntimeState({
    workspaceId,
    agentId: channel.connectedByAgentId,
    sessionClientId: channel.sessionClientId
  });
}

export async function getWorkspaceWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  agentId: string;
}) {
  const channel = await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
  const runtime = runtimeStates.get(buildRuntimeKey(input.workspaceId));

  if (
    !runtime &&
    channel?.sessionClientId &&
    channel.connectedByAgentId &&
    ["CONNECTED", "AUTHENTICATED", "INITIALIZING", "QR_READY"].includes(channel.connectionStatus)
  ) {
    await restoreWorkspaceWhatsAppClient(input.workspaceId).catch(() => null);
  }

  const hydratedRuntime = runtimeStates.get(buildRuntimeKey(input.workspaceId));

  return {
    channel,
    qrCodeDataUrl: hydratedRuntime?.qrCodeDataUrl ?? null,
    runtimeStatus: hydratedRuntime?.connectionStatus ?? channel?.connectionStatus ?? "DISCONNECTED",
    lastError: hydratedRuntime?.lastError ?? channel?.lastError ?? null,
    connectedByCurrentAgent: channel?.connectedByAgentId === input.agentId,
    isSyncingHistory: hydratedRuntime?.isSyncingHistory ?? false
  };
}

export async function disconnectWorkspaceWhatsAppClient(workspaceId: string) {
  const runtimeKey = buildRuntimeKey(workspaceId);
  const runtime = runtimeStates.get(runtimeKey);

  if (runtime) {
    runtimeStates.delete(runtimeKey);
    await runtime.client.destroy().catch(() => null);
  }

  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      workspaceId
    }
  });

  await clearWorkspaceWhatsAppSession(
    workspaceId,
    null,
    channel?.sessionClientId ? getSessionAuthPath(channel.sessionClientId) : null
  );
}

export async function sendWhatsAppWebMessage(input: {
  workspaceId: string;
  to: string;
  body: string;
  interactiveButtons?: string[] | null;
  interactiveListButtonText?: string | null;
  interactiveListOptions?: string[] | null;
  attachmentPath?: string | null;
  attachmentUrl?: string | null;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
}) {
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId);

  if (!runtime) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);

  const chatId = `${input.to.replace(/\D/g, "")}@c.us`;

  try {
    const normalizedButtons = (input.interactiveButtons ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 3);
    const normalizedListOptions = (input.interactiveListOptions ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 10);
    const normalizedListButtonText = input.interactiveListButtonText?.trim() || "Choose option";

    if (normalizedButtons.length) {
      if (input.attachmentPath || input.attachmentUrl) {
        throw new Error("Button messages do not support attachments yet.");
      }

      let sentMessage: Message;

      try {
        sentMessage = await connectedRuntime.client.sendMessage(
          chatId,
          new Buttons(
            input.body,
            normalizedButtons.map((label, index) => ({
              id: `button_${index + 1}`,
              body: label
            }))
          )
        );
      } catch (interactiveError) {
        if (!shouldFallbackFromInteractiveButtons(interactiveError)) {
          throw interactiveError;
        }

        sentMessage = await connectedRuntime.client.sendMessage(
          chatId,
          buildPlainTextButtonsFallback(input.body, normalizedButtons)
        );
      }

      return {
        providerMessageId: sentMessage.id._serialized,
        status: "accepted" as const
      };
    }

    if (normalizedListOptions.length) {
      if (input.attachmentPath || input.attachmentUrl) {
        throw new Error("List messages do not support attachments yet.");
      }

      let sentMessage: Message;

      try {
        sentMessage = await connectedRuntime.client.sendMessage(
          chatId,
          new List(input.body, normalizedListButtonText, [
            {
              title: "Options",
              rows: normalizedListOptions.map((label, index) => ({
                id: `choice_${index + 1}`,
                title: label
              }))
            }
          ])
        );
      } catch (interactiveError) {
        if (!shouldFallbackFromInteractiveList(interactiveError)) {
          throw interactiveError;
        }

        sentMessage = await connectedRuntime.client.sendMessage(
          chatId,
          buildPlainTextListFallback(input.body, normalizedListButtonText, normalizedListOptions)
        );
      }

      return {
        providerMessageId: sentMessage.id._serialized,
        status: "accepted" as const
      };
    }

    if (input.attachmentPath || input.attachmentUrl) {
      const media = input.attachmentPath
        ? MessageMedia.fromFilePath(input.attachmentPath)
        : await MessageMedia.fromUrl(input.attachmentUrl!, {
            filename: input.attachmentName ?? undefined,
            unsafeMime: true
          });
      const sentMessage = await connectedRuntime.client.sendMessage(chatId, media, {
        caption: input.body || undefined,
        sendMediaAsDocument: !(input.attachmentMimeType ?? "").startsWith("image/")
      });

      return {
        providerMessageId: sentMessage.id._serialized,
        status: "accepted" as const
      };
    }

    const sentMessage = await connectedRuntime.client.sendMessage(chatId, input.body);
    return {
      providerMessageId: sentMessage.id._serialized,
      status: "accepted" as const
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send WhatsApp message.";

    if (message.includes("getChat")) {
      runtimeStates.delete(buildRuntimeKey(input.workspaceId));
      throw new Error(
        "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try sending again."
      );
    }

    throw error;
  }
}

export async function syncWorkspaceHistory(workspaceId: string) {
  const runtime = await restoreWorkspaceWhatsAppClient(workspaceId);

  if (!runtime) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  if (!runtime.client) {
    runtimeStates.delete(buildRuntimeKey(workspaceId));
    throw new Error("WhatsApp client runtime is stale. Restart the QR session and try syncing again.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);

  if (runtime.isSyncingHistory) {
    return { importedChats: 0, importedMessages: 0 };
  }

  runtime.isSyncingHistory = true;

  try {
    const chats = await connectedRuntime.client.getChats().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to load WhatsApp chats.";

      if (message.includes("getChats")) {
        runtimeStates.delete(buildRuntimeKey(workspaceId));
        throw new Error(
          "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try syncing again."
        );
      }

      throw error;
    });
    let importedChats = 0;
    let importedMessages = 0;

    for (const chat of chats) {
      if (!canImportChat(chat)) {
        continue;
      }

      await chat.syncHistory().catch(() => false);
      const messages = await chat.fetchMessages({ limit: Infinity });
      const contact = await chat.getContact();
      const phone = contact.number || chat.id.user || toPhoneNumber(chat.id._serialized);
      const primaryPhotoUrl = await contact.getProfilePicUrl().catch(() => null);
      const fallbackPhotoUrl = await connectedRuntime.client
        .getProfilePicUrl(chat.id._serialized)
        .catch(() => null);
      const bridgePhotoUrl = await getBridgeProfilePhotoUrl(
        connectedRuntime.client,
        chat.id._serialized
      );
      const photoUrl = primaryPhotoUrl ?? fallbackPhotoUrl ?? bridgePhotoUrl ?? null;

      logProfilePhotoResult({
        source: "sync",
        displayName: contact.pushname || contact.name || chat.name || contact.number,
        phone,
        photoUrl: primaryPhotoUrl,
        fallbackPhotoUrl,
        bridgePhotoUrl
      });

      if (!phone) {
        continue;
      }

      const result = await syncWhatsAppHistoryConversation({
        workspaceId,
        phone,
        displayName: contact.pushname || contact.name || chat.name || contact.number,
        photoUrl,
        unreadCount: chat.unreadCount,
        messages: messages.map((message) => ({
          id: message.id._serialized,
          body: message.body,
          fromMe: message.fromMe,
          timestamp: message.timestamp,
          type: message.type,
          hasMedia: message.hasMedia,
          rawPayload: {
            from: message.from,
            to: message.to,
            type: message.type,
            body: message.body,
            timestamp: message.timestamp
          }
        }))
      });

      if (result.conversationId) {
        importedChats += 1;
        importedMessages += result.importedCount;
      }
    }

    return {
      importedChats,
      importedMessages
    };
  } finally {
    runtime.isSyncingHistory = false;
  }
}
