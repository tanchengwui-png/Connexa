import assert from "node:assert/strict";
import test from "node:test";
import { changeCurrentUserPassword } from "@/lib/auth/change-password";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

test("Change Password works for the logged-in user", async () => {
  let updatedPassword: { email: string; passwordHash: string } | null = null;
  const auditEvents: string[] = [];

  const result = await changeCurrentUserPassword(
    {
      agentId: "agent-1",
      currentPassword: "current-password-123",
      newPassword: "new-password-123",
      confirmNewPassword: "new-password-123"
    },
    {
      getCurrentUserPasswordContextImpl: async () => ({
        id: "agent-1",
        accountId: "account-1",
        email: "aisyah@example.com",
        name: "Aisyah",
        workspaceId: "workspace-1",
        role: "MANAGER",
        effectivePasswordHash: hashPassword("current-password-123"),
        passwordLastUpdatedAt: new Date()
      }),
      updatePasswordForEmailImpl: async (input) => {
        updatedPassword = input;
      },
      logUserSecurityEventImpl: async (input) => {
        auditEvents.push(input.eventType);
      }
    }
  );

  assert.deepEqual(result, { ok: true });
  assert.ok(updatedPassword);
  const passwordUpdate = updatedPassword as { email: string; passwordHash: string };
  assert.equal(passwordUpdate.email, "aisyah@example.com");
  assert.notEqual(passwordUpdate.passwordHash, "new-password-123");
  assert.equal(verifyPassword("new-password-123", passwordUpdate.passwordHash), true);
  assert.deepEqual(auditEvents, ["password_change_success"]);
});
