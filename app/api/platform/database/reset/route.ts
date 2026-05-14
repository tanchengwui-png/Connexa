import { NextResponse } from "next/server";
import { reseedDemoDatabase } from "@/lib/platform-database-reset";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    await requireApiPlatformAdmin();
    const result = await reseedDemoDatabase();

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset the demo database.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
