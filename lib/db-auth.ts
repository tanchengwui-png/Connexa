import { randomUUID } from "node:crypto";
import { type DbExecutor, execute, queryMany, queryOne, transaction } from "@/lib/db";

let pendingWorkspacePackageUpgradeStoreReady = false;
let pendingWorkspacePackageUpgradeStorePromise: Promise<void> | null = null;

function createRecordId() {
  return randomUUID().replace(/-/g, "");
}

export type AgentRow = {
  id: string;
  accountId: string | null;
  workspaceId: string;
  name: string;
  email: string;
  phone: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  inviteAcceptedAt: Date | null;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AccountRow = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionRow = {
  id: string;
  agentId: string;
  workspaceId: string;
  tokenHash: string;
  remember: boolean;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
};

export type SessionWithAgentRow = SessionRow & {
  agent: AgentRow;
};

export type RememberSessionRow = {
  id: string;
  agentId: string;
  workspaceId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
};

export type RememberSessionWithAgentRow = RememberSessionRow & {
  agent: AgentRow;
};

export type PlatformAdminRow = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformSessionRow = {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
};

export type PlatformSessionWithAdminRow = PlatformSessionRow & {
  admin: PlatformAdminRow;
};

export type PlatformRememberSessionRow = {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
};

export type PlatformRememberSessionWithAdminRow = PlatformRememberSessionRow & {
  admin: PlatformAdminRow;
};

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  industryType: string;
  plan: string;
  trialEndsAt: Date | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceWithCountsRow = WorkspaceRow & {
  agentCount: number;
};

export type AgentWorkspaceLoginRow = AgentRow & {
  workspaceName: string;
  workspaceSlug: string;
  effectivePasswordHash: string | null;
  effectiveEmailVerifiedAt: Date | null;
};

export type VerificationAgentRow = {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  workspaceName: string;
};

export type VerificationTokenRow = {
  id: string;
  agentId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

export type VerificationTokenWithAgentRow = VerificationTokenRow & {
  agent: AgentRow;
};

export type PasswordResetTokenRow = {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

export type PlatformUserSecurityRow = {
  id: string;
  accountId: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspacePlan: string;
  name: string;
  email: string;
  role: string;
  status: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  inviteAcceptedAt: Date | null;
  lastLoginAt: Date | null;
  passwordLastUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentCredentialRow = {
  id: string;
  accountId: string | null;
  email: string;
  name: string;
  workspaceId: string;
  role: string;
  effectivePasswordHash: string | null;
  passwordLastUpdatedAt: Date | null;
};

export type UserSecurityAuditLogRow = {
  id: string;
  agentId: string;
  adminId: string | null;
  eventType: string;
  metadataJson: string | null;
  createdAt: Date;
};

function isMissingAccountTableError(error: unknown) {
  return error instanceof Error && error.message.includes('relation "Account" does not exist');
}

function isMissingPasswordResetTokenTableError(error: unknown) {
  return error instanceof Error && error.message.includes('relation "PasswordResetToken" does not exist');
}

function isMissingSessionRememberColumnError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('"remember"') &&
    error.message.includes("does not exist")
  );
}

export type InviteRow = {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedById: string;
  createdAt: Date;
};

export type InviteWithContextRow = InviteRow & {
  workspaceName: string;
  invitedByName: string;
};

export type TeamAgentRow = AgentRow;

export type PlatformConfigRow = {
  id: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
  supportEmail: string | null;
  emailBrandName: string | null;
  emailBrandTagline: string | null;
  billplzApiKey: string | null;
  billplzXSignatureKey: string | null;
  billplzCollectionId: string | null;
  billplzSandbox: boolean;
  metaAppId: string | null;
  metaAppSecret: string | null;
  metaConfigId: string | null;
  metaGraphVersion: string | null;
  metaRedirectUri: string | null;
  metaWebhookVerifyToken: string | null;
  automationWorkflowIdleHours: number;
  automationWorkflowExpireHours: number;
  freeTrialDurationDays: number;
  expiredAccountCleanupDays: number;
  sessionTimeoutMinutes: number;
  rememberMeTimeoutMinutes: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PendingWorkspaceCheckoutRow = {
  id: string;
  plan: string;
  billingPeriod: string | null;
  name: string;
  email: string;
  workspaceName: string;
  passwordHash: string;
  billingName: string;
  billingPhoneNumber: string;
  billingAddressLine1: string;
  billingAddressLine2: string | null;
  billingCity: string;
  billingState: string;
  billingPostcode: string;
  billingCountry: string;
  billingTaxId: string | null;
  remember: boolean;
  provider: string | null;
  providerReference: string | null;
  providerCheckoutUrl: string | null;
  discountCode: string | null;
  discountPercentage: number | null;
  originalAmount: string | null;
  finalAmount: string | null;
  currency: string | null;
  status: string;
  paidAt: Date | null;
  completedAt: Date | null;
  workspaceId: string | null;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PendingWorkspacePackageUpgradeRow = {
  id: string;
  workspaceId: string;
  requestedByAgentId: string;
  invoiceNumber: string;
  currentPlan: string;
  targetPlan: string;
  operationType: string | null;
  billingPeriod: string | null;
  provider: string | null;
  providerReference: string | null;
  providerCheckoutUrl: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  receiptNumber: string | null;
  receiptIssuedAt: Date | null;
  replacedById: string | null;
  replacesId: string | null;
  replacementReason: string | null;
  paymentStartedAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformPackageConfigRow = {
  id: string;
  platformId: string;
  packageKey: string;
  isVisible: boolean;
  displayOrder: number;
  priceAmount: string | null;
  yearlyDiscountPercentage: string | null;
  mediaLibraryStorageLimitBytes: number | string | null;
  maxOutboundMessages: number | null;
  maxActiveContacts: number | null;
  maxActiveAutomations: number | null;
  maxWhatsAppCampaigns: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformDiscountCodeRow = {
  id: string;
  platformId: string;
  code: string;
  percentage: number;
  amountOff: string | null;
  isActive: boolean;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redeemedByName: string | null;
  redeemedByEmail: string | null;
  redeemedByWorkspaceName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PackageRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceAmount: string | null;
  currency: string | null;
  billingPeriod: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspacePackageSubscriptionRow = {
  id: string;
  workspaceId: string;
  packageId: string;
  status: string;
  subscribedPrice: string | null;
  currency: string | null;
  billingPeriod: string | null;
  startedAt: Date;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  endedAt: Date | null;
  nextBillingAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  autoRenew: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspacePackageSubscriptionWithPackageRow = WorkspacePackageSubscriptionRow & {
  packageCode: string;
  packageName: string;
};

export async function findAgentByEmail(email: string) {
  const agents = await queryMany<AgentRow>(
    `SELECT * FROM "Agent" WHERE email = $1 ORDER BY "createdAt" ASC LIMIT 2`,
    [email]
  );

  if (agents.length > 1) {
    throw new Error("AMBIGUOUS_AGENT_EMAIL");
  }

  return agents[0] ?? null;
}

export async function findAgentsByEmail(email: string) {
  try {
    return await queryMany<AgentWorkspaceLoginRow>(
      `SELECT
          a.*,
          w.name AS "workspaceName",
          w.slug AS "workspaceSlug",
          COALESCE(ac."passwordHash", a."passwordHash") AS "effectivePasswordHash",
          COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt") AS "effectiveEmailVerifiedAt"
        FROM "Agent" a
        JOIN "Workspace" w ON w.id = a."workspaceId"
        LEFT JOIN "Account" ac
          ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
        WHERE a.email = $1
        ORDER BY a."createdAt" ASC`,
      [email]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return queryMany<AgentWorkspaceLoginRow>(
        `SELECT
            a.*,
            w.name AS "workspaceName",
            w.slug AS "workspaceSlug",
            a."passwordHash" AS "effectivePasswordHash",
            a."emailVerifiedAt" AS "effectiveEmailVerifiedAt"
          FROM "Agent" a
          JOIN "Workspace" w ON w.id = a."workspaceId"
          WHERE a.email = $1
          ORDER BY a."createdAt" ASC`,
        [email]
      );
    }

    throw error;
  }
}

export async function findAgentsByAccountId(accountId: string) {
  try {
    return await queryMany<AgentWorkspaceLoginRow>(
      `SELECT
          a.*,
          w.name AS "workspaceName",
          w.slug AS "workspaceSlug",
          COALESCE(ac."passwordHash", a."passwordHash") AS "effectivePasswordHash",
          COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt") AS "effectiveEmailVerifiedAt"
        FROM "Agent" a
        JOIN "Workspace" w ON w.id = a."workspaceId"
        LEFT JOIN "Account" ac ON ac.id = a."accountId"
        WHERE a."accountId" = $1
        ORDER BY a."createdAt" ASC`,
      [accountId]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return [];
    }

    throw error;
  }
}

export async function touchAgentLastLogin(agentId: string) {
  await execute(`UPDATE "Agent" SET "lastLoginAt" = NOW() WHERE id = $1`, [agentId]);
}

export async function findAccountByEmail(email: string) {
  try {
    return await queryOne<AccountRow>(
      `SELECT *
       FROM "Account"
       WHERE email = $1
       LIMIT 1`,
      [email]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function createAccountRecord(input: {
  email: string;
  passwordHash: string;
  emailVerifiedAt?: Date | null;
}) {
  try {
    return await queryOne<AccountRow>(
      `INSERT INTO "Account" (
         id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [createRecordId(), input.email, input.passwordHash, input.emailVerifiedAt ?? null]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function attachAgentToAccount(agentId: string, accountId: string) {
  try {
    await execute(
      `UPDATE "Agent"
       SET "accountId" = $2, "updatedAt" = NOW()
       WHERE id = $1`,
      [agentId, accountId]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return;
    }

    throw error;
  }
}

export async function touchAccountLastLogin(accountId: string) {
  try {
    await execute(`UPDATE "Account" SET "lastLoginAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [accountId]);
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return;
    }

    throw error;
  }
}

export async function verifyAccountEmailByEmail(email: string) {
  try {
    await execute(
      `UPDATE "Account"
       SET "emailVerifiedAt" = NOW(), "updatedAt" = NOW()
       WHERE email = $1`,
      [email]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return;
    }

    throw error;
  }
}

export async function findSessionWithAgentByTokenHash(tokenHash: string) {
  try {
    return await queryOne<SessionWithAgentRow>(
      `SELECT
          s.id,
          s."agentId",
          s."workspaceId",
          s."tokenHash",
          s."remember",
          s."expiresAt",
          s."lastUsedAt",
          s."createdAt",
          json_build_object(
            'id', a.id,
            'accountId', a."accountId",
            'workspaceId', a."workspaceId",
            'name', a.name,
            'email', a.email,
            'phone', a.phone,
            'passwordHash', COALESCE(ac."passwordHash", a."passwordHash"),
            'emailVerifiedAt', COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt"),
            'lastLoginAt', COALESCE(ac."lastLoginAt", a."lastLoginAt"),
            'inviteAcceptedAt', a."inviteAcceptedAt",
            'role', a.role,
            'status', a.status,
            'createdAt', a."createdAt",
            'updatedAt', a."updatedAt"
          ) AS agent
        FROM "Session" s
        JOIN "Agent" a ON a.id = s."agentId"
        LEFT JOIN "Account" ac
          ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
        WHERE s."tokenHash" = $1
        LIMIT 1`,
      [tokenHash]
    );
  } catch (error) {
    if (isMissingSessionRememberColumnError(error)) {
      return queryOne<SessionWithAgentRow>(
        `SELECT
            s.id,
            s."agentId",
            s."workspaceId",
            s."tokenHash",
            CASE
              WHEN s."expiresAt" - s."lastUsedAt" > INTERVAL '7 days' THEN TRUE
              ELSE FALSE
            END AS "remember",
            s."expiresAt",
            s."lastUsedAt",
            s."createdAt",
            json_build_object(
              'id', a.id,
              'accountId', a."accountId",
              'workspaceId', a."workspaceId",
              'name', a.name,
              'email', a.email,
              'phone', a.phone,
              'passwordHash', COALESCE(ac."passwordHash", a."passwordHash"),
              'emailVerifiedAt', COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt"),
              'lastLoginAt', COALESCE(ac."lastLoginAt", a."lastLoginAt"),
              'inviteAcceptedAt', a."inviteAcceptedAt",
              'role', a.role,
              'status', a.status,
              'createdAt', a."createdAt",
              'updatedAt', a."updatedAt"
            ) AS agent
          FROM "Session" s
          JOIN "Agent" a ON a.id = s."agentId"
          LEFT JOIN "Account" ac
            ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
          WHERE s."tokenHash" = $1
          LIMIT 1`,
        [tokenHash]
      );
    }

    if (isMissingAccountTableError(error)) {
      return queryOne<SessionWithAgentRow>(
        `SELECT
            s.id,
            s."agentId",
            s."workspaceId",
            s."tokenHash",
            CASE
              WHEN s."expiresAt" - s."lastUsedAt" > INTERVAL '7 days' THEN TRUE
              ELSE FALSE
            END AS "remember",
            s."expiresAt",
            s."lastUsedAt",
            s."createdAt",
            row_to_json(a) AS agent
          FROM "Session" s
          JOIN "Agent" a ON a.id = s."agentId"
          WHERE s."tokenHash" = $1
          LIMIT 1`,
        [tokenHash]
      );
    }

    throw error;
  }
}

export async function findRememberSessionWithAgentByTokenHash(tokenHash: string) {
  await ensureRememberSessionStore();
  return queryOne<RememberSessionWithAgentRow>(
    `SELECT
        s.id,
        s."agentId",
        s."workspaceId",
        s."tokenHash",
        s."expiresAt",
        s."lastUsedAt",
        s."createdAt",
        json_build_object(
          'id', a.id,
          'accountId', a."accountId",
          'workspaceId', a."workspaceId",
          'name', a.name,
          'email', a.email,
          'phone', a.phone,
          'passwordHash', COALESCE(ac."passwordHash", a."passwordHash"),
          'emailVerifiedAt', COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt"),
          'lastLoginAt', COALESCE(ac."lastLoginAt", a."lastLoginAt"),
          'inviteAcceptedAt', a."inviteAcceptedAt",
          'role', a.role,
          'status', a.status,
          'createdAt', a."createdAt",
          'updatedAt', a."updatedAt"
        ) AS agent
      FROM "RememberSession" s
      JOIN "Agent" a ON a.id = s."agentId"
      LEFT JOIN "Account" ac
        ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
      WHERE s."tokenHash" = $1
      LIMIT 1`,
    [tokenHash]
  );
}

export async function createSessionRecord(input: {
  agentId: string;
  workspaceId: string;
  tokenHash: string;
  remember: boolean;
  expiresAt: Date;
}) {
  try {
    await execute(
      `INSERT INTO "Session" (id, "agentId", "workspaceId", "tokenHash", "remember", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [createRecordId(), input.agentId, input.workspaceId, input.tokenHash, input.remember, input.expiresAt]
    );
  } catch (error) {
    if (isMissingSessionRememberColumnError(error)) {
      await execute(
        `INSERT INTO "Session" (id, "agentId", "workspaceId", "tokenHash", "expiresAt")
         VALUES ($1, $2, $3, $4, $5)`,
        [createRecordId(), input.agentId, input.workspaceId, input.tokenHash, input.expiresAt]
      );
      return;
    }

    throw error;
  }
}

export async function createRememberSessionRecord(input: {
  agentId: string;
  workspaceId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  await ensureRememberSessionStore();
  await execute(
    `INSERT INTO "RememberSession" (id, "agentId", "workspaceId", "tokenHash", "expiresAt")
     VALUES ($1, $2, $3, $4, $5)`,
    [createRecordId(), input.agentId, input.workspaceId, input.tokenHash, input.expiresAt]
  );
}

export async function updateSessionRecord(sessionId: string, expiresAt: Date, remember: boolean) {
  try {
    await execute(
      `UPDATE "Session"
       SET "expiresAt" = $2, "remember" = $3, "lastUsedAt" = NOW()
       WHERE id = $1`,
      [sessionId, expiresAt, remember]
    );
  } catch (error) {
    if (isMissingSessionRememberColumnError(error)) {
      await execute(
        `UPDATE "Session"
         SET "expiresAt" = $2, "lastUsedAt" = NOW()
         WHERE id = $1`,
        [sessionId, expiresAt]
      );
      return;
    }

    throw error;
  }
}

export async function touchRememberSessionRecord(sessionId: string, lastUsedAt: Date = new Date()) {
  await ensureRememberSessionStore();
  await execute(
    `UPDATE "RememberSession"
     SET "lastUsedAt" = $2
     WHERE id = $1`,
    [sessionId, lastUsedAt]
  );
}

export async function updateRememberSessionContext(input: {
  sessionId: string;
  agentId: string;
  workspaceId: string;
}) {
  await ensureRememberSessionStore();
  await execute(
    `UPDATE "RememberSession"
     SET "agentId" = $2, "workspaceId" = $3, "lastUsedAt" = NOW()
     WHERE id = $1`,
    [input.sessionId, input.agentId, input.workspaceId]
  );
}

export async function deleteSessionById(sessionId: string) {
  await execute(`DELETE FROM "Session" WHERE id = $1`, [sessionId]);
}

export async function deleteRememberSessionById(sessionId: string) {
  await ensureRememberSessionStore();
  await execute(`DELETE FROM "RememberSession" WHERE id = $1`, [sessionId]);
}

export async function deleteSessionsByTokenHash(tokenHash: string) {
  await execute(`DELETE FROM "Session" WHERE "tokenHash" = $1`, [tokenHash]);
}

export async function deleteRememberSessionsByTokenHash(tokenHash: string) {
  await ensureRememberSessionStore();
  await execute(`DELETE FROM "RememberSession" WHERE "tokenHash" = $1`, [tokenHash]);
}

export async function deleteSessionsByEmail(email: string, executor?: DbExecutor) {
  await execute(
    `DELETE FROM "Session"
     WHERE "agentId" IN (
       SELECT id
       FROM "Agent"
       WHERE email = $1
     )`,
    [email],
    executor
  );
}

export async function deleteRememberSessionsByEmail(email: string, executor?: DbExecutor) {
  await ensureRememberSessionStore();
  await execute(
    `DELETE FROM "RememberSession"
     WHERE "agentId" IN (
       SELECT id
       FROM "Agent"
       WHERE email = $1
     )`,
    [email],
    executor
  );
}

export async function findPlatformAdminByEmail(email: string) {
  return queryOne<PlatformAdminRow>(
    `SELECT * FROM "PlatformAdmin" WHERE email = $1 LIMIT 1`,
    [email]
  );
}

export async function touchPlatformAdminLastLogin(adminId: string) {
  await execute(`UPDATE "PlatformAdmin" SET "lastLoginAt" = NOW() WHERE id = $1`, [adminId]);
}

export async function findPlatformSessionWithAdminByTokenHash(tokenHash: string) {
  return queryOne<PlatformSessionWithAdminRow>(
    `SELECT
        s.id,
        s."adminId",
        s."tokenHash",
        s."expiresAt",
        s."lastUsedAt",
        s."createdAt",
        row_to_json(a) AS admin
      FROM "PlatformSession" s
      JOIN "PlatformAdmin" a ON a.id = s."adminId"
      WHERE s."tokenHash" = $1
      LIMIT 1`,
    [tokenHash]
  );
}

export async function findPlatformRememberSessionWithAdminByTokenHash(tokenHash: string) {
  await ensurePlatformRememberSessionStore();
  return queryOne<PlatformRememberSessionWithAdminRow>(
    `SELECT
        s.id,
        s."adminId",
        s."tokenHash",
        s."expiresAt",
        s."lastUsedAt",
        s."createdAt",
        row_to_json(a) AS admin
      FROM "PlatformRememberSession" s
      JOIN "PlatformAdmin" a ON a.id = s."adminId"
      WHERE s."tokenHash" = $1
      LIMIT 1`,
    [tokenHash]
  );
}

export async function createPlatformSessionRecord(input: {
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  await execute(
    `INSERT INTO "PlatformSession" (id, "adminId", "tokenHash", "expiresAt")
     VALUES ($1, $2, $3, $4)`,
    [createRecordId(), input.adminId, input.tokenHash, input.expiresAt]
  );
}

export async function updatePlatformSessionRecord(sessionId: string, expiresAt: Date) {
  await execute(
    `UPDATE "PlatformSession"
     SET "expiresAt" = $2, "lastUsedAt" = NOW()
     WHERE id = $1`,
    [sessionId, expiresAt]
  );
}

export async function createPlatformRememberSessionRecord(input: {
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  await ensurePlatformRememberSessionStore();
  await execute(
    `INSERT INTO "PlatformRememberSession" (id, "adminId", "tokenHash", "expiresAt")
     VALUES ($1, $2, $3, $4)`,
    [createRecordId(), input.adminId, input.tokenHash, input.expiresAt]
  );
}

export async function deletePlatformSessionById(sessionId: string) {
  await execute(`DELETE FROM "PlatformSession" WHERE id = $1`, [sessionId]);
}

export async function deletePlatformRememberSessionById(sessionId: string) {
  await ensurePlatformRememberSessionStore();
  await execute(`DELETE FROM "PlatformRememberSession" WHERE id = $1`, [sessionId]);
}

export async function deletePlatformSessionsByTokenHash(tokenHash: string) {
  await execute(`DELETE FROM "PlatformSession" WHERE "tokenHash" = $1`, [tokenHash]);
}

export async function deletePlatformRememberSessionsByTokenHash(tokenHash: string) {
  await ensurePlatformRememberSessionStore();
  await execute(`DELETE FROM "PlatformRememberSession" WHERE "tokenHash" = $1`, [tokenHash]);
}

export async function findWorkspaceById(workspaceId: string) {
  return queryOne<WorkspaceRow>(`SELECT * FROM "Workspace" WHERE id = $1 LIMIT 1`, [workspaceId]);
}

export async function findWorkspaceByIdForUpdate(workspaceId: string, executor: DbExecutor) {
  return queryOne<WorkspaceRow>(
    `SELECT *
     FROM "Workspace"
     WHERE id = $1
     LIMIT 1
     FOR UPDATE`,
    [workspaceId],
    executor
  );
}

export async function findWorkspaceSummaryById(workspaceId: string) {
  return queryOne<Pick<WorkspaceRow, "name" | "industryType">>(
    `SELECT name, "industryType" FROM "Workspace" WHERE id = $1 LIMIT 1`,
    [workspaceId]
  );
}

export async function findWorkspaceNameById(workspaceId: string) {
  return queryOne<Pick<WorkspaceRow, "name">>(
    `SELECT name FROM "Workspace" WHERE id = $1 LIMIT 1`,
    [workspaceId]
  );
}

export async function findWorkspaceBySlug(slug: string) {
  return queryOne<WorkspaceRow>(`SELECT * FROM "Workspace" WHERE slug = $1 LIMIT 1`, [slug]);
}

export async function createWorkspaceRecord(input: {
  name: string;
  slug: string;
  plan: string;
  trialEndsAt: Date;
}) {
  return queryOne<WorkspaceRow>(
    `INSERT INTO "Workspace" (id, name, slug, plan, "trialEndsAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [createRecordId(), input.name, input.slug, input.plan, input.trialEndsAt]
  );
}

export async function updateWorkspaceIndustryType(workspaceId: string, industryType: string) {
  return queryOne<WorkspaceRow>(
    `UPDATE "Workspace"
     SET "industryType" = $2, "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [workspaceId, industryType]
  );
}

export async function updateWorkspacePlan(workspaceId: string, plan: string, executor?: DbExecutor) {
  return queryOne<WorkspaceRow>(
    `UPDATE "Workspace"
     SET plan = $2,
         "trialEndsAt" = NULL,
         "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [workspaceId, plan],
    executor
  );
}

export async function findPlatformConfig() {
  return queryOne<PlatformConfigRow>(`SELECT * FROM "PlatformConfig" WHERE id = 'platform' LIMIT 1`);
}

export async function ensurePlatformConfigStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "PlatformConfig" (
       id TEXT PRIMARY KEY DEFAULT 'platform',
       "smtpHost" TEXT,
       "smtpPort" INTEGER,
       "smtpSecure" BOOLEAN NOT NULL DEFAULT FALSE,
       "smtpUser" TEXT,
       "smtpPass" TEXT,
       "smtpFrom" TEXT,
       "supportEmail" TEXT,
       "emailBrandName" TEXT,
       "emailBrandTagline" TEXT,
       "billplzApiKey" TEXT,
       "billplzXSignatureKey" TEXT,
       "billplzCollectionId" TEXT,
       "billplzSandbox" BOOLEAN NOT NULL DEFAULT FALSE,
       "metaAppId" TEXT,
       "metaAppSecret" TEXT,
       "metaConfigId" TEXT,
       "metaGraphVersion" TEXT,
       "metaRedirectUri" TEXT,
       "metaWebhookVerifyToken" TEXT,
       "automationWorkflowIdleHours" INTEGER NOT NULL DEFAULT 24,
       "automationWorkflowExpireHours" INTEGER NOT NULL DEFAULT 72,
       "freeTrialDurationDays" INTEGER NOT NULL DEFAULT 14,
       "expiredAccountCleanupDays" INTEGER NOT NULL DEFAULT 60,
       "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
       "rememberMeTimeoutMinutes" INTEGER NOT NULL DEFAULT 43200,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "smtpHost" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "smtpPort" INTEGER`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "smtpSecure" BOOLEAN NOT NULL DEFAULT FALSE`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "smtpUser" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "smtpPass" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "smtpFrom" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "supportEmail" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "emailBrandName" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "emailBrandTagline" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "billplzApiKey" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "billplzXSignatureKey" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "billplzCollectionId" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "billplzSandbox" BOOLEAN NOT NULL DEFAULT FALSE`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "metaAppId" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "metaAppSecret" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "metaConfigId" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "metaGraphVersion" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "metaRedirectUri" TEXT`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "metaWebhookVerifyToken" TEXT`);
  await execute(
    `ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "automationWorkflowIdleHours" INTEGER NOT NULL DEFAULT 24`
  );
  await execute(
    `ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "automationWorkflowExpireHours" INTEGER NOT NULL DEFAULT 72`
  );
  await execute(
    `ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "freeTrialDurationDays" INTEGER NOT NULL DEFAULT 14`
  );
  await execute(
    `ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "expiredAccountCleanupDays" INTEGER NOT NULL DEFAULT 60`
  );
  await execute(
    `ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 60`
  );
  await execute(
    `ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "rememberMeTimeoutMinutes" INTEGER NOT NULL DEFAULT 43200`
  );
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "smtpSecure" SET DEFAULT FALSE`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "billplzSandbox" SET DEFAULT FALSE`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "automationWorkflowIdleHours" SET DEFAULT 24`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "automationWorkflowExpireHours" SET DEFAULT 72`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "freeTrialDurationDays" SET DEFAULT 14`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "expiredAccountCleanupDays" SET DEFAULT 60`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "sessionTimeoutMinutes" SET DEFAULT 60`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "rememberMeTimeoutMinutes" SET DEFAULT 43200`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);
}

export async function ensureRememberSessionStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "RememberSession" (
       id TEXT PRIMARY KEY,
       "agentId" TEXT NOT NULL REFERENCES "Agent"(id) ON DELETE CASCADE,
       "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
       "tokenHash" TEXT NOT NULL UNIQUE,
       "expiresAt" TIMESTAMP(3) NOT NULL,
       "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`CREATE INDEX IF NOT EXISTS "RememberSession_agentId_expiresAt_idx" ON "RememberSession" ("agentId", "expiresAt")`);
  await execute(`CREATE INDEX IF NOT EXISTS "RememberSession_workspaceId_expiresAt_idx" ON "RememberSession" ("workspaceId", "expiresAt")`);
}

export async function ensurePlatformRememberSessionStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "PlatformRememberSession" (
       id TEXT PRIMARY KEY,
       "adminId" TEXT NOT NULL REFERENCES "PlatformAdmin"(id) ON DELETE CASCADE,
       "tokenHash" TEXT NOT NULL UNIQUE,
       "expiresAt" TIMESTAMP(3) NOT NULL,
       "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`CREATE INDEX IF NOT EXISTS "PlatformRememberSession_adminId_expiresAt_idx" ON "PlatformRememberSession" ("adminId", "expiresAt")`);
}

export async function upsertPlatformConfig(input: {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string | null;
  smtpFrom: string;
  supportEmail: string;
  emailBrandName: string;
  emailBrandTagline: string;
  billplzApiKey: string | null;
  billplzXSignatureKey: string | null;
  billplzCollectionId: string | null;
  billplzSandbox: boolean;
  metaAppId: string | null;
  metaAppSecret: string | null;
  metaConfigId: string | null;
  metaGraphVersion: string | null;
  metaRedirectUri: string | null;
  metaWebhookVerifyToken: string | null;
  automationWorkflowIdleHours: number;
  automationWorkflowExpireHours: number;
  freeTrialDurationDays: number;
  expiredAccountCleanupDays: number;
  sessionTimeoutMinutes: number;
  rememberMeTimeoutMinutes: number;
}) {
  return queryOne<PlatformConfigRow>(
    `INSERT INTO "PlatformConfig" (
        id, "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpPass",
        "smtpFrom", "supportEmail", "emailBrandName", "emailBrandTagline",
        "billplzApiKey", "billplzXSignatureKey", "billplzCollectionId", "billplzSandbox",
        "metaAppId", "metaAppSecret", "metaConfigId", "metaGraphVersion", "metaRedirectUri", "metaWebhookVerifyToken",
        "automationWorkflowIdleHours", "automationWorkflowExpireHours", "freeTrialDurationDays", "expiredAccountCleanupDays",
        "sessionTimeoutMinutes", "rememberMeTimeoutMinutes", "createdAt", "updatedAt"
      )
      VALUES (
        'platform', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        "smtpHost" = EXCLUDED."smtpHost",
        "smtpPort" = EXCLUDED."smtpPort",
        "smtpSecure" = EXCLUDED."smtpSecure",
        "smtpUser" = EXCLUDED."smtpUser",
        "smtpPass" = EXCLUDED."smtpPass",
        "smtpFrom" = EXCLUDED."smtpFrom",
        "supportEmail" = EXCLUDED."supportEmail",
        "emailBrandName" = EXCLUDED."emailBrandName",
        "emailBrandTagline" = EXCLUDED."emailBrandTagline",
        "billplzApiKey" = EXCLUDED."billplzApiKey",
        "billplzXSignatureKey" = EXCLUDED."billplzXSignatureKey",
        "billplzCollectionId" = EXCLUDED."billplzCollectionId",
        "billplzSandbox" = EXCLUDED."billplzSandbox",
        "metaAppId" = EXCLUDED."metaAppId",
        "metaAppSecret" = EXCLUDED."metaAppSecret",
        "metaConfigId" = EXCLUDED."metaConfigId",
        "metaGraphVersion" = EXCLUDED."metaGraphVersion",
        "metaRedirectUri" = EXCLUDED."metaRedirectUri",
        "metaWebhookVerifyToken" = EXCLUDED."metaWebhookVerifyToken",
        "automationWorkflowIdleHours" = EXCLUDED."automationWorkflowIdleHours",
        "automationWorkflowExpireHours" = EXCLUDED."automationWorkflowExpireHours",
        "freeTrialDurationDays" = EXCLUDED."freeTrialDurationDays",
        "expiredAccountCleanupDays" = EXCLUDED."expiredAccountCleanupDays",
        "sessionTimeoutMinutes" = EXCLUDED."sessionTimeoutMinutes",
        "rememberMeTimeoutMinutes" = EXCLUDED."rememberMeTimeoutMinutes",
        "updatedAt" = NOW()
      RETURNING *`,
    [
      input.smtpHost,
      input.smtpPort,
      input.smtpSecure,
      input.smtpUser,
      input.smtpPass,
      input.smtpFrom,
      input.supportEmail,
      input.emailBrandName,
      input.emailBrandTagline,
      input.billplzApiKey,
      input.billplzXSignatureKey,
      input.billplzCollectionId,
      input.billplzSandbox,
      input.metaAppId,
      input.metaAppSecret,
      input.metaConfigId,
      input.metaGraphVersion,
      input.metaRedirectUri,
      input.metaWebhookVerifyToken,
      input.automationWorkflowIdleHours,
      input.automationWorkflowExpireHours,
      input.freeTrialDurationDays,
      input.expiredAccountCleanupDays,
      input.sessionTimeoutMinutes,
      input.rememberMeTimeoutMinutes
    ]
  );
}

export async function upsertPlatformMetaConfig(input: {
  metaAppId: string | null;
  metaAppSecret: string | null;
  metaConfigId: string | null;
  metaGraphVersion: string | null;
  metaRedirectUri: string | null;
  metaWebhookVerifyToken: string | null;
}) {
  return queryOne<PlatformConfigRow>(
    `INSERT INTO "PlatformConfig" (
        id, "metaAppId", "metaAppSecret", "metaConfigId", "metaGraphVersion", "metaRedirectUri", "metaWebhookVerifyToken", "createdAt", "updatedAt"
      )
      VALUES (
        'platform', $1, $2, $3, $4, $5, $6, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        "metaAppId" = EXCLUDED."metaAppId",
        "metaAppSecret" = EXCLUDED."metaAppSecret",
        "metaConfigId" = EXCLUDED."metaConfigId",
        "metaGraphVersion" = EXCLUDED."metaGraphVersion",
        "metaRedirectUri" = EXCLUDED."metaRedirectUri",
        "metaWebhookVerifyToken" = EXCLUDED."metaWebhookVerifyToken",
        "updatedAt" = NOW()
      RETURNING *`,
    [
      input.metaAppId,
      input.metaAppSecret,
      input.metaConfigId,
      input.metaGraphVersion,
      input.metaRedirectUri,
      input.metaWebhookVerifyToken
    ]
  );
}

export async function createPendingWorkspaceCheckout(input: {
  plan: string;
  billingPeriod: string;
  name: string;
  email: string;
  workspaceName: string;
  passwordHash: string;
  billingName: string;
  billingPhoneNumber: string;
  billingAddressLine1: string;
  billingAddressLine2?: string | null;
  billingCity: string;
  billingState: string;
  billingPostcode: string;
  billingCountry: string;
  billingTaxId?: string | null;
  remember: boolean;
  provider: string;
  discountCode?: string | null;
  discountPercentage?: number | null;
  originalAmount?: number | null;
  finalAmount?: number | null;
  currency?: string | null;
}) {
  return queryOne<PendingWorkspaceCheckoutRow>(
    `INSERT INTO "PendingWorkspaceCheckout" (
        id, plan, "billingPeriod", name, email, "workspaceName", "passwordHash", "billingName",
        "billingPhoneNumber", "billingAddressLine1", "billingAddressLine2", "billingCity", "billingState",
        "billingPostcode", "billingCountry", "billingTaxId", remember, provider, "discountCode",
        "discountPercentage", "originalAmount", "finalAmount", currency, status, "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, 'PENDING', NOW(), NOW()
      )
      RETURNING *`,
    [
      createRecordId(),
      input.plan,
      input.billingPeriod,
      input.name,
      input.email,
      input.workspaceName,
      input.passwordHash,
      input.billingName,
      input.billingPhoneNumber,
      input.billingAddressLine1,
      input.billingAddressLine2 ?? null,
      input.billingCity,
      input.billingState,
      input.billingPostcode,
      input.billingCountry,
      input.billingTaxId ?? null,
      input.remember,
      input.provider,
      input.discountCode ?? null,
      input.discountPercentage ?? null,
      input.originalAmount ?? null,
      input.finalAmount ?? null,
      input.currency ?? null
    ]
  );
}

export async function updatePendingWorkspaceCheckoutProvider(input: {
  checkoutId: string;
  providerReference: string;
  providerCheckoutUrl: string;
}) {
  return queryOne<PendingWorkspaceCheckoutRow>(
    `UPDATE "PendingWorkspaceCheckout"
     SET "providerReference" = $2,
         "providerCheckoutUrl" = $3,
         "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [input.checkoutId, input.providerReference, input.providerCheckoutUrl]
  );
}

export async function findPendingWorkspaceCheckoutByProviderReference(providerReference: string) {
  return queryOne<PendingWorkspaceCheckoutRow>(
    `SELECT *
     FROM "PendingWorkspaceCheckout"
     WHERE "providerReference" = $1
     LIMIT 1`,
    [providerReference]
  );
}

export async function findPendingWorkspaceCheckoutByProviderReferenceForUpdate(
  providerReference: string,
  executor: DbExecutor
) {
  return queryOne<PendingWorkspaceCheckoutRow>(
    `SELECT *
     FROM "PendingWorkspaceCheckout"
     WHERE "providerReference" = $1
     LIMIT 1
     FOR UPDATE`,
    [providerReference],
    executor
  );
}

export async function updatePendingWorkspaceCheckoutStatus(input: {
  checkoutId: string;
  status: string;
  paidAt?: Date | null;
  workspaceId?: string | null;
  agentId?: string | null;
  completedAt?: Date | null;
  executor?: DbExecutor;
}) {
  return queryOne<PendingWorkspaceCheckoutRow>(
    `UPDATE "PendingWorkspaceCheckout"
     SET status = $2,
         "paidAt" = COALESCE($3, "paidAt"),
         "workspaceId" = COALESCE($4, "workspaceId"),
         "agentId" = COALESCE($5, "agentId"),
         "completedAt" = COALESCE($6, "completedAt"),
         "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      input.checkoutId,
      input.status,
      input.paidAt ?? null,
      input.workspaceId ?? null,
      input.agentId ?? null,
      input.completedAt ?? null
    ],
    input.executor
  );
}

export async function createPendingWorkspacePackageUpgrade(input: {
  workspaceId: string;
  requestedByAgentId: string;
  invoiceNumber: string;
  currentPlan: string;
  targetPlan: string;
  operationType?: string | null;
  billingPeriod?: string | null;
  provider?: string | null;
  status?: string;
  amount?: number | null;
  currency?: string | null;
  replacesId?: string | null;
  replacementReason?: string | null;
  executor?: DbExecutor;
}) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `INSERT INTO "PendingWorkspacePackageUpgrade" (
        id, "workspaceId", "requestedByAgentId", "invoiceNumber", "currentPlan", "targetPlan",
        "operationType", "billingPeriod", provider, amount, currency, status, "replacesId",
        "replacementReason", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      RETURNING *`,
    [
      createRecordId(),
      input.workspaceId,
      input.requestedByAgentId,
      input.invoiceNumber,
      input.currentPlan,
      input.targetPlan,
      input.operationType ?? null,
      input.billingPeriod ?? null,
      input.provider ?? null,
      input.amount ?? null,
      input.currency ?? null,
      input.status ?? "ISSUED",
      input.replacesId ?? null,
      input.replacementReason ?? null
    ],
    input.executor
  );
}

export async function findPendingWorkspacePackageUpgradeByIdForWorkspace(workspaceId: string, upgradeId: string) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `SELECT *
     FROM "PendingWorkspacePackageUpgrade"
     WHERE id = $1 AND "workspaceId" = $2
     LIMIT 1`,
    [upgradeId, workspaceId]
  );
}

export async function findPendingWorkspacePackageUpgradeByIdForWorkspaceForUpdate(
  workspaceId: string,
  upgradeId: string,
  executor: DbExecutor
) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `SELECT *
     FROM "PendingWorkspacePackageUpgrade"
     WHERE id = $1 AND "workspaceId" = $2
     LIMIT 1
     FOR UPDATE`,
    [upgradeId, workspaceId],
    executor
  );
}

export async function listPendingWorkspacePackageUpgradesByWorkspace(workspaceId: string) {
  return queryMany<PendingWorkspacePackageUpgradeRow>(
    `SELECT *
     FROM "PendingWorkspacePackageUpgrade"
     WHERE "workspaceId" = $1
     ORDER BY "createdAt" DESC`,
    [workspaceId]
  );
}

export async function listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(
  workspaceId: string,
  executor: DbExecutor
) {
  return queryMany<PendingWorkspacePackageUpgradeRow>(
    `SELECT *
     FROM "PendingWorkspacePackageUpgrade"
     WHERE "workspaceId" = $1
       AND status IN ('ISSUED', 'PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED')
     ORDER BY "createdAt" DESC
     FOR UPDATE`,
    [workspaceId],
    executor
  );
}

export async function updatePendingWorkspacePackageUpgradeProvider(input: {
  upgradeId: string;
  provider?: string | null;
  providerReference: string;
  providerCheckoutUrl: string;
  status?: string;
  paymentStartedAt?: Date | null;
  executor?: DbExecutor;
}) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `UPDATE "PendingWorkspacePackageUpgrade"
     SET provider = COALESCE($2, provider),
         "providerReference" = $3,
         "providerCheckoutUrl" = $4,
         status = COALESCE($5, status),
         "paymentStartedAt" = COALESCE($6, "paymentStartedAt"),
         "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      input.upgradeId,
      input.provider ?? null,
      input.providerReference,
      input.providerCheckoutUrl,
      input.status ?? null,
      input.paymentStartedAt ?? null
    ],
    input.executor
  );
}

export async function findPendingWorkspacePackageUpgradeByProviderReference(providerReference: string) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `SELECT *
     FROM "PendingWorkspacePackageUpgrade"
     WHERE "providerReference" = $1
     LIMIT 1`,
    [providerReference]
  );
}

export async function findPendingWorkspacePackageUpgradeByProviderReferenceForUpdate(
  providerReference: string,
  executor: DbExecutor
) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `SELECT *
     FROM "PendingWorkspacePackageUpgrade"
     WHERE "providerReference" = $1
     LIMIT 1
     FOR UPDATE`,
    [providerReference],
    executor
  );
}

export async function updatePendingWorkspacePackageUpgradeStatus(input: {
  upgradeId: string;
  status: string;
  paidAt?: Date | null;
  receiptNumber?: string | null;
  receiptIssuedAt?: Date | null;
  cancelledAt?: Date | null;
  completedAt?: Date | null;
  replacedById?: string | null;
  replacementReason?: string | null;
  executor?: DbExecutor;
}) {
  return queryOne<PendingWorkspacePackageUpgradeRow>(
    `UPDATE "PendingWorkspacePackageUpgrade"
	     SET status = $2,
	         "paidAt" = COALESCE($3, "paidAt"),
             "receiptNumber" = COALESCE($4, "receiptNumber"),
             "receiptIssuedAt" = COALESCE($5, "receiptIssuedAt"),
	         "cancelledAt" = COALESCE($6, "cancelledAt"),
	         "completedAt" = COALESCE($7, "completedAt"),
	         "replacedById" = COALESCE($8, "replacedById"),
	         "replacementReason" = COALESCE($9, "replacementReason"),
	         "updatedAt" = NOW()
	     WHERE id = $1
	     RETURNING *`,
    [
	      input.upgradeId,
	      input.status,
	      input.paidAt ?? null,
      input.receiptNumber ?? null,
      input.receiptIssuedAt ?? null,
	      input.cancelledAt ?? null,
	      input.completedAt ?? null,
	      input.replacedById ?? null,
      input.replacementReason ?? null
    ],
    input.executor
  );
}

async function runPendingWorkspacePackageUpgradeStoreMigrations() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "PendingWorkspacePackageUpgrade" (
       id TEXT PRIMARY KEY,
       "workspaceId" TEXT NOT NULL,
       "requestedByAgentId" TEXT NOT NULL,
       "invoiceNumber" TEXT,
       "currentPlan" TEXT NOT NULL,
       "targetPlan" TEXT NOT NULL,
       "billingPeriod" TEXT,
       provider TEXT,
       "providerReference" TEXT,
       "providerCheckoutUrl" TEXT,
       amount DECIMAL(10, 2),
       currency TEXT,
       status TEXT NOT NULL DEFAULT 'PENDING',
       "paidAt" TIMESTAMP(3),
       "cancelledAt" TIMESTAMP(3),
       "completedAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "requestedByAgentId" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "currentPlan" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "targetPlan" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "operationType" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS provider TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "providerReference" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "providerCheckoutUrl" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS amount DECIMAL(10, 2)`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS currency TEXT`);
	  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ISSUED'`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3)`);
	  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3)`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3)`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3)`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "replacedById" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "replacesId" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "replacementReason" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "paymentStartedAt" TIMESTAMP(3)`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`UPDATE "PendingWorkspacePackageUpgrade" SET status = 'ISSUED' WHERE status = 'PENDING'`);
  await execute(
    `UPDATE "PendingWorkspacePackageUpgrade"
     SET "operationType" = CASE
       WHEN "targetPlan" = "currentPlan" THEN 'RENEWAL'
       WHEN "targetPlan" = 'starter' AND "currentPlan" <> 'starter' AND status = 'SCHEDULED' THEN 'DOWNGRADE'
       ELSE 'UPGRADE'
     END
     WHERE "operationType" IS NULL`
  );
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PendingWorkspacePackageUpgrade" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);

  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_invoiceNumber_key"
     ON "PendingWorkspacePackageUpgrade" ("invoiceNumber")
     WHERE "invoiceNumber" IS NOT NULL`
  );
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_providerReference_key"
     ON "PendingWorkspacePackageUpgrade" ("providerReference")
     WHERE "providerReference" IS NOT NULL`
  );
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_receiptNumber_key"
     ON "PendingWorkspacePackageUpgrade" ("receiptNumber")`
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_workspaceId_status_idx"
     ON "PendingWorkspacePackageUpgrade" ("workspaceId", status)`
  );
  const activePlanChangeIndex = await queryOne<{ indexdef: string }>(
    `SELECT indexdef
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'PendingWorkspacePackageUpgrade'
       AND indexname = 'PendingWorkspacePackageUpgrade_one_active_plan_change_idx'
     LIMIT 1`
  );
  const activePlanChangeIndexIncludesFailedStatus =
    activePlanChangeIndex?.indexdef.includes("'PAYMENT_FAILED'::text") ?? false;

  if (!activePlanChangeIndexIncludesFailedStatus) {
    await execute(`DROP INDEX IF EXISTS "PendingWorkspacePackageUpgrade_one_active_plan_change_idx"`);
    await execute(
      `CREATE UNIQUE INDEX "PendingWorkspacePackageUpgrade_one_active_plan_change_idx"
       ON "PendingWorkspacePackageUpgrade" ("workspaceId")
       WHERE status IN ('ISSUED', 'PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED')`
    );
  }
  await execute(
    `CREATE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_requestedByAgentId_createdAt_idx"
     ON "PendingWorkspacePackageUpgrade" ("requestedByAgentId", "createdAt")`
  );
}

export async function ensurePendingWorkspacePackageUpgradeStore() {
  if (pendingWorkspacePackageUpgradeStoreReady) {
    return;
  }

  if (!pendingWorkspacePackageUpgradeStorePromise) {
    pendingWorkspacePackageUpgradeStorePromise = runPendingWorkspacePackageUpgradeStoreMigrations()
      .then(() => {
        pendingWorkspacePackageUpgradeStoreReady = true;
      })
      .catch((error) => {
        pendingWorkspacePackageUpgradeStorePromise = null;
        throw error;
      });
  }

  await pendingWorkspacePackageUpgradeStorePromise;
}

export async function findPlatformPackageConfigs() {
  return queryMany<PlatformPackageConfigRow>(
    `SELECT
       id,
       "platformId",
       "packageKey",
       "isVisible",
       "displayOrder",
       "priceAmount",
       "yearlyDiscountPercentage",
       "mediaLibraryStorageLimitBytes"::TEXT AS "mediaLibraryStorageLimitBytes",
       "maxOutboundMessages",
       "maxActiveContacts",
       "maxActiveAutomations",
       "maxWhatsAppCampaigns",
       "createdAt",
       "updatedAt"
     FROM "PlatformPackageConfig"
     WHERE "platformId" = 'platform'
     ORDER BY "displayOrder" ASC, "createdAt" ASC`
  );
}

export async function ensurePlatformPackageConfigStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "PlatformPackageConfig" (
       id TEXT PRIMARY KEY,
       "platformId" TEXT NOT NULL DEFAULT 'platform',
       "packageKey" TEXT NOT NULL,
       "isVisible" BOOLEAN NOT NULL DEFAULT TRUE,
       "displayOrder" INTEGER NOT NULL DEFAULT 0,
       "priceAmount" DECIMAL(10, 2),
       "yearlyDiscountPercentage" DECIMAL(5, 2) NOT NULL DEFAULT 0,
       "mediaLibraryStorageLimitBytes" BIGINT,
       "maxOutboundMessages" INTEGER,
       "maxActiveContacts" INTEGER,
       "maxActiveAutomations" INTEGER,
       "maxWhatsAppCampaigns" INTEGER,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "platformId" TEXT NOT NULL DEFAULT 'platform'`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "isVisible" BOOLEAN NOT NULL DEFAULT TRUE`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "priceAmount" DECIMAL(10, 2)`);
  await execute(
    `ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "yearlyDiscountPercentage" DECIMAL(5, 2) NOT NULL DEFAULT 0`
  );
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "mediaLibraryStorageLimitBytes" BIGINT`);
  await execute(
    `ALTER TABLE "PlatformPackageConfig"
     ALTER COLUMN "mediaLibraryStorageLimitBytes" TYPE BIGINT`
  );
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "maxOutboundMessages" INTEGER`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "maxActiveContacts" INTEGER`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "maxActiveAutomations" INTEGER`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "maxWhatsAppCampaigns" INTEGER`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformPackageConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);

  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PlatformPackageConfig_packageKey_key"
     ON "PlatformPackageConfig" ("packageKey")`
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "PlatformPackageConfig_platformId_displayOrder_idx"
     ON "PlatformPackageConfig" ("platformId", "displayOrder")`
  );
}

export async function upsertPlatformPackageConfig(input: {
  packageKey: string;
  isVisible: boolean;
  displayOrder: number;
  priceAmount: string | null;
  yearlyDiscountPercentage: string;
  mediaLibraryStorageLimitBytes: number | null;
  maxOutboundMessages: number | null;
  maxActiveContacts: number | null;
  maxActiveAutomations: number | null;
  maxWhatsAppCampaigns: number | null;
}) {
  return queryOne<PlatformPackageConfigRow>(
    `INSERT INTO "PlatformPackageConfig" (
        id, "platformId", "packageKey", "isVisible", "displayOrder", "priceAmount", "yearlyDiscountPercentage", "mediaLibraryStorageLimitBytes", "maxOutboundMessages", "maxActiveContacts", "maxActiveAutomations", "maxWhatsAppCampaigns", "createdAt", "updatedAt"
      )
      VALUES ($1, 'platform', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      ON CONFLICT ("packageKey") DO UPDATE SET
        "isVisible" = EXCLUDED."isVisible",
        "displayOrder" = EXCLUDED."displayOrder",
        "priceAmount" = EXCLUDED."priceAmount",
        "yearlyDiscountPercentage" = EXCLUDED."yearlyDiscountPercentage",
        "mediaLibraryStorageLimitBytes" = EXCLUDED."mediaLibraryStorageLimitBytes",
        "maxOutboundMessages" = EXCLUDED."maxOutboundMessages",
        "maxActiveContacts" = EXCLUDED."maxActiveContacts",
        "maxActiveAutomations" = EXCLUDED."maxActiveAutomations",
        "maxWhatsAppCampaigns" = EXCLUDED."maxWhatsAppCampaigns",
        "updatedAt" = NOW()
      RETURNING
        id,
        "platformId",
        "packageKey",
        "isVisible",
        "displayOrder",
        "priceAmount",
        "yearlyDiscountPercentage",
        "mediaLibraryStorageLimitBytes"::TEXT AS "mediaLibraryStorageLimitBytes",
        "maxOutboundMessages",
        "maxActiveContacts",
        "maxActiveAutomations",
        "maxWhatsAppCampaigns",
        "createdAt",
        "updatedAt"`,
    [
      createRecordId(),
      input.packageKey,
      input.isVisible,
      input.displayOrder,
      input.priceAmount,
      input.yearlyDiscountPercentage,
      input.mediaLibraryStorageLimitBytes,
      input.maxOutboundMessages,
      input.maxActiveContacts,
      input.maxActiveAutomations,
      input.maxWhatsAppCampaigns
    ]
  );
}

export async function findPlatformDiscountCodes() {
  return queryMany<PlatformDiscountCodeRow>(
    `SELECT *
     FROM "PlatformDiscountCode"
     WHERE "platformId" = 'platform'
     ORDER BY "createdAt" DESC, code ASC`
  );
}

export async function findPlatformDiscountCodeById(id: string) {
  return queryOne<PlatformDiscountCodeRow>(
    `SELECT *
     FROM "PlatformDiscountCode"
     WHERE id = $1 AND "platformId" = 'platform'
     LIMIT 1`,
    [id]
  );
}

export async function findPlatformDiscountCodeByCode(code: string) {
  return queryOne<PlatformDiscountCodeRow>(
    `SELECT *
     FROM "PlatformDiscountCode"
     WHERE code = $1 AND "platformId" = 'platform'
     LIMIT 1`,
    [code]
  );
}

export async function findPlatformDiscountCodeByCodeForUpdate(code: string, executor: DbExecutor) {
  return queryOne<PlatformDiscountCodeRow>(
    `SELECT *
     FROM "PlatformDiscountCode"
     WHERE code = $1 AND "platformId" = 'platform'
     LIMIT 1
     FOR UPDATE`,
    [code],
    executor
  );
}

export async function ensurePlatformDiscountCodeStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "PlatformDiscountCode" (
       id TEXT PRIMARY KEY,
       "platformId" TEXT NOT NULL DEFAULT 'platform',
       code TEXT NOT NULL,
       percentage INTEGER NOT NULL,
       "amountOff" DECIMAL(10, 2),
       "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
       "expiresAt" TIMESTAMP(3),
       "redeemedAt" TIMESTAMP(3),
       "redeemedByName" TEXT,
       "redeemedByEmail" TEXT,
       "redeemedByWorkspaceName" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "platformId" TEXT NOT NULL DEFAULT 'platform'`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS code TEXT`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS percentage INTEGER NOT NULL DEFAULT 0`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "amountOff" DECIMAL(10, 2)`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "redeemedAt" TIMESTAMP(3)`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "redeemedByName" TEXT`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "redeemedByEmail" TEXT`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "redeemedByWorkspaceName" TEXT`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`);
  await execute(`ALTER TABLE "PlatformDiscountCode" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);

  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PlatformDiscountCode_code_key"
     ON "PlatformDiscountCode" (code)`
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "PlatformDiscountCode_platformId_createdAt_idx"
     ON "PlatformDiscountCode" ("platformId", "createdAt")`
  );
}

