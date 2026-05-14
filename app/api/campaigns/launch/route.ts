import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { launchCampaign } from "@/lib/campaigns";

export async function POST(request: NextRequest) {
  try {
    await requireCurrentApiAgent();
    const body = (await request.json()) as {
      name?: string;
      messageBody?: string;
      scheduleAt?: string | null;
      selectedContactIds?: string[];
      selectedAttachmentIds?: string[];
    };

    const result = await launchCampaign({
      name: body.name ?? "",
      messageBody: body.messageBody ?? "",
      scheduleAt: body.scheduleAt ?? null,
      selectedContactIds: body.selectedContactIds ?? [],
      selectedAttachmentIds: body.selectedAttachmentIds ?? []
    });

    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to launch campaign."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
