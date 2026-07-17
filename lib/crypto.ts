import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_KEY_ENV = "APP_ENCRYPTION_KEY";

function getEncryptionKey() {
  const rawKey = process.env[ENCRYPTION_KEY_ENV];

  if (!rawKey) {
    throw new Error(`${ENCRYPTION_KEY_ENV} is required.`);
  }

  return createHash("sha256").update(rawKey).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [ivText, encryptedText, tagText] = payload.split(":");

  if (!ivText || !encryptedText || !tagText) {
    throw new Error("Invalid encrypted secret.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivText, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function maskSecret(value: string | null | undefined, visibleChars = 4) {
  const normalized = `${value ?? ""}`;
  if (!normalized) {
    return "";
  }

  if (normalized.length <= visibleChars) {
    return "*".repeat(normalized.length);
  }

  return `${"*".repeat(Math.max(8, normalized.length - visibleChars))}${normalized.slice(-visibleChars)}`;
}

export function sanitizeSensitiveText(value: string | null | undefined) {
  const normalized = `${value ?? ""}`;
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:access_?token|token|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/("?(?:access_?token|app_?secret|authorization)"?\s*[:=]\s*"?)([^",\s}]+)/gi, "$1[REDACTED]");
}
