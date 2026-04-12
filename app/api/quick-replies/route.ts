import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { createQuickReply, getQuickRepliesData } from "@/lib/quick-replies";

export async function GET() {
  try {
    await requireCurrentApiAgent();
    const data = await getQuickRepliesData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load quick replies." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireCurrentApiAgent();
    const body = (await request.json()) as {
      title?: string;
      shortcut?: string;
      category?: string;
      isPinned?: boolean;
      body?: string;
    };
    const quickReply = await createQuickReply({
      title: body.title ?? "",
      shortcut: body.shortcut ?? "",
      category: body.category ?? "General",
      isPinned: Boolean(body.isPinned),
      body: body.body ?? ""
    });

    return NextResponse.json({ quickReply }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to create quick reply."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
