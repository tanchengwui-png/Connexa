import { AutomationMatchType, AutomationTriggerType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteAutomationRule, updateAutomationRule } from "@/lib/automation-rules";

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
      name?: string;
      triggerType?: AutomationTriggerType;
      matchType?: AutomationMatchType;
      keyword?: string;
      replyBody?: string;
      addTags?: string[];
      priority?: number;
      cooldownMinutes?: number;
      stopAfterMatch?: boolean;
      businessHoursOnly?: boolean;
      followUpDelayMinutes?: number | null;
      followUpReplyBody?: string | null;
      enabled?: boolean;
    };
    const rule = await updateAutomationRule(id, {
      name: body.name,
      triggerType: body.triggerType,
      matchType: body.matchType,
      keyword: body.keyword,
      replyBody: body.replyBody,
      addTags: body.addTags,
      priority: body.priority,
      cooldownMinutes: body.cooldownMinutes,
      stopAfterMatch: body.stopAfterMatch,
      businessHoursOnly: body.businessHoursOnly,
      followUpDelayMinutes: body.followUpDelayMinutes,
      followUpReplyBody: body.followUpReplyBody,
      enabled: body.enabled
    });

    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to update automation rule."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    await deleteAutomationRule(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to delete automation rule."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
