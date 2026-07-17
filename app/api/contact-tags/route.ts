import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { createWorkspaceContactTag, listWorkspaceContactTags } from "@/lib/contact-tags";

export async function GET() {
  try {
    const agent = await requireCurrentApiAgent();
    const tags = await listWorkspaceContactTags(agent.workspaceId);
    return NextResponse.json({ tags });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to load contact tags."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
    };

    const tag = await createWorkspaceContactTag({
      workspaceId: agent.workspaceId,
      name: body.name ?? "",
      description: body.description ?? null
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "UNAUTHORIZED"
        ? "Unauthorized."
        : error instanceof Error
          ? error.message
          : "Unable to create contact tag.";

    return NextResponse.json(
      {
        error: message
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : message === "A tag with this name already exists."
              ? 409
              : 400
      }
    );
  }
}
