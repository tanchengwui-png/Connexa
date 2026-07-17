import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/app-url";
import { finalizeWorkspacePackageUpgradeFromRedirect } from "@/lib/workspace-package-upgrades";

export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl();

  try {
    const params: Record<string, string> = {};

    request.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const result = await finalizeWorkspacePackageUpgradeFromRedirect(params);
    const status =
      result.status === "COMPLETED"
        ? "success"
        : result.status === "FAILED"
          ? "failed"
          : "pending";

    return NextResponse.redirect(new URL(`/account-settings/billing?packageUpgrade=${status}`, appBaseUrl));
  } catch {
    return NextResponse.redirect(new URL("/account-settings/billing?packageUpgrade=failed", appBaseUrl));
  }
}
