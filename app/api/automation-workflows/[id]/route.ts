import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteAutomationWorkflow, updateAutomationWorkflow } from "@/lib/automation-rules";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      definitionJson?: string;
      isActive?: boolean;
    };

    const workflow = await updateAutomationWorkflow(id, {
      name: body.name,
      definitionJson: body.definitionJson,
      isActive: body.isActive
    });

    return NextResponse.json({ workflow });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update workflow."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const workflow = await deleteAutomationWorkflow(id);
    return NextResponse.json({ workflow });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to delete workflow."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