export async function ensurePendingWorkspaceCheckoutDiscountColumns() {
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingPeriod" "BillingPeriod"`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingName" TEXT NOT NULL DEFAULT ''`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingPhoneNumber" TEXT NOT NULL DEFAULT ''`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingAddressLine1" TEXT NOT NULL DEFAULT ''`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingAddressLine2" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingCity" TEXT NOT NULL DEFAULT ''`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingState" TEXT NOT NULL DEFAULT ''`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingPostcode" TEXT NOT NULL DEFAULT ''`);
  await execute(
    `ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingCountry" TEXT NOT NULL DEFAULT 'Malaysia'`
  );
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "billingTaxId" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "discountCode" TEXT`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "discountPercentage" INTEGER`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "originalAmount" DECIMAL(10, 2)`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS "finalAmount" DECIMAL(10, 2)`);
  await execute(`ALTER TABLE "PendingWorkspaceCheckout" ADD COLUMN IF NOT EXISTS currency TEXT`);
}

async function upsertPackageRecord(input: {
  packageCode: string;
  packageName: string;
  packageDescription?: string | null;
  packagePriceAmount?: number | null;
  packageCurrency?: string | null;
  packageBillingPeriod?: string | null;
}, executor: DbExecutor) {
  return queryOne<PackageRow>(
    `INSERT INTO "Package" (
       id, code, name, description, "priceAmount", currency, "billingPeriod", "isActive", "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       "priceAmount" = EXCLUDED."priceAmount",
       currency = EXCLUDED.currency,
       "billingPeriod" = EXCLUDED."billingPeriod",
       "isActive" = TRUE,
       "updatedAt" = NOW()
     RETURNING *`,
    [
      createRecordId(),
      input.packageCode,
      input.packageName,
      input.packageDescription ?? null,
      input.packagePriceAmount ?? null,
      input.packageCurrency ?? null,
      input.packageBillingPeriod ?? null
    ],
    executor
  );
}

