import { decryptStoredSecret } from "../lib/crypto.ts";
import { prisma } from "../lib/prisma.ts";

const requiredConfirmation = "PRINT_TO_SECURE_TTY";

try {
  if (process.env.CONNEXA_META_TOKEN_ACTION !== requiredConfirmation || !process.stdout.isTTY) {
    throw new Error(
      `Refusing to print the Meta webhook token. Use an interactive secure terminal and set CONNEXA_META_TOKEN_ACTION=${requiredConfirmation}.`
    );
  }

  const config = await prisma.platformConfig.findFirst({
    select: { metaWebhookVerifyToken: true }
  });
  const verifyToken = decryptStoredSecret(config?.metaWebhookVerifyToken);
  if (!verifyToken) {
    throw new Error("The Meta webhook verify token is not configured.");
  }

  process.stdout.write(`${verifyToken}\n`);
} finally {
  await prisma.$disconnect();
}
