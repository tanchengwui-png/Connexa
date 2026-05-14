import { NextRequest, NextResponse } from "next/server";
import { loginPlatformAdmin } from "@/lib/platform-auth/login";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };

  try {
    await loginPlatformAdmin({
      email: body.email ?? "",
      password: body.password ?? "",
      remember: Boolean(body.remember)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to sign in."
      },
      { status: 400 }
    );
  }
}
