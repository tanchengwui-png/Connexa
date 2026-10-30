import { NextResponse } from "next/server";
import { confirmAccountDeletionRequest, processConfirmedDeletionRequest } from "@/lib/account-deletion";
import { requireApiManager } from "@/lib/auth/current-user";

export async function POST() {
  try {
    const agent = await requireApiManager();
    const request = await confirmAccountDeletionRequest({ userId: agent.id, accountId: agent.accountId, workspaceId: agent.workspaceId, actionType: "delete_all_data" });
    const result = await processConfirmedDeletionRequest(request.id);
    return NextResponse.json({ ok: true, request: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm data deletion.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message === "FORBIDDEN" ? "Forbidden." : "Unable to confirm data deletion." }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}
