import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-connexa-return-to",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: ["/((?!_next|api|favicon.ico|manifest.webmanifest|icon|apple-icon).*)"]
};
