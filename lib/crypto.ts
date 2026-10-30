import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_KEY_ENV = "APP_ENCRYPTION_KEY";
const ENCRYPTION_FORMAT_VERSION = "v1";
const ENCRYPTION_KEY_ID_ENV = "APP_ENCRYPTION_KEY_ID";
const PREVIOUS_ENCRYPTION_KEYS_ENV = "APP_ENCRYPTION_PREVIOUS_KEYS_JSON";

function getActiveEncryptionKeyId() {
  const keyId = process.env[ENCRYPTION_KEY_ID_ENV]?.trim() || "primary";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId)) {
    throw new Error(`${ENCRYPTION_KEY_ID_ENV} is invalid.`);
  }
  return keyId;
}

function getEncryptionKey(keyId = getActiveEncryptionKeyId()) {
  let rawKey = keyId === getActiveEncryptionKeyId() ? process.env[ENCRYPTION_KEY_ENV] : undefined;

  if (!rawKey && process.env[PREVIOUS_ENCRYPTION_KEYS_ENV]) {
    let keyring: Record<string, unknown>;
    try {
      keyring = JSON.parse(process.env[PREVIOUS_ENCRYPTION_KEYS_ENV] ?? "{}") as Record<string, unknown>;
    } catch {
      throw new Error(`${PREVIOUS_ENCRYPTION_KEYS_ENV} must be valid JSON.`);
    }
    rawKey = typeof keyring[keyId] === "string" ? keyring[keyId] : undefined;
  }

  if (!rawKey) {
    throw new Error(`Encryption key '${keyId}' is unavailable.`);
  }

  return createHash("sha256").update(rawKey).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const keyId = getActiveEncryptionKeyId();
  return `${ENCRYPTION_FORMAT_VERSION}.${keyId}:${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const parts = payload.split(":");
  // Existing channel credentials used the unversioned three-part format.
  // Continue to read it while all newly encrypted values include a key ID.
  const versioned = parts[0]?.startsWith(`${ENCRYPTION_FORMAT_VERSION}.`);
  const keyId = versioned ? parts[0].slice(`${ENCRYPTION_FORMAT_VERSION}.`.length) : getActiveEncryptionKeyId();
  const [ivText, encryptedText, tagText] = versioned ? parts.slice(1) : parts;

  if (!ivText || !encryptedText || !tagText) {
    throw new Error("Invalid encrypted secret.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(keyId),
    Buffer.from(ivText, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

export function isEncryptedSecret(value: string | null | undefined) {
  const parts = `${value ?? ""}`.split(":");
  if (parts[0]?.startsWith(`${ENCRYPTION_FORMAT_VERSION}.`)) {
    return parts.length === 4 && Boolean(parts[0].slice(3)) && parts.slice(1).every(Boolean);
  }

  return parts.length === 3 && parts.every(Boolean);
}

export function encryptSecretForStorage(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Cannot encrypt an empty secret.");
  }

  return isEncryptedSecret(normalized) ? normalized : encryptSecret(normalized);
}

export function decryptStoredSecret(value: string | null | undefined) {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) {
    return "";
  }

  // Read legacy plaintext platform values during controlled rotation, but
  // every value saved through the current settings path is encrypted.
  return isEncryptedSecret(normalized) ? decryptSecret(normalized) : normalized;
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
