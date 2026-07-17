import { scryptSync } from "node:crypto";
import { mkdir, readdir, rm } from "fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { deleteWorkspaceWhatsAppClientSession } from "@/lib/whatsapp-runtime";

function hashPassword(password: string) {
  const salt = process.env.PLATFORM_ADMIN_PASSWORD_SALT?.trim() || "connexa-platform-admin";
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function getDatabaseTarget() {
  const url = process.env.DATABASE_URL ?? "postgresql://connexa:connexa@localhost:5432/connexa?schema=public";

  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === "postgresql:" ? "5432" : ""),
      database: parsed.pathname.replace(/^\//, "") || null
    };
  } catch {
    return {
      host: null,
      port: null,
      database: null
    };
  }
}

function getSeededPlatformOwner() {
  return {
    name: "Platform Owner",
    email: "owner@connexa.com",
    password: process.env.PLATFORM_ADMIN_PASSWORD?.trim() || "Connexa123!"
  };
}

async function collectRemainingCounts() {
  const [platformAdmins, platformSessions, platformConfigs, platformPackageConfigs, workspaces, agents, accounts] =
    await Promise.all([
      prisma.platformAdmin.count(),
      prisma.platformSession.count(),
      prisma.platformConfig.count(),
      prisma.platformPackageConfig.count(),
      prisma.workspace.count(),
      prisma.agent.count(),
      prisma.account.count()
    ]);

  return {
    platformAdmins,
    platformSessions,
    platformConfigs,
    platformPackageConfigs,
    workspaces,
    agents,
    accounts
  };
}

async function resetUploadedAssets() {
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  const productUploadsDir = path.join(uploadsDir, "products");

  await mkdir(uploadsDir, { recursive: true });
  const uploadEntries = await readdir(uploadsDir, { withFileTypes: true });

  await Promise.all(
    uploadEntries.map((entry) =>
      rm(path.join(uploadsDir, entry.name), {
        recursive: true,
        force: true
      })
    )
  );

  await mkdir(productUploadsDir, { recursive: true });
}

export async function reseedDemoDatabase() {
  const existingWorkspaceIds = await prisma.workspace.findMany({
    select: {
      id: true
    }
  });

  await Promise.allSettled(
    existingWorkspaceIds.map(({ id }: { id: string }) => deleteWorkspaceWhatsAppClientSession(id))
  );
  await resetUploadedAssets();

  if (prisma.invite) {
    await prisma.invite.deleteMany();
  }
  if (prisma.emailVerificationToken) {
    await prisma.emailVerificationToken.deleteMany();
  }
  if (prisma.session) {
    await prisma.session.deleteMany();
  }
  await prisma.outboundMessageJob.deleteMany();
  await prisma.automationJob.deleteMany();
  await prisma.conversationRuleExecution.deleteMany();
  await prisma.conversationAutomationState.deleteMany();
  await prisma.outboundWorkerHeartbeat.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.note.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.workspaceAutomationSettings.deleteMany();
  await prisma.automationWorkflow.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.workspaceMediaAsset.deleteMany();
  await prisma.whatsAppChannel.deleteMany();
  await prisma.quickReply.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.product.deleteMany();
  await prisma.agentAvailabilityOverride.deleteMany();
  await prisma.agentAvailabilityRule.deleteMany();
  await prisma.agent.deleteMany();
  if (prisma.account) {
    await prisma.account.deleteMany();
  }
  await prisma.workspace.deleteMany();

  await prisma.platformSession.deleteMany();
  await prisma.platformPackageConfig.deleteMany();
  await prisma.platformConfig.deleteMany();
  await prisma.platformAdmin.deleteMany();

  const owner = getSeededPlatformOwner();

  await prisma.platformAdmin.create({
    data: {
      name: owner.name,
      email: owner.email,
      passwordHash: hashPassword(owner.password),
      lastLoginAt: null
    }
  });

  return {
    target: getDatabaseTarget(),
    seededPlatformOwner: {
      email: owner.email
    },
    login: {
      email: owner.email,
      passwordHint:
        process.env.PLATFORM_ADMIN_PASSWORD?.trim()
          ? "Using PLATFORM_ADMIN_PASSWORD from the environment."
          : "Using default password Connexa123! because PLATFORM_ADMIN_PASSWORD is not set."
    },
    remaining: await collectRemainingCounts()
  };
}
