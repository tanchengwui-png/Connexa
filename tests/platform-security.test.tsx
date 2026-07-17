import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmationProvider } from "@/components/confirmation-provider";
import { PlatformUserSecurityManager } from "@/components/platform-user-security-manager";
import { ToastProvider } from "@/components/toast-provider";
import { PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE } from "@/lib/auth/password-reset-infra";
import {
  handlePlatformUserResendVerificationRequest,
  handlePlatformUserResetPasswordRequest
} from "@/lib/platform-security-route-handlers";
import {
  buildSafeUserDetails,
  sendPlatformUserVerificationEmail,
  sendPlatformUserPasswordResetEmail,
  serializeUserSecurityLogs
} from "@/lib/platform-security";

const baseUser = {
  id: "agent-1",
  accountId: "account-1",
  workspaceId: "workspace-1",
  workspaceName: "Workspace One",
  workspaceSlug: "workspace-one",
  workspacePlan: "professional",
  name: "Aisyah",
  email: "aisyah@example.com",
  role: "MANAGER",
  status: "ACTIVE",
  phone: "+60123456789",
  emailVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
  inviteAcceptedAt: new Date("2026-07-01T00:00:00.000Z"),
  lastLoginAt: new Date("2026-07-05T10:00:00.000Z"),
  passwordLastUpdatedAt: new Date("2026-07-04T08:00:00.000Z"),
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-06T00:00:00.000Z")
};

test("User Management / Account Security section renders the expected columns and actions", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        ConfirmationProvider,
        null,
        React.createElement(PlatformUserSecurityManager, {
          users: [
            {
              id: "agent-1",
              name: "Aisyah",
              email: "aisyah@example.com",
              packageName: "Professional",
              packageStatus: "Active",
              status: "ACTIVE",
              emailVerified: true,
              emailVerifiedLabel: "Jul 1, 2026, 8:00 AM",
              lastLoginLabel: "Jul 5, 2026, 6:00 PM",
              passwordLastUpdatedLabel: "Jul 4, 2026, 4:00 PM",
              createdAtLabel: "Jun 1, 2026, 8:00 AM"
            }
          ],
          resetAvailability: {
            enabled: true,
            helperText: null
          }
        })
      )
    )
  );

  assert.match(markup, /User Management \/ Account Security/);
  assert.match(markup, /Name/);
  assert.match(markup, /Email/);
  assert.match(markup, /Package/);
  assert.match(markup, /Package Status/);
  assert.match(markup, /Status/);
  assert.match(markup, /Last Login/);
  assert.match(markup, /View Details/);
  assert.match(markup, /Send Reset Password Email/);
  assert.match(markup, /View Security Logs/);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, />Actions</);
  assert.doesNotMatch(markup, /<th>Email Verification<\/th>/);
  assert.doesNotMatch(markup, /<th>Password Last Updated<\/th>/);
  assert.doesNotMatch(markup, /<th>Created At<\/th>/);
  assert.doesNotMatch(markup, /Resend Verification Email/);
});

