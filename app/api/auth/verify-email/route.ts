import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/app-url";
import { createSession } from "@/lib/auth/session";
import { verifyEmailToken } from "@/lib/auth/verification";

function buildVerificationRedirect(status: "success" | "expired" | "invalid" | "failed") {
  const url = new URL("/verify-email", getAppBaseUrl());
  url.searchParams.set("verification", status);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return buildVerificationRedirect("invalid");
  }

  try {
    const verifiedAgent = await verifyEmailToken(token);

    // Cookie writes must happen in a Route Handler. createSession also clears
    // the previous active and remembered sessions before issuing this one.
    await createSession({
      agentId: verifiedAgent.id,
      workspaceId: verifiedAgent.workspaceId,
      remember: false
    });

    return buildVerificationRedirect("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "This verification link has expired.") {
      return buildVerificationRedirect("expired");
    }

    if (message === "Invalid verification link.") {
      return buildVerificationRedirect("invalid");
    }

    return buildVerificationRedirect("failed");
  }
}
