import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { validateContactAddress } from "@/lib/contact-address";
import { createContactRecord, findAgentInWorkspace, setContactTeammates } from "@/lib/db-contacts";
import { assertWorkspaceHasActiveContactCapacity } from "@/lib/package-feature-limits";
import { buildStoredPhone, normalizeStoredPhone } from "@/lib/phone";

export async function POST(request: Request) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json()) as {
      ownerId?: string | null;
      teammateIds?: string[];
      displayName?: string;
      email?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      tags?: string;
      countryCode?: string;
      phoneNumber?: string;
    };

    const displayName = body.displayName?.trim() ?? "";
    const email = body.email?.trim() ?? "";
    const tags = body.tags?.trim() ?? "";
    const ownerId = body.ownerId?.trim() ?? "";
    const teammateIds = Array.from(
      new Set((body.teammateIds ?? []).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))
    );
    const countryCode = normalizeStoredPhone(body.countryCode ?? "");
    const phone = buildStoredPhone(countryCode, body.phoneNumber ?? "");

    if (!displayName) {
      return NextResponse.json({ error: "Contact name is required." }, { status: 400 });
    }

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
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

    await assertWorkspaceHasActiveContactCapacity(agent.workspaceId);

    const contact = await createContactRecord({
      workspaceId: agent.workspaceId,
      ownerId: ownerId || null,
      displayName,
      email: email || null,
      addressLine1: normalizedAddress.addressLine1,
      addressLine2: normalizedAddress.addressLine2,
      city: normalizedAddress.city,
      state: normalizedAddress.state,
      postalCode: normalizedAddress.postalCode,
      country: normalizedAddress.country,
      phone,
      tags
    });

    await setContactTeammates(contact.id, teammateIds.filter((teammateId) => teammateId !== ownerId));

    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if ((error as { code?: string } | null)?.code === "23505") {
      return NextResponse.json({ error: "That phone number already exists in this workspace." }, { status: 409 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create contact." },
      { status: 400 }
    );
  }
}
