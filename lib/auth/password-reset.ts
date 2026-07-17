import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { renderEmailTemplate } from "@/lib/email-template";
import { hashPassword } from "@/lib/auth/password";
import {
  PASSWORD_RESET_GENERIC_MESSAGE,
  PASSWORD_RESET_TOKEN_EXPIRED_MESSAGE,
  PASSWORD_RESET_TOKEN_INVALID_MESSAGE,
  validatePasswordResetEmail,
  validatePasswordResetForm,
  validatePasswordResetToken
} from "@/lib/auth/password-reset-shared";
import { sendEmail } from "@/lib/mail";
import { getResolvedPlatformEmailConfig } from "@/lib/platform-config";
import {
  createPasswordResetTokenRecord,
  consumePasswordResetToken,
  deletePasswordResetTokenById,
  deletePasswordResetTokensByEmail,
  findAgentsByEmail,
  findPasswordResetToken,
  updatePasswordForEmail
} from "@/lib/db-auth";
import { getPasswordResetBaseUrl, PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE } from "@/lib/auth/password-reset-infra";
import { logUserSecurityEvent } from "@/lib/user-security-audit";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type PasswordResetAgentLookup = typeof findAgentsByEmail;
type PasswordResetTokenLookup = typeof findPasswordResetToken;
type PasswordResetTokenCreate = typeof createPasswordResetTokenRecord;
type PasswordResetPasswordUpdater = typeof updatePasswordForEmail;

type PasswordResetInstructionInput = {
  email: string;
  workspaceCount: number;
  resetUrl: string;
};

type RequestPasswordResetDependencies = {
  findAgentsByEmailImpl?: PasswordResetAgentLookup;
  createPasswordResetTokenRecordImpl?: PasswordResetTokenCreate;
  deletePasswordResetTokensByEmailImpl?: typeof deletePasswordResetTokensByEmail;
  sendPasswordResetInstructionsImpl?: (input: PasswordResetInstructionInput) => Promise<void>;
  getBaseUrlImpl?: () => string | null;
};

