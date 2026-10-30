import { randomUUID } from "node:crypto";
import { createUserSecurityAuditLog } from "@/lib/db-auth";
import { execute, queryOne, transaction } from "@/lib/db";
import { deleteWorkspaceWhatsAppClientSession } from "@/lib/whatsapp-runtime";

export type DeletionActionType = "delete_all_data" | "delete_account";

type DeletionRequestRow = {
  id: string;
  actionType: DeletionActionType;
  status: "confirmed" | "processing" | "completed" | "failed" | "cancelled";
  confirmedAt: Date;
  completedAt: Date | null;
};

function recordId() {
  return randomUUID().replace(/-/g, "");
}

/**
 * The server creates the confirmation timestamp. The client never supplies a
 * user id, account id, workspace id, or timestamp.
 */
export async function confirmAccountDeletionRequest(input: {
  userId: string;
  accountId: string | null;
  workspaceId: string;
  actionType: DeletionActionType;
}) {
  let request: DeletionRequestRow | null;
  try {
    request = await transaction(async (client) => {
    const active = await queryOne<DeletionRequestRow>(
      `SELECT id, "actionType", status, "confirmedAt", "completedAt"
       FROM "DeletionRequest"
       WHERE "workspaceId" = $1 AND "actionType" = $2
         AND status IN ('confirmed', 'processing', 'completed')
       FOR UPDATE`,
      [input.workspaceId, input.actionType],
      client
    );
    if (active) {
      // Delete-all-data is intentionally idempotent. Older requests could be
      // marked completed before every operational record and WhatsApp session
      // was removed, so an explicit repeat confirmation must be able to retry
      // the same workspace purge. Account deletion remains non-retryable.
      if (active.actionType === "delete_all_data" && active.status === "completed") {
        return queryOne<DeletionRequestRow>(
          `UPDATE "DeletionRequest"
           SET status = 'confirmed', "completedAt" = NULL, "processingStartedAt" = NULL,
               "failedAt" = NULL, "failureReason" = NULL, "confirmedAt" = NOW(), "updatedAt" = NOW()
           WHERE id = $1
           RETURNING id, "actionType", status, "confirmedAt", "completedAt"`,
          [active.id],
          client
        );
      }
      return active;
    }

    return queryOne<DeletionRequestRow>(
      `INSERT INTO "DeletionRequest" (
         id, "userId", "accountId", "workspaceId", "actionType", status,
         "confirmedAt", "requestSource", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 'confirmed', NOW(), 'account_settings', NOW(), NOW())
       RETURNING id, "actionType", status, "confirmedAt", "completedAt"`,
      [recordId(), input.userId, input.accountId, input.workspaceId, input.actionType],
      client
    );
    });
  } catch (error) {
    // The partial unique index is the final concurrency guard when two workers
    // reach the initial SELECT before either has inserted its request.
    const duplicate = (error as { code?: string } | null)?.code === "23505";
    if (!duplicate) throw error;
    request = await queryOne<DeletionRequestRow>(
      `SELECT id, "actionType", status, "confirmedAt", "completedAt"
       FROM "DeletionRequest"
       WHERE "workspaceId" = $1 AND "actionType" = $2
         AND status IN ('confirmed', 'processing', 'completed')
       ORDER BY "createdAt" DESC LIMIT 1`,
      [input.workspaceId, input.actionType]
    );
  }

  if (!request) throw new Error("Unable to record deletion request.");
  await createUserSecurityAuditLog({
    agentId: input.userId,
    eventType: `account_deletion_${input.actionType}_confirmed`,
    metadataJson: JSON.stringify({ deletionRequestId: request.id, workspaceId: input.workspaceId })
  });
  return request;
}

/**
 * Deletes operational customer content only. Billing, invoice, payment,
 * security-audit, and deletion-request records are deliberately retained for
 * legal, fraud-prevention, security, and financial obligations.
 */
