import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { applyHumanTakeoverPause } from "@/lib/automation-engine";
import { parseMalaysiaDateTimeLocalInput } from "@/lib/malaysia-time";
import { resolveMediaAssetUrl } from "@/lib/media-library-urls";
import { enqueueOutboundMessage } from "@/lib/outbound-message-jobs";
import { assertWorkspaceHasOutboundMessageCapacity } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";
    const isFormData = contentType.includes("multipart/form-data");
    let text = "";
    let mediaAssetIds: string[] = [];
    let mentions: Array<{ id: string; label: string; token: string }> = [];
    let replyToMessageId = "";
    let interactiveButtons: string[] = [];
    let interactiveListButtonText = "";
    let interactiveListOptions: string[] = [];
    let scheduledFor = "";

    if (isFormData) {
      const formData = await request.formData();
      text = `${formData.get("body") ?? ""}`.trim();
      mediaAssetIds = parseStringArray(formData.get("mediaAssetIds"));
      mentions = parseMentions(formData.get("mentions"));
      replyToMessageId = `${formData.get("replyToMessageId") ?? ""}`.trim();
      interactiveButtons = parseInteractiveChoices(formData.get("interactiveButtons"), 3);
      interactiveListButtonText = `${formData.get("interactiveListButtonText") ?? ""}`.trim();
      interactiveListOptions = parseInteractiveChoices(formData.get("interactiveListOptions"), 10);
      scheduledFor = `${formData.get("scheduledFor") ?? ""}`.trim();
    } else {
      const body = (await request.json()) as {
        body?: string;
        mediaAssetIds?: string[];
        mentions?: unknown;
        replyToMessageId?: string;
        interactiveButtons?: unknown;
        interactiveListButtonText?: string;
        interactiveListOptions?: unknown;
        scheduledFor?: string;
      };
      text = body.body?.trim() ?? "";
      mediaAssetIds = parseStringArray(body.mediaAssetIds);
      mentions = parseMentions(body.mentions);
      replyToMessageId = body.replyToMessageId?.trim() ?? "";
      interactiveButtons = parseInteractiveChoices(body.interactiveButtons, 3);
      interactiveListButtonText = body.interactiveListButtonText?.trim() ?? "";
      interactiveListOptions = parseInteractiveChoices(body.interactiveListOptions, 10);
      scheduledFor = body.scheduledFor?.trim() ?? "";
    }

    if (!text && !mediaAssetIds.length) {
      return NextResponse.json({ error: "Message body or media is required." }, { status: 400 });
    }

    if ((interactiveButtons.length || interactiveListOptions.length) && mediaAssetIds.length) {
      return NextResponse.json({ error: "Interactive messages cannot include attachments yet." }, { status: 400 });
    }

    if (interactiveButtons.length && interactiveListOptions.length) {
      return NextResponse.json({ error: "Choose either buttons or a list for this reply." }, { status: 400 });
    }

    const scheduledAt = scheduledFor ? parseMalaysiaDateTimeLocalInput(scheduledFor) ?? new Date(scheduledFor) : null;

    if (scheduledFor && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
      return NextResponse.json({ error: "Scheduled date is invalid." }, { status: 400 });
    }

    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Scheduled send time must be in the future." }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        workspaceId: agent.workspaceId
      },
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        contact: {
          select: {
            phone: true
          }
        },
        assignee: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    if (conversation.assignee?.id && conversation.assignee.id !== agent.id && agent.role !== "MANAGER") {
      return NextResponse.json(
        {
          error: `Conversation assigned to ${conversation.assignee.name}. Take over to reply.`,
          code: "CONVERSATION_ASSIGNED"
        },
        { status: 409 }
      );
    }

    const selectedMediaAssets = mediaAssetIds.length
      ? await prisma.workspaceMediaAsset.findMany({
          where: {
            id: {
              in: mediaAssetIds
            },
            workspaceId: agent.workspaceId
          }
        })
      : [];

    if (mediaAssetIds.length && selectedMediaAssets.length !== mediaAssetIds.length) {
      return NextResponse.json({ error: "Selected media was not found." }, { status: 400 });
    }

    const orderedMediaAssets = mediaAssetIds
      .map((assetId) => selectedMediaAssets.find((asset) => asset.id === assetId) ?? null)
      .filter((asset): asset is NonNullable<(typeof selectedMediaAssets)[number]> => Boolean(asset));

    await assertWorkspaceHasOutboundMessageCapacity(
      agent.workspaceId,
      (text ? 1 : 0) + orderedMediaAssets.length
    );

    const messages = [];

    if (text) {
      const textMessage = await enqueueOutboundMessage({
        workspaceId: conversation.workspaceId,
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null,
        conversationId: id,
        body: text,
        availableAt: scheduledAt,
        senderId: agent.id,
        replyToMessageId: replyToMessageId || null,
        mentions,
        source: "manual-reply",
        to: conversation.contact.phone,
        interactiveButtons,
        interactiveListButtonText,
        interactiveListOptions
      });
      messages.push(textMessage);
    }

    for (const [index, mediaAsset] of orderedMediaAssets.entries()) {
      const nextMessage = await enqueueOutboundMessage({
        workspaceId: conversation.workspaceId,
        attachmentMimeType: mediaAsset.mimeType,
        attachmentName: mediaAsset.originalName || mediaAsset.title,
        attachmentUrl: resolveMediaAssetUrl(mediaAsset.publicUrl),
        conversationId: id,
        body: "",
        availableAt: scheduledAt,
        senderId: agent.id,
        replyToMessageId: !text && index === 0 ? replyToMessageId || null : null,
        source: "manual-reply",
        to: conversation.contact.phone,
        interactiveButtons: [],
        interactiveListButtonText: "",
        interactiveListOptions: []
      });
      messages.push(nextMessage);
    }

    await applyHumanTakeoverPause({
      workspaceId: conversation.workspaceId,
      conversationId: id,
      pausedAt: messages[messages.length - 1].sentAt
    });

    return NextResponse.json({ message: messages[0], messages }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message === "UNAUTHORIZED"
          ? "Unauthorized."
          : error.message.includes("WhatsApp channel is not connected")
            ? "WhatsApp is not configured yet. Configure the channel before sending public replies."
            : error.message
        : "Unable to send message.";

    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseMentions(value: unknown) {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;

  if (!Array.isArray(parsed)) {
    return [] as Array<{ id: string; label: string; token: string }>;
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const token = typeof record.token === "string" ? record.token.trim() : "";

      return id && label && token ? { id, label, token } : null;
    })
    .filter((entry): entry is { id: string; label: string; token: string } => Boolean(entry));
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseInteractiveChoices(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, limit);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}
