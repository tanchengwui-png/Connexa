import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { updateAutomationSettings } from "@/lib/automation-rules";

export async function PATCH(request: NextRequest) {
  try {
    await requireCurrentApiAgent();
    const body = (await request.json()) as {
      timezone?: string;
      businessHoursEnabled?: boolean;
      businessHours?: Array<{ day: number; enabled: boolean; start: string; end: string; label?: string }>;
      awayReplyEnabled?: boolean;
      awayReplyBody?: string;
      awayReplyCooldownMinutes?: number;
      humanTakeoverPauseMinutes?: number;
      regexEnabled?: boolean;
      decisionFlowEnabled?: boolean;
      decisionFlowQuestion?: string;
      decisionFlowYesKeywords?: string;
      decisionFlowNoKeywords?: string;
      decisionFlowYesReply?: string;
      decisionFlowNoReply?: string;
      decisionFlowFallbackReply?: string;
      decisionFlowYesTags?: string[];
      decisionFlowNoTags?: string[];
      workflowFlowEnabled?: boolean;
      activeWorkflowId?: string | null;
      propertyFlowEnabled?: boolean;
      propertyFlowPromptPurpose?: string;
      propertyFlowPromptArea?: string;
      propertyFlowPromptBudget?: string;
      propertyFlowCompleteReply?: string;
    };

    const settings = await updateAutomationSettings({
      timezone: body.timezone ?? "Asia/Kuala_Lumpur",
      businessHoursEnabled: body.businessHoursEnabled ?? false,
      businessHours: body.businessHours ?? [],
      awayReplyEnabled: body.awayReplyEnabled ?? false,
      awayReplyBody: body.awayReplyBody ?? "",
      awayReplyCooldownMinutes: body.awayReplyCooldownMinutes ?? 720,
      humanTakeoverPauseMinutes: body.humanTakeoverPauseMinutes ?? 240,
      regexEnabled: body.regexEnabled ?? false,
      decisionFlowEnabled: body.decisionFlowEnabled ?? false,
      decisionFlowQuestion: body.decisionFlowQuestion ?? "",
      decisionFlowYesKeywords: body.decisionFlowYesKeywords ?? "",
      decisionFlowNoKeywords: body.decisionFlowNoKeywords ?? "",
      decisionFlowYesReply: body.decisionFlowYesReply ?? "",
      decisionFlowNoReply: body.decisionFlowNoReply ?? "",
      decisionFlowFallbackReply: body.decisionFlowFallbackReply ?? "",
      decisionFlowYesTags: body.decisionFlowYesTags ?? [],
      decisionFlowNoTags: body.decisionFlowNoTags ?? [],
      workflowFlowEnabled: body.workflowFlowEnabled ?? false,
      activeWorkflowId: body.activeWorkflowId ?? null,
      propertyFlowEnabled: body.propertyFlowEnabled ?? false,
      propertyFlowPromptPurpose: body.propertyFlowPromptPurpose ?? "",
      propertyFlowPromptArea: body.propertyFlowPromptArea ?? "",
      propertyFlowPromptBudget: body.propertyFlowPromptBudget ?? "",
      propertyFlowCompleteReply: body.propertyFlowCompleteReply ?? ""
    });

    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update automation settings."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
