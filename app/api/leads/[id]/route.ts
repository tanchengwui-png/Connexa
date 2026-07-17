import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { LeadNextActionType, LeadPriority, LeadSource, LeadStage } from "@/lib/db-types";
import { updateLeadRecord } from "@/lib/leads";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      budget?: number | null;
      currency?: string | null;
      customData?: string | Record<string, unknown> | null;
      financingStatus?: string | null;
      lostReason?: string | null;
      name?: string;
      nextActionAt?: string | null;
      nextActionNote?: string | null;
      nextActionType?: LeadNextActionType | null;
      note?: string | null;
      ownerId?: string | null;
      phone?: string;
      pipelineId?: string | null;
      pipelineStageKey?: string | null;
      preferredArea?: string | null;
      priority?: LeadPriority;
      productId?: string | null;
      project?: string;
      source?: LeadSource;
      sourceDetail?: string | null;
      stage?: LeadStage;
      value?: number | null;
    };
    const has = (key: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, key);

    const lead = await updateLeadRecord(id, {
      actorId: agent.id,
      budget: has("budget") ? body.budget ?? null : undefined,
      currency: has("currency") ? body.currency ?? null : undefined,
      customData: has("customData") ? body.customData ?? null : undefined,
      financingStatus: has("financingStatus") ? body.financingStatus ?? null : undefined,
      lostReason: has("lostReason") ? body.lostReason ?? null : undefined,
      name: body.name,
      nextActionAt: body.nextActionAt === undefined ? undefined : body.nextActionAt ? new Date(body.nextActionAt) : null,
      nextActionNote: has("nextActionNote") ? body.nextActionNote ?? null : undefined,
      nextActionType: has("nextActionType") ? body.nextActionType ?? null : undefined,
      note: has("note") ? body.note ?? null : undefined,
      ownerId: has("ownerId") ? body.ownerId ?? null : undefined,
      phone: body.phone,
      pipelineId: has("pipelineId") ? body.pipelineId ?? null : undefined,
      pipelineStageKey: has("pipelineStageKey") ? body.pipelineStageKey ?? null : undefined,
      preferredArea: has("preferredArea") ? body.preferredArea ?? null : undefined,
      priority: body.priority,
      productId: has("productId") ? body.productId ?? null : undefined,
      project: body.project,
      source: body.source,
      sourceDetail: has("sourceDetail") ? body.sourceDetail ?? null : undefined,
      stage: body.stage,
      value: has("value") ? body.value ?? null : undefined
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
