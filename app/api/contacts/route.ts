import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { buildStoredPhone, normalizeStoredPhone } from "@/lib/phone";

export async function POST(request: Request) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json()) as {
      ownerId?: string | null;
      displayName?: string;
      email?: string;
      tags?: string;
      countryCode?: string;
      phoneNumber?: string;
    };

    const displayName = body.displayName?.trim() ?? "";
    const email = body.email?.trim() ?? "";
    const tags = body.tags?.trim() ?? "";
    const ownerId = body.ownerId?.trim() ?? "";
    const countryCode = normalizeStoredPhone(body.countryCode ?? "");
    const phone = buildStoredPhone(countryCode, body.phoneNumber ?? "");

    if (!displayName) {
      return NextResponse.json({ error: "Contact name is required." }, { status: 400 });
    }

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
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

    const contact = await prisma.contact.create({
      data: {
        workspaceId: agent.workspaceId,
        ownerId: ownerId || null,
        displayName,
        email: email || null,
        phone,
        tags
      }
    });

    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That phone number already exists in this workspace." }, { status: 409 });
    }

    return NextResponse.json({ error: "Unable to create contact." }, { status: 400 });
  }
}
