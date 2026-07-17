import "dotenv/config";
import { stat } from "fs/promises";
import path from "path";
import pg from "pg";

const { Client } = pg;
const DEFAULT_BATCH_SIZE = 100;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const batchSize = parsePositiveInteger(process.env.MEDIA_LIBRARY_BACKFILL_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const summary = {
      messagesProcessed: 0,
      outboundJobsProcessed: 0,
      envelopesProcessed: 0,
      createdAssets: 0,
      reusedAssets: 0,
      linkedMessages: 0,
      linkedOutboundJobs: 0,
      linkedEnvelopes: 0,
      unresolved: 0
    };

    let cursor = null;
    while (true) {
      const rows = await loadMessageRows(client, cursor, batchSize);
      if (!rows.length) {
        break;
      }

      for (const row of rows) {
        summary.messagesProcessed += 1;
        const result = await registerFromRecord(client, {
          workspaceId: row.workspaceId,
          sourceModule: "INBOX",
          attachmentUrl: row.attachmentUrl,
          mimeType: row.attachmentMimeType,
          originalName: row.attachmentName,
          fallbackName: row.providerMessageId ?? row.id,
          existingMediaAssetId: row.mediaAssetId,
          uploadedByAgentId: row.senderId,
          existingStoragePath: null
        });

        if (!result) {
          summary.unresolved += 1;
        } else {
          summary.createdAssets += result.created ? 1 : 0;
          summary.reusedAssets += result.created ? 0 : 1;
          if (!row.mediaAssetId || row.mediaAssetId !== result.assetId) {
            await client.query(`UPDATE "Message" SET "mediaAssetId" = $2 WHERE id = $1`, [row.id, result.assetId]);
            summary.linkedMessages += 1;
          }
        }
      }

      cursor = rows[rows.length - 1].id;
    }

    cursor = null;
    while (true) {
      const rows = await loadOutboundJobRows(client, cursor, batchSize);
      if (!rows.length) {
        break;
      }

      for (const row of rows) {
        summary.outboundJobsProcessed += 1;
        const result = await registerFromRecord(client, {
          workspaceId: row.workspaceId,
          sourceModule: row.campaignRunId ? "CAMPAIGN" : "INBOX",
          attachmentUrl: row.attachmentUrl,
          mimeType: row.attachmentMimeType,
          originalName: row.attachmentName,
          fallbackName: row.id,
          existingMediaAssetId: row.mediaAssetId,
          uploadedByAgentId: row.senderId,
          existingStoragePath: null
        });

        if (!result) {
          summary.unresolved += 1;
        } else {
          summary.createdAssets += result.created ? 1 : 0;
          summary.reusedAssets += result.created ? 0 : 1;
          if (!row.mediaAssetId || row.mediaAssetId !== result.assetId) {
            await client.query(`UPDATE "OutboundMessageJob" SET "mediaAssetId" = $2 WHERE id = $1`, [row.id, result.assetId]);
            summary.linkedOutboundJobs += 1;
          }
        }
      }

      cursor = rows[rows.length - 1].id;
    }

    cursor = null;
    while (true) {
      const rows = await loadEnvelopeRows(client, cursor, batchSize);
      if (!rows.length) {
        break;
      }

      for (const row of rows) {
        summary.envelopesProcessed += 1;
        const result = await registerFromRecord(client, {
          workspaceId: row.workspaceId,
          sourceModule: "WHATSAPP_INBOUND",
          attachmentUrl: row.mediaUrl,
          mimeType: row.mediaMimeType,
          originalName: row.mediaFilename,
          fallbackName: row.providerMessageId ?? row.id,
          existingMediaAssetId: row.mediaAssetId,
          uploadedByAgentId: null,
          existingStoragePath: row.mediaStoragePath
        });

        if (!result) {
          summary.unresolved += 1;
        } else {
          summary.createdAssets += result.created ? 1 : 0;
          summary.reusedAssets += result.created ? 0 : 1;
          if (!row.mediaAssetId || row.mediaAssetId !== result.assetId) {
            await client.query(`UPDATE "WhatsAppMessageEnvelope" SET "mediaAssetId" = $2 WHERE id = $1`, [row.id, result.assetId]);
            summary.linkedEnvelopes += 1;
          }
        }
      }

      cursor = rows[rows.length - 1].id;
    }

    await client.query(`
      UPDATE "Workspace" w
      SET "mediaLibraryUsedBytes" = usage."usedBytes"
      FROM (
        SELECT "workspaceId", COALESCE(SUM("sizeBytes"), 0)::INTEGER AS "usedBytes"
        FROM "WorkspaceMediaAsset"
        GROUP BY "workspaceId"
      ) usage
      WHERE usage."workspaceId" = w.id
    `);

    console.info(JSON.stringify({ ok: true, batchSize, ...summary }, null, 2));
  } finally {
    await client.end();
  }
}

