import { NextRequest, NextResponse } from "next/server";
import { NewConversationError, startInboxConversationWithNewNumber } from "@/lib/inbox-new-conversation";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          channelId?: string;
          countryCode?: string | null;
          phoneNumber?: string;
          displayName?: string | null;
          messageText?: string;
          idempotencyKey?: string;
        }
      | null;

    const result = await startInboxConversationWithNewNumber({
      channelId: `${body?.channelId ?? ""}`,
      countryCode: body?.countryCode ?? null,
      phoneNumber: `${body?.phoneNumber ?? ""}`,
      displayName: body?.displayName ?? null,
      messageText: `${body?.messageText ?? ""}`,
      idempotencyKey: `${body?.idempotencyKey ?? ""}`
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof NewConversationError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.details ? error.details : {})
        },
        {
          status: error.status
        }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "EMAIL_NOT_VERIFIED"
              ? "Verify your email before sending messages."
              : error instanceof Error
                ? error.message
                : "Unable to start a new conversation."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "EMAIL_NOT_VERIFIED"
              ? 403
              : 400
      }
    );
  }
}
