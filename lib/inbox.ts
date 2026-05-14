import { getConversationDetail, listConversations } from "@/lib/conversations";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { AgentRole, ConversationStatus, IndustryType, MessageDirection } from "@/lib/db-types";
import {
  getInboxWorkspaceSummary,
  listAgentNameRows,
  listQuickReplyRows
} from "@/lib/db-conversations";
import { listWorkspaceMediaAssets } from "@/lib/media-library";
import { formatMediaAssetSize } from "@/lib/media-library-shared";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import { getWorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";
import {
  getWhatsAppProviderMode,
  isWhatsAppMockModeEnabled
} from "@/lib/whatsapp-channel";
import { resolveWhatsAppContacts } from "@/lib/whatsapp-runtime";
import { getConversationScheduledStats } from "@/lib/scheduled-messages";
import { getPlatformAutomationWorkflowConfig } from "@/lib/platform-config";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";

const statusLabels: Record<ConversationStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  CLOSED: "Closed"
};

export async function getInboxData(selectedConversationId?: string) {
  const currentAgent = await requireCurrentAgent();
  const workspaceId = await requireCurrentWorkspaceId();
  const isMockMode = isWhatsAppMockModeEnabled();
  const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const [workspace, agents, quickReplies, whatsAppHealth, mediaAssets, scheduledStatsByConversationId, workflowTimeoutConfig] = await Promise.all([
    getInboxWorkspaceSummary(workspaceId),
    listAgentNameRows(workspaceId),
    listQuickReplyRows(workspaceId),
    getWorkspaceWhatsAppHealth({
      workspaceId,
      agentId: currentAgent.id
    }),
    listWorkspaceMediaAssets(workspaceId),
    getConversationScheduledStats(workspaceId),
    getPlatformAutomationWorkflowConfig()
  ]);

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  const whatsAppChannel = whatsAppHealth.channel as WorkspaceWhatsAppChannelStatus | null;

  const conversationRecords = await listConversations();
  const selectedConversationRecord =
    (selectedConversationId && (await getConversationDetail(selectedConversationId))) ||
    (conversationRecords[0] ? await getConversationDetail(conversationRecords[0].id) : null);
  const mentionBodiesByMessageId = selectedConversationRecord
    ? await resolveMentionBodies({
        workspaceId,
        messages: selectedConversationRecord.messages
      })
    : new Map<string, string>();
  const senderLabelsByMessageId = selectedConversationRecord
    ? await resolveMessageSenders({
        workspaceId,
        messages: selectedConversationRecord.messages
      })
    : new Map<string, string>();
  const reactionSenderLabelsByReactionId = selectedConversationRecord
    ? await resolveReactionSenders({
        workspaceId,
        messages: selectedConversationRecord.messages
      })
    : new Map<string, string>();

  return {
    whatsapp: {
      callbackUrl: `${appUrl}/api/webhooks/whatsapp`,
      isConfigured: isMockMode || whatsAppHealth.isLiveRuntime,
      mode: getWhatsAppProviderMode(),
      phoneNumberId: isMockMode
        ? whatsAppHealth.channel?.phoneNumber ?? "mock-channel"
        : whatsAppHealth.channel?.phoneNumber ?? null,
      updatedAt: whatsAppHealth.channel?.updatedAt ? formatDetailTimestamp(whatsAppHealth.channel.updatedAt) : null,
      runtimeStatus: whatsAppHealth.runtimeStatus,
      isInboxReady: whatsAppHealth.isInboxReady,
      isHistoryStabilizing: whatsAppHealth.isHistoryStabilizing,
      isHistoryStuck: whatsAppHealth.isHistoryStuck,
      isLiveOnlyMode: whatsAppHealth.isLiveOnlyMode,
      importedConversationCount: whatsAppHealth.importedConversationCount,
      importedMessageCount: whatsAppHealth.importedMessageCount,
      lastSyncError: whatsAppHealth.lastSyncError
    },
    currentAgent: {
      id: currentAgent.id,
      name: currentAgent.name,
      role: currentAgent.role as AgentRole
    },
    workspaceIndustryType: workspace.industryType as IndustryType,
    summary: {
      open: workspace.openCount,
      pending: workspace.pendingCount,
      unassigned: workspace.unassignedCount,
      hotLeads: workspace.hotLeadCount
    },
    conversations: conversationRecords.map((conversation) => ({
      id: conversation.id,
      contactName: conversation.contactName,
      photoUrl: conversation.photoUrl ?? null,
      phone: conversation.phone,
      isGroup: conversation.isGroup,
      status: formatConversationStatus(conversation.status),
      snoozedUntil: conversation.snoozedUntil ? formatSnoozeUntil(conversation.snoozedUntil) : null,
      snoozedUntilIso: conversation.snoozedUntil ? conversation.snoozedUntil.toISOString() : null,
      unreadCount: conversation.unreadCount,
      isHotLead: conversation.isHotLead,
      scheduledCount: scheduledStatsByConversationId.get(conversation.id)?.scheduledCount ?? 0,
      nextScheduledAt: scheduledStatsByConversationId.get(conversation.id)?.nextScheduledAt
        ? formatDetailTimestamp(scheduledStatsByConversationId.get(conversation.id)!.nextScheduledAt as Date)
        : null,
      nextScheduledAtIso: scheduledStatsByConversationId.get(conversation.id)?.nextScheduledAt?.toISOString() ?? null,
      assigneeId: conversation.assignee?.id ?? null,
      assignee: conversation.assignee?.name ?? "Unassigned",
      teammateIds: conversation.teammates.map((teammate) => teammate.id),
      teammates: conversation.teammates,
      lastMessagePreview: sanitizeInboxDisplayText(conversation.lastMessagePreview) || "No recent messages",
      lastMessageAt: formatListTimestamp(conversation.lastMessageAt),
      lastMessageAtIso: conversation.lastMessageAt.toISOString()
    })),
    selectedConversation: selectedConversationRecord
      ? {
          id: selectedConversationRecord.id,
          contactName: selectedConversationRecord.contactName,
          photoUrl: selectedConversationRecord.photoUrl ?? null,
          lead: selectedConversationRecord.lead
            ? {
                id: selectedConversationRecord.lead.id,
                product: selectedConversationRecord.lead.product
                  ? formatProductSummary(selectedConversationRecord.lead.product)
                  : null,
                appointments: selectedConversationRecord.lead.appointments.map((appointment) => ({
                  id: appointment.id,
                  title: appointment.title,
                  type: formatAppointmentType(appointment.type),
                  startAt: formatDetailTimestamp(appointment.startAt),
                  startAtIso: appointment.startAt.toISOString(),
                  endAt: formatDetailTimestamp(appointment.endAt),
                  endAtIso: appointment.endAt.toISOString(),
                  location: appointment.location,
                  note: appointment.note
                })),
                budget: selectedConversationRecord.lead.budget,
                budgetValue: selectedConversationRecord.lead.budgetValue,
                financingStatus: selectedConversationRecord.lead.financingStatus,
                nextActionAt: selectedConversationRecord.lead.nextActionAt
                  ? formatDetailTimestamp(selectedConversationRecord.lead.nextActionAt)
                  : null,
                nextActionAtIso: selectedConversationRecord.lead.nextActionAt?.toISOString() ?? null,
                preferredArea: selectedConversationRecord.lead.preferredArea,
                priority: formatLeadPriority(selectedConversationRecord.lead.priority),
                project: selectedConversationRecord.lead.project,
                sourceDetail: selectedConversationRecord.lead.sourceDetail,
                stage: formatLeadStage(selectedConversationRecord.lead.stage),
                customData: selectedConversationRecord.lead.customData
              }
            : null,
          phone: selectedConversationRecord.phone,
          isGroup: selectedConversationRecord.isGroup,
          status: formatConversationStatus(selectedConversationRecord.status),
          snoozedUntil: selectedConversationRecord.snoozedUntil
            ? formatSnoozeUntil(selectedConversationRecord.snoozedUntil)
            : null,
          snoozedUntilIso: selectedConversationRecord.snoozedUntil
            ? selectedConversationRecord.snoozedUntil.toISOString()
            : null,
          scheduledCount: scheduledStatsByConversationId.get(selectedConversationRecord.id)?.scheduledCount ?? 0,
          nextScheduledAt: scheduledStatsByConversationId.get(selectedConversationRecord.id)?.nextScheduledAt
            ? formatDetailTimestamp(scheduledStatsByConversationId.get(selectedConversationRecord.id)!.nextScheduledAt as Date)
            : null,
          nextScheduledAtIso:
            scheduledStatsByConversationId.get(selectedConversationRecord.id)?.nextScheduledAt?.toISOString() ?? null,
          assignee: selectedConversationRecord.assignee?.name ?? "Unassigned",
          assigneeId: selectedConversationRecord.assignee?.id ?? null,
          teammateIds: selectedConversationRecord.teammates.map((teammate) => teammate.id),
          teammates: selectedConversationRecord.teammates,
          tags: selectedConversationRecord.tags,
          notes: selectedConversationRecord.notes.map((note) => ({
            id: note.id,
            body: note.body,
            author: note.author,
            createdAt: formatDetailTimestamp(note.createdAt),
            createdAtIso: note.createdAt.toISOString()
          })),
          auditEvents: selectedConversationRecord.auditEvents.map((event) => ({
            id: event.id,
            type: event.type,
            actor: event.actor,
            fromAssignee: event.fromAssignee,
            toAssignee: event.toAssignee,
            createdAt: formatDetailTimestamp(event.createdAt),
            createdAtIso: event.createdAt.toISOString()
          })),
          automation: selectedConversationRecord.automation
            ? {
                automationPausedUntil: selectedConversationRecord.automation.automationPausedUntil
                  ? formatDetailTimestamp(selectedConversationRecord.automation.automationPausedUntil)
                  : null,
                automationPausedUntilIso:
                  selectedConversationRecord.automation.automationPausedUntil?.toISOString() ?? null,
                activeFlowKey: selectedConversationRecord.automation.activeFlowKey,
                activeFlowStep: selectedConversationRecord.automation.activeFlowStep,
                lastAutoReplyAt: selectedConversationRecord.automation.lastAutoReplyAt
                  ? formatDetailTimestamp(selectedConversationRecord.automation.lastAutoReplyAt)
                  : null,
                lastAutoReplyAtIso:
                  selectedConversationRecord.automation.lastAutoReplyAt?.toISOString() ?? null,
                lastMatchedRuleName: selectedConversationRecord.automation.lastMatchedRuleName,
                isIdle:
                  Boolean(selectedConversationRecord.automation.activeFlowStep) &&
                  Boolean(selectedConversationRecord.automation.lastAutoReplyAt) &&
                  Date.now() - selectedConversationRecord.automation.lastAutoReplyAt!.getTime() >=
                    workflowTimeoutConfig.idleAfterHours * 60 * 60 * 1000
              }
            : null,
          messages: selectedConversationRecord.messages.map((message) => ({
            id: message.id,
            attachmentMimeType: message.attachmentMimeType,
            attachmentName: message.attachmentName,
            attachmentUrl: message.attachmentUrl,
            body: sanitizeInboxDisplayText(
              mentionBodiesByMessageId.get(message.id) ?? message.body,
              message.attachmentUrl ?? null,
              { preserveLineBreaks: true }
            ),
            deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
            direction:
              message.direction === MessageDirection.INBOUND
                ? ("inbound" as const)
                : ("outbound" as const),
            isConnexaOutbound: message.isConnexaOutbound,
            outboundJobAvailableAt: message.outboundJobAvailableAt
              ? formatDetailTimestamp(message.outboundJobAvailableAt)
              : null,
            outboundJobLastError: message.outboundJobLastError,
            outboundJobStatus: message.outboundJobStatus,
            providerMessageId: message.providerMessageId,
            replyToMessageId: message.replyToMessageId,
            replyToMessage: message.replyToMessage,
            reactions: message.reactions.map((reaction) => ({
              id: reaction.id,
              emoji: reaction.emoji,
              sender: reactionSenderLabelsByReactionId.get(reaction.id) ?? reaction.sender,
              sentAtIso: reaction.sentAt.toISOString()
            })),
            sender: senderLabelsByMessageId.get(message.id) ?? message.sender,
            sentAt: formatMessageTime(message.sentAt),
            sentAtIso: message.sentAt.toISOString()
          }))
        }
      : null,
    quickReplies: quickReplies.map((item) => ({
      id: item.id,
      title: item.title,
      shortcut: item.shortcut,
      category: item.category,
      body: item.body,
      mediaAssetIds: parseMediaAssetIds(item.mediaAssetIdsJson)
    })),
    mediaAssets: mediaAssets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      publicUrl: asset.publicUrl,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeLabel: formatMediaAssetSize(asset.sizeBytes)
    })),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name
    }))
  };
}

