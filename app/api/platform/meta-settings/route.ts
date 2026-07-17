import { NextRequest, NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformConfigForAdmin, updatePlatformMetaConfig } from "@/lib/platform-config";

export async function GET() {
  try {
    await requireApiPlatformAdmin();
    const settings = await getPlatformConfigForAdmin();
    return NextResponse.json({
      settings: {
        metaAppId: settings.metaAppId,
        metaConfigId: settings.metaConfigId,
        metaGraphVersion: settings.metaGraphVersion,
        metaRedirectUri: settings.metaRedirectUri,
        metaAppSecretConfigured: settings.metaAppSecretConfigured,
        metaWebhookVerifyTokenConfigured: settings.metaWebhookVerifyTokenConfigured,
        metaEmbeddedSignupConfigured: settings.metaEmbeddedSignupConfigured
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Meta settings.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      metaAppId?: string;
      metaAppSecret?: string;
      metaConfigId?: string;
      metaGraphVersion?: string;
      metaRedirectUri?: string;
      metaWebhookVerifyToken?: string;
    };

    await updatePlatformMetaConfig({
      metaAppId: body.metaAppId ?? "",
      metaAppSecret: body.metaAppSecret ?? "",
      metaConfigId: body.metaConfigId ?? "",
      metaGraphVersion: body.metaGraphVersion ?? "v23.0",
      metaRedirectUri: body.metaRedirectUri ?? "",
      metaWebhookVerifyToken: body.metaWebhookVerifyToken ?? ""
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save Meta settings.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
