import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { applyHumanTakeoverPause } from "@/lib/automation-engine";
import { enqueueOutboundMessage } from "@/lib/outbound-message-jobs";
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
    let file: File | null = null;
    let interactiveButtons: string[] = [];
    let interactiveListButtonText = "";
    let interactiveListOptions: string[] = [];

    if (isFormData) {
      const formData = await request.formData();
      text = `${formData.get("body") ?? ""}`.trim();
      const attachment = formData.get("attachment");
      file = attachment instanceof File ? attachment : null;
      interactiveButtons = parseInteractiveChoices(formData.get("interactiveButtons"), 3);
      interactiveListButtonText = `${formData.get("interactiveListButtonText") ?? ""}`.trim();
      interactiveListOptions = parseInteractiveChoices(formData.get("interactiveListOptions"), 10);
    } else {
      const body = (await request.json()) as {
        body?: string;
        interactiveButtons?: unknown;
        interactiveListButtonText?: string;
        interactiveListOptions?: unknown;
      };
      text = body.body?.trim() ?? "";
      interactiveButtons = parseInteractiveChoices(body.interactiveButtons, 3);
      interactiveListButtonText = body.interactiveListButtonText?.trim() ?? "";
      interactiveListOptions = parseInteractiveChoices(body.interactiveListOptions, 10);
    }

    if (!text && !file) {
      return NextResponse.json({ error: "Message body or attachment is required." }, { status: 400 });
    }

    if ((interactiveButtons.length || interactiveListOptions.length) && file) {
      return NextResponse.json({ error: "Interactive messages cannot include attachments yet." }, { status: 400 });
    }

    if (interactiveButtons.length && interactiveListOptions.length) {
      return NextResponse.json({ error: "Choose either buttons or a list for this reply." }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        workspaceId: agent.workspaceId
      },
      include: {
        contact: true
      }
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    const uploadedAttachment = file ? await saveAttachment(file) : null;
    const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
    const message = await enqueueOutboundMessage({
      workspaceId: conversation.workspaceId,
      attachmentMimeType: uploadedAttachment?.mimeType ?? null,
      attachmentName: uploadedAttachment?.name ?? null,
      attachmentUrl: uploadedAttachment ? `${appUrl}${uploadedAttachment.publicPath}` : null,
      conversationId: conversation.id,
      body: text,
      senderId: agent.id,
      source: "manual-reply",
      to: conversation.contact.phone,
      interactiveButtons,
      interactiveListButtonText,
      interactiveListOptions
    });

    await applyHumanTakeoverPause({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      pausedAt: message.sentAt
    });

    return NextResponse.json({ message }, { status: 201 });
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
async function saveAttachment(file: File) {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Attachments must be 10 MB or smaller.");
  }

  const extension = path.extname(file.name) || inferExtension(file.type);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, fileName);
  const arrayBuffer = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    publicPath: `/uploads/${fileName}`
  };
}

function inferExtension(mimeType: string) {
  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType.startsWith("image/")) {
    return `.${mimeType.slice("image/".length)}`;
  }

  return "";
}