export async function createWorkspacePackageSubscription(input: {
  workspaceId: string;
  packageCode: string;
  packageName: string;
  packageDescription?: string | null;
  packagePriceAmount?: number | null;
  packageCurrency?: string | null;
  packageBillingPeriod?: string | null;
  subscriptionPriceAmount?: number | null;
  subscriptionBillingPeriod?: string | null;
  subscriptionStatus: string;
  subscriptionNextBillingAt?: Date | null;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  autoRenew?: boolean;
  executor: DbExecutor;
}) {
  await execute(
    `ALTER TABLE "WorkspacePackageSubscription" ADD COLUMN IF NOT EXISTS "trialStartedAt" TIMESTAMP(3)`,
    [],
    input.executor
  );
  await execute(
    `ALTER TABLE "WorkspacePackageSubscription" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3)`,
    [],
    input.executor
  );
  await execute(
    `ALTER TABLE "WorkspacePackageSubscription" ADD COLUMN IF NOT EXISTS "autoRenew" BOOLEAN NOT NULL DEFAULT TRUE`,
    [],
    input.executor
  );
  const packageRecord = await upsertPackageRecord(input, input.executor);

  if (!packageRecord) {
    throw new Error("Unable to create package catalog record.");
  }

  return queryOne<WorkspacePackageSubscriptionRow>(
    `INSERT INTO "WorkspacePackageSubscription" (
       id, "workspaceId", "packageId", status, "subscribedPrice", currency, "billingPeriod",
       "startedAt", "trialStartedAt", "trialEndsAt", "nextBillingAt", "autoRenew", "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, NOW(), NOW())
     RETURNING *`,
    [
      createRecordId(),
      input.workspaceId,
      packageRecord.id,
      input.subscriptionStatus,
      input.subscriptionPriceAmount ?? input.packagePriceAmount ?? null,
      input.packageCurrency ?? null,
      input.subscriptionBillingPeriod ?? input.packageBillingPeriod ?? null,
      input.trialStartedAt ?? null,
      input.trialEndsAt ?? null,
      input.subscriptionNextBillingAt ?? null,
      input.autoRenew ?? true
    ],
    input.executor
  );
}

