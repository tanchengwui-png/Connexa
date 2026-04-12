import { NextRequest, NextResponse } from "next/server";
import { acceptInvite } from "@/lib/auth/invites";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    token?: string;
    name?: string;
    password?: string;
    remember?: boolean;
  };

  try {
    await acceptInvite({
      token: body.token ?? "",
      name: body.name ?? "",
      password: body.password ?? "",
      remember: Boolean(body.remember)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to accept invitation." },
      { status: 400 }
    );
  }
}
