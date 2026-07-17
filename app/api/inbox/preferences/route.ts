import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  getAgentInboxNotificationSoundsMuted,
  parseInboxNotificationSoundsMutedInput,
  updateAgentInboxNotificationSoundsMuted
} from "@/lib/inbox-notification-preferences";

export async function GET() {
  try {
    const agent = await requireCurrentApiAgent();
    const inboxNotificationSoundsMuted = await getAgentInboxNotificationSoundsMuted({
      agentId: agent.id,
      workspaceId: agent.workspaceId
    });

    return NextResponse.json({ inboxNotificationSoundsMuted }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load Inbox preferences."
      },
      {
        status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400
      }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json().catch(() => null)) as
      | {
          inboxNotificationSoundsMuted?: unknown;
        }
      | null;

    const muted = parseInboxNotificationSoundsMutedInput(body?.inboxNotificationSoundsMuted);
    const result = await updateAgentInboxNotificationSoundsMuted({
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      muted
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message === "UNAUTHORIZED"
          ? "Unauthorized."
          : error.message === "INVALID_INBOX_NOTIFICATION_SOUNDS_MUTED"
            ? "Choose a valid Inbox notification preference."
            : error.message === "FORBIDDEN"
              ? "Forbidden."
              : error.message
        : "Unable to update Inbox preferences.";

    const status =
      error instanceof Error
        ? error.message === "UNAUTHORIZED"
          ? 401
          : error.message === "FORBIDDEN"
            ? 403
            : error.message === "INVALID_INBOX_NOTIFICATION_SOUNDS_MUTED"
              ? 400
              : 400
        : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
