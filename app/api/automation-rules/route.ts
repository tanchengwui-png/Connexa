import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { createAutomationRule, getAutomationRulesData } from "@/lib/automation-rules";
import { AutomationMatchType, AutomationTriggerType } from "@/lib/db-types";

export async function GET() {
  try {
    await requireCurrentApiAgent();
    const data = await getAutomationRulesData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load automation rules." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireCurrentApiAgent();
    const body = (await request.json()) as {
      name?: string;
      triggerType?: AutomationTriggerType;
      matchType?: AutomationMatchType;
      keyword?: string;
      replyBody?: string;
      replyMediaAssetIds?: string[];
      replyMediaAssetId?: string | null;
      workflowId?: string | null;
      addTags?: string[];
      priority?: number;
      cooldownMinutes?: number;
      stopAfterMatch?: boolean;
      businessHoursOnly?: boolean;
      followUpDelayMinutes?: number | null;
      followUpReplyBody?: string | null;
      followUpMediaAssetIds?: string[];
      followUpMediaAssetId?: string | null;
      enabled?: boolean;
    };

    if (!body.triggerType || !Object.values(AutomationTriggerType).includes(body.triggerType)) {
      return NextResponse.json({ error: "Invalid trigger type." }, { status: 400 });
    }

    if (!body.matchType || !Object.values(AutomationMatchType).includes(body.matchType)) {
      return NextResponse.json({ error: "Invalid match type." }, { status: 400 });
    }

    const rule = await createAutomationRule({
      name: body.name ?? "",
      triggerType: body.triggerType,
      matchType: body.matchType,
      keyword: body.keyword,
      replyBody: body.replyBody ?? "",
      replyMediaAssetIds: body.replyMediaAssetIds ?? [],
      replyMediaAssetId: body.replyMediaAssetId ?? null,
      workflowId: body.workflowId ?? null,
      addTags: body.addTags ?? [],
      priority: body.priority ?? 100,
      cooldownMinutes: body.cooldownMinutes ?? 360,
      stopAfterMatch: body.stopAfterMatch ?? false,
      businessHoursOnly: body.businessHoursOnly ?? false,
      followUpDelayMinutes: body.followUpDelayMinutes ?? null,
      followUpReplyBody: body.followUpReplyBody ?? null,
      followUpMediaAssetIds: body.followUpMediaAssetIds ?? [],
      followUpMediaAssetId: body.followUpMediaAssetId ?? null,
      enabled: body.enabled
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to create automation rule."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
