import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAppBaseUrl } from "@/lib/app-url";

const BILLING_REMINDER_LINK_SCOPE = "billing-reminder-manage";
const BILLING_REMINDER_LINK_VERSION = 1;
const BILLING_REMINDER_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type BillingReminderLinkClaims = {
  scope: typeof BILLING_REMINDER_LINK_SCOPE;
  version: typeof BILLING_REMINDER_LINK_VERSION;
  recipientAgentId: string;
  recipientAccountId: string | null;
  recipientEmailHash: string;
  workspaceId: string;
  subscriptionId: string;
  issuedAt: number;
  expiresAt: number;
};

type BillingReminderRecipient = {
  agentId: string;
  accountId: string | null;
  email: string;
  workspaceId: string;
};

type BillingReminderLinkOptions = {
  now?: Date;
  secret?: string;
};

function getSigningSecret(secret?: string) {
  const resolvedSecret = secret?.trim() || process.env.APP_ENCRYPTION_KEY?.trim();

  if (!resolvedSecret) {
    throw new Error("APP_ENCRYPTION_KEY is required for billing reminder links.");
  }

  return resolvedSecret;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashEmail(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("base64url");
}

function signPayload(encodedPayload: string, secret?: string) {
  return createHmac("sha256", getSigningSecret(secret)).update(encodedPayload).digest("base64url");
}

function hasValidClaimsShape(value: unknown): value is BillingReminderLinkClaims {
  if (!value || typeof value !== "object") {
    return false;
  }

  const claims = value as Partial<BillingReminderLinkClaims>;
  return (
    claims.scope === BILLING_REMINDER_LINK_SCOPE &&
    claims.version === BILLING_REMINDER_LINK_VERSION &&
    typeof claims.recipientAgentId === "string" &&
    claims.recipientAgentId.length > 0 &&
    (claims.recipientAccountId === null || typeof claims.recipientAccountId === "string") &&
    typeof claims.recipientEmailHash === "string" &&
    claims.recipientEmailHash.length > 0 &&
    typeof claims.workspaceId === "string" &&
    claims.workspaceId.length > 0 &&
    typeof claims.subscriptionId === "string" &&
    claims.subscriptionId.length > 0 &&
    typeof claims.issuedAt === "number" &&
    Number.isFinite(claims.issuedAt) &&
    typeof claims.expiresAt === "number" &&
    Number.isFinite(claims.expiresAt) &&
    claims.expiresAt > claims.issuedAt
  );
}

export function createBillingReminderManageToken(
  input: {
    recipientAgentId: string;
    recipientAccountId: string | null;
    recipientEmail: string;
    workspaceId: string;
    subscriptionId: string;
  },
  options?: BillingReminderLinkOptions
) {
  const issuedAt = (options?.now ?? new Date()).getTime();
  const claims: BillingReminderLinkClaims = {
    scope: BILLING_REMINDER_LINK_SCOPE,
    version: BILLING_REMINDER_LINK_VERSION,
    recipientAgentId: input.recipientAgentId,
    recipientAccountId: input.recipientAccountId,
    recipientEmailHash: hashEmail(input.recipientEmail),
    workspaceId: input.workspaceId,
    subscriptionId: input.subscriptionId,
    issuedAt,
    expiresAt: issuedAt + BILLING_REMINDER_LINK_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, options?.secret)}`;
}

export function createBillingReminderManageUrl(
  input: Parameters<typeof createBillingReminderManageToken>[0],
  options?: BillingReminderLinkOptions & { appBaseUrl?: string }
) {
  const token = createBillingReminderManageToken(input, options);
  const appBaseUrl = (options?.appBaseUrl ?? getAppBaseUrl()).replace(/\/$/, "");
  return `${appBaseUrl}/account-settings/billing/manage?token=${encodeURIComponent(token)}`;
}

export function verifyBillingReminderManageToken(
  token: string,
  options?: BillingReminderLinkOptions
):
  | { ok: true; claims: BillingReminderLinkClaims }
  | { ok: false; reason: "invalid" | "expired" } {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "invalid" };
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return { ok: false, reason: "invalid" };
  }

  const expectedSignature = signPayload(encodedPayload, options?.secret);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "invalid" };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!hasValidClaimsShape(claims)) {
    return { ok: false, reason: "invalid" };
  }

  if (claims.expiresAt <= (options?.now ?? new Date()).getTime()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims };
}

export function resolveBillingReminderAccess(
  claims: BillingReminderLinkClaims,
  recipient: BillingReminderRecipient | null
):
  | { status: "login_required" }
  | { status: "invalid_recipient" }
  | { status: "allowed"; requiresWorkspaceSwitch: boolean } {
  if (!recipient) {
    return { status: "login_required" };
  }

  const matchesAccount = claims.recipientAccountId
    ? recipient.accountId === claims.recipientAccountId
    : recipient.agentId === claims.recipientAgentId;
  const matchesEmail = hashEmail(recipient.email) === claims.recipientEmailHash;

  if (!matchesAccount || !matchesEmail) {
    return { status: "invalid_recipient" };
  }

  return {
    status: "allowed",
    requiresWorkspaceSwitch:
      recipient.agentId !== claims.recipientAgentId || recipient.workspaceId !== claims.workspaceId
  };
}
