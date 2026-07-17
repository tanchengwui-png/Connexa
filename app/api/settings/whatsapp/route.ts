import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { sanitizeWhatsAppChannelDisplayName } from "@/lib/whatsapp-channel-label";
import {
  clearWhatsAppChannelInboxData,
  createWorkspaceWhatsAppChannel,
  deleteWhatsAppChannelRecord,
  getWorkspaceWhatsAppChannels,
  saveWhatsAppChannelConnectionMethod,
  saveWhatsAppCloudCredentials
} from "@/lib/whatsapp-channel";
import {
  deleteWorkspaceWhatsAppClientSession,
  ensureWorkspaceWhatsAppClient,
  getWorkspaceWhatsAppRuntimeStatus,
  syncWorkspaceHistory
} from "@/lib/whatsapp-runtime";
import { logWhatsAppRuntimeEvent } from "@/lib/whatsapp-runtime-events";

function getChannelIdFromRequest(request: NextRequest) {
  return request.nextUrl.searchParams.get("channelId")?.trim() || null;
}

function requireChannelId(channelId: string | null) {
  if (!channelId) {
    throw new Error("WHATSAPP_CHANNEL_REQUIRED");
  }

  return channelId;
}

export async function GET(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const channelId = getChannelIdFromRequest(request);
    const status = await getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: manager.workspaceId,
      agentId: manager.id,
      channelId
    });
    const channels = await getWorkspaceWhatsAppChannels(manager.workspaceId);

    return NextResponse.json({ status, channels }, { status: 200 });
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
                : "Unable to load WhatsApp status."
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

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as
      | {
          action?: string;
          channelId?: string | null;
          connectionMethod?: "api" | "web";
          accessToken?: string;
          businessAccountId?: string | null;
          connectionName?: string | null;
          phoneNumber?: string | null;
          phoneNumberId?: string;
          webhookVerifyToken?: string | null;
        }
      | null;
    const channelId = body?.channelId?.trim() || getChannelIdFromRequest(request);

    if (body?.action === "create-channel") {
      const channel = await createWorkspaceWhatsAppChannel(manager.workspaceId);
      return NextResponse.json({ channel }, { status: 201 });
    }

    const requiredChannelId = requireChannelId(channelId);

    if (body?.action === "save-connection-method") {
      const connectionMethod = body?.connectionMethod;
      if (connectionMethod !== "api" && connectionMethod !== "web") {
        throw new Error("WHATSAPP_CONNECTION_METHOD_INVALID");
      }

      const channel = await saveWhatsAppChannelConnectionMethod({
        workspaceId: manager.workspaceId,
        channelId: requiredChannelId,
        connectionMethod
      });
      const status = await getWorkspaceWhatsAppRuntimeStatus({
        workspaceId: manager.workspaceId,
        agentId: manager.id,
        channelId: requiredChannelId
      });

      return NextResponse.json({ channel, status }, { status: 200 });
    }

    if (body?.action === "save-cloud") {
      const channel = await saveWhatsAppCloudCredentials({
        workspaceId: manager.workspaceId,
        channelId: requiredChannelId,
        phoneNumberId: body?.phoneNumberId ?? "",
        businessAccountId: body?.businessAccountId ?? null,
        accessToken: body?.accessToken ?? "",
        verifyToken: body?.webhookVerifyToken ?? null,
        displayName: sanitizeWhatsAppChannelDisplayName(body?.connectionName),
        phoneNumber: body?.phoneNumber ?? null,
        provider: "meta",
        channelType: "cloudapi"
      });
      await logWhatsAppRuntimeEvent({
        workspaceId: manager.workspaceId,
        sessionClientId: channel.sessionClientId,
        eventType: "CLOUD_UPDATED",
        message: "WhatsApp Cloud credentials saved manually.",
        metadata: {
          channelId: channel.id,
          provider: "meta",
          channelType: "cloudapi",
          phoneNumberId: channel.phoneNumberId,
          businessAccountId: channel.businessAccountId
        }
      });
      const status = await getWorkspaceWhatsAppRuntimeStatus({
        workspaceId: manager.workspaceId,
        agentId: manager.id,
        channelId: requiredChannelId
      });

      return NextResponse.json({ channel, status }, { status: 200 });
    }

    if (body?.action === "fresh-start") {
      await deleteWorkspaceWhatsAppClientSession(manager.workspaceId, requiredChannelId);
    }

    await ensureWorkspaceWhatsAppClient({
      workspaceId: manager.workspaceId,
      agentId: manager.id,
      channelId: requiredChannelId
    });

    const status = await getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: manager.workspaceId,
      agentId: manager.id,
      channelId: requiredChannelId
    });

    return NextResponse.json({ status }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error && error.message === "WHATSAPP_CONNECTION_METHOD_INVALID"
                ? "Choose a valid WhatsApp connection method."
              : error instanceof Error && error.message === "WHATSAPP_CHANNEL_REQUIRED"
                ? "Choose a WhatsApp channel before generating or resetting a QR session."
              : error instanceof Error
                ? error.message
                : "Unable to start WhatsApp login."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : error instanceof Error && error.message === "WHATSAPP_CONNECTION_METHOD_INVALID"
                ? 400
              : 400
      }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const channelId = requireChannelId(getChannelIdFromRequest(request));
    const body = (await request.json().catch(() => null)) as
      | {
          clearChatsAndContacts?: boolean;
        }
      | null;
    await deleteWorkspaceWhatsAppClientSession(manager.workspaceId, channelId);
    const cleanupResult = body?.clearChatsAndContacts
      ? await clearWhatsAppChannelInboxData({
          workspaceId: manager.workspaceId,
          channelId
        })
      : null;
    await deleteWhatsAppChannelRecord({
      workspaceId: manager.workspaceId,
      channelId
    });
    const channels = await getWorkspaceWhatsAppChannels(manager.workspaceId);
    return NextResponse.json(
      {
        ok: true,
        cleanupResult,
        nextChannelId: channels[0]?.id ?? null
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error && error.message === "WHATSAPP_CHANNEL_REQUIRED"
                ? "Choose a WhatsApp channel before removing a WhatsApp connection."
              : error instanceof Error
                ? error.message
                : "Unable to disconnect WhatsApp."
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

export async function PATCH(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const channelId = requireChannelId(getChannelIdFromRequest(request));
    const result = await syncWorkspaceHistory(manager.workspaceId, channelId, {
      triggeredBy: "manual"
    });
    const status = await getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: manager.workspaceId,
      agentId: manager.id,
      channelId
    });

    return NextResponse.json({ ok: true, result, status }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error && error.message === "WHATSAPP_CHANNEL_REQUIRED"
                ? "Choose a WhatsApp channel before finalizing WhatsApp setup."
              : error instanceof Error
                ? error.message
                : "Unable to sync WhatsApp history."
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
