import "dotenv/config";
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

async function main() {
  const prisma = createPrismaClient();

  try {
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        accountId: true,
        email: true,
        passwordHash: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const accountIdsByEmail = new Map();
    let createdAccounts = 0;
    let linkedAgents = 0;

    for (const agent of agents) {
      const email = agent.email.trim().toLowerCase();

      if (!email) {
        continue;
      }

      if (!accountIdsByEmail.has(email)) {
        const existingAccount = await prisma.account.findUnique({
          where: {
            email
          },
          select: {
            id: true
          }
        });

        if (existingAccount) {
          accountIdsByEmail.set(email, existingAccount.id);
        } else {
          const sourceAgent = agents.find(
            (candidate) => candidate.email.trim().toLowerCase() === email && candidate.passwordHash
          );

          if (!sourceAgent?.passwordHash) {
            console.warn(`Skipping ${email} because no password hash exists on any membership.`);
            continue;
          }

          const mostRecentLogin = agents
            .filter((candidate) => candidate.email.trim().toLowerCase() === email)
            .map((candidate) => candidate.lastLoginAt)
            .filter(Boolean)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

          const emailVerifiedAt = agents
            .filter((candidate) => candidate.email.trim().toLowerCase() === email)
            .map((candidate) => candidate.emailVerifiedAt)
            .filter(Boolean)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

          const account = await prisma.account.create({
            data: {
              email,
              passwordHash: sourceAgent.passwordHash,
              emailVerifiedAt,
              lastLoginAt: mostRecentLogin
            },
            select: {
              id: true
            }
          });

          accountIdsByEmail.set(email, account.id);
          createdAccounts += 1;
        }
      }

      const accountId = accountIdsByEmail.get(email);

      if (!accountId || agent.accountId === accountId) {
        continue;
      }

      await prisma.agent.update({
        where: {
          id: agent.id
        },
        data: {
          accountId
        }
      });

      linkedAgents += 1;
    }

    console.info(
      JSON.stringify(
        {
          ok: true,
          createdAccounts,
          linkedAgents
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
