import { NextRequest, NextResponse } from "next/server";
import { IndustryType } from "@prisma/client";
import { requireApiManager } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as {
      industryType?: IndustryType;
    };

    if (!body.industryType || !Object.values(IndustryType).includes(body.industryType)) {
      return NextResponse.json({ error: "Invalid industry type." }, { status: 400 });
    }

    const workspace = await prisma.workspace.update({
      where: {
        id: manager.workspaceId
      },
      data: {
        industryType: body.industryType
      }
    });

    return NextResponse.json({ workspace });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : "Unable to save industry setup."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}
