import { createUserSecurityAuditLog, findAgentsByEmail } from "@/lib/db-auth";

const SECURITY_EVENT_TYPES = new Set([
  "user_security_details_viewed",
  "user_security_logs_viewed",
  "reset_email_requested",
  "reset_email_sent",
  "reset_email_failed",
  "verification_email_requested",
  "verification_email_sent",
  "verification_email_failed",
  "email_verified",
  "password_change_success",
  "password_change_failed",
  "password_reset_success",
  "password_reset_failed"
]);

type AuditMetadata = Record<string, string | number | boolean | null | undefined>;

export async function logUserSecurityEvent(input: {
  agentId?: string;
  email?: string;
  adminId?: string | null;
  eventType: string;
  metadata?: AuditMetadata;
}) {
  if (!SECURITY_EVENT_TYPES.has(input.eventType)) {
    throw new Error("Unsupported security audit event.");
  }

  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  if (input.agentId) {
    await createUserSecurityAuditLog({
      agentId: input.agentId,
      adminId: input.adminId ?? null,
      eventType: input.eventType,
      metadataJson
    });
    return;
  }

  if (!input.email) {
    return;
  }

  const agents = await findAgentsByEmail(input.email.trim().toLowerCase());
  await Promise.all(
    agents.map((agent) =>
      createUserSecurityAuditLog({
        agentId: agent.id,
        adminId: input.adminId ?? null,
        eventType: input.eventType,
        metadataJson
      })
    )
  );
}
