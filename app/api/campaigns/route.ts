import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { createCampaignDraft, listCampaignDrafts } from "@/lib/campaigns";

export async function GET() {
  try {
    await requireCurrentApiAgent();
    const drafts = await listCampaignDrafts();
    return NextResponse.json({ drafts });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to load campaign drafts."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

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

    const draft = await createCampaignDraft({
      name: body.name ?? "",
      messageBody: body.messageBody ?? "",
      scheduleAt: body.scheduleAt ?? null,
      selectedContactIds: body.selectedContactIds ?? [],
      selectedAttachmentIds: body.selectedAttachmentIds ?? []
    });

    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to create campaign draft."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
