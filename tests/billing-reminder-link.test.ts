import assert from "node:assert/strict";
import test from "node:test";
import {
  createBillingReminderManageToken,
  createBillingReminderManageUrl,
  resolveBillingReminderAccess,
  verifyBillingReminderManageToken
} from "../lib/billing-reminder-link";
import { getSafeReturnTo } from "../lib/auth/return-to";

const secret = "billing-reminder-link-test-secret";
const issuedAt = new Date("2026-08-20T00:00:00.000Z");

function createToken() {
  return createBillingReminderManageToken(
    {
      recipientAgentId: "agent_manager",
      recipientAccountId: "account_owner",
      recipientEmail: "owner@connexa.test",
      workspaceId: "workspace_1",
      subscriptionId: "subscription_1"
    },
    { now: issuedAt, secret }
  );
}

test("billing reminder Manage Plan URL contains a signed recipient token", () => {
  const url = createBillingReminderManageUrl(
    {
      recipientAgentId: "agent_manager",
      recipientAccountId: "account_owner",
      recipientEmail: "owner@connexa.test",
      workspaceId: "workspace_1",
      subscriptionId: "subscription_1"
    },
    { appBaseUrl: "https://connexa.test/", now: issuedAt, secret }
  );

  assert.match(url, /^https:\/\/connexa\.test\/account-settings\/billing\/manage\?token=/);
  const token = new URL(url).searchParams.get("token");
  assert.ok(token);
  assert.equal(verifyBillingReminderManageToken(token, { now: issuedAt, secret }).ok, true);
});

test("matching account can continue and switch to the reminder workspace", () => {
  const verification = verifyBillingReminderManageToken(createToken(), { now: issuedAt, secret });
  assert.equal(verification.ok, true);
  if (!verification.ok) return;

  assert.deepEqual(
    resolveBillingReminderAccess(verification.claims, {
      agentId: "agent_other_workspace",
      accountId: "account_owner",
      email: "OWNER@connexa.test",
      workspaceId: "workspace_2"
    }),
    { status: "allowed", requiresWorkspaceSwitch: true }
  );
});

test("different logged-in account is rejected", () => {
  const verification = verifyBillingReminderManageToken(createToken(), { now: issuedAt, secret });
  assert.equal(verification.ok, true);
  if (!verification.ok) return;

  assert.deepEqual(
    resolveBillingReminderAccess(verification.claims, {
      agentId: "agent_intruder",
      accountId: "account_intruder",
      email: "intruder@connexa.test",
      workspaceId: "workspace_1"
    }),
    { status: "invalid_recipient" }
  );
});

test("signed-out visitor is required to log in", () => {
  const verification = verifyBillingReminderManageToken(createToken(), { now: issuedAt, secret });
  assert.equal(verification.ok, true);
  if (!verification.ok) return;

  assert.deepEqual(resolveBillingReminderAccess(verification.claims, null), {
    status: "login_required"
  });
});

test("expired and tampered billing reminder tokens are rejected", () => {
  const token = createToken();
  const expired = verifyBillingReminderManageToken(token, {
    now: new Date("2026-08-28T00:00:00.000Z"),
    secret
  });
  assert.deepEqual(expired, { ok: false, reason: "expired" });

  const [payload, signature] = token.split(".");
  const tamperedSignature = `${signature?.slice(0, -1)}${signature?.endsWith("a") ? "b" : "a"}`;
  const tampered = verifyBillingReminderManageToken(`${payload}.${tamperedSignature}`, {
    now: issuedAt,
    secret
  });
  assert.deepEqual(tampered, { ok: false, reason: "invalid" });
});

test("login return paths accept local paths and reject external redirects", () => {
  assert.equal(
    getSafeReturnTo("/account-settings/billing/manage?token=signed"),
    "/account-settings/billing/manage?token=signed"
  );
  assert.equal(getSafeReturnTo("https://evil.test", "/inbox"), "/inbox");
  assert.equal(getSafeReturnTo("//evil.test", "/inbox"), "/inbox");
  assert.equal(getSafeReturnTo("/\\evil.test", "/inbox"), "/inbox");
});