export async function findCurrentWorkspacePackageSubscriptionForUpdate(workspaceId: string, executor: DbExecutor) {
  return queryOne<WorkspacePackageSubscriptionWithPackageRow>(
    `SELECT s.*, p.code AS "packageCode", p.name AS "packageName"
     FROM "WorkspacePackageSubscription" s
     INNER JOIN "Package" p ON p.id = s."packageId"
     WHERE s."workspaceId" = $1
       AND s.status IN ('PENDING', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED')
     ORDER BY
       CASE WHEN s.status IN ('PENDING', 'TRIAL', 'ACTIVE', 'PAST_DUE') AND s."endedAt" IS NULL THEN 0 ELSE 1 END,
       s."startedAt" DESC
     LIMIT 1
     FOR UPDATE`,
    [workspaceId],
    executor
  );
}

export async function endWorkspacePackageSubscription(input: {
  subscriptionId: string;
  status: string;
  endedAt: Date;
  executor: DbExecutor;
}) {
  return queryOne<WorkspacePackageSubscriptionRow>(
    `UPDATE "WorkspacePackageSubscription"
     SET status = $2,
         "endedAt" = $3,
         "cancelledAt" = $3,
         "nextBillingAt" = NULL,
         "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [input.subscriptionId, input.status, input.endedAt],
    input.executor
  );
}

export async function createPlatformDiscountCode(input: {
  code: string;
  percentage: number;
  amountOff?: number | null;
  expiresAt?: Date | null;
}) {
  return queryOne<PlatformDiscountCodeRow>(
    `INSERT INTO "PlatformDiscountCode" (
        id, "platformId", code, percentage, "amountOff", "isActive", "expiresAt", "createdAt", "updatedAt"
      )
      VALUES ($1, 'platform', $2, $3, $4, TRUE, $5, NOW(), NOW())
      RETURNING *`,
    [createRecordId(), input.code, input.percentage, input.amountOff ?? null, input.expiresAt ?? null]
  );
}

export async function updatePlatformDiscountCode(input: {
  id: string;
  code: string;
  percentage: number;
  amountOff?: number | null;
  expiresAt?: Date | null;
}) {
  return queryOne<PlatformDiscountCodeRow>(
    `UPDATE "PlatformDiscountCode"
     SET code = $2,
         percentage = $3,
         "amountOff" = $4,
         "expiresAt" = $5,
         "updatedAt" = NOW()
     WHERE id = $1 AND "platformId" = 'platform'
     RETURNING *`,
    [input.id, input.code, input.percentage, input.amountOff ?? null, input.expiresAt ?? null]
  );
}

export async function redeemPlatformDiscountCode(input: {
  id: string;
  redeemedAt: Date;
  redeemedByName?: string | null;
  redeemedByEmail?: string | null;
  redeemedByWorkspaceName?: string | null;
  executor?: DbExecutor;
}) {
  return queryOne<PlatformDiscountCodeRow>(
    `UPDATE "PlatformDiscountCode"
     SET "redeemedAt" = COALESCE("redeemedAt", $2),
         "redeemedByName" = COALESCE("redeemedByName", $3),
         "redeemedByEmail" = COALESCE("redeemedByEmail", $4),
         "redeemedByWorkspaceName" = COALESCE("redeemedByWorkspaceName", $5),
         "updatedAt" = NOW()
     WHERE id = $1 AND "platformId" = 'platform'
     RETURNING *`,
    [
      input.id,
      input.redeemedAt,
      input.redeemedByName ?? null,
      input.redeemedByEmail ?? null,
      input.redeemedByWorkspaceName ?? null
    ],
    input.executor
  );
}

export async function deletePlatformDiscountCode(id: string) {
  return queryOne<PlatformDiscountCodeRow>(
    `DELETE FROM "PlatformDiscountCode"
     WHERE id = $1 AND "platformId" = 'platform'
     RETURNING *`,
    [id]
  );
}

export async function deactivatePlatformDiscountCode(id: string) {
  return queryOne<PlatformDiscountCodeRow>(
    `UPDATE "PlatformDiscountCode"
     SET "isActive" = FALSE,
         "updatedAt" = NOW()
     WHERE id = $1 AND "platformId" = 'platform'
     RETURNING *`,
    [id]
  );
}

export async function activatePlatformDiscountCode(id: string) {
  return queryOne<PlatformDiscountCodeRow>(
    `UPDATE "PlatformDiscountCode"
     SET "isActive" = TRUE,
         "updatedAt" = NOW()
     WHERE id = $1 AND "platformId" = 'platform'
     RETURNING *`,
    [id]
  );
}

export async function findAgentByIdWithWorkspace(agentId: string) {
  try {
    return await queryOne<VerificationAgentRow>(
      `SELECT
          a.id,
          a.name,
          a.email,
          COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt") AS "emailVerifiedAt",
          w.name AS "workspaceName"
        FROM "Agent" a
        JOIN "Workspace" w ON w.id = a."workspaceId"
        LEFT JOIN "Account" ac
          ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
        WHERE a.id = $1
        LIMIT 1`,
      [agentId]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return queryOne<VerificationAgentRow>(
        `SELECT
            a.id,
            a.name,
            a.email,
            a."emailVerifiedAt",
            w.name AS "workspaceName"
          FROM "Agent" a
          JOIN "Workspace" w ON w.id = a."workspaceId"
          WHERE a.id = $1
          LIMIT 1`,
        [agentId]
      );
    }

    throw error;
  }
}

export async function findAgentVerificationStatus(agentId: string) {
  try {
    return await queryOne<Pick<AgentRow, "id" | "emailVerifiedAt">>(
      `SELECT
          a.id,
          COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt") AS "emailVerifiedAt"
       FROM "Agent" a
       LEFT JOIN "Account" ac
         ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
       WHERE a.id = $1
       LIMIT 1`,
      [agentId]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return queryOne<Pick<AgentRow, "id" | "emailVerifiedAt">>(
        `SELECT id, "emailVerifiedAt"
         FROM "Agent"
         WHERE id = $1
         LIMIT 1`,
        [agentId]
      );
    }

    throw error;
  }
}

export async function deleteVerificationTokensByAgentId(agentId: string) {
  await execute(`DELETE FROM "EmailVerificationToken" WHERE "agentId" = $1`, [agentId]);
}

export async function createVerificationTokenRecord(input: {
  agentId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return queryOne<VerificationTokenRow>(
    `INSERT INTO "EmailVerificationToken" (id, "agentId", "tokenHash", "expiresAt")
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [createRecordId(), input.agentId, input.tokenHash, input.expiresAt]
  );
}

