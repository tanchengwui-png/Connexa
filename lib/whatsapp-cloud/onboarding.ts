import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/whatsapp-cloud/security";
import type { MetaEmbeddedSignupPhoneNumber } from "@/lib/meta-whatsapp";

const ONBOARDING_TTL_MS = 15 * 60 * 1000;

export async function createMetaOnboardingAttempt(input: {
  workspaceId: string;
  channelId: string;
  initiatedByAgentId: string;
  configId: string;
  mode: "standard" | "coexistence";
}) {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId
    },
    select: { id: true }
  });
  if (!channel) {
    throw new Error("WHATSAPP_CHANNEL_NOT_FOUND");
  }

  const state = randomBytes(32).toString("base64url");
  const attempt = await prisma.metaOnboardingAttempt.create({
    data: {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      initiatedByAgentId: input.initiatedByAgentId,
      stateHash: sha256(state),
      configId: input.configId,
      mode: input.mode,
      status: "AWAITING_META_AUTHORIZATION",
      expiresAt: new Date(Date.now() + ONBOARDING_TTL_MS)
    },
    select: {
      id: true,
      expiresAt: true
    }
  });

  return { ...attempt, state };
}

export async function consumeMetaAuthorizationState(input: {
  workspaceId: string;
  channelId: string;
  initiatedByAgentId: string;
  state: string;
}) {
  const stateHash = sha256(input.state.trim());
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const attempt = await tx.metaOnboardingAttempt.findFirst({
      where: {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        initiatedByAgentId: input.initiatedByAgentId,
        stateHash,
        status: "AWAITING_META_AUTHORIZATION",
        consumedAt: null,
        expiresAt: { gt: now }
      }
    });
    if (!attempt) {
      throw new Error("META_ONBOARDING_STATE_INVALID");
    }

    const claimed = await tx.metaOnboardingAttempt.updateMany({
      where: {
        id: attempt.id,
        status: "AWAITING_META_AUTHORIZATION",
        consumedAt: null
      },
      data: {
        consumedAt: now,
        status: "EXCHANGING_CODE"
      }
    });
    if (claimed.count !== 1) {
      throw new Error("META_ONBOARDING_STATE_REPLAYED");
    }

    return attempt;
  });
}

export async function storeMetaOnboardingAssets(input: {
  attemptId: string;
  accessToken: string;
  tokenExpiresAt: Date | null;
  phoneNumbers: MetaEmbeddedSignupPhoneNumber[];
}) {
  return prisma.metaOnboardingAttempt.update({
    where: { id: input.attemptId },
    data: {
      authorizationCiphertext: encryptSecret(input.accessToken),
      returnedAssetsJson: JSON.stringify({
        tokenExpiresAt: input.tokenExpiresAt?.toISOString() ?? null,
        phoneNumbers: input.phoneNumbers
      }),
      status: "AWAITING_ASSET_SELECTION"
    },
    select: {
      id: true,
      mode: true,
      expiresAt: true
    }
  });
}

export async function loadMetaOnboardingSelection(input: {
  attemptId: string;
  workspaceId: string;
  channelId: string;
  initiatedByAgentId: string;
}) {
  const attempt = await prisma.metaOnboardingAttempt.findFirst({
    where: {
      id: input.attemptId,
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      initiatedByAgentId: input.initiatedByAgentId,
      status: "AWAITING_ASSET_SELECTION",
      expiresAt: { gt: new Date() }
    }
  });
  if (!attempt?.authorizationCiphertext || !attempt.returnedAssetsJson) {
    throw new Error("META_ONBOARDING_ATTEMPT_EXPIRED");
  }

  const assets = JSON.parse(attempt.returnedAssetsJson) as {
    tokenExpiresAt: string | null;
    phoneNumbers: MetaEmbeddedSignupPhoneNumber[];
  };
  return {
    attempt,
    accessToken: decryptSecret(attempt.authorizationCiphertext),
    tokenExpiresAt: assets.tokenExpiresAt ? new Date(assets.tokenExpiresAt) : null,
    phoneNumbers: Array.isArray(assets.phoneNumbers) ? assets.phoneNumbers : []
  };
}

export async function completeMetaOnboardingAttempt(attemptId: string) {
  await prisma.metaOnboardingAttempt.update({
    where: { id: attemptId },
    data: {
      authorizationCiphertext: null,
      status: "COMPLETED"
    }
  });
}

export async function cancelMetaOnboardingAttempt(input: {
  attemptId: string;
  workspaceId: string;
  channelId: string;
  initiatedByAgentId: string;
}) {
  const cancelledAt = new Date();
  const cancelled = await prisma.metaOnboardingAttempt.updateMany({
    where: {
      id: input.attemptId,
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      initiatedByAgentId: input.initiatedByAgentId,
      status: { in: ["AWAITING_META_AUTHORIZATION", "AWAITING_ASSET_SELECTION"] }
    },
    data: {
      status: "CANCELLED",
      cancelledAt,
      authorizationCiphertext: null
    }
  });
  if (cancelled.count !== 1) {
    throw new Error("META_ONBOARDING_ATTEMPT_NOT_CANCELABLE");
  }
  return { cancelled: true, cancelledAt };
}

export async function failMetaOnboardingAttempt(attemptId: string, failureCode: string) {
  await prisma.metaOnboardingAttempt.updateMany({
    where: { id: attemptId },
    data: {
      authorizationCiphertext: null,
      status: "FAILED",
      failureCode
    }
  });
}