async function registerFromRecord(client, input) {
  if (input.existingMediaAssetId) {
    const existing = await client.query(
      `SELECT id FROM "WorkspaceMediaAsset" WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
      [input.existingMediaAssetId, input.workspaceId]
    );
    if (existing.rows[0]?.id) {
      return { assetId: existing.rows[0].id, created: false };
    }
  }

  const resolvedUrl = typeof input.attachmentUrl === "string" ? input.attachmentUrl.trim() : "";
  const storagePath = input.existingStoragePath?.trim() || resolveStoragePathFromUrl(resolvedUrl);
  if (!storagePath) {
    return null;
  }

  const fileStats = await stat(storagePath).catch(() => null);
  if (!fileStats?.isFile()) {
    return null;
  }

  const publicUrl = resolvedUrl || toPublicUrlFromStoragePath(storagePath);
  if (!publicUrl) {
    return null;
  }

  const existing = await client.query(
    `SELECT id FROM "WorkspaceMediaAsset" WHERE "workspaceId" = $1 AND "storagePath" = $2 LIMIT 1`,
    [input.workspaceId, storagePath]
  );
  if (existing.rows[0]?.id) {
    return { assetId: existing.rows[0].id, created: false };
  }

  const insert = await client.query(
    `WITH locked_workspace AS (
       SELECT id FROM "Workspace" WHERE id = $1 FOR UPDATE
     ),
     created_asset AS (
       INSERT INTO "WorkspaceMediaAsset" (
         id, "workspaceId", "uploadedByAgentId", title, "originalName", "storagePath", "publicUrl",
         "mimeType", kind, "sizeBytes", "sourceModule", "createdAt", "updatedAt"
       )
       SELECT
         md5(random()::text || clock_timestamp()::text),
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         CAST($8 AS "MediaAssetKind"),
         $9,
         CAST($10 AS "MediaAssetSource"),
         NOW(),
         NOW()
       FROM locked_workspace
       ON CONFLICT ("workspaceId", "storagePath") DO NOTHING
       RETURNING id, "sizeBytes"
     ),
     updated_workspace AS (
       UPDATE "Workspace"
       SET "mediaLibraryUsedBytes" = "mediaLibraryUsedBytes" + COALESCE((SELECT "sizeBytes" FROM created_asset), 0)
       WHERE id = $1
     )
     SELECT id FROM created_asset`,
    [
      input.workspaceId,
      input.uploadedByAgentId ?? null,
      deriveTitle(input.originalName, input.fallbackName),
      sanitizeFileName(input.originalName, input.fallbackName),
      storagePath,
      publicUrl,
      input.mimeType || inferMimeTypeFromName(input.originalName),
      inferKind(input.mimeType, input.originalName),
      Math.min(fileStats.size, 2147483647),
      input.sourceModule
    ]
  );

  if (insert.rows[0]?.id) {
    return { assetId: insert.rows[0].id, created: true };
  }

  const race = await client.query(
    `SELECT id FROM "WorkspaceMediaAsset" WHERE "workspaceId" = $1 AND "storagePath" = $2 LIMIT 1`,
    [input.workspaceId, storagePath]
  );

  return race.rows[0]?.id ? { assetId: race.rows[0].id, created: false } : null;
}

async function loadMessageRows(client, cursor, batchSize) {
  const { rows } = await client.query(
    `SELECT
       msg.id,
       conv."workspaceId",
       msg."mediaAssetId",
       msg."providerMessageId",
       msg."attachmentName",
       msg."attachmentMimeType",
       msg."attachmentUrl",
       msg."senderId"
     FROM "Message" msg
     INNER JOIN "Conversation" conv ON conv.id = msg."conversationId"
     WHERE msg."attachmentUrl" IS NOT NULL
       AND msg.id > COALESCE($1, '')
     ORDER BY msg.id ASC
     LIMIT $2`,
    [cursor, batchSize]
  );
  return rows;
}

async function loadOutboundJobRows(client, cursor, batchSize) {
  const { rows } = await client.query(
    `SELECT
       job.id,
       job."workspaceId",
       job."mediaAssetId",
       job."attachmentName",
       job."attachmentMimeType",
       job."attachmentUrl",
       job."campaignRunId",
       msg."senderId"
     FROM "OutboundMessageJob" job
     LEFT JOIN "Message" msg ON msg.id = job."messageId"
     WHERE job."attachmentUrl" IS NOT NULL
       AND job.id > COALESCE($1, '')
     ORDER BY job.id ASC
     LIMIT $2`,
    [cursor, batchSize]
  );
  return rows;
}

async function loadEnvelopeRows(client, cursor, batchSize) {
  const { rows } = await client.query(
    `SELECT
       env.id,
       env."workspaceId",
       env."mediaAssetId",
       env."providerMessageId",
       env."mediaFilename",
       env."mediaMimeType",
       env."mediaUrl",
       env."mediaStoragePath"
     FROM "WhatsAppMessageEnvelope" env
     WHERE env."mediaUrl" IS NOT NULL
       AND env.id > COALESCE($1, '')
     ORDER BY env.id ASC
     LIMIT $2`,
    [cursor, batchSize]
  );
  return rows;
}

function resolveStoragePathFromUrl(value) {
  if (!value || !value.startsWith("/uploads/")) {
    return null;
  }
  return path.join(process.cwd(), "public", value.replace(/^\/uploads\//, "uploads/"));
}

function toPublicUrlFromStoragePath(value) {
  const publicRoot = path.join(process.cwd(), "public");
  if (!value.startsWith(publicRoot)) {
    return null;
  }
  return value.slice(publicRoot.length).replace(/\\/g, "/");
}

function deriveTitle(originalName, fallbackName) {
  const base = (originalName || fallbackName || "media").trim();
  const extension = path.extname(base);
  return path.basename(base, extension).trim() || "media";
}

function sanitizeFileName(originalName, fallbackName) {
  const value = (originalName || fallbackName || "upload.bin").trim();
  const extension = path.extname(value).toLowerCase();
  const base = path.basename(value, extension).replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "upload";
  return `${base}${extension}`;
}

function inferKind(mimeType, fileName) {
  const normalizedMimeType = `${mimeType || ""}`.toLowerCase();
  const extension = path.extname(fileName || "").toLowerCase();

  if (normalizedMimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(extension)) {
    return "IMAGE";
  }
  if (normalizedMimeType.startsWith("audio/") || [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus"].includes(extension)) {
    return "AUDIO";
  }
  if (
    normalizedMimeType.startsWith("video/") ||
    [".mp4", ".mov", ".webm", ".3gp", ".mkv"].includes(extension)
  ) {
    return "VIDEO";
  }
  return "DOCUMENT";
}

function inferMimeTypeFromName(fileName) {
  const extension = path.extname(fileName || "").toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