export async function findVerificationTokenWithAgent(tokenHash: string) {
  return queryOne<VerificationTokenWithAgentRow>(
    `SELECT
        t.id,
        t."agentId",
        t."tokenHash",
        t."expiresAt",
        t."createdAt",
        row_to_json(a) AS agent
      FROM "EmailVerificationToken" t
      JOIN "Agent" a ON a.id = t."agentId"
      WHERE t."tokenHash" = $1
      LIMIT 1`,
    [tokenHash]
  );
}

export async function deleteVerificationTokenById(tokenId: string) {
  await execute(`DELETE FROM "EmailVerificationToken" WHERE id = $1`, [tokenId]);
}

export async function deletePasswordResetTokensByEmail(email: string, executor?: DbExecutor) {
  await ensurePasswordResetTokenStore();
  await execute(`DELETE FROM "PasswordResetToken" WHERE email = $1`, [email], executor);
}

export async function ensurePasswordResetTokenStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
       id TEXT PRIMARY KEY,
       email TEXT NOT NULL,
       "tokenHash" TEXT NOT NULL UNIQUE,
       "expiresAt" TIMESTAMP(3) NOT NULL,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(`ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS email TEXT`);
  await execute(`ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT`);
  await execute(`ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`);
  await execute(
    `ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );
  await execute(`ALTER TABLE "PasswordResetToken" ALTER COLUMN email SET NOT NULL`);
  await execute(`ALTER TABLE "PasswordResetToken" ALTER COLUMN "tokenHash" SET NOT NULL`);
  await execute(`ALTER TABLE "PasswordResetToken" ALTER COLUMN "expiresAt" SET NOT NULL`);
  await execute(`ALTER TABLE "PasswordResetToken" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`);
  await execute(`CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken" ("tokenHash")`);
  await execute(
    `CREATE INDEX IF NOT EXISTS "PasswordResetToken_email_expiresAt_idx"
     ON "PasswordResetToken" (email, "expiresAt")`
  );
}

