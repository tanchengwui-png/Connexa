import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { upsertPropertyLeadForConversation } from "@/lib/conversations";
import { createPropertyLeadDraftForConversation } from "@/lib/leads";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      budget?: number | null;
      financingStatus?: string | null;
      nextActionAt?: string | null;
      preferredArea?: string | null;
      priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
      project: string;
      sourceDetail?: string | null;
      stage:
        | "NEW_LEAD"
        | "QUALIFIED"
        | "SITE_VISIT_BOOKED"
        | "FOLLOW_UP"
        | "NEGOTIATION"
        | "CLOSED_WON"
        | "CLOSED_LOST";
    };

    const lead =
      body.project && body.priority && body.stage
        ? await upsertPropertyLeadForConversation(id, {
            budget: body.budget ?? null,
            financingStatus: body.financingStatus ?? null,
            nextActionAt: body.nextActionAt ? new Date(body.nextActionAt) : null,
            preferredArea: body.preferredArea ?? null,
            priority: body.priority,
            project: body.project,
            sourceDetail: body.sourceDetail ?? null,
            stage: body.stage
          })
        : await createPropertyLeadDraftForConversation(id);

    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to save property lead."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
