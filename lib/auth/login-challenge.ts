import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const LOGIN_CHALLENGE_TTL_MS = 10 * 60 * 1000;

type LoginChallengePayload = {
  email: string;
  remember: boolean;
  candidates: Array<{
    agentId: string;
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    role: string;
  }>;
  exp: number;
};

function getChallengeSecret() {
  const secret = process.env.APP_ENCRYPTION_KEY?.trim();

  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY is required for login challenges.");
  }

  return secret;
}

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", getChallengeSecret()).update(payload).digest("base64url");
}

export function createLoginChallenge(input: Omit<LoginChallengePayload, "exp">) {
  const payload = JSON.stringify({
    ...input,
    exp: Date.now() + LOGIN_CHALLENGE_TTL_MS
  } satisfies LoginChallengePayload);

  const encodedPayload = toBase64Url(payload);
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function consumeLoginChallengeToken(token: string, expiresAtMs: number) {
  const expiresAt = new Date(expiresAtMs);

  try {
    await prisma.loginChallengeUse.create({
      data: {
        tokenHash: hashToken(token),
        expiresAt
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new Error("This login challenge has already been used. Sign in again.");
    }

    throw error;
  }
}

export async function verifyLoginChallenge(token: string) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Invalid login challenge.");
  }

  const expectedSignature = signPayload(encodedPayload);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("Invalid login challenge.");
  }

  let payload: LoginChallengePayload;

  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as LoginChallengePayload;
  } catch {
    throw new Error("Invalid login challenge.");
  }

  if (!Array.isArray(payload.candidates) || payload.exp <= Date.now()) {
    throw new Error("This login challenge has expired. Sign in again.");
  }

  await consumeLoginChallengeToken(token, payload.exp);

  return payload;
}
