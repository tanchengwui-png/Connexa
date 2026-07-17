import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  dismissAgentInboxDesktopNotificationsPrompt,
  parseInboxDesktopNotificationsPromptDismissedInput
} from "@/lib/inbox-notification-preferences";

export async function PATCH(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json().catch(() => null)) as
      | { inboxDesktopNotificationsPromptDismissed?: unknown }
      | null;

    parseInboxDesktopNotificationsPromptDismissedInput(
      body?.inboxDesktopNotificationsPromptDismissed
    );

    const result = await dismissAgentInboxDesktopNotificationsPrompt({
      agentId: agent.id,
      workspaceId: agent.workspaceId
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update the desktop notification prompt preference.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "INVALID_INBOX_DESKTOP_NOTIFICATIONS_PROMPT_DISMISSED"
          ? 400
          : message === "FORBIDDEN"
            ? 403
            : 400;

    return NextResponse.json(
      {
        error:
          message === "UNAUTHORIZED"
            ? "Sign in to update the desktop notification prompt preference."
            : message === "INVALID_INBOX_DESKTOP_NOTIFICATIONS_PROMPT_DISMISSED"
              ? "Choose a valid desktop notification prompt preference."
              : message
      },
      { status }
    );
  }
}
