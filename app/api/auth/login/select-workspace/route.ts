import { NextRequest, NextResponse } from "next/server";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { loginWithWorkspaceSelection } from "@/lib/auth/login";
import { getSafeReturnTo } from "@/lib/auth/return-to";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    challengeToken?: string;
    agentId?: string;
    returnTo?: string;
  };

  try {
    const agent = await loginWithWorkspaceSelection({
      challengeToken: body.challengeToken ?? "",
      agentId: body.agentId ?? ""
    });

    const redirectTo = body.returnTo
      ? getSafeReturnTo(body.returnTo, await getAgentEntryPath(agent))
      : await getAgentEntryPath(agent);

    return NextResponse.json({ ok: true, redirectTo });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to complete sign in."
      },
      { status: 400 }
    );
  }
}