export async function createPasswordResetTokenRecord(input: {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  await ensurePasswordResetTokenStore();

  return queryOne<PasswordResetTokenRow>(
    `INSERT INTO "PasswordResetToken" (id, email, "tokenHash", "expiresAt")
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [createRecordId(), input.email, input.tokenHash, input.expiresAt]
  );
}

export async function findPasswordResetToken(tokenHash: string) {
  await ensurePasswordResetTokenStore();

  return queryOne<PasswordResetTokenRow>(
    `SELECT *
     FROM "PasswordResetToken"
     WHERE "tokenHash" = $1
     LIMIT 1`,
    [tokenHash]
  );
}

export async function deletePasswordResetTokenById(tokenId: string, executor?: DbExecutor) {
  await ensurePasswordResetTokenStore();
  await execute(`DELETE FROM "PasswordResetToken" WHERE id = $1`, [tokenId], executor);
}

export async function consumePasswordResetToken(tokenHash: string) {
  await ensurePasswordResetTokenStore();

  return transaction(async (client) => {
    const record = await queryOne<PasswordResetTokenRow>(
      `SELECT *
       FROM "PasswordResetToken"
       WHERE "tokenHash" = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
      client
    );

    if (!record) {
      return null;
    }

    await execute(`DELETE FROM "PasswordResetToken" WHERE id = $1`, [record.id], client);
    return record;
  });
}

