import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  getAgentInboxNotificationDesktopPromptState,
  getAgentInboxNotificationSoundsMuted
} from "@/lib/inbox-notification-preferences";
import { getCurrentAgentPushStatus } from "@/lib/inbox-web-push";

export async function GET() {
  try {
    const agent = await requireCurrentApiAgent();
    const [preference, prompt, push] = await Promise.all([
      getAgentInboxNotificationSoundsMuted({
        agentId: agent.id,
        workspaceId: agent.workspaceId
      }),
      getAgentInboxNotificationDesktopPromptState({
        agentId: agent.id,
        workspaceId: agent.workspaceId
      }),
      getCurrentAgentPushStatus({
        accountId: agent.accountId ?? null,
        agentId: agent.id
      })
    ]);

    return NextResponse.json(
      {
        inboxNotificationSoundsMuted: preference,
        inboxDesktopNotificationsPromptDismissedAt:
          prompt.inboxDesktopNotificationsPromptDismissedAt,
        pushEnabled: push.enabled,
        pushSubscriptionCount: push.subscriptionCount,
        vapidPublicKey: push.vapidPublicKey
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Inbox push settings.";

    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Sign in to manage Inbox push notifications." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
