import { NextRequest, NextResponse } from "next/server";
import { registerWorkspace } from "@/lib/auth/register";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    name?: string;
    email?: string;
    workspaceName?: string;
    password?: string;
    plan?: string;
    remember?: boolean;
  };

  try {
    await registerWorkspace({
      name: body.name ?? "",
      email: body.email ?? "",
      workspaceName: body.workspaceName ?? "",
      password: body.password ?? "",
      plan: body.plan ?? "",
      remember: Boolean(body.remember)
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create workspace."
      },
      { status: 400 }
    );
  }
}
