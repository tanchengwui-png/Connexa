import { NextResponse } from "next/server";
import { clearPlatformSession } from "@/lib/platform-auth/session";

export async function POST() {
  await clearPlatformSession();
  return NextResponse.json({ ok: true });
}
