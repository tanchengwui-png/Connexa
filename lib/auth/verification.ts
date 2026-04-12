import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { renderEmailTemplate } from "@/lib/email-template";
import { sendEmail } from "@/lib/mail";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getBaseUrl() {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getSupportEmail() {
  return process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? "Connexa <no-reply@connexa.local>";
}

export async function createEmailVerification(agentId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  const agent = await prisma.agent.findUnique({
    where: {
      id: agentId
    },
    include: {
      workspace: true
    }
  });

  if (!agent) {
    throw new Error("Account not found.");
  }

  await prisma.emailVerificationToken.deleteMany({
    where: {
      agentId
    }
  });

  await prisma.emailVerificationToken.create({
    data: {
      agentId,
      tokenHash: hashToken(token),
      expiresAt
    }
  });

  const verificationUrl = `${getBaseUrl()}/verify-email?token=${token}`;
  const supportEmail = getSupportEmail();
  const logoPath = path.join(process.cwd(), "public", "recurvos_connexa_transparent.png");

  await sendEmail({
    to: agent.email,
    subject: "Verify your email address for Connexa",
    text: [
      `Hi ${agent.name},`,
      "",
      "Welcome to Connexa.",
      "",
      `Please verify your email address to finish setting up your account for "${agent.workspace.name}".`,
      "",
      "Use the link below to confirm your email:",
      verificationUrl,
      "",
      "For security reasons, this link expires in 24 hours.",
      "",
      "If you did not request this email, you can safely ignore it.",
      "",
      `Need help? Contact ${supportEmail}.`,
      "",
      "Connexa"
    ].join("\n"),
    html: renderEmailTemplate({
      preheader: `Verify your email address to finish setting up ${agent.workspace.name}.`,
      eyebrow: "Account verification",
      title: "Verify your email address",
      intro: `Hi ${escapeHtml(agent.name)},`,
      logoSrc: "cid:connexa-logo",
      footerNote: "This is an automated account verification message.",
      bodyHtml: `
        <p style="margin:0 0 16px">
          Welcome to Connexa. Please verify your email address to finish setting up your account for
          <strong> ${escapeHtml(agent.workspace.name)}</strong>.
        </p>
        <p style="margin:0 0 24px;color:#cbd5e1">
          This confirmation helps protect your account and ensures you can receive important product and security updates.
        </p>
        <div style="margin:0 0 24px;padding:16px 18px;border:1px solid rgba(255,255,255,0.08);border-radius:16px;background:rgba(255,255,255,0.04)">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#a5f3fc;margin-bottom:8px">Workspace</div>
          <div style="font-size:18px;font-weight:700;color:#ffffff">${escapeHtml(agent.workspace.name)}</div>
        </div>
        <p style="margin:0 0 24px">
          <a
            href="${verificationUrl}"
            style="display:inline-block;padding:14px 22px;border-radius:14px;background:linear-gradient(90deg,#34d399 0%,#22d3ee 100%);color:#07111b;text-decoration:none;font-weight:700"
          >
            Verify email
          </a>
        </p>
        <p style="margin:0 0 12px;color:#cbd5e1;font-size:14px">If the button does not open, use this link:</p>
        <p style="margin:0 0 24px;font-size:14px;word-break:break-word">
          <a href="${verificationUrl}" style="color:#a5f3fc;text-decoration:none">${verificationUrl}</a>
        </p>
        <p style="margin:0 0 8px;color:#cbd5e1;font-size:14px">This link expires in 24 hours.</p>
        <p style="margin:0;color:#cbd5e1;font-size:14px">If you did not request this email, you can safely ignore it.</p>
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

  return {
    expiresAt
  };
}

export async function verifyEmailToken(token: string) {
  const tokenHash = hashToken(token);
  const record = await prisma.emailVerificationToken.findUnique({
    where: {
      tokenHash
    },
    include: {
      agent: true
    }
  });

  if (!record) {
    throw new Error("Invalid verification link.");
  }

  if (record.expiresAt <= new Date()) {
    await prisma.emailVerificationToken.delete({
      where: {
        id: record.id
      }
    });
    throw new Error("This verification link has expired.");
  }

  await prisma.$transaction([
    prisma.agent.update({
      where: {
        id: record.agentId
      },
      data: {
        emailVerifiedAt: new Date()
      }
    }),
    prisma.emailVerificationToken.deleteMany({
      where: {
        agentId: record.agentId
      }
    })
  ]);

  return record.agent;
}

export async function resendEmailVerification(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: {
      id: agentId
    },
    select: {
      id: true,
      emailVerifiedAt: true
    }
  });

  if (!agent) {
    throw new Error("Account not found.");
  }

  if (agent.emailVerifiedAt) {
    throw new Error("Email is already verified.");
  }

  return createEmailVerification(agentId);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
