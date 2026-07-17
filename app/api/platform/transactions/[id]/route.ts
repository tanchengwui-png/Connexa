import { NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformTransaction } from "@/lib/platform-transactions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiPlatformAdmin();
    const { id } = await context.params;
    const transaction = await getPlatformTransaction(id);
    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    return NextResponse.json({ transaction });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load transaction.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
