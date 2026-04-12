import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      ownerId?: string | null;
      displayName?: string;
      email?: string | null;
      tags?: string;
      resetFields?: Array<"displayName" | "email" | "tags">;
    };

    const contact = await prisma.contact.findFirst({
      where: {
        id,
        workspaceId: agent.workspaceId
      },
      select: {
        id: true,
        phone: true,
        displayName: true,
        tags: true,
        syncedDisplayName: true,
        syncedTags: true
      }
    });

    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    const ownerId = body.ownerId?.trim() ?? "";
    const displayName = body.displayName?.trim();
    const email = body.email?.trim() ?? "";
    const tags = body.tags?.trim();

    if (displayName !== undefined && !displayName) {
      return NextResponse.json({ error: "Display name is required." }, { status: 400 });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    if (ownerId) {
      const owner = await prisma.agent.findFirst({
        where: {
          id: ownerId,
          workspaceId: agent.workspaceId
        },
        select: {
          id: true
        }
      });

      if (!owner) {
        return NextResponse.json({ error: "Assigned team member was not found." }, { status: 400 });
      }
    }

    const resetFields = new Set(body.resetFields ?? []);
    const data: Prisma.ContactUncheckedUpdateInput = {};

    if (body.ownerId !== undefined) {
      data.ownerId = ownerId || null;
    }

    if (displayName !== undefined) {
      if (
        shouldPromoteCurrentDisplayNameToSynced(contact.syncedDisplayName, contact.phone) &&
        !looksLikePhoneLabel(contact.displayName)
      ) {
        data.syncedDisplayName = contact.displayName;
      }
      data.displayName = displayName;
      data.displayNameManualOverride = true;
    }

    if (body.email !== undefined) {
      data.email = email || null;
      data.emailManualOverride = Boolean(email);
    }

    if (tags !== undefined) {
      data.tags = tags;
      data.tagsManualOverride = true;
    }

    if (resetFields.has("displayName")) {
      data.displayNameManualOverride = false;
      data.displayName = contact.syncedDisplayName || contact.displayName || contact.phone;
    }

    if (resetFields.has("email")) {
      data.email = null;
      data.emailManualOverride = false;
    }

    if (resetFields.has("tags")) {
      data.tagsManualOverride = false;
      data.tags = contact.syncedTags || contact.tags || "whatsapp";
    }

    const updatedContact = await prisma.contact.update({
      where: {
        id: contact.id
      },
      data,
      include: {
        owner: true
      }
    });

    return NextResponse.json({
      contact: {
        id: updatedContact.id,
        ownerId: updatedContact.ownerId,
        ownerName: updatedContact.owner?.name ?? null,
        displayName: updatedContact.displayName,
        email: updatedContact.email,
        tags: updatedContact.tags
      }
    });
  } catch (error) {
    console.error("[contacts][patch] failed", error);
    const message =
      error instanceof Error && error.message === "UNAUTHORIZED"
        ? "Unauthorized."
        : error instanceof Error
          ? error.message
          : "Unable to update contact.";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized." ? 401 : 400 });
  }
}

function looksLikePhoneLabel(value: string | null | undefined) {
  if (!value) {
    return true;
  }

  const normalized = value.replace(/[\s()+-]/g, "");
  return /^[\d]+$/.test(normalized);
}

function shouldPromoteCurrentDisplayNameToSynced(
  syncedDisplayName: string | null | undefined,
  phone: string
) {
  return !syncedDisplayName || looksLikePhoneLabel(syncedDisplayName) || syncedDisplayName === phone;
}
