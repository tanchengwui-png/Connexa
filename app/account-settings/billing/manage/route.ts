import { NextRequest, NextResponse } from "next/server";
import { resolveAgentAuthState } from "@/lib/auth/session";
import { switchWorkspaceSession } from "@/lib/auth/workspace-switch";
import {
  resolveBillingReminderAccess,
  verifyBillingReminderManageToken
} from "@/lib/billing-reminder-link";
import { getAppBaseUrl } from "@/lib/app-url";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getAppBaseUrl()));
}

function getInvalidLinkPath(returnTo?: string) {
  return returnTo
    ? `/billing-link-invalid?returnTo=${encodeURIComponent(returnTo)}`
    : "/billing-link-invalid";
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  let verification: ReturnType<typeof verifyBillingReminderManageToken>;

  try {
    verification = verifyBillingReminderManageToken(token);
  } catch {
    return redirectTo(getInvalidLinkPath());
  }

  if (!verification.ok) {
    return redirectTo(getInvalidLinkPath());
  }

  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const authState = await resolveAgentAuthState({ mode: "api" });
  if (authState.status !== "authenticated") {
    const reason = authState.status === "expired" ? "reason=session-expired&" : "";
    return redirectTo(`/login?${reason}returnTo=${encodeURIComponent(returnTo)}`);
  }

  const access = resolveBillingReminderAccess(verification.claims, {
    agentId: authState.session.agent.id,
    accountId: authState.session.agent.accountId,
    email: authState.session.agent.email,
    workspaceId: authState.session.workspaceId
  });

  if (access.status !== "allowed" || !authState.session.agent.emailVerifiedAt) {
    return redirectTo(getInvalidLinkPath(returnTo));
  }

  if (access.requiresWorkspaceSwitch) {
    try {
      await switchWorkspaceSession({
        currentAccountId: authState.session.agent.accountId,
        targetAgentId: verification.claims.recipientAgentId
      });
    } catch {
      return redirectTo(getInvalidLinkPath(returnTo));
    }
  }

  return redirectTo("/account-settings/billing");
}
