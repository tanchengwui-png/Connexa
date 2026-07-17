import { NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformSecurityUserLogs } from "@/lib/platform-security";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [admin, params] = await Promise.all([requireApiPlatformAdmin(), context.params]);
    const logs = await getPlatformSecurityUserLogs(params.id, admin.id);
    return NextResponse.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load security logs.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