export async function updatePasswordForEmail(input: {
  email: string;
  passwordHash: string;
}) {
  await transaction(async (client) => {
    await execute(
      `UPDATE "Agent"
       SET "passwordHash" = $2, "updatedAt" = NOW()
       WHERE email = $1`,
      [input.email, input.passwordHash],
      client
    );

    try {
      await execute(
        `UPDATE "Account"
         SET "passwordHash" = $2, "updatedAt" = NOW()
         WHERE email = $1`,
        [input.email, input.passwordHash],
        client
      );
    } catch (error) {
      if (!isMissingAccountTableError(error)) {
        throw error;
      }
    }

    await deleteSessionsByEmail(input.email, client);
    await deletePasswordResetTokensByEmail(input.email, client);
  });
}

export async function findAgentCredentialById(agentId: string) {
  try {
    return await queryOne<AgentCredentialRow>(
      `SELECT
          a.id,
          a."accountId",
          a.email,
          a.name,
          a."workspaceId",
          a.role,
          COALESCE(ac."passwordHash", a."passwordHash") AS "effectivePasswordHash",
          CASE
            WHEN ac."passwordHash" IS NOT NULL THEN ac."updatedAt"
            WHEN a."passwordHash" IS NOT NULL THEN a."updatedAt"
            ELSE NULL
          END AS "passwordLastUpdatedAt"
        FROM "Agent" a
        LEFT JOIN "Account" ac
          ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
        WHERE a.id = $1
        LIMIT 1`,
      [agentId]
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return queryOne<AgentCredentialRow>(
        `SELECT
            id,
            "accountId",
            email,
            name,
            "workspaceId",
            role,
            "passwordHash" AS "effectivePasswordHash",
            CASE
              WHEN "passwordHash" IS NOT NULL THEN "updatedAt"
              ELSE NULL
            END AS "passwordLastUpdatedAt"
          FROM "Agent"
          WHERE id = $1
          LIMIT 1`,
        [agentId]
      );
    }

    throw error;
  }
}

export async function listPlatformUserSecurityRows() {
  try {
    return await queryMany<PlatformUserSecurityRow>(
      `SELECT
          a.id,
          a."accountId",
          a."workspaceId",
          w.name AS "workspaceName",
          w.slug AS "workspaceSlug",
          w.plan AS "workspacePlan",
          a.name,
          a.email,
          a.role,
          a.status,
          a.phone,
          COALESCE(ac."emailVerifiedAt", a."emailVerifiedAt") AS "emailVerifiedAt",
          a."inviteAcceptedAt",
          COALESCE(ac."lastLoginAt", a."lastLoginAt") AS "lastLoginAt",
          CASE
            WHEN ac."passwordHash" IS NOT NULL THEN ac."updatedAt"
            WHEN a."passwordHash" IS NOT NULL THEN a."updatedAt"
            ELSE NULL
          END AS "passwordLastUpdatedAt",
          a."createdAt",
          a."updatedAt"
        FROM "Agent" a
        JOIN "Workspace" w ON w.id = a."workspaceId"
        LEFT JOIN "Account" ac
          ON ac.id = a."accountId" OR (a."accountId" IS NULL AND ac.email = a.email)
        ORDER BY a."createdAt" DESC, a.id DESC`
    );
  } catch (error) {
    if (isMissingAccountTableError(error)) {
      return queryMany<PlatformUserSecurityRow>(
        `SELECT
            a.id,
            a."accountId",
            a."workspaceId",
            w.name AS "workspaceName",
            w.slug AS "workspaceSlug",
            w.plan AS "workspacePlan",
            a.name,
            a.email,
            a.role,
            a.status,
            a.phone,
            a."emailVerifiedAt",
            a."inviteAcceptedAt",
            a."lastLoginAt",
            CASE
              WHEN a."passwordHash" IS NOT NULL THEN a."updatedAt"
              ELSE NULL
            END AS "passwordLastUpdatedAt",
            a."createdAt",
            a."updatedAt"
          FROM "Agent" a
          JOIN "Workspace" w ON w.id = a."workspaceId"
          ORDER BY a."createdAt" DESC, a.id DESC`
      );
    }

    throw error;
  }
}

export async function findPlatformUserSecurityRow(agentId: string) {
  const rows = await listPlatformUserSecurityRows();
  return rows.find((row) => row.id === agentId) ?? null;
}

export async function ensureUserSecurityAuditLogStore() {
  await execute(
    `CREATE TABLE IF NOT EXISTS "UserSecurityAuditLog" (
       id TEXT PRIMARY KEY,
       "agentId" TEXT NOT NULL REFERENCES "Agent"(id) ON DELETE CASCADE,
       "adminId" TEXT REFERENCES "PlatformAdmin"(id) ON DELETE SET NULL,
       "eventType" TEXT NOT NULL,
       "metadataJson" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await execute(
    `CREATE INDEX IF NOT EXISTS "UserSecurityAuditLog_agentId_createdAt_idx"
     ON "UserSecurityAuditLog" ("agentId", "createdAt" DESC)`
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "UserSecurityAuditLog_eventType_createdAt_idx"
     ON "UserSecurityAuditLog" ("eventType", "createdAt" DESC)`
  );
}

