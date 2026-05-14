import { NextResponse } from "next/server";
import { validateContactAddress } from "@/lib/contact-address";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  findAgentInWorkspace,
  findContactInWorkspace,
  listContactTeammatesByWorkspace,
  setContactTeammates,
  updateContactRecord
} from "@/lib/db-contacts";

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
      teammateIds?: string[];
      displayName?: string;
      email?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      country?: string | null;
      tags?: string;
      resetFields?: Array<"displayName" | "email" | "tags">;
    };

    const contact = await findContactInWorkspace(id, agent.workspaceId);

    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    const ownerId = body.ownerId?.trim() ?? "";
    const teammateIds = Array.from(
      new Set((body.teammateIds ?? []).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))
    );
    const displayName = body.displayName?.trim();
    const email = body.email?.trim() ?? "";
    const tags = body.tags?.trim();

    if (displayName !== undefined && !displayName) {
      return NextResponse.json({ error: "Display name is required." }, { status: 400 });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const { normalized: normalizedAddress, error: addressError } = validateContactAddress({
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2,
      city: body.city,
      state: body.state,
      postalCode: body.postalCode,
      country: body.country
    });

    if (addressError) {
      return NextResponse.json({ error: addressError }, { status: 400 });
    }

    if (ownerId) {
      const owner = await findAgentInWorkspace(ownerId, agent.workspaceId);

      if (!owner) {
        return NextResponse.json({ error: "Assigned team member was not found." }, { status: 400 });
      }
    }

    for (const teammateId of teammateIds) {
      const teammate = await findAgentInWorkspace(teammateId, agent.workspaceId);
      if (!teammate) {
        return NextResponse.json({ error: "A selected teammate was not found." }, { status: 400 });
      }
    }

    const resetFields = new Set(body.resetFields ?? []);
    const data: Record<string, unknown> = {};

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

    if (body.addressLine1 !== undefined) {
      data.addressLine1 = normalizedAddress.addressLine1;
    }

    if (body.addressLine2 !== undefined) {
      data.addressLine2 = normalizedAddress.addressLine2;
    }

    if (body.city !== undefined) {
      data.city = normalizedAddress.city;
    }

    if (body.state !== undefined) {
      data.state = normalizedAddress.state;
    }

    if (body.postalCode !== undefined) {
      data.postalCode = normalizedAddress.postalCode;
    }

    if (body.country !== undefined) {
      data.country = normalizedAddress.country;
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

    const updatedContact = await updateContactRecord(contact.id, data);
    if (body.teammateIds !== undefined) {
      await setContactTeammates(contact.id, teammateIds.filter((teammateId) => teammateId !== ownerId));
    }
    const teammateRows = await listContactTeammatesByWorkspace(agent.workspaceId, [contact.id]);
    const teammates = teammateRows
      .filter((row) => row.contactId === contact.id)
      .map((row) => ({
        id: row.agentId,
        name: row.agentName
      }));

    return NextResponse.json({
      contact: {
        id: updatedContact.id,
        ownerId: updatedContact.ownerId,
        ownerName: updatedContact.ownerName,
        teammateIds: teammates.map((teammate) => teammate.id),
        teammates,
        displayName: updatedContact.displayName,
        displayNameManualOverride: updatedContact.displayNameManualOverride,
        email: updatedContact.email,
        emailManualOverride: updatedContact.emailManualOverride,
        addressLine1: updatedContact.addressLine1,
        addressLine2: updatedContact.addressLine2,
        city: updatedContact.city,
        state: updatedContact.state,
        postalCode: updatedContact.postalCode,
        country: updatedContact.country,
        tags: splitTags(updatedContact.tags),
        tagsManualOverride: updatedContact.tagsManualOverride
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

function splitTags(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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
