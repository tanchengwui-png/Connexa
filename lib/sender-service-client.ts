type SenderServiceRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  searchParams?: URLSearchParams;
};

function getSenderServiceBaseUrl() {
  return process.env.SENDER_SERVICE_URL?.trim()?.replace(/\/$/, "") ?? null;
}

function getSenderServiceToken() {
  return process.env.SENDER_SERVICE_TOKEN?.trim() ?? null;
}

export function isRemoteSenderServiceEnabled() {
  return Boolean(getSenderServiceBaseUrl());
}

async function callSenderService<T>(
  path: string,
  init: SenderServiceRequestInit = {}
): Promise<T> {
  const baseUrl = getSenderServiceBaseUrl();
  if (!baseUrl) {
    throw new Error("SENDER_SERVICE_URL is not configured.");
  }

  const url = new URL(`${baseUrl}${path}`);
  if (init.searchParams) {
    url.search = init.searchParams.toString();
  }

  const headers = new Headers();
  const token = getSenderServiceToken();
  if (token) {
    headers.set("x-sender-token", token);
    headers.set("authorization", `Bearer ${token}`);
  }

  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }

  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body,
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
      }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Sender service request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getRemoteWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  agentId: string;
}) {
  const payload = await callSenderService<{
    status: {
      channel?: unknown;
      qrCodeDataUrl?: string | null;
      runtimeStatus?: string;
      lastError?: string | null;
      connectedByCurrentAgent?: boolean;
      isSyncingHistory?: boolean;
    };
  }>("/whatsapp/runtime", {
    searchParams: new URLSearchParams({
      workspaceId: input.workspaceId,
      agentId: input.agentId
    })
  });

  return payload.status;
}

export async function ensureRemoteWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  agentId: string;
}) {
  await callSenderService<{ ok: true }>("/whatsapp/runtime/start", {
    method: "POST",
    body: input
  });
}

export async function disconnectRemoteWorkspaceWhatsAppClient(workspaceId: string) {
  await callSenderService<{ ok: true }>("/whatsapp/runtime", {
    method: "DELETE",
    searchParams: new URLSearchParams({
      workspaceId
    })
  });
}

export async function syncRemoteWorkspaceHistory(workspaceId: string) {
  const payload = await callSenderService<{
    ok: true;
    result: {
      importedChats: number;
      importedMessages: number;
    };
  }>("/whatsapp/runtime/sync", {
    method: "POST",
    body: { workspaceId }
  });

  return payload.result;
}

export async function sendRemoteWhatsAppMessage(input: {
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
  const payload = await callSenderService<{
    result: {
      providerMessageId: string;
      status: "accepted";
    };
  }>("/messages/send", {
    method: "POST",
    body: input
  });

  return payload.result;
}
