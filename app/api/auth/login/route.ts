import { NextRequest, NextResponse } from "next/server";
import { loginWithPassword } from "@/lib/auth/login";
import { getAgentEntryPath } from "@/lib/auth/entry-path";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };

  try {
    const result = await loginWithPassword({
      email: body.email ?? "",
      password: body.password ?? "",
      remember: Boolean(body.remember)
    });

    if (result.type === "workspace_selection_required") {
      return NextResponse.json({
        ok: true,
        requiresWorkspaceSelection: true,
        challengeToken: result.challengeToken,
        options: result.options
      });
    }

    const redirectTo = await getAgentEntryPath(result.agent);

    return NextResponse.json({ ok: true, redirectTo });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to sign in."
      },
      { status: 400 }
    );
  }
}
