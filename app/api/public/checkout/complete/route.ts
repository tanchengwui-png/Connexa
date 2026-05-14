import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";
import { finalizeCheckoutFromRedirect } from "@/lib/checkout";
import { getAppBaseUrl } from "@/lib/app-url";

export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl();

  try {
    const params: Record<string, string> = {};

    request.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const result = await finalizeCheckoutFromRedirect(params);

    if (result.status === "COMPLETED" && result.pendingCheckout?.agentId && result.pendingCheckout.workspaceId) {
      await createSession({
        agentId: result.pendingCheckout.agentId,
        workspaceId: result.pendingCheckout.workspaceId,
        remember: result.pendingCheckout.remember
      });

      return NextResponse.redirect(new URL("/verify-email", appBaseUrl));
    }

    return NextResponse.redirect(new URL("/checkout/complete?status=pending", appBaseUrl));
  } catch {
    return NextResponse.redirect(new URL("/checkout/complete?status=failed", appBaseUrl));
  }
}