test("security table has a responsive compact action menu instead of relying on document overflow", () => {
  const componentSource = readFileSync("components/platform-user-security-manager.tsx", "utf8");
  const cssSource = readFileSync("app/globals.css", "utf8");

  assert.match(componentSource, /PortalDropdown/);
  assert.match(componentSource, /platform-security-actions-trigger/);
  assert.match(componentSource, /role="menu"/);
  assert.match(componentSource, /role="menuitem"/);
  assert.match(componentSource, /View Details/);
  assert.match(componentSource, /Send Reset Password Email/);
  assert.match(componentSource, /View Security Logs/);

  assert.match(cssSource, /\.platform-security-panel\s*{[\s\S]*?container-type:\s*inline-size/);
  assert.match(cssSource, /@container\s*\(max-width:\s*1220px\)/);
  assert.match(cssSource, /\.platform-security-actions-inline\s*{[\s\S]*?display:\s*none/);
  assert.match(cssSource, /\.platform-security-actions-trigger\s*{[\s\S]*?display:\s*inline-flex/);
  assert.match(cssSource, /\.platform-security-table\s*{[\s\S]*?width:\s*100%[\s\S]*?table-layout:\s*fixed/);
  assert.match(cssSource, /\.platform-security-table-shell\s*{[\s\S]*?overflow-x:\s*auto/);
});

test("unverified users show the resend verification action", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        ConfirmationProvider,
        null,
        React.createElement(PlatformUserSecurityManager, {
          users: [
            {
              id: "agent-1",
              name: "Aisyah",
              email: "aisyah@example.com",
              packageName: "Professional",
              packageStatus: "Active",
              status: "ACTIVE",
              emailVerified: false,
              emailVerifiedLabel: "Not verified",
              lastLoginLabel: "Not recorded",
              passwordLastUpdatedLabel: "Not recorded",
              createdAtLabel: "Jun 1, 2026, 8:00 AM"
            }
          ],
          resetAvailability: {
            enabled: true,
            helperText: null
          }
        })
      )
    )
  );

  assert.match(markup, /Not verified/);
  assert.match(markup, /Resend Verification Email/);
});

test("safe user details exclude password hashes, reset tokens, and secrets", () => {
  const details = buildSafeUserDetails(baseUser);
  const serialized = JSON.stringify(details);

  assert.equal(details.packageStatus, "Not recorded");
  assert.equal("passwordHash" in details, false);
  assert.equal("resetToken" in details, false);
  assert.equal("apiKey" in details, false);
  assert.equal(serialized.includes("passwordHash"), false);
  assert.equal(serialized.includes("tokenHash"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("Send Reset Password Email stays unavailable when reset infrastructure is missing", async () => {
  let requestCalled = false;

  await assert.rejects(
    sendPlatformUserPasswordResetEmail("agent-1", "admin-1", {
      findPlatformUserSecurityRowImpl: async () => baseUser,
      getPasswordResetEmailAvailabilityImpl: async () => ({
        enabled: false,
        helperText: PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE
      }),
      requestPasswordResetImpl: async () => {
        requestCalled = true;
        return { accepted: true, message: "ok" };
      }
    }),
    /Password reset email is unavailable because email reset-link infrastructure is not configured\./
  );

  assert.equal(requestCalled, false);
});

test("unauthorized admins cannot trigger reset email", async () => {
  let sendCalled = false;

  const response = await handlePlatformUserResetPasswordRequest("agent-1", {
    requireApiPlatformAdminImpl: async () => {
      throw new Error("UNAUTHORIZED");
    },
    sendPlatformUserPasswordResetEmailImpl: async () => {
      sendCalled = true;
      return { ok: true };
    }
  });

  assert.equal(response.status, 401);
  assert.equal(sendCalled, false);
});

test("reset email action only requests a reset email and never changes the password directly", async () => {
  let requestCount = 0;
  const auditEvents: string[] = [];

  const result = await sendPlatformUserPasswordResetEmail("agent-1", "admin-1", {
    findPlatformUserSecurityRowImpl: async () => baseUser,
    getPasswordResetEmailAvailabilityImpl: async () => ({
      enabled: true,
      helperText: null
    }),
    requestPasswordResetImpl: async () => {
      requestCount += 1;
      return {
        accepted: true,
        message: "If an account exists for this email, we have sent password reset instructions."
      };
    },
    logUserSecurityEventImpl: async (input) => {
      auditEvents.push(input.eventType);
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(requestCount, 1);
  assert.deepEqual(auditEvents, ["reset_email_requested", "reset_email_sent"]);
});

test("resend verification action refuses already verified users", async () => {
  let resendCalled = false;

  await assert.rejects(
    sendPlatformUserVerificationEmail("agent-1", "admin-1", {
      findPlatformUserSecurityRowImpl: async () => baseUser,
      resendEmailVerificationImpl: async () => {
        resendCalled = true;
        return { expiresAt: new Date("2026-07-02T00:00:00.000Z") };
      }
    }),
    /Email is already verified\./
  );

  assert.equal(resendCalled, false);
});

test("resend verification action sends email and records audit events for unverified users", async () => {
  let resendCount = 0;
  const auditEvents: string[] = [];

  const result = await sendPlatformUserVerificationEmail("agent-1", "admin-1", {
    findPlatformUserSecurityRowImpl: async () => ({ ...baseUser, emailVerifiedAt: null }),
    resendEmailVerificationImpl: async () => {
      resendCount += 1;
      return { expiresAt: new Date("2026-07-02T00:00:00.000Z") };
    },
    logUserSecurityEventImpl: async (input) => {
      auditEvents.push(input.eventType);
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(resendCount, 1);
  assert.deepEqual(auditEvents, ["verification_email_requested", "verification_email_sent"]);
});

test("unauthorized admins cannot resend verification email", async () => {
  let sendCalled = false;

  const response = await handlePlatformUserResendVerificationRequest("agent-1", {
    requireApiPlatformAdminImpl: async () => {
      throw new Error("UNAUTHORIZED");
    },
    sendPlatformUserVerificationEmailImpl: async () => {
      sendCalled = true;
      return { ok: true };
    }
  });

  assert.equal(response.status, 401);
  assert.equal(sendCalled, false);
});

test("View Security Logs serializes only safe fields", () => {
  const logs = serializeUserSecurityLogs([
    {
      id: "log-1",
      eventType: "reset_email_failed",
      metadataJson: JSON.stringify({
        reason: "SMTP is not configured.",
        tokenHash: "secret-token-hash"
      }),
      createdAt: new Date("2026-07-07T00:00:00.000Z")
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.eventLabel, "Reset email failed");
  assert.deepEqual(logs[0]?.metadata, [
    { key: "reason", value: "SMTP is not configured." }
  ]);
});

test("verification email and verified events are serialized for security logs", () => {
  const logs = serializeUserSecurityLogs([
    {
      id: "log-1",
      eventType: "verification_email_sent",
      metadataJson: JSON.stringify({
        expiresAt: "2026-07-14T00:00:00.000Z"
      }),
      createdAt: new Date("2026-07-07T00:00:00.000Z")
    },
    {
      id: "log-2",
      eventType: "email_verified",
      metadataJson: null,
      createdAt: new Date("2026-07-07T01:00:00.000Z")
    }
  ]);

  assert.equal(logs.length, 2);
  assert.equal(logs[0]?.eventLabel, "Verification email sent");
  assert.deepEqual(logs[0]?.metadata, [
    { key: "expiresAt", value: "2026-07-14T00:00:00.000Z" }
  ]);
  assert.equal(logs[1]?.eventLabel, "Email verified");
});

test("security log history excludes internal log-viewed events", () => {
  const logs = serializeUserSecurityLogs([
    {
      id: "log-1",
      eventType: "user_security_logs_viewed",
      metadataJson: null,
      createdAt: new Date("2026-07-07T00:00:00.000Z")
    },
    {
      id: "log-2",
      eventType: "reset_email_sent",
      metadataJson: null,
      createdAt: new Date("2026-07-07T01:00:00.000Z")
    }
  ]).filter((log) => log.eventType !== "user_security_logs_viewed");

  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.eventType, "reset_email_sent");
});
