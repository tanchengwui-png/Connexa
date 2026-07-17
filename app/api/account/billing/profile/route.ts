import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { getBillingPageData, saveBillingProfile } from "@/lib/billing-management";

export async function GET() {
  try {
    const manager = await requireApiManager();
    const billing = await getBillingPageData(manager.workspaceId, manager.name, manager.email);
    return NextResponse.json({ profile: billing.profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load billing information.";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as {
      billingName?: string;
      billingEmail?: string;
      billingPhoneNumber?: string;
      billingAddressLine1?: string;
      billingAddressLine2?: string;
      billingCity?: string;
      billingState?: string;
      billingPostcode?: string;
      billingCountry?: string;
      billingTaxId?: string;
    };
    await saveBillingProfile({
      workspaceId: manager.workspaceId,
      billingName: body.billingName ?? "",
      billingEmail: body.billingEmail ?? "",
      billingPhoneNumber: body.billingPhoneNumber ?? "",
      billingAddressLine1: body.billingAddressLine1 ?? "",
      billingAddressLine2: body.billingAddressLine2 ?? null,
      billingCity: body.billingCity ?? "",
      billingState: body.billingState ?? "",
      billingPostcode: body.billingPostcode ?? "",
      billingCountry: body.billingCountry ?? "Malaysia",
      billingTaxId: body.billingTaxId ?? null
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save billing information.";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
