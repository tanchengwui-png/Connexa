import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { getInboxData } from "@/lib/inbox";

export async function GET() {
  try {
    await requireCurrentApiAgent();
    const { conversations } = await getInboxData();
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load conversations." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
