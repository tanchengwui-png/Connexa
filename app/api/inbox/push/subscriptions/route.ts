import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  disableBrowserPushSubscription,
  isInboxWebPushConfigured,
  upsertBrowserPushSubscription
} from "@/lib/inbox-web-push";

function parsePushSubscriptionBody(body: unknown) {
  const candidate = body as
    | {
        endpoint?: unknown;
        keys?: {
          auth?: unknown;
          p256dh?: unknown;
        };
      }
    | null;

  if (
    !candidate ||
    typeof candidate.endpoint !== "string" ||
    typeof candidate.keys?.auth !== "string" ||
    typeof candidate.keys?.p256dh !== "string"
  ) {
    throw new Error("INVALID_BROWSER_PUSH_SUBSCRIPTION");
  }

  return {
    endpoint: candidate.endpoint,
    keys: {
      auth: candidate.keys.auth,
      p256dh: candidate.keys.p256dh
    }
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!isInboxWebPushConfigured()) {
      throw new Error("INBOX_WEB_PUSH_NOT_CONFIGURED");
    }

    const agent = await requireCurrentApiAgent();
    const body = parsePushSubscriptionBody(await request.json().catch(() => null));
    const subscription = await upsertBrowserPushSubscription({
      accountId: agent.accountId ?? null,
      agentId: agent.id,
      subscription: body,
      userAgent: request.headers.get("user-agent")
    });

    return NextResponse.json(subscription, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save browser push subscription.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "INBOX_WEB_PUSH_NOT_CONFIGURED"
          ? 503
          : message === "INVALID_BROWSER_PUSH_SUBSCRIPTION"
            ? 400
            : 400;

    return NextResponse.json(
      {
        error:
          message === "UNAUTHORIZED"
            ? "Sign in to enable desktop notifications."
            : message === "INBOX_WEB_PUSH_NOT_CONFIGURED"
              ? "Desktop push notifications are not configured for this environment."
              : message === "INVALID_BROWSER_PUSH_SUBSCRIPTION"
                ? "Choose a valid browser push subscription."
                : message
      },
      { status }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = parsePushSubscriptionBody(await request.json().catch(() => null));
    const result = await disableBrowserPushSubscription({
      accountId: agent.accountId ?? null,
      agentId: agent.id,
      endpoint: body.endpoint
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to disable browser push subscription.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "INVALID_BROWSER_PUSH_SUBSCRIPTION" ? 400 : 400;

    return NextResponse.json(
      {
        error:
          message === "UNAUTHORIZED"
            ? "Sign in to disable desktop notifications."
            : message === "INVALID_BROWSER_PUSH_SUBSCRIPTION"
              ? "Choose a valid browser push subscription."
              : message
      },
      { status }
    );
  }
}
