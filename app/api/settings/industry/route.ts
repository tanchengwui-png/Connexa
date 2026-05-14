import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { IndustryType } from "@/lib/db-types";
import { updateWorkspaceIndustryType } from "@/lib/db-auth";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as {
      industryType?: IndustryType;
    };

    if (!body.industryType || !Object.values(IndustryType).includes(body.industryType)) {
      return NextResponse.json({ error: "Invalid industry type." }, { status: 400 });
    }

    const workspace = await updateWorkspaceIndustryType(manager.workspaceId, body.industryType);

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
