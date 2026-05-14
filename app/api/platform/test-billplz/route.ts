import { NextRequest, NextResponse } from "next/server";
import { getBillplzCollection } from "@/lib/billplz";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformConfig } from "@/lib/platform-config";

export async function POST(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();

    const body = (await request.json()) as {
      billplzApiKey?: string;
      billplzCollectionId?: string;
      billplzXSignatureKey?: string;
      billplzSandbox?: boolean;
    };

    const stored = await getPlatformConfig();
    const apiKey = String(body.billplzApiKey ?? "").trim() || stored?.billplzApiKey || process.env.BILLPLZ_API_KEY || "";
    const collectionId =
      String(body.billplzCollectionId ?? "").trim() ||
      stored?.billplzCollectionId ||
      process.env.BILLPLZ_COLLECTION_ID ||
      "";
    const xSignatureKey =
      String(body.billplzXSignatureKey ?? "").trim() ||
      stored?.billplzXSignatureKey ||
      process.env.BILLPLZ_X_SIGNATURE_KEY ||
      "";
    const sandbox =
      typeof body.billplzSandbox === "boolean"
        ? body.billplzSandbox
        : stored?.billplzSandbox ?? process.env.BILLPLZ_SANDBOX === "true";

    if (!apiKey) {
      return NextResponse.json({ error: "Billplz API key is required." }, { status: 400 });
    }

    if (!collectionId) {
      return NextResponse.json({ error: "Billplz collection ID is required." }, { status: 400 });
    }

    const collection = await getBillplzCollection({
      apiKey,
      collectionId,
      xSignatureKey,
      sandbox
    });

    return NextResponse.json({
      ok: true,
      collection,
      xSignatureConfigured: Boolean(xSignatureKey),
      sandbox
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to test Billplz connection.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