type ResetPasswordDependencies = {
  findPasswordResetTokenImpl?: PasswordResetTokenLookup;
  deletePasswordResetTokenByIdImpl?: typeof deletePasswordResetTokenById;
  updatePasswordForEmailImpl?: PasswordResetPasswordUpdater;
  consumePasswordResetTokenImpl?: typeof consumePasswordResetToken;
  logUserSecurityEventImpl?: typeof logUserSecurityEvent;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getBaseUrl() {
  return getPasswordResetBaseUrl();
}

export async function requestPasswordReset(
  input: { email: string },
  dependencies: RequestPasswordResetDependencies = {}
) {
  const validation = validatePasswordResetEmail(input.email);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const findAgentsByEmailImpl = dependencies.findAgentsByEmailImpl ?? findAgentsByEmail;
  const createPasswordResetTokenRecordImpl =
    dependencies.createPasswordResetTokenRecordImpl ?? createPasswordResetTokenRecord;
  const deletePasswordResetTokensByEmailImpl =
    dependencies.deletePasswordResetTokensByEmailImpl ?? deletePasswordResetTokensByEmail;
  const sendPasswordResetInstructionsImpl =
    dependencies.sendPasswordResetInstructionsImpl ?? sendPasswordResetInstructions;
  const getBaseUrlImpl = dependencies.getBaseUrlImpl ?? getBaseUrl;
  const baseUrl = getBaseUrlImpl();

  const matchingAgents = await findAgentsByEmailImpl(validation.email);

  if (matchingAgents.length > 0) {
    if (!baseUrl) {
      throw new Error(PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE);
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await deletePasswordResetTokensByEmailImpl(validation.email);
    await createPasswordResetTokenRecordImpl({
      email: validation.email,
      tokenHash: hashToken(token),
      expiresAt
    });

    await sendPasswordResetInstructionsImpl({
      email: validation.email,
      workspaceCount: matchingAgents.length,
      resetUrl
    });
  }

  return {
    accepted: true as const,
    message: PASSWORD_RESET_GENERIC_MESSAGE
  };
}

export async function getPasswordResetTokenStatus(
  token: string,
  dependencies: Pick<ResetPasswordDependencies, "findPasswordResetTokenImpl" | "deletePasswordResetTokenByIdImpl"> = {}
) {
  const validation = validatePasswordResetToken(token);

  if (!validation.ok) {
    return {
      ok: false as const,
      error: validation.error
    };
  }

  const findPasswordResetTokenImpl = dependencies.findPasswordResetTokenImpl ?? findPasswordResetToken;
  const deletePasswordResetTokenByIdImpl =
    dependencies.deletePasswordResetTokenByIdImpl ?? deletePasswordResetTokenById;
  const record = await findPasswordResetTokenImpl(hashToken(validation.token));

  if (!record) {
    return {
      ok: false as const,
      error: PASSWORD_RESET_TOKEN_INVALID_MESSAGE
    };
  }

  if (record.expiresAt <= new Date()) {
    await deletePasswordResetTokenByIdImpl(record.id);
    return {
      ok: false as const,
      error: PASSWORD_RESET_TOKEN_EXPIRED_MESSAGE
    };
  }

  return {
    ok: true as const,
    email: record.email
  };
}

export async function resetPasswordWithToken(
  input: { token: string; password: string; confirmPassword: string },
  dependencies: ResetPasswordDependencies = {}
) {
  const tokenValidation = validatePasswordResetToken(input.token);

  if (!tokenValidation.ok) {
    throw new Error(tokenValidation.error);
  }

  const passwordValidation = validatePasswordResetForm(input.password, input.confirmPassword);

  if (!passwordValidation.ok) {
    throw new Error(passwordValidation.error);
  }

  const findPasswordResetTokenImpl = dependencies.findPasswordResetTokenImpl ?? findPasswordResetToken;
  const consumePasswordResetTokenImpl = dependencies.consumePasswordResetTokenImpl ?? consumePasswordResetToken;
  const deletePasswordResetTokenByIdImpl = dependencies.deletePasswordResetTokenByIdImpl ?? deletePasswordResetTokenById;
  const updatePasswordForEmailImpl = dependencies.updatePasswordForEmailImpl ?? updatePasswordForEmail;
  const logUserSecurityEventImpl = dependencies.logUserSecurityEventImpl ?? logUserSecurityEvent;
  const existingRecord = await findPasswordResetTokenImpl(hashToken(tokenValidation.token));

  if (!existingRecord) {
    throw new Error(PASSWORD_RESET_TOKEN_INVALID_MESSAGE);
  }

  if (existingRecord.expiresAt <= new Date()) {
    await deletePasswordResetTokenByIdImpl(existingRecord.id);
    await logUserSecurityEventImpl({
      email: existingRecord.email,
      eventType: "password_reset_failed",
      metadata: {
        reason: "expired_token"
      }
    });
    throw new Error(PASSWORD_RESET_TOKEN_EXPIRED_MESSAGE);
  }

  const record = await consumePasswordResetTokenImpl(hashToken(tokenValidation.token));

  if (!record) {
    throw new Error(PASSWORD_RESET_TOKEN_INVALID_MESSAGE);
  }

  try {
    await updatePasswordForEmailImpl({
      email: record.email,
      passwordHash: hashPassword(input.password)
    });
    await logUserSecurityEventImpl({
      email: record.email,
      eventType: "password_reset_success"
    });
  } catch (error) {
    await logUserSecurityEventImpl({
      email: record.email,
      eventType: "password_reset_failed",
      metadata: {
        reason: error instanceof Error ? error.message : "update_failed"
      }
    });
    throw error;
  }

  return {
    success: true as const
  };
}

async function sendPasswordResetInstructions(input: PasswordResetInstructionInput) {
  const emailConfig = await getResolvedPlatformEmailConfig();
  const supportEmail = emailConfig.supportEmail || emailConfig.smtpFrom || "Connexa <no-reply@connexa.local>";
  const logoPath = path.join(process.cwd(), "public", "recurvos_connexa_transparent.png");

  await sendEmail({
    to: input.email,
    subject: "Reset your Connexa password",
    text: [
      "We received a request to reset your Connexa password.",
      "",
      `Use the link below to choose a new password${input.workspaceCount > 1 ? " for your workspaces" : ""}:`,
      input.resetUrl,
      "",
      "For security reasons, this link expires in 1 hour and can only be used once.",
      "",
      "If you did not request a password reset, you can safely ignore this email.",
      "",
      `Need help? Contact ${supportEmail}.`,
      "",
      "Connexa"
    ].join("\n"),
    html: await renderEmailTemplate({
      preheader: "Reset your Connexa password securely.",
      eyebrow: "Password reset",
      title: "Choose a new password",
      intro: "We received a request to reset your Connexa password.",
      logoSrc: "cid:connexa-logo",
      footerNote: "This is an automated security message.",
      bodyHtml: `
        <p style="margin:0 0 16px;color:#cbd5e1">
          Use the secure link below to choose a new password${input.workspaceCount > 1 ? " for your Connexa workspaces" : ""}.
        </p>
        <p style="margin:0 0 24px">
          <a
            href="${input.resetUrl}"
            style="display:inline-block;padding:14px 22px;border-radius:14px;background:linear-gradient(90deg,#34d399 0%,#22d3ee 100%);color:#07111b;text-decoration:none;font-weight:700"
          >
            Reset password
          </a>
        </p>
        <p style="margin:0 0 12px;color:#cbd5e1;font-size:14px">If the button does not open, use this link:</p>
        <p style="margin:0 0 24px;font-size:14px;word-break:break-word">
          <a href="${input.resetUrl}" style="color:#a5f3fc;text-decoration:none">${input.resetUrl}</a>
        </p>
        <p style="margin:0 0 8px;color:#cbd5e1;font-size:14px">This link expires in 1 hour and can only be used once.</p>
        <p style="margin:0;color:#cbd5e1;font-size:14px">If you did not request this reset, you can safely ignore this email.</p>
      `
    }),
    attachments: [
      {
        filename: "recurvos_connexa_transparent.png",
        path: logoPath,
        cid: "connexa-logo"
      }
    ]
  });
}

function maskEmailForLog(email: string) {
  const [localPart = "", domain = "unknown"] = email.split("@");
  const visiblePrefix = localPart.slice(0, 2);
  return `${visiblePrefix || "*"}***@${domain}`;
}

export function maskPasswordResetEmail(email: string) {
  return maskEmailForLog(email);
}
