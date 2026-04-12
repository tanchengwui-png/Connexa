import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { createAutomationWorkflow } from "@/lib/automation-rules";

export async function POST(request: NextRequest) {
  try {
    await requireCurrentApiAgent();
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const workflow = await createAutomationWorkflow({
      name: body.name ?? ""
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
              : "Unable to create workflow."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
