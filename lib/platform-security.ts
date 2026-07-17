import {
  findAgentCredentialById,
  findPlatformUserSecurityRow,
  listPlatformUserSecurityRows,
  listUserSecurityAuditLogs,
  type PlatformUserSecurityRow
} from "@/lib/db-auth";
import {
  getPasswordResetEmailAvailability,
  PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE
} from "@/lib/auth/password-reset-infra";
import { requestPasswordReset } from "@/lib/auth/password-reset";
import { resendEmailVerification } from "@/lib/auth/verification";
import { getCurrentSubscriptionOverview } from "@/lib/billing-management";
import { logUserSecurityEvent } from "@/lib/user-security-audit";

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(value);
}

function formatPackageLabel(plan: string) {
  if (!plan) {
    return "Not assigned";
  }

  return plan
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatPackageStatusLabel(status: string | null | undefined) {
  if (!status) {
    return "Not recorded";
  }

  if (status === "TRIAL") {
    return "Trial active";
  }

  if (status === "PAST_DUE") {
    return "Past due";
  }

  if (status === "CANCELLED") {
    return "Cancelled";
  }

  if (status === "EXPIRED") {
    return "Expired";
  }

  if (status === "PENDING") {
    return "Pending";
  }

  return "Active";
}

function formatSecurityEventLabel(eventType: string) {
  return eventType
    .split("_")
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }

      return part;
    })
    .join(" ");
}

function sanitizeAuditMetadata(metadataJson: string | null) {
  if (!metadataJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          return false;
        }

        return !/(password|token|secret|hash|api[-_]?key)/i.test(key);
      })
      .map(([key, value]) => ({
        key,
        value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "[redacted]"
      }));
  } catch {
    return [];
  }
}

export function buildSafeUserDetails(row: PlatformUserSecurityRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    packageName: formatPackageLabel(row.workspacePlan),
    packageStatus: "Not recorded",
    packageExpiryLabel: "Not recorded",
    lastLoginLabel: formatDateTime(row.lastLoginAt),
    passwordLastUpdatedLabel: formatDateTime(row.passwordLastUpdatedAt),
    createdAtLabel: formatDateTime(row.createdAt),
    updatedAtLabel: formatDateTime(row.updatedAt),
    emailVerifiedLabel: row.emailVerifiedAt ? formatDateTime(row.emailVerifiedAt) : "Not verified",
    emailVerified: Boolean(row.emailVerifiedAt),
    inviteAcceptedLabel: row.inviteAcceptedAt ? formatDateTime(row.inviteAcceptedAt) : "Not recorded"
  };
}

export async function listPlatformSecurityUsers() {
  const rows = await listPlatformUserSecurityRows();
  const packageSummaries = new Map<string, { status: string; expiryLabel: string }>();

  await Promise.all(
    Array.from(new Set(rows.map((row) => row.workspaceId))).map(async (workspaceId) => {
      const subscription = await getCurrentSubscriptionOverview(workspaceId).catch(() => null);
      packageSummaries.set(workspaceId, {
        status: formatPackageStatusLabel(subscription?.status),
        expiryLabel: formatDateTime(subscription?.expiryDate ?? null)
      });
    })
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    packageName: formatPackageLabel(row.workspacePlan),
    packageStatus: packageSummaries.get(row.workspaceId)?.status ?? "Not recorded",
    packageExpiryLabel: packageSummaries.get(row.workspaceId)?.expiryLabel ?? "Not recorded",
    status: row.status,
    emailVerified: Boolean(row.emailVerifiedAt),
    emailVerifiedLabel: row.emailVerifiedAt ? formatDateTime(row.emailVerifiedAt) : "Not verified",
    lastLoginLabel: formatDateTime(row.lastLoginAt),
    passwordLastUpdatedLabel: formatDateTime(row.passwordLastUpdatedAt),
    createdAtLabel: formatDateTime(row.createdAt)
  }));
}

export async function getPlatformSecurityAdminView() {
  const [users, resetAvailability] = await Promise.all([
    listPlatformSecurityUsers(),
    getPasswordResetEmailAvailability()
  ]);

  return {
    users,
    resetAvailability
  };
}

export async function getPlatformSecurityUserDetails(agentId: string, adminId: string) {
  const row = await findPlatformUserSecurityRow(agentId);

  if (!row) {
    throw new Error("User not found.");
  }

  const subscription = await getCurrentSubscriptionOverview(row.workspaceId).catch(() => null);

  await logUserSecurityEvent({
    agentId,
    adminId,
    eventType: "user_security_details_viewed"
  });

  return {
    ...buildSafeUserDetails(row),
    packageStatus: formatPackageStatusLabel(subscription?.status),
    packageExpiryLabel: formatDateTime(subscription?.expiryDate ?? null)
  };
}

