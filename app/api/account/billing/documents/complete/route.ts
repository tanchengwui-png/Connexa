import { NextRequest, NextResponse } from "next/server";
import { finalizeSubscriberInvoicePaymentFromRedirect } from "@/lib/billing-management";
import { getAppBaseUrl } from "@/lib/app-url";

export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl();

  try {
    const params: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const result = await finalizeSubscriberInvoicePaymentFromRedirect(params);
    const status = result.status === "COMPLETED" ? "success" : "pending";
    return NextResponse.redirect(new URL(`/account-settings/billing?invoicePayment=${status}`, appBaseUrl));
  } catch {
    return NextResponse.redirect(new URL("/account-settings/billing?invoicePayment=failed", appBaseUrl));
  }
}