export async function processConfirmedDeletionRequest(requestId: string) {
  const request = await transaction(async (client) => {
    const row = await queryOne<DeletionRequestRow & { workspaceId: string; accountId: string | null; userId: string }>(
      `SELECT id, "actionType", status, "confirmedAt", "completedAt", "workspaceId", "accountId", "userId"
       FROM "DeletionRequest" WHERE id = $1 FOR UPDATE`,
      [requestId], client
    );
    if (!row) throw new Error("Deletion request was not found.");
    if (row.status === "completed") return row;
    if (row.status !== "confirmed") return row;
    await execute(`UPDATE "DeletionRequest" SET status = 'processing', "processingStartedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [requestId], client);
    return { ...row, status: "processing" as const };
  });

  if (request.status !== "processing") return request;

  try {
    // A database-only channel deletion leaves the sender service authenticated,
    // allowing it to recreate the channel and re-import messages immediately.
    // Revoke the runtime and its WhatsApp Web auth state before purging records.
    await deleteWorkspaceWhatsAppClientSession(request.workspaceId);

    await transaction(async (client) => {
      const workspaceId = request.workspaceId;
      // Dependency-safe operational-data purge. Database cascades clear related
      // messages, recipients, automation state, and conversation children.
      await execute(`DELETE FROM "AutomationJob" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "OutboundMessageJob" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "CampaignRunRecipient" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "CampaignDraft" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "CampaignRun" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "ConversationRuleExecution" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "ConversationAutomationState" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "ConversationAuditEvent" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "InboxNewConversationRequest" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "AutomationRule" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "AutomationWorkflow" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "QuickReply" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "Appointment" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "LeadActivity" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "Lead" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "Note" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "Message" WHERE "conversationId" IN (SELECT id FROM "Conversation" WHERE "workspaceId" = $1)`, [workspaceId], client);
      await execute(`DELETE FROM "Conversation" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "Contact" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "contact_imports" WHERE workspace_id = $1`, [workspaceId], client);
      await execute(`DELETE FROM "WorkspaceContactTag" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "EmailLog" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "Product" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "WorkspaceMediaAsset" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "WhatsAppMessageEnvelope" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "WhatsAppRuntimeEvent" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "OutboundWorkerHeartbeat" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "WorkspaceAutomationSettings" WHERE "workspaceId" = $1`, [workspaceId], client);
      await execute(`DELETE FROM "WhatsAppChannel" WHERE "workspaceId" = $1`, [workspaceId], client);
      if (request.actionType === "delete_account") {
        if (request.accountId) {
          await execute(`UPDATE "Account" SET "deactivatedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [request.accountId], client);
        }
        if (request.accountId) {
          await execute(`DELETE FROM "Session" WHERE "agentId" IN (SELECT id FROM "Agent" WHERE "accountId" = $1)`, [request.accountId], client);
          await execute(`DELETE FROM "RememberSession" WHERE "agentId" IN (SELECT id FROM "Agent" WHERE "accountId" = $1)`, [request.accountId], client);
        } else {
          await execute(`DELETE FROM "Session" WHERE "workspaceId" = $1`, [workspaceId], client);
          await execute(`DELETE FROM "RememberSession" WHERE "workspaceId" = $1`, [workspaceId], client);
        }
      }
      await execute(`UPDATE "DeletionRequest" SET status = 'completed', "completedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [request.id], client);
    });
  } catch (error) {
    await execute(
      `UPDATE "DeletionRequest" SET status = 'failed', "failedAt" = NOW(), "failureReason" = $2, "updatedAt" = NOW() WHERE id = $1 AND status = 'processing'`,
      [request.id, error instanceof Error ? error.message.slice(0, 500) : "Deletion processing failed."]
    );
    throw error;
  }

  return queryOne<DeletionRequestRow>(`SELECT id, "actionType", status, "confirmedAt", "completedAt" FROM "DeletionRequest" WHERE id = $1`, [request.id]);
}
