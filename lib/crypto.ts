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
