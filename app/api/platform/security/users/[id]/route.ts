import { NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformSecurityUserDetails } from "@/lib/platform-security";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [admin, params] = await Promise.all([requireApiPlatformAdmin(), context.params]);
    const user = await getPlatformSecurityUserDetails(params.id, admin.id);
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load user details.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
