import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { saveAgentAvailability } from "@/lib/availability";
import { AvailabilityOverrideType } from "@/lib/db-types";

export async function POST(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json()) as {
      weeklyRules?: Array<{
        dayOfWeek?: number;
        enabled?: boolean;
        startTime?: string;
        endTime?: string;
      }>;
      overrides?: Array<{
        type?: AvailabilityOverrideType;
        startAt?: string;
        endAt?: string;
        note?: string;
      }>;
    };

    await saveAgentAvailability(agent.id, {
      weeklyRules: (body.weeklyRules ?? []).map((rule) => ({
        dayOfWeek: Number(rule.dayOfWeek ?? -1),
        enabled: Boolean(rule.enabled),
        startTime: String(rule.startTime ?? ""),
        endTime: String(rule.endTime ?? "")
      })),
      overrides: (body.overrides ?? []).map((override) => ({
        type: override.type ?? AvailabilityOverrideType.BLOCKED,
        startAt: String(override.startAt ?? ""),
        endAt: String(override.endAt ?? ""),
        note: override.note ?? ""
      }))
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save availability.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "EMAIL_NOT_VERIFIED"
          ? 403
          : 400;

    return NextResponse.json({ error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message }, { status });
  }
}
