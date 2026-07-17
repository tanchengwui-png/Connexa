import assert from "node:assert/strict";
import test from "node:test";
import {
  getPasswordResetTokenStatus,
  requestPasswordReset,
  resetPasswordWithToken
} from "@/lib/auth/password-reset";
import {
  PASSWORD_RESET_GENERIC_MESSAGE,
  getPasswordResetTokenErrorMessage,
  getPasswordResetTokenExpiredMessage,
  normalizePasswordResetEmail,
  validatePasswordResetEmail,
  validatePasswordResetForm
} from "@/lib/auth/password-reset-shared";

test("normalizePasswordResetEmail trims and lowercases the input", () => {
  assert.equal(normalizePasswordResetEmail("  OWNER@Example.COM "), "owner@example.com");
});

test("validatePasswordResetEmail requires a value", () => {
  assert.deepEqual(validatePasswordResetEmail("   "), {
    ok: false,
    error: "Email is required."
  });
});

test("validatePasswordResetEmail rejects malformed addresses", () => {
  assert.deepEqual(validatePasswordResetEmail("owner"), {
    ok: false,
    error: "Enter a valid email address."
  });
});

test("validatePasswordResetForm requires a password", () => {
  assert.deepEqual(validatePasswordResetForm("", ""), {
    ok: false,
    error: "New password is required."
  });
});

test("validatePasswordResetForm requires matching passwords", () => {
  assert.deepEqual(validatePasswordResetForm("password123", "password456"), {
    ok: false,
    error: "Passwords do not match."
  });
});

test("requestPasswordReset returns the generic message when no matching account exists", async () => {
  let placeholderCalled = false;

  const result = await requestPasswordReset(
    { email: "missing@example.com" },
    {
      findAgentsByEmailImpl: async () => [],
      sendPasswordResetInstructionsImpl: async () => {
        placeholderCalled = true;
      }
    }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.message, PASSWORD_RESET_GENERIC_MESSAGE);
  assert.equal(placeholderCalled, false);
});

test("requestPasswordReset keeps the response generic when an account exists", async () => {
  let placeholderInput: { email: string; workspaceCount: number; resetUrl: string } | null = null;
  let createdTokenRecord: { email: string; tokenHash: string; expiresAt: Date } | null = null;

  const result = await requestPasswordReset(
    { email: " Manager@Example.com " },
    {
      findAgentsByEmailImpl: async () => [
        {
          id: "agent-1",
          workspaceId: "workspace-1",
          email: "manager@example.com",
          phone: null,
          workspaceName: "Workspace One",
          workspaceSlug: "workspace-one",
          role: "MANAGER",
          accountId: null,
          passwordHash: null,
          effectivePasswordHash: null,
          emailVerifiedAt: null,
          effectiveEmailVerifiedAt: null,
          name: "Manager One",
          inviteAcceptedAt: null,
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null
        }
      ],
      createPasswordResetTokenRecordImpl: async (input) => {
        createdTokenRecord = input;
        return {
          id: "token-1",
          ...input,
          createdAt: new Date()
        };
      },
      deletePasswordResetTokensByEmailImpl: async () => undefined,
      getBaseUrlImpl: () => "https://connexa.example.com",
      sendPasswordResetInstructionsImpl: async (input) => {
        placeholderInput = input;
      }
    }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.message, PASSWORD_RESET_GENERIC_MESSAGE);
  assert.ok(placeholderInput);
  assert.ok(createdTokenRecord);
  const sentInput = placeholderInput as { email: string; workspaceCount: number; resetUrl: string };
  const tokenRecord = createdTokenRecord as { email: string; tokenHash: string; expiresAt: Date };
  assert.equal(sentInput.email, "manager@example.com");
  assert.equal(sentInput.workspaceCount, 1);
  assert.equal(typeof sentInput.resetUrl, "string");
  assert.equal(Boolean(sentInput.resetUrl.includes("/reset-password?token=")), true);
  assert.equal(tokenRecord.email, "manager@example.com");
  assert.equal(typeof tokenRecord.tokenHash, "string");
});

test("getPasswordResetTokenStatus rejects missing token", async () => {
  const result = await getPasswordResetTokenStatus("");

  assert.deepEqual(result, {
    ok: false,
    error: getPasswordResetTokenErrorMessage()
  });
});

test("getPasswordResetTokenStatus reports expired tokens", async () => {
  let deletedTokenId: string | null = null;

  const result = await getPasswordResetTokenStatus("abc123", {
    findPasswordResetTokenImpl: async () => ({
      id: "token-1",
      email: "manager@example.com",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date()
    }),
    deletePasswordResetTokenByIdImpl: async (tokenId) => {
      deletedTokenId = tokenId;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    error: getPasswordResetTokenExpiredMessage()
  });
  assert.equal(deletedTokenId, "token-1");
});

test("resetPasswordWithToken updates the password for a valid token", async () => {
  let updatedPassword: { email: string; passwordHash: string } | null = null;

  const result = await resetPasswordWithToken(
    {
      token: "abc123",
      password: "new-password-123",
      confirmPassword: "new-password-123"
    },
    {
      findPasswordResetTokenImpl: async () => ({
        id: "token-1",
        email: "manager@example.com",
        tokenHash: "hashed",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date()
      }),
      consumePasswordResetTokenImpl: async () => ({
        id: "token-1",
        email: "manager@example.com",
        tokenHash: "hashed",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date()
      }),
      logUserSecurityEventImpl: async () => undefined,
      updatePasswordForEmailImpl: async (input) => {
        updatedPassword = input;
      }
    }
  );

  assert.deepEqual(result, {
    success: true
  });
  assert.ok(updatedPassword);
  const passwordUpdate = updatedPassword as { email: string; passwordHash: string };
  assert.equal(passwordUpdate.email, "manager@example.com");
  assert.equal(typeof passwordUpdate.passwordHash, "string");
  assert.notEqual(passwordUpdate.passwordHash, "new-password-123");
});
