import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { getInboxConversationListPage } from "@/lib/inbox-conversation-list";
import { clampInboxPageSize } from "@/lib/inbox-pagination";

export async function GET(request: Request) {
  try {
    await requireCurrentApiAgent();
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channelId");
    const result = await getInboxConversationListPage({
      channelId,
      cursor: url.searchParams.get("cursor"),
      limit: clampInboxPageSize(url.searchParams.get("limit"), 50, 100)
    });
    const etag = `W/\"${result.version}\"`;
    if (!url.searchParams.get("cursor") && request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { etag, "cache-control": "private, no-cache" } });
    }
    return NextResponse.json(
      { conversations: result.conversations, page: result.page },
      { headers: { etag, "cache-control": "private, no-cache" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load conversations." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
