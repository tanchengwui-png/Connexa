import { NextRequest, NextResponse } from "next/server";
import { LeadPriority, LeadStage } from "@prisma/client";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { updateLeadRecord } from "@/lib/leads";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      budget?: number | null;
      customData?: string | null;
      financingStatus?: string | null;
      nextActionAt?: string | null;
      ownerId?: string | null;
      preferredArea?: string | null;
      priority?: LeadPriority;
      productId?: string | null;
      project?: string;
      sourceDetail?: string | null;
      stage?: LeadStage;
    };

    const lead = await updateLeadRecord(id, {
      budget: body.budget ?? null,
      customData: body.customData ?? null,
      financingStatus: body.financingStatus ?? null,
      nextActionAt: body.nextActionAt ? new Date(body.nextActionAt) : null,
      ownerId: body.ownerId ?? undefined,
      preferredArea: body.preferredArea ?? null,
      priority: body.priority,
      productId: body.productId ?? undefined,
      project: body.project,
      sourceDetail: body.sourceDetail ?? null,
      stage: body.stage
    });

    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update lead."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