export function serializeUserSecurityLogs(logs: Array<{ id: string; eventType: string; metadataJson: string | null; createdAt: Date }>) {
  return logs.map((log) => ({
    id: log.id,
    eventType: log.eventType,
    eventLabel: formatSecurityEventLabel(log.eventType),
    createdAtLabel: formatDateTime(log.createdAt),
    metadata: sanitizeAuditMetadata(log.metadataJson)
  }));
}

export async function getPlatformSecurityUserLogs(agentId: string, adminId: string) {
  const row = await findPlatformUserSecurityRow(agentId);

  if (!row) {
    throw new Error("User not found.");
  }

  const logs = await listUserSecurityAuditLogs(agentId);
  return serializeUserSecurityLogs(logs.filter((log) => log.eventType !== "user_security_logs_viewed"));
}

export async function sendPlatformUserPasswordResetEmail(
  agentId: string,
  adminId: string,
  dependencies: {
    findPlatformUserSecurityRowImpl?: typeof findPlatformUserSecurityRow;
    getPasswordResetEmailAvailabilityImpl?: typeof getPasswordResetEmailAvailability;
    requestPasswordResetImpl?: typeof requestPasswordReset;
    logUserSecurityEventImpl?: typeof logUserSecurityEvent;
  } = {}
) {
  const findPlatformUserSecurityRowImpl =
    dependencies.findPlatformUserSecurityRowImpl ?? findPlatformUserSecurityRow;
  const getPasswordResetEmailAvailabilityImpl =
    dependencies.getPasswordResetEmailAvailabilityImpl ?? getPasswordResetEmailAvailability;
  const requestPasswordResetImpl = dependencies.requestPasswordResetImpl ?? requestPasswordReset;
  const logUserSecurityEventImpl = dependencies.logUserSecurityEventImpl ?? logUserSecurityEvent;
  const [row, availability] = await Promise.all([
    findPlatformUserSecurityRowImpl(agentId),
    getPasswordResetEmailAvailabilityImpl()
  ]);

  if (!row) {
    throw new Error("User not found.");
  }

  if (!availability.enabled) {
    throw new Error(PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE);
  }

  await logUserSecurityEventImpl({
    agentId,
    adminId,
    eventType: "reset_email_requested"
  });

  try {
    await requestPasswordResetImpl({ email: row.email });
    await logUserSecurityEventImpl({
      agentId,
      adminId,
      eventType: "reset_email_sent"
    });
    return { ok: true as const };
  } catch (error) {
    await logUserSecurityEventImpl({
      agentId,
      adminId,
      eventType: "reset_email_failed",
      metadata: {
        reason: error instanceof Error ? error.message : "unknown_error"
      }
    });
    throw error;
  }
}

export async function sendPlatformUserVerificationEmail(
  agentId: string,
  adminId: string,
  dependencies: {
    findPlatformUserSecurityRowImpl?: typeof findPlatformUserSecurityRow;
    resendEmailVerificationImpl?: typeof resendEmailVerification;
    logUserSecurityEventImpl?: typeof logUserSecurityEvent;
  } = {}
) {
  const findPlatformUserSecurityRowImpl =
    dependencies.findPlatformUserSecurityRowImpl ?? findPlatformUserSecurityRow;
  const resendEmailVerificationImpl =
    dependencies.resendEmailVerificationImpl ?? resendEmailVerification;
  const logUserSecurityEventImpl = dependencies.logUserSecurityEventImpl ?? logUserSecurityEvent;
  const row = await findPlatformUserSecurityRowImpl(agentId);

  if (!row) {
    throw new Error("User not found.");
  }

  if (row.emailVerifiedAt) {
    throw new Error("Email is already verified.");
  }

  await logUserSecurityEventImpl({
    agentId,
    adminId,
    eventType: "verification_email_requested"
  });

  try {
    await resendEmailVerificationImpl(agentId);
    await logUserSecurityEventImpl({
      agentId,
      adminId,
      eventType: "verification_email_sent"
    });
    return { ok: true as const };
  } catch (error) {
    await logUserSecurityEventImpl({
      agentId,
      adminId,
      eventType: "verification_email_failed",
      metadata: {
        reason: error instanceof Error ? error.message : "unknown_error"
      }
    });
    throw error;
  }
}

export async function getCurrentUserPasswordContext(agentId: string) {
  const row = await findAgentCredentialById(agentId);

  if (!row) {
    throw new Error("UNAUTHORIZED");
  }

  return row;
}
