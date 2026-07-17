import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredWorkspaces, sendSubscriptionExpiryReminderEmails } from "@/lib/billing-management";
import { applyScheduledWorkspaceDowngrades } from "@/lib/workspace-package-upgrades";

function isAuthorized(request: NextRequest) {
  const expectedToken =
    process.env.BILLING_WORKER_TOKEN?.trim() ??
    process.env.AUTOMATION_WORKER_TOKEN?.trim() ??
    process.env.OUTBOUND_WORKER_TOKEN?.trim();
  return Boolean(expectedToken && request.headers.get("x-worker-token")?.trim() === expectedToken);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const cleanup = await cleanupExpiredWorkspaces();
    const downgrades = await applyScheduledWorkspaceDowngrades();
    const reminders = await sendSubscriptionExpiryReminderEmails();
    return NextResponse.json({ ...cleanup, ...downgrades, ...reminders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process billing maintenance." },
      { status: 500 }
    );
  }
}
