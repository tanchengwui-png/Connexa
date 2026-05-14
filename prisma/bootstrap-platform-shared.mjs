import "dotenv/config";
import { scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import prismaPackage from "@prisma/client";

const { PrismaClient } = prismaPackage;

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://connexa:connexa@localhost:5432/connexa?schema=public"
  });

  return new PrismaClient({ adapter });
}

function hashPassword(password) {
  const salt = process.env.PLATFORM_ADMIN_PASSWORD_SALT?.trim() || "connexa-platform-admin";
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export async function bootstrapPlatformAdmin() {
  const prisma = createPrismaClient();

  try {
    const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    const platformAdminPassword = process.env.PLATFORM_ADMIN_PASSWORD?.trim();

    if (!platformAdminEmail || !platformAdminPassword) {
      console.info("Skipping platform admin bootstrap because PLATFORM_ADMIN_EMAIL or PLATFORM_ADMIN_PASSWORD is not set.");
      return;
    }

    await prisma.platformAdmin.upsert({
      where: {
        email: platformAdminEmail
      },
      update: {
        name: "Platform Owner",
        passwordHash: hashPassword(platformAdminPassword),
        lastLoginAt: null
      },
      create: {
        name: "Platform Owner",
        email: platformAdminEmail,
        passwordHash: hashPassword(platformAdminPassword)
      }
    });

    await prisma.platformConfig.upsert({
      where: {
        id: "platform"
      },
      update: {
        smtpHost: process.env.SMTP_HOST ?? null,
        smtpPort: Number(process.env.SMTP_PORT ?? "587"),
        smtpSecure: process.env.SMTP_SECURE === "true",
        smtpUser: process.env.SMTP_USER ?? null,
        smtpPass: process.env.SMTP_PASS ?? null,
        smtpFrom: process.env.SMTP_FROM ?? null,
        supportEmail: process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? null,
        emailBrandName: process.env.EMAIL_BRAND_NAME ?? "Connexa",
        emailBrandTagline:
          process.env.EMAIL_BRAND_TAGLINE ?? "Shared workspace communication for modern teams."
      },
      create: {
        id: "platform",
        smtpHost: process.env.SMTP_HOST ?? null,
        smtpPort: Number(process.env.SMTP_PORT ?? "587"),
        smtpSecure: process.env.SMTP_SECURE === "true",
        smtpUser: process.env.SMTP_USER ?? null,
        smtpPass: process.env.SMTP_PASS ?? null,
        smtpFrom: process.env.SMTP_FROM ?? null,
        supportEmail: process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? null,
        emailBrandName: process.env.EMAIL_BRAND_NAME ?? "Connexa",
        emailBrandTagline:
          process.env.EMAIL_BRAND_TAGLINE ?? "Shared workspace communication for modern teams."
      }
    });

    console.info("Platform admin bootstrapped without modifying workspace data.");
  } finally {
    await prisma.$disconnect();
  }
}
