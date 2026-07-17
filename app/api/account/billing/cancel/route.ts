import { NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { cancelCurrentSubscription } from "@/lib/billing-management";

export async function POST() {
  try {
    const manager = await requireApiManager();
    await cancelCurrentSubscription(manager.workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel subscription.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
