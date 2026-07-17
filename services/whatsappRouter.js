import { decryptSecret, sanitizeSensitiveText } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import * as personalProvider from "@/providers/personal/provider.js";
import * as cloudProvider from "@/providers/cloud/provider.js";

function normalizeChannelKind(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();

  if (["cloud", "cloud_api", "meta", "meta_cloud", "whatsapp_cloud"].includes(normalized)) {
    return "cloud";
  }

  if (["personal", "webjs", "whatsapp_personal", "personal_qr"].includes(normalized)) {
    return "personal";
  }

  return null;
}

function inferChannelKind(account) {
  const explicit = normalizeChannelKind(account?.channel ?? account?.channelType ?? account?.provider);
  if (explicit) {
    return explicit;
  }

  if (account?.phoneNumberId && account?.accessTokenCiphertext) {
    return "cloud";
  }

  return "personal";
}

async function loadAccountFromChannelId(channelId) {
  if (!channelId) {
    return null;
  }

  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      id: channelId
    },
    select: {
      id: true,
      workspaceId: true,
      phoneNumberId: true,
      businessAccountId: true,
      accessTokenCiphertext: true,
      appSecretCiphertext: true,
      verifyTokenHash: true,
      accessTokenLastFour: true,
      appSecretLastFour: true,
      verifyTokenLastFour: true,
      sessionClientId: true,
      connectionStatus: true,
      displayName: true,
      phoneNumber: true
    }
  });

  if (!channel) {
    return null;
  }

  return {
    ...channel,
    channel: inferChannelKind(channel)
  };
}

function normalizeWorkspaceId(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function normalizeChannelId(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function assertResolvedAccountSecurity(input, account) {
  const inputWorkspaceId = normalizeWorkspaceId(input?.workspaceId ?? input?.account?.workspaceId);
  const inputChannelId = normalizeChannelId(input?.channelId ?? input?.account?.id);

  if (inputWorkspaceId && account?.workspaceId && inputWorkspaceId !== account.workspaceId) {
    throw new Error("Workspace isolation check failed for WhatsApp channel access.");
  }

  if (inputChannelId && account?.id && inputChannelId !== account.id) {
    throw new Error("Cross-account WhatsApp send attempt was blocked.");
  }

  if (input?.account?.id && account?.id && input.account.id !== account.id) {
    throw new Error("Cross-account WhatsApp account override was blocked.");
  }
}

async function resolveAccount(input) {
  const inputAccount =
    input && typeof input === "object" && input.account && typeof input.account === "object"
      ? { ...input.account }
      : null;
  const explicitChannelId = normalizeChannelId(input?.channelId ?? inputAccount?.id);
  const loadedAccount = explicitChannelId ? await loadAccountFromChannelId(explicitChannelId) : null;

  if (loadedAccount) {
    const resolvedAccount = {
      ...loadedAccount,
      accessToken: loadedAccount.accessTokenCiphertext
        ? decryptSecret(loadedAccount.accessTokenCiphertext)
        : null,
      appSecret: loadedAccount.appSecretCiphertext
        ? decryptSecret(loadedAccount.appSecretCiphertext)
        : null
    };
    assertResolvedAccountSecurity(input, resolvedAccount);
    return resolvedAccount;
  }

  if (inputAccount) {
    const resolvedAccount = {
      ...inputAccount,
      channel: inferChannelKind(inputAccount),
      accessToken: inputAccount.accessTokenCiphertext
        ? decryptSecret(inputAccount.accessTokenCiphertext)
        : inputAccount.accessToken ?? null,
      appSecret: inputAccount.appSecretCiphertext
        ? decryptSecret(inputAccount.appSecretCiphertext)
        : inputAccount.appSecret ?? null
    };
    if (resolvedAccount.channel === "cloud" && !resolvedAccount.id) {
      throw new Error("WhatsApp Cloud sends require a persisted channel id.");
    }
    assertResolvedAccountSecurity(input, resolvedAccount);
    return resolvedAccount;
  }

  const fallbackAccount = {
    channel: "personal"
  };
  assertResolvedAccountSecurity(input, fallbackAccount);
  return fallbackAccount;
}

function resolveProvider(account) {
  if (account?.channel === "personal") {
    return personalProvider;
  }

  if (account?.channel === "cloud") {
    return cloudProvider;
  }

  return inferChannelKind(account) === "cloud" ? cloudProvider : personalProvider;
}

export async function sendMessage(input) {
  try {
    const account = await resolveAccount(input);
    const provider = resolveProvider(account);
    return provider.sendMessage(input, account);
  } catch (error) {
    throw new Error(
      sanitizeSensitiveText(error instanceof Error ? error.message : "WhatsApp router send failed.")
    );
  }
}

export async function sendTemplate(input) {
  try {
    const account = await resolveAccount(input);
    const provider = resolveProvider(account);
    return provider.sendTemplate(input, account);
  } catch (error) {
    throw new Error(
      sanitizeSensitiveText(error instanceof Error ? error.message : "WhatsApp router template send failed.")
    );
  }
}

export async function broadcast(input) {
  try {
    const account = await resolveAccount(input);
    const provider = resolveProvider(account);
    return provider.broadcast(input, account);
  } catch (error) {
    throw new Error(
      sanitizeSensitiveText(error instanceof Error ? error.message : "WhatsApp router broadcast failed.")
    );
  }
}

export async function sendMedia(input) {
  try {
    const account = await resolveAccount(input);
    const provider = resolveProvider(account);
    return provider.sendMedia(input, account);
  } catch (error) {
    throw new Error(
      sanitizeSensitiveText(error instanceof Error ? error.message : "WhatsApp router media send failed.")
    );
  }
}

export async function resolveProviderAccount(input) {
  try {
    return await resolveAccount(input);
  } catch (error) {
    throw new Error(
      sanitizeSensitiveText(error instanceof Error ? error.message : "WhatsApp router account resolve failed.")
    );
  }
}
