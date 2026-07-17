import { NextRequest, NextResponse } from "next/server";
import { restoreSessionFromRemember } from "@/lib/auth/session";
import { getAppBaseUrl } from "@/lib/app-url";

function getSafeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/inbox";
}

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/inbox";
  const safeReturnTo = getSafeReturnTo(returnTo);
  const result = await restoreSessionFromRemember();
  const appBaseUrl = getAppBaseUrl();

  if (!result.restored) {
    return NextResponse.redirect(
      new URL("/login?reason=session-expired", appBaseUrl)
    );
  }

  return NextResponse.redirect(new URL(safeReturnTo, appBaseUrl));
}
