import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { getInboxData } from "@/lib/inbox";

export async function GET(request: Request) {
  try {
    await requireCurrentApiAgent();
    const channelId = new URL(request.url).searchParams.get("channelId");
    const { conversations } = await getInboxData(undefined, channelId);
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load conversations." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
