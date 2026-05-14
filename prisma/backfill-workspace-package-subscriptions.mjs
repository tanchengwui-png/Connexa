import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import prismaPackage from "@prisma/client";

const { PrismaClient } = prismaPackage;

const publicPackages = {
  starter: {
    code: "starter",
    name: "Starter",
    description: "Best for smaller teams getting their first shared WhatsApp workspace live.",
    priceAmount: 79,
    currency: "MYR",
    billingPeriod: "MONTHLY"
  },
  professional: {
    code: "professional",
    name: "Professional",
    description: "Best for teams that need stronger coordination and cleaner daily operating flow.",
    priceAmount: 119,
    currency: "MYR",
    billingPeriod: "MONTHLY"
  },
  growth: {
    code: "growth",
    name: "Growth",
    description: "Best for active teams that need assignment, follow-up, and visibility at scale.",
    priceAmount: 149,
    currency: "MYR",
    billingPeriod: "MONTHLY"
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    description: "Best for larger rollouts that need flexible setup, support, and enterprise-fit controls.",
    priceAmount: null,
    currency: null,
    billingPeriod: null
  }
};

const publicPackageKeys = Object.keys(publicPackages);

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://connexa:connexa@localhost:5432/connexa?schema=public"
  });

  return new PrismaClient({ adapter });
}

async function main() {
  const prisma = createPrismaClient();

  try {
    for (const packageKey of publicPackageKeys) {
      const pkg = publicPackages[packageKey];

      await prisma.package.upsert({
        where: {
          code: pkg.code
        },
        update: {
          name: pkg.name,
          description: pkg.description,
          priceAmount: pkg.priceAmount,
          currency: pkg.currency,
          billingPeriod: pkg.billingPeriod,
          isActive: true
        },
        create: {
          code: pkg.code,
          name: pkg.name,
          description: pkg.description,
          priceAmount: pkg.priceAmount,
          currency: pkg.currency,
          billingPeriod: pkg.billingPeriod,
          isActive: true
        }
      });
    }

    const workspaces = await prisma.workspace.findMany({
      select: {
        id: true,
        plan: true,
        trialEndsAt: true
      }
    });

    let createdSubscriptions = 0;
    let skippedWorkspaces = 0;

    for (const workspace of workspaces) {
      const existingSubscription = await prisma.workspacePackageSubscription.findFirst({
        where: {
          workspaceId: workspace.id
        },
        select: {
          id: true
        }
      });

      if (existingSubscription) {
        skippedWorkspaces += 1;
        continue;
      }

      const packageKey = normalizePackageKey(workspace.plan);
      const pkg = publicPackages[packageKey];
      const packageRecord = await prisma.package.findUniqueOrThrow({
        where: {
          code: pkg.code
        },
        select: {
          id: true
        }
      });

      await prisma.workspacePackageSubscription.create({
        data: {
          workspaceId: workspace.id,
          packageId: packageRecord.id,
          status: workspace.trialEndsAt && workspace.trialEndsAt > new Date() ? "TRIAL" : "ACTIVE",
          subscribedPrice: pkg.priceAmount,
          currency: pkg.currency,
          billingPeriod: pkg.billingPeriod,
          startedAt: new Date(),
          nextBillingAt: workspace.trialEndsAt
        }
      });

      createdSubscriptions += 1;
    }

    console.info(
      JSON.stringify(
        {
          ok: true,
          createdSubscriptions,
          skippedWorkspaces
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

function normalizePackageKey(plan) {
  const normalized = plan.trim().toLowerCase();

  if (normalized === "professional" || normalized === "growth" || normalized === "enterprise") {
    return normalized;
  }

  return "starter";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
