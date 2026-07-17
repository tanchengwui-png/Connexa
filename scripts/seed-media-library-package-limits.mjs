import "dotenv/config";
import pg from "pg";
import { readFile } from "fs/promises";
import path from "path";

const { Client } = pg;
const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const mappingPath = process.env.MEDIA_LIBRARY_LIMIT_MAP_PATH?.trim()
    ? path.resolve(process.cwd(), process.env.MEDIA_LIBRARY_LIMIT_MAP_PATH.trim())
    : path.join(process.cwd(), "scripts", "media-library-storage-limit-map.example.json");
  const mapping = JSON.parse(await readFile(mappingPath, "utf8"));
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const entries = Object.entries(mapping);
    let updated = 0;

    for (const [packageKey, rawValue] of entries) {
      const limitBytes = parseStorageLimitValue(rawValue);
      const result = await client.query(
        `UPDATE "PlatformPackageConfig"
         SET "mediaLibraryStorageLimitBytes" = $2, "updatedAt" = NOW()
         WHERE "packageKey" = $1`,
        [packageKey, limitBytes]
      );
      updated += result.rowCount ?? 0;
    }

    console.info(
      JSON.stringify(
        {
          ok: true,
          mappingPath,
          packageKeys: entries.map(([packageKey]) => packageKey),
          updated
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

function parseStorageLimitValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid storage limit value: ${String(value)}`);
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(MB|GB|B)$/);
  if (!match) {
    throw new Error(`Unable to parse storage limit value "${value}". Use formats like "100 MB" or "1 GB".`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid storage limit value "${value}".`);
  }

  if (unit === "GB") {
    return Math.round(amount * BYTES_PER_GB);
  }

  if (unit === "MB") {
    return Math.round(amount * BYTES_PER_MB);
  }

  return Math.round(amount);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
