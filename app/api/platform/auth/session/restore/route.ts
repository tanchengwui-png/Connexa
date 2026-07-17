import { NextRequest, NextResponse } from "next/server";
import { restorePlatformSessionFromRememberCookie } from "@/lib/platform-auth/session";
import { getAppBaseUrl } from "@/lib/app-url";

function getSafeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/platform";
}

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/platform";
  const safeReturnTo = getSafeReturnTo(returnTo);
  const result = await restorePlatformSessionFromRememberCookie();
  const appBaseUrl = getAppBaseUrl();

  if (!result.restored) {
    return NextResponse.redirect(
      new URL("/platform/login?reason=session-expired", appBaseUrl)
    );
  }

  return NextResponse.redirect(new URL(safeReturnTo, appBaseUrl));
}
