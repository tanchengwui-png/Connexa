import { NextResponse } from "next/server";
import { createContactNote } from "@/lib/contacts";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      body?: string;
    };

    const note = await createContactNote({
      contactId: id,
      body: body.body ?? ""
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message === "UNAUTHORIZED"
          ? "Unauthorized."
          : error.message
        : "Unable to save note.";

    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
