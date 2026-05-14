import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteCampaignDraft, updateCampaignDraft } from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      messageBody?: string;
      scheduleAt?: string | null;
      selectedContactIds?: string[];
      selectedAttachmentIds?: string[];
    };

    const draft = await updateCampaignDraft(id, {
      name: body.name,
      messageBody: body.messageBody,
      scheduleAt: body.scheduleAt,
      selectedContactIds: body.selectedContactIds,
      selectedAttachmentIds: body.selectedAttachmentIds
    });

    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update campaign draft."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    await deleteCampaignDraft(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to delete campaign draft."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