async function resolveMentionBodies(input: {
  workspaceId: string;
  messages: Array<{
    id: string;
    body: string;
    rawPayload?: string | null;
    whatsAppEnvelopeMentionedIdsJson?: unknown;
    whatsAppEnvelopeGroupMentionsJson?: unknown;
    whatsAppEnvelopeRawJson?: unknown;
  }>;
}) {
  const mentionIds = Array.from(
    new Set(
      input.messages
        .flatMap((message) => getMentionIdsFromMessageMetadata(message))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

  if (!mentionIds.length) {
    return new Map<string, string>();
  }

  const contacts = await resolveWhatsAppContacts({
    workspaceId: input.workspaceId,
    mentionIds
  }).catch(() => []);

  const mentionLabels = new Map<string, string>(
    contacts.map((contact) => [
      contact.id,
      formatMentionLabel(contact)
    ])
  );

  for (const message of input.messages) {
    for (const [mentionId, label] of getMentionLabelsFromRawPayload(message.rawPayload ?? null)) {
      if (!mentionLabels.has(mentionId)) {
        mentionLabels.set(mentionId, label);
      }
    }
  }

  return new Map(
    input.messages.map((message) => [
      message.id,
      replaceMentionTokens(message.body, getMentionIdsFromMessageMetadata(message), mentionLabels)
    ])
  );
}

async function resolveMessageSenders(input: {
  workspaceId: string;
  messages: Array<{
    id: string;
    direction: string;
    sender: string;
    rawPayload?: string | null;
  }>;
}) {
  const inboundGroupMessages = input.messages.filter(
    (message) => message.direction === MessageDirection.INBOUND && isGroupMessagePayload(message.rawPayload ?? null)
  );

  if (!inboundGroupMessages.length) {
    return new Map<string, string>();
  }

  const authorIds = Array.from(
    new Set(
      inboundGroupMessages
        .map((message) => getAuthorIdFromRawPayload(message.rawPayload ?? null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const contacts = authorIds.length
    ? await resolveWhatsAppContacts({
        workspaceId: input.workspaceId,
        mentionIds: authorIds
      }).catch(() => [])
    : [];

  const authorLabels = new Map<string, string>(
    contacts
      .map((contact) => [contact.id, contact.name?.trim() || contact.pushname?.trim() || contact.phone?.trim() || null] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );

  const labels = new Map<string, string>();

  for (const message of inboundGroupMessages) {
    const authorId = getAuthorIdFromRawPayload(message.rawPayload ?? null);
    if (!authorId) {
      continue;
    }

    const resolvedLabel =
      authorLabels.get(authorId) ??
      getSenderLabelFromRawPayload(message.rawPayload ?? null) ??
      formatFallbackSenderLabel(authorId);

    if (resolvedLabel) {
      labels.set(message.id, resolvedLabel);
    }
  }

  return labels;
}

async function resolveReactionSenders(input: {
  workspaceId: string;
  messages: Array<{
    reactions?: Array<{
      id: string;
      senderId?: string | null;
      sender: string;
    }>;
  }>;
}) {
  const senderIds = Array.from(
    new Set(
      input.messages
        .flatMap((message) => message.reactions ?? [])
        .map((reaction) => reaction.senderId?.trim() ?? "")
        .filter(Boolean)
    )
  );

  if (!senderIds.length) {
    return new Map<string, string>();
  }

  const contacts = await resolveWhatsAppContacts({
    workspaceId: input.workspaceId,
    mentionIds: senderIds
  }).catch(() => []);

  const senderLabels = new Map<string, string>(
    contacts
      .map((contact) => [
        contact.id,
        contact.name?.trim() || contact.pushname?.trim() || contact.phone?.trim() || null
      ] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );

  const labels = new Map<string, string>();

  for (const message of input.messages) {
    for (const reaction of message.reactions ?? []) {
      if (!reaction.id) {
        continue;
      }
      const reactionId: string = reaction.id;

      if (!reaction.senderId) {
        continue;
      }
      const senderId: string = reaction.senderId;

      const normalizedSenderId: string = senderId.trim();
      if (!normalizedSenderId) {
        continue;
      }

      labels.set(
        String(reactionId),
        senderLabels.get(String(normalizedSenderId)) ?? formatFallbackSenderLabel(String(normalizedSenderId))
      );
    }
  }

  return labels;
}

function getMentionIdsFromMessageMetadata(message: {
  rawPayload?: string | null;
  whatsAppEnvelopeMentionedIdsJson?: unknown;
  whatsAppEnvelopeGroupMentionsJson?: unknown;
  whatsAppEnvelopeRawJson?: unknown;
}) {
  const ids = [
    ...getMentionIdsFromParsedPayload(parseJsonRecord(message.rawPayload) ?? {}),
    ...getStringArray(message.whatsAppEnvelopeMentionedIdsJson),
    ...getMentionIdsFromGroupMentions(message.whatsAppEnvelopeGroupMentionsJson),
    ...getMentionIdsFromParsedPayload(asRecord(message.whatsAppEnvelopeRawJson) ?? {})
  ];

  return Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)));
}

function parseJsonRecord(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function getMentionIdsFromGroupMentions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const record = asRecord(entry);
      return (
        getRecordString(record, "id") ??
        getRecordString(record, "jid") ??
        getRecordString(record, "mentionId") ??
        getRecordString(record, "participant")
      );
    })
    .filter((entry): entry is string => Boolean(entry?.trim()))
    .map((entry) => entry.trim());
}

function getRecordString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function replaceMentionTokens(body: string, mentionIds: string[], mentionLabels: Map<string, string>) {
  if (!body.trim() || !mentionIds.length) {
    return body;
  }

  let nextBody = body;

  for (const mentionId of mentionIds) {
    const numericId = mentionId.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();
    const label = mentionLabels.get(mentionId) ?? formatFallbackMentionLabel(mentionId);
    const escapedNumericId = escapeRegExp(numericId);
    nextBody = nextBody.replace(new RegExp(`@${escapedNumericId}\\b`, "g"), label);
  }

  return nextBody;
}

function formatMentionLabel(contact: {
  id: string;
  phone: string | null;
  name: string | null;
  pushname: string | null;
}) {
  const name = contact.name?.trim() || contact.pushname?.trim() || null;
  const phone = contact.phone?.trim() || contact.id.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();

  if (name) {
    return prefixMentionLabel(name);
  }

  return phone ? prefixMentionLabel(phone) : formatFallbackMentionLabel(contact.id);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMentionLabelsFromRawPayload(rawPayload: string | null) {
  if (!rawPayload) {
    return new Map<string, string>();
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    const mentionIds = getMentionIdsFromParsedPayload(parsed);

    if (!mentionIds.length) {
      return new Map<string, string>();
    }

    const labels = new Map<string, string>();
    collectMentionLabelsFromValue(parsed, mentionIds, labels, 0);
    return labels;
  } catch {
    return new Map<string, string>();
  }
}

function getMentionIdsFromParsedPayload(parsed: Record<string, unknown>) {
  const candidates = [parsed.mentionedJidList, parsed.mentionedIds, parsed.mentionedJids];
  const ids: string[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    ids.push(...candidate.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean));
  }

  ids.push(...getMentionIdsFromGroupMentions(parsed.groupMentions));
  ids.push(...extractMentionTokensFromBody(getRecordString(parsed, "body")));

  return Array.from(new Set(ids));
}

function extractMentionTokensFromBody(body?: string | null) {
  const matches = body?.match(/@[\dA-Za-z._-]+/g) ?? [];
  return matches
    .map((match) => match.slice(1).trim())
    .filter(Boolean)
    .map((value) => (/^\d+$/.test(value) ? `${value}@lid` : value));
}

function collectMentionLabelsFromValue(
  value: unknown,
  mentionIds: string[],
  labels: Map<string, string>,
  depth: number
): void {
  if (!value || depth > 5) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMentionLabelsFromValue(item, mentionIds, labels, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const matchedMentionId = matchMentionIdFromRecord(record, mentionIds);
  const rawLabel = getMentionLabelCandidate(record);

  if (matchedMentionId && rawLabel && !labels.has(matchedMentionId)) {
    labels.set(matchedMentionId, prefixMentionLabel(rawLabel));
  }

  for (const child of Object.values(record)) {
    collectMentionLabelsFromValue(child, mentionIds, labels, depth + 1);
  }
}

function matchMentionIdFromRecord(record: Record<string, unknown>, mentionIds: string[]): string | null {
  const candidateIds = new Set<string>();
  const directCandidates = [
    record.id,
    record.jid,
    record.wid,
    record.participant,
    record.mentionId,
    record.contactId,
    record.author,
    record.user
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      candidateIds.add(candidate.trim());
    }
  }

  const nestedIdCandidates = [record.id, record.jid, record.wid, record.contact, record.participant];
  for (const candidate of nestedIdCandidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const nestedRecord = candidate as Record<string, unknown>;
    const nestedSerialized = nestedRecord._serialized;
    const nestedUser = nestedRecord.user;
    if (typeof nestedSerialized === "string" && nestedSerialized.trim()) {
      candidateIds.add(nestedSerialized.trim());
    }
    if (typeof nestedUser === "string" && nestedUser.trim()) {
      candidateIds.add(nestedUser.trim());
    }
  }

  for (const mentionId of mentionIds) {
    const normalizedMentionId = normalizeMentionId(mentionId);
    for (const candidateId of candidateIds) {
      if (normalizeMentionId(candidateId) === normalizedMentionId) {
        return mentionId;
      }
    }
  }

  return null;
}

function getMentionLabelCandidate(record: Record<string, unknown>): string | null {
  const directCandidates = [
    record.displayName,
    record.notifyName,
    record.pushname,
    record.name,
    record.formattedName,
    record.shortName,
    record.subject,
    record.title
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedCandidates = [record.contact, record.profile, record.chat];
  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const nestedRecord = candidate as Record<string, unknown>;
    const nestedLabel = getMentionLabelCandidate(nestedRecord);
    if (nestedLabel) {
      return nestedLabel;
    }
  }

  return null;
}

function normalizeMentionId(value: string) {
  return value.trim().replace(/@(?:lid|c\.us|g\.us)$/i, "");
}

function prefixMentionLabel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function formatFallbackMentionLabel(mentionId: string) {
  const normalized = mentionId.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();
  return normalized ? prefixMentionLabel(normalized) : mentionId;
}

function isGroupMessagePayload(rawPayload: string | null) {
  if (!rawPayload) {
    return false;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    return [parsed.chatId, parsed.from, parsed.to]
      .some((value) => typeof value === "string" && value.trim().endsWith("@g.us"));
  } catch {
    return false;
  }
}

function getAuthorIdFromRawPayload(rawPayload: string | null) {
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    const author = parsed.author;
    return typeof author === "string" && author.trim() ? author.trim() : null;
  } catch {
    return null;
  }
}

function getSenderLabelFromRawPayload(rawPayload: string | null) {
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    return getMentionLabelCandidate(parsed);
  } catch {
    return null;
  }
}

function formatFallbackSenderLabel(authorId: string) {
  const normalized = authorId.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();
  return normalized || "Contact";
}

function parseMediaAssetIds(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function formatConversationStatus(status: string) {
  return statusLabels[status as ConversationStatus] ?? status;
}

function sanitizeInboxDisplayText(
  value?: string | null,
  attachmentUrl?: string | null,
  options?: { preserveLineBreaks?: boolean }
) {
  const source = value?.replace(/\r\n/g, "\n").trim() ?? "";
  if (!source) {
    return "";
  }

  const removablePatterns = [
    /\[\s*\]/gi,
    /\[biz content placeholder\]/gi,
    /\[security message visible only on primary device\]/gi,
    /\[system message or security content visible only on primary device\]/gi,
    /\[unsupported message\]/gi
  ];

  if (attachmentUrl) {
    removablePatterns.push(
      /\[image\]/gi,
      /\[video\]/gi,
      /\[audio\]/gi,
      /\[document\]/gi,
      /\[media\]/gi,
      /\[file\]/gi,
      /\[attachment\]/gi,
      /\[sticker\]/gi
    );
  }

  let cleaned = source;
  let removedKnownPlaceholder = false;

  for (const pattern of removablePatterns) {
    const next = cleaned.replace(pattern, " ");
    if (next !== cleaned) {
      removedKnownPlaceholder = true;
      cleaned = next;
    }
  }

  if (options?.preserveLineBreaks) {
    cleaned = cleaned
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    cleaned = cleaned.replace(/\s+/g, " ").trim();
  }

  if (!cleaned) {
    return "";
  }

  const placeholderCheckValue = cleaned.replace(/\n+/g, " ").trim();

  if (removedKnownPlaceholder && /^(\[[^\]]+\]\s*)+$/.test(placeholderCheckValue)) {
    return "";
  }

  return cleaned;
}

function formatMessageTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function formatDetailTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function formatListTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function formatSnoozeUntil(date: Date) {
  return `Snoozed until ${formatDetailTimestamp(date)}`;
}

function formatLeadStage(stage: string) {
  return stage
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLeadPriority(priority: string) {
  const normalized = priority.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatAppointmentType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatProductSummary(product: {
  id: string;
  name: string;
  description: string | null;
  area: string | null;
  location: string | null;
  mapUrl: string | null;
  websiteUrl: string | null;
  financing: string | null;
  financingTags: string | null;
  brochureName: string | null;
  brochureUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  imageUrls: string | null;
  latitude: number | null;
  longitude: number | null;
}) {
  const images = parseImageUrls(product.imageUrls);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    area: product.area,
    location: product.location,
    mapUrl: product.mapUrl,
    websiteUrl: product.websiteUrl,
    financing: product.financing,
    financingTags: parseImageUrls(product.financingTags),
    brochureName: product.brochureName,
    brochureUrl: product.brochureUrl,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
    imageUrls: images,
    latitude: product.latitude,
    longitude: product.longitude
  };
}

function parseImageUrls(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const payload = JSON.parse(value) as string[];
    return payload.filter((item) => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}