export async function createUserSecurityAuditLog(input: {
  agentId: string;
  adminId?: string | null;
  eventType: string;
  metadataJson?: string | null;
}) {
  await ensureUserSecurityAuditLogStore();

  return queryOne<UserSecurityAuditLogRow>(
    `INSERT INTO "UserSecurityAuditLog" (id, "agentId", "adminId", "eventType", "metadataJson")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [createRecordId(), input.agentId, input.adminId ?? null, input.eventType, input.metadataJson ?? null]
  );
}

export async function listUserSecurityAuditLogs(agentId: string) {
  await ensureUserSecurityAuditLogStore();

  return queryMany<UserSecurityAuditLogRow>(
    `SELECT *
     FROM "UserSecurityAuditLog"
     WHERE "agentId" = $1
     ORDER BY "createdAt" DESC, id DESC`,
    [agentId]
  );
}

export async function markAgentEmailVerified(agentId: string) {
  await execute(`UPDATE "Agent" SET "emailVerifiedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [agentId]);
}

export async function verifyAgentEmailAndClearTokens(agentId: string) {
  await transaction(async (client) => {
    const agent = await queryOne<Pick<AgentRow, "email">>(
      `SELECT email
       FROM "Agent"
       WHERE id = $1
       LIMIT 1`,
      [agentId],
      client
    );

    await execute(
      `UPDATE "Agent"
       SET "emailVerifiedAt" = NOW(), "updatedAt" = NOW()
       WHERE email = $1`,
      [agent?.email ?? ""],
      client
    );

    try {
      await execute(
        `UPDATE "Account"
         SET "emailVerifiedAt" = NOW(), "updatedAt" = NOW()
         WHERE email = $1`,
        [agent?.email ?? ""],
        client
      );
    } catch (error) {
      if (!isMissingAccountTableError(error)) {
        throw error;
      }
    }

    await execute(`DELETE FROM "EmailVerificationToken" WHERE "agentId" = $1`, [agentId], client);
  });
}

export async function findAgentInWorkspaceByEmail(workspaceId: string, email: string) {
  return queryOne<Pick<AgentRow, "id">>(
    `SELECT id
     FROM "Agent"
     WHERE "workspaceId" = $1 AND email = $2
     LIMIT 1`,
    [workspaceId, email]
  );
}

export async function findAnyAgentByEmail(email: string) {
  return queryOne<Pick<AgentRow, "id">>(
    `SELECT id
     FROM "Agent"
     WHERE email = $1
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [email]
  );
}

export async function createAgentRecord(input: {
  accountId?: string | null;
  workspaceId: string;
  name: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt?: Date | null;
  inviteAcceptedAt?: Date | null;
  role: string;
  status: string;
}) {
  return queryOne<AgentRow>(
    `INSERT INTO "Agent" (
       id, "accountId", "workspaceId", name, email, "passwordHash", "emailVerifiedAt",
       "inviteAcceptedAt", role, status, "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     RETURNING *`,
    [
      createRecordId(),
      input.accountId ?? null,
      input.workspaceId,
      input.name,
      input.email,
      input.passwordHash,
      input.emailVerifiedAt ?? null,
      input.inviteAcceptedAt ?? null,
      input.role,
      input.status
    ]
  );
}

async function createWorkspaceAndManagerWithExecutor(
  input: {
    accountId?: string | null;
    workspaceName: string;
    slug: string;
    plan: string;
    trialEndsAt: Date | null;
    subscriptionNextBillingAt?: Date | null;
    packageCode: string;
    packageName: string;
    packageDescription?: string | null;
    packagePriceAmount?: number | null;
    packageCurrency?: string | null;
    packageBillingPeriod?: string | null;
    subscriptionPriceAmount?: number | null;
    subscriptionBillingPeriod?: string | null;
    subscriptionStatus: string;
    agentName: string;
    agentEmail: string;
    passwordHash: string;
    role: string;
    status: string;
  },
  executor: DbExecutor
) {
  const workspace = await queryOne<WorkspaceRow>(
    `INSERT INTO "Workspace" (id, name, slug, plan, "trialEndsAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [createRecordId(), input.workspaceName, input.slug, input.plan, input.trialEndsAt],
    executor
  );

  if (!workspace) {
    throw new Error("Unable to create workspace.");
  }

  const subscription = await createWorkspacePackageSubscription({
    workspaceId: workspace.id,
    packageCode: input.packageCode,
    packageName: input.packageName,
    packageDescription: input.packageDescription,
    packagePriceAmount: input.packagePriceAmount,
    packageCurrency: input.packageCurrency,
    packageBillingPeriod: input.packageBillingPeriod,
    subscriptionPriceAmount: input.subscriptionPriceAmount,
    subscriptionBillingPeriod: input.subscriptionBillingPeriod,
    subscriptionStatus: input.subscriptionStatus,
    subscriptionNextBillingAt: input.subscriptionNextBillingAt ?? input.trialEndsAt,
    trialStartedAt: input.subscriptionStatus === "TRIAL" ? new Date() : null,
    trialEndsAt: input.subscriptionStatus === "TRIAL" ? input.trialEndsAt : null,
    autoRenew: input.subscriptionStatus !== "TRIAL",
    executor
  });

  const agent = await queryOne<AgentRow>(
    `INSERT INTO "Agent" (
       id, "accountId", "workspaceId", name, email, "passwordHash", "inviteAcceptedAt", role, status, "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, NOW(), NOW())
     RETURNING *`,
    [
      createRecordId(),
      input.accountId ?? null,
      workspace.id,
      input.agentName,
      input.agentEmail,
      input.passwordHash,
      input.role,
      input.status
    ],
    executor
  );

  if (!agent) {
    throw new Error("Unable to create workspace owner.");
  }

  return { workspace, agent, subscription };
}

export async function createWorkspaceAndManager(input: {
  accountId?: string | null;
  workspaceName: string;
  slug: string;
  plan: string;
  trialEndsAt: Date | null;
  subscriptionNextBillingAt?: Date | null;
  packageCode: string;
  packageName: string;
  packageDescription?: string | null;
  packagePriceAmount?: number | null;
  packageCurrency?: string | null;
  packageBillingPeriod?: string | null;
  subscriptionPriceAmount?: number | null;
  subscriptionBillingPeriod?: string | null;
  subscriptionStatus: string;
  agentName: string;
  agentEmail: string;
  passwordHash: string;
  role: string;
  status: string;
  executor?: DbExecutor;
}) {
  if (input.executor) {
    return createWorkspaceAndManagerWithExecutor(input, input.executor);
  }

  return transaction(async (client) => createWorkspaceAndManagerWithExecutor(input, client));
}

export async function deletePendingInvitesByWorkspaceEmail(workspaceId: string, email: string) {
  await execute(
    `DELETE FROM "Invite"
     WHERE "workspaceId" = $1 AND email = $2 AND "acceptedAt" IS NULL`,
    [workspaceId, email]
  );
}

export async function createInviteRecord(input: {
  workspaceId: string;
  invitedById: string;
  email: string;
  role: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return queryOne<InviteRow>(
    `INSERT INTO "Invite" (id, "workspaceId", email, role, "tokenHash", "expiresAt", "invitedById")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      createRecordId(),
      input.workspaceId,
      input.email,
      input.role,
      input.tokenHash,
      input.expiresAt,
      input.invitedById
    ]
  );
}

export async function listPendingInvites(workspaceId: string) {
  return queryMany<InviteRow>(
    `SELECT *
     FROM "Invite"
     WHERE "workspaceId" = $1 AND "acceptedAt" IS NULL
     ORDER BY "createdAt" DESC`,
    [workspaceId]
  );
}

export async function findValidInviteByTokenHash(tokenHash: string) {
  return queryOne<InviteWithContextRow>(
    `SELECT
        i.*,
        w.name AS "workspaceName",
        a.name AS "invitedByName"
      FROM "Invite" i
      JOIN "Workspace" w ON w.id = i."workspaceId"
      JOIN "Agent" a ON a.id = i."invitedById"
      WHERE i."tokenHash" = $1
        AND i."acceptedAt" IS NULL
        AND i."expiresAt" > NOW()
      LIMIT 1`,
    [tokenHash]
  );
}

export async function findPendingInviteById(workspaceId: string, inviteId: string) {
  return queryOne<InviteRow>(
    `SELECT *
     FROM "Invite"
     WHERE id = $1 AND "workspaceId" = $2 AND "acceptedAt" IS NULL
     LIMIT 1`,
    [inviteId, workspaceId]
  );
}

export async function deleteInviteById(inviteId: string) {
  await execute(`DELETE FROM "Invite" WHERE id = $1`, [inviteId]);
}

export async function acceptInviteAndCreateAgent(input: {
  inviteId: string;
  accountId?: string | null;
  workspaceId: string;
  name: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt?: Date | null;
  role: string;
  status: string;
}) {
  return transaction(async (client) => {
    const agent = await queryOne<AgentRow>(
      `INSERT INTO "Agent" (
         id, "accountId", "workspaceId", name, email, "passwordHash", "emailVerifiedAt",
         "inviteAcceptedAt", role, status, "createdAt", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        createRecordId(),
        input.accountId ?? null,
        input.workspaceId,
        input.name,
        input.email,
        input.passwordHash,
        input.emailVerifiedAt ?? new Date(),
        input.role,
        input.status
      ],
      client
    );

    await execute(
      `UPDATE "Invite"
       SET "acceptedAt" = NOW()
       WHERE id = $1`,
      [input.inviteId],
      client
    );

    return agent;
  });
}

export async function findWorkspaceWithAgentCount(workspaceId: string) {
  return queryOne<WorkspaceWithCountsRow>(
    `SELECT
        w.*,
        COUNT(a.id)::int AS "agentCount"
      FROM "Workspace" w
      LEFT JOIN "Agent" a ON a."workspaceId" = w.id
      WHERE w.id = $1
      GROUP BY w.id`,
    [workspaceId]
  );
}

export async function countPendingInvites(workspaceId: string, excludeInviteEmail?: string) {
  const values: unknown[] = [workspaceId];
  let emailSql = "";

  if (excludeInviteEmail) {
    values.push(excludeInviteEmail);
    emailSql = ` AND email <> $${values.length}`;
  }

  const result = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM "Invite"
     WHERE "workspaceId" = $1
       AND "acceptedAt" IS NULL
       AND "expiresAt" > NOW()${emailSql}`,
    values
  );

  return result?.count ?? 0;
}

export async function listWorkspaceAgents(workspaceId: string) {
  return queryMany<TeamAgentRow>(
    `SELECT *
     FROM "Agent"
     WHERE "workspaceId" = $1
     ORDER BY "createdAt" ASC`,
    [workspaceId]
  );
}

export async function findTeamMember(workspaceId: string, agentId: string) {
  return queryOne<TeamAgentRow>(
    `SELECT *
     FROM "Agent"
     WHERE id = $1 AND "workspaceId" = $2
     LIMIT 1`,
    [agentId, workspaceId]
  );
}

export async function countWorkspaceManagers(workspaceId: string) {
  const result = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM "Agent"
     WHERE "workspaceId" = $1 AND role = 'MANAGER'`,
    [workspaceId]
  );

  return result?.count ?? 0;
}

export async function updateTeamMember(agentId: string, input: { role: string; status: string; phone?: string | null }) {
  return queryOne<TeamAgentRow>(
    `UPDATE "Agent"
     SET role = $2, status = $3, phone = $4, "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [agentId, input.role, input.status, input.phone?.trim() || null]
  );
}

export async function deleteTeamMember(agentId: string) {
  await execute(`DELETE FROM "Agent" WHERE id = $1`, [agentId]);
}
