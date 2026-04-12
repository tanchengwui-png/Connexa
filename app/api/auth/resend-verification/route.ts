import { NextResponse } from "next/server";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { resendEmailVerification } from "@/lib/auth/verification";

export async function POST() {
  const agent = await getCurrentAgent();

  if (!agent) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (agent.emailVerifiedAt) {
    return NextResponse.json({ error: "Email is already verified." }, { status: 400 });
  }

  try {
    await resendEmailVerification(agent.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to resend verification."
      },
      { status: 400 }
    );
  }
}
