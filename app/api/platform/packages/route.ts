import { NextRequest, NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformPackageAdminView, savePlatformPackageSettings } from "@/lib/platform-packages";
import { isPublicPackageKey, type PublicPackageKey } from "@/lib/public-packages";

export async function GET() {
  try {
    await requireApiPlatformAdmin();
    const packages = await getPlatformPackageAdminView();
    return NextResponse.json({ packages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load platform packages.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      packages?: Array<{
        packageKey?: string;
        isVisible?: boolean;
        displayOrder?: number;
        priceAmount?: number | null;
        maxOutboundMessages?: number | null;
        maxActiveContacts?: number | null;
        maxActiveAutomations?: number | null;
        maxWhatsAppCampaigns?: number | null;
      }>;
    };

    const packages: Array<{
      packageKey: PublicPackageKey;
      isVisible: boolean;
      displayOrder: number;
      priceAmount: number | null;
      maxOutboundMessages: number | null;
      maxActiveContacts: number | null;
      maxActiveAutomations: number | null;
      maxWhatsAppCampaigns: number | null;
    }> = [];

    for (const item of body.packages ?? []) {
      const packageKey = String(item.packageKey ?? "");

      if (!isPublicPackageKey(packageKey)) {
        throw new Error("Invalid package key.");
      }

      packages.push({
        packageKey,
        isVisible: Boolean(item.isVisible),
        displayOrder: Number(item.displayOrder ?? 0),
        priceAmount: parseOptionalPrice(item.priceAmount),
        maxOutboundMessages: parseOptionalLimit(item.maxOutboundMessages),
        maxActiveContacts: parseOptionalLimit(item.maxActiveContacts),
        maxActiveAutomations: parseOptionalLimit(item.maxActiveAutomations),
        maxWhatsAppCampaigns: parseOptionalLimit(item.maxWhatsAppCampaigns)
      });
    }

    await savePlatformPackageSettings(packages);
    return NextResponse.json({ ok: true, packages: await getPlatformPackageAdminView() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save platform packages.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

function parseOptionalLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new Error("Package limits must be numbers or left blank for unlimited.");
  }

  return Math.trunc(normalized);
}

function parseOptionalPrice(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new Error("Package prices must be numeric or left blank for custom billing.");
  }

  return Math.round(normalized * 100) / 100;
}
