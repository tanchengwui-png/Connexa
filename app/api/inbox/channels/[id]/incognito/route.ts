import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { setWhatsAppChannelIncognitoMode } from "@/lib/whatsapp-channel";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | {
          incognitoMode?: boolean;
        }
      | null;

    if (typeof body?.incognitoMode !== "boolean") {
      return NextResponse.json({ error: "Choose a valid incognito mode state." }, { status: 400 });
    }

    const channel = await setWhatsAppChannelIncognitoMode({
      workspaceId: agent.workspaceId,
      channelId: id,
      incognitoMode: body.incognitoMode
    });

    return NextResponse.json({ channel }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to update incognito mode."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}
