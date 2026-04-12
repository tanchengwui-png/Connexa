import { AgentRole, AgentStatus } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { assertWorkspaceHasAcceptanceCapacity, assertWorkspaceHasInviteCapacity } from "@/lib/team-capacity";
import { renderEmailTemplate } from "@/lib/email-template";
import { sendEmail } from "@/lib/mail";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getBaseUrl() {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getSupportEmail() {
  return process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? "Connexa <no-reply@connexa.local>";
}

export async function createInvite(input: {
  workspaceId: string;
  invitedById: string;
  inviterName: string;
  workspaceName: string;
  email: string;
  role: AgentRole;
}) {
  const email = input.email.trim().toLowerCase();

  if (!email) {
    throw new Error("Invite email is required.");
  }

  const existingAgent = await prisma.agent.findFirst({
    where: {
      workspaceId: input.workspaceId,
      email
    },
    select: {
      id: true
    }
  });

  if (existingAgent) {
    throw new Error("That user is already a member of this workspace.");
  }

  await assertWorkspaceHasInviteCapacity(input.workspaceId, {
    excludeInviteEmail: email
  });

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await prisma.invite.deleteMany({
    where: {
      workspaceId: input.workspaceId,
      email,
      acceptedAt: null
    }
  });

  await prisma.invite.create({
    data: {
      workspaceId: input.workspaceId,
      invitedById: input.invitedById,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt
    }
  });

  const inviteUrl = `${getBaseUrl()}/invite/${token}`;
  const supportEmail = getSupportEmail();

  await sendEmail({
    to: email,
    subject: `${input.inviterName} invited you to join ${input.workspaceName} on Connexa`,
    text: [
      `You have been invited to join ${input.workspaceName} on Connexa.`,
      "",
      `Role: ${input.role}`,
      `Invited by: ${input.inviterName}`,
      "",
      "Use the link below to accept your invite:",
      inviteUrl,
      "",
      "This invite expires in 7 days.",
      "",
      `Need help? Contact ${supportEmail}.`
    ].join("\n"),
    html: renderEmailTemplate({
      preheader: `You have been invited to join ${input.workspaceName} on Connexa.`,
      eyebrow: "Team invitation",
      title: "You have been invited",
      intro: `${input.inviterName} invited you to join ${input.workspaceName} on Connexa.`,
      footerNote: "This is an automated workspace invitation email.",
      bodyHtml: `
        <p style="margin:0 0 16px">
          Join your team workspace and start collaborating in Connexa.
        </p>
        <div style="margin:0 0 24px;padding:16px 18px;border:1px solid #dbe7ff;border-radius:16px;background:#f7fbff">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5f7699;margin-bottom:8px">Invitation details</div>
          <div style="font-size:18px;font-weight:700;color:#12233d">${input.workspaceName}</div>
          <div style="margin-top:8px;color:#5f7699">Role: ${input.role}</div>
          <div style="margin-top:4px;color:#5f7699">Invited by: ${input.inviterName}</div>
        </div>
        <p style="margin:0 0 24px">
          <a
            href="${inviteUrl}"
            style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(135deg,#5f9dff 0%,#2457d6 58%,#1fc8b5 100%);color:#ffffff;text-decoration:none;font-weight:700"
          >
            Accept invitation
          </a>
        </p>
        <p style="margin:0 0 12px;color:#5f7699;font-size:14px">If the button does not open, use this link:</p>
        <p style="margin:0 0 24px;font-size:14px;word-break:break-word">
          <a href="${inviteUrl}" style="color:#2457d6;text-decoration:none">${inviteUrl}</a>
        </p>
        <p style="margin:0;color:#5f7699;font-size:14px">This invite expires in 7 days.</p>
      `
    })
  });
}

export async function listWorkspaceInvites(workspaceId: string) {
  return prisma.invite.findMany({
    where: {
      workspaceId,
      acceptedAt: null
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function getInviteByToken(token: string) {
  const invite = await prisma.invite.findUnique({
    where: {
      tokenHash: hashToken(token)
    },
    include: {
      workspace: true,
      invitedBy: true
    }
  });

  if (!invite) {
    return null;
  }

  if (invite.acceptedAt || invite.expiresAt <= new Date()) {
    return null;
  }

  return invite;
}

export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
  remember: boolean;
}) {
  const invite = await getInviteByToken(input.token);

  if (!invite) {
    throw new Error("This invitation is invalid or expired.");
  }

  await assertWorkspaceHasAcceptanceCapacity(invite.workspaceId);

  const name = input.name.trim();
  const password = input.password;

  if (!name || password.length < 8) {
    throw new Error("Name and an 8-character password are required.");
  }

  const agent = await prisma.$transaction(async (tx) => {
    const createdAgent = await tx.agent.create({
      data: {
        workspaceId: invite.workspaceId,
        name,
        email: invite.email,
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
        inviteAcceptedAt: new Date(),
        role: invite.role,
        status: AgentStatus.ACTIVE
      }
    });

    await tx.invite.update({
      where: {
        id: invite.id
      },
      data: {
        acceptedAt: new Date()
      }
    });

    return createdAgent;
  });

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: input.remember
  });

  return agent;
}
