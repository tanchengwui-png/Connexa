import {
  deleteWorkspaceWhatsAppClientSession,
  deleteWhatsAppMessageForEveryone,
  disconnectWorkspaceWhatsAppClient,
  ensureWorkspaceWhatsAppClient,
  getWhatsAppSenderNodeMetrics,
  getWorkspaceWhatsAppRuntimeStatus,
  listWhatsAppMentionCandidates,
  resolveWhatsAppContacts,
  sendWhatsAppMessage,
  syncWorkspaceHistory
} from "@/lib/whatsapp-runtime";

function buildButtonsFallback(body, buttons) {
  const lines = buttons.map((button, index) => `${index + 1}. ${button}`);
  return [body.trim(), ...lines].filter(Boolean).join("\n");
}

function buildListFallback(body, buttonText, options) {
  const lines = options.map((option, index) => `${index + 1}. ${option}`);
  const header = buttonText?.trim() ? `${body.trim()}\n${buttonText.trim()}:` : body.trim();
  return [header, ...lines].filter(Boolean).join("\n");
}

function normalizeTemplateText(input) {
  const componentLines = (input.components ?? [])
    .map((component) => {
      if (!component || typeof component !== "object") {
        return "";
      }

      const textParts = Array.isArray(component.parameters)
        ? component.parameters
            .map((parameter) => {
              if (!parameter || typeof parameter !== "object") {
                return "";
              }

              if (typeof parameter.text === "string") {
                return parameter.text.trim();
              }

              if (typeof parameter.payload === "string") {
                return parameter.payload.trim();
              }

              return "";
            })
            .filter(Boolean)
        : [];

      return textParts.join(" ");
    })
    .filter(Boolean);

  return [`Template: ${input.name}`, ...componentLines].join("\n").trim();
}

export async function getRuntimeStatus(input) {
  return getWorkspaceWhatsAppRuntimeStatus(input);
}

export async function getSenderMetrics() {
  return getWhatsAppSenderNodeMetrics();
}

export async function ensureSession(input) {
  return ensureWorkspaceWhatsAppClient(input);
}

export async function disconnectSession(workspaceId, channelId = null) {
  return disconnectWorkspaceWhatsAppClient(workspaceId, channelId);
}

export async function deleteSession(workspaceId, channelId = null) {
  return deleteWorkspaceWhatsAppClientSession(workspaceId, channelId);
}

export async function syncHistory(
  workspaceId,
  channelIdOrOptions = null,
  options = {}
) {
  return syncWorkspaceHistory(workspaceId, channelIdOrOptions, options);
}

export async function resolveContacts(input) {
  return resolveWhatsAppContacts(input);
}

export async function listMentionCandidates(input) {
  return listWhatsAppMentionCandidates(input);
}

export async function sendMessage(input) {
  return sendWhatsAppMessage({
    channelId: input.channelId ?? null,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    to: input.to,
    body: input.body,
    mentions: input.mentions ?? null,
    quotedProviderMessageId: input.quotedProviderMessageId ?? null,
    simulateTyping: input.simulateTyping ?? false,
    interactiveButtons: input.interactiveButtons ?? null,
    interactiveListButtonText: input.interactiveListButtonText ?? null,
    interactiveListOptions: input.interactiveListOptions ?? null,
    attachmentPath: input.attachmentPath ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    sendAudioAsVoice: input.sendAudioAsVoice === true
  });
}

export async function sendMedia(input) {
  return sendMessage({
    ...input,
    body: input.body ?? ""
  });
}

export async function sendTemplate(input) {
  const templateBody = normalizeTemplateText(input);

  return sendMessage({
    ...input,
    body: templateBody || input.body || ""
  });
}

export async function broadcast(input) {
  const results = [];

  for (const recipient of input.recipients ?? []) {
    if (input.template) {
      results.push(
        await sendTemplate({
          ...input.template,
          ...recipient,
          channelId: recipient.channelId ?? input.channelId ?? null,
          workspaceId: recipient.workspaceId ?? input.workspaceId,
          conversationId: recipient.conversationId
        })
      );
      continue;
    }

    const normalizedButtons = Array.isArray(recipient.interactiveButtons)
      ? recipient.interactiveButtons.map((entry) => `${entry ?? ""}`.trim()).filter(Boolean)
      : [];
    const normalizedListOptions = Array.isArray(recipient.interactiveListOptions)
      ? recipient.interactiveListOptions.map((entry) => `${entry ?? ""}`.trim()).filter(Boolean)
      : [];
    const fallbackBody = normalizedButtons.length
      ? buildButtonsFallback(recipient.body ?? "", normalizedButtons)
      : normalizedListOptions.length
        ? buildListFallback(recipient.body ?? "", recipient.interactiveListButtonText ?? "", normalizedListOptions)
        : recipient.body ?? "";

    results.push(
      await (recipient.attachmentUrl
        ? sendMedia({
            ...recipient,
            channelId: recipient.channelId ?? input.channelId ?? null,
            workspaceId: recipient.workspaceId ?? input.workspaceId,
            conversationId: recipient.conversationId,
            body: fallbackBody
          })
        : sendMessage({
        ...recipient,
        channelId: recipient.channelId ?? input.channelId ?? null,
        workspaceId: recipient.workspaceId ?? input.workspaceId,
        conversationId: recipient.conversationId,
        body: fallbackBody
          }))
    );
  }

  return {
    provider: "personal",
    sent: results.length,
    results
  };
}

export async function deleteMessageForEveryone(input) {
  return deleteWhatsAppMessageForEveryone(input);
}
