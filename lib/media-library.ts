import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireCurrentApiAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { MediaAssetKind, MediaAssetSource, type MediaAssetSource as MediaAssetSourceValue } from "@/lib/db-types";
import {
  sanitizeUploadedFileName,
  toMediaAssetKind,
  validateInboxUploadFile,
  INBOX_UPLOAD_LIMITS
} from "@/lib/inbox-upload";
import { buildMediaStorageExceededMessage, buildMediaUsageSummary } from "@/lib/media-library-quota";
import {
  isAudioMimeType,
  isDocumentMimeType,
  type MediaLibraryAsset,
  type MediaLibraryUsage
} from "@/lib/media-library-shared";
import { getWorkspacePackageFeatureLimits } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";

const MEDIA_LIBRARY_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "media-library");
const MAX_MEDIA_UPLOAD_BYTES = Math.max(...Object.values(INBOX_UPLOAD_LIMITS));

type WorkspaceMediaAssetCreateData = Parameters<typeof prisma.workspaceMediaAsset.create>[0]["data"];
type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function toSafeStorageNumber(value: bigint | number | null | undefined) {
  const normalized = typeof value === "bigint" ? Number(value) : value ?? 0;

  if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < 0) {
    throw new Error("Storage byte value is invalid.");
  }

  if (!Number.isSafeInteger(normalized)) {
    throw new Error("Storage byte value exceeds the supported safe integer range.");
  }

  return normalized;
}

export class WorkspaceMediaStorageLimitError extends Error {
  code = "MEDIA_LIBRARY_STORAGE_LIMIT_EXCEEDED" as const;
  status = 409 as const;
  limitBytes: number;
  usedStorageBytes: number;
  requestedUploadBytes: number;
  remainingStorageBytes: number;

  constructor(input: {
    limitBytes: number;
    usedStorageBytes: number;
    requestedUploadBytes: number;
  }) {
    const remainingStorageBytes = Math.max(input.limitBytes - input.usedStorageBytes, 0);
    super(
      buildMediaStorageExceededMessage({
        usedStorageBytes: input.usedStorageBytes,
        storageLimitBytes: input.limitBytes,
        requestedUploadBytes: input.requestedUploadBytes
      })
    );
    this.limitBytes = input.limitBytes;
    this.usedStorageBytes = input.usedStorageBytes;
    this.requestedUploadBytes = input.requestedUploadBytes;
    this.remainingStorageBytes = remainingStorageBytes;
  }
}

type PreparedUpload = {
  dedupeKey: string;
  originalName: string;
  sanitizedOriginalName: string;
  title: string;
  mimeType: string;
  kind: MediaAssetKind;
  sizeBytes: number;
  extension: string;
  checksumSha256: string;
  buffer: Buffer;
};

type StoredPreparedUpload = PreparedUpload & {
  storagePath: string;
  publicUrl: string;
};

type RegisteredMediaAsset = Awaited<ReturnType<typeof registerStoredWorkspaceMediaAsset>>;

export async function getMediaLibraryData() {
  const workspaceId = await requireCurrentWorkspaceId();
  return getWorkspaceMediaLibraryData(workspaceId);
}

export async function getWorkspaceMediaLibraryData(workspaceId: string) {
  const [assets, usage] = await Promise.all([
    listWorkspaceMediaAssets(workspaceId),
    getWorkspaceMediaLibraryUsage(workspaceId)
  ]);

  return {
    assets,
    limits: usage,
    summary: {
      totalAssets: usage.totalAssets,
      imageCount: usage.imageCount,
      audioCount: usage.audioCount,
      videoCount: usage.videoCount,
      documentCount: usage.documentCount
    }
  };
}

export async function getWorkspaceMediaLibraryUsage(workspaceId: string): Promise<MediaLibraryUsage> {
  const [workspace, limits] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        mediaLibraryUsedBytes: true
      }
    }),
    getWorkspacePackageFeatureLimits(workspaceId)
  ]);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const counts = await getWorkspaceMediaLibraryCounts(workspaceId);

  const videoCount = Math.max(
    counts.totalAssets - counts.imageCount - counts.audioCount - counts.documentCount,
    0
  );
  const hasStorageLimitConfigured = limits.mediaLibraryStorageLimitBytes !== null;

  return buildMediaUsageSummary({
    totalAssets: counts.totalAssets,
    imageCount: counts.imageCount,
    audioCount: counts.audioCount,
    videoCount,
    documentCount: counts.documentCount,
    usedStorageBytes: toSafeStorageNumber(workspace.mediaLibraryUsedBytes),
    storageLimitBytes: limits.mediaLibraryStorageLimitBytes,
    hasStorageLimitConfigured,
    maxFileBytes: MAX_MEDIA_UPLOAD_BYTES
  });
}

async function getWorkspaceMediaLibraryCounts(workspaceId: string) {
  try {
    const [totalAssets, imageCount, audioCount, documentCount] = await Promise.all([
      prisma.workspaceMediaAsset.count({
        where: { workspaceId }
      }),
      prisma.workspaceMediaAsset.count({
        where: {
          workspaceId,
          kind: MediaAssetKind.IMAGE
        }
      }),
      prisma.workspaceMediaAsset.count({
        where: {
          workspaceId,
          kind: MediaAssetKind.AUDIO
        }
      }),
      prisma.workspaceMediaAsset.count({
        where: {
          workspaceId,
          kind: MediaAssetKind.DOCUMENT
        }
      })
    ]);

    return {
      totalAssets,
      imageCount,
      audioCount,
      documentCount
    };
  } catch (error) {
    if (!isLegacyMediaAssetKindError(error)) {
      throw error;
    }
  }

  const assets = await prisma.workspaceMediaAsset.findMany({
    where: { workspaceId },
    select: {
      kind: true,
      mimeType: true
    }
  });

  let imageCount = 0;
  let audioCount = 0;
  let documentCount = 0;

  for (const asset of assets) {
    if (isDocumentMimeType(asset.mimeType) || asset.kind === MediaAssetKind.DOCUMENT) {
      documentCount += 1;
      continue;
    }

    if (isAudioMimeType(asset.mimeType) || asset.kind === MediaAssetKind.AUDIO) {
      audioCount += 1;
      continue;
    }

    if (asset.kind === MediaAssetKind.IMAGE) {
      imageCount += 1;
    }
  }

  return {
    totalAssets: assets.length,
    imageCount,
    audioCount,
    documentCount
  };
}

function isLegacyMediaAssetKindError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string };
  return candidate.code === "P2007" && candidate.message.includes('enum "MediaAssetKind"');
}

export async function listWorkspaceMediaAssets(workspaceId: string): Promise<MediaLibraryAsset[]> {
  const assets = await prisma.workspaceMediaAsset.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "asc" }],
    include: {
      uploadedByAgent: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  return assets.map((asset: (typeof assets)[number]) => mapMediaAsset(asset));
}

export async function createWorkspaceMediaAsset(input: {
  file: File;
  sourceModule?: MediaAssetSourceValue;
  skipStorageLimitCheck?: boolean;
}) {
  const agent = await requireCurrentApiAgent();
  const [asset] = await createWorkspaceMediaAssets({
    files: [input.file],
    sourceModule: input.sourceModule ?? MediaAssetSource.MEDIA_LIBRARY,
    skipStorageLimitCheck: input.skipStorageLimitCheck,
    workspaceId: agent.workspaceId,
    uploadedByAgentId: agent.id
  });

  return asset;
}

export async function createWorkspaceMediaAssets(input: {
  files: File[];
  sourceModule?: MediaAssetSourceValue;
  skipStorageLimitCheck?: boolean;
  workspaceId?: string;
  uploadedByAgentId?: string | null;
}) {
  const agent =
    input.workspaceId && input.uploadedByAgentId !== undefined
      ? {
          workspaceId: input.workspaceId,
          id: input.uploadedByAgentId
        }
      : await requireCurrentApiAgent();

  const preparedUploads = await Promise.all(input.files.map((file) => prepareUploadedFile(file)));
  const uniqueUploads = new Map<string, PreparedUpload>();
  for (const upload of preparedUploads) {
    if (!uniqueUploads.has(upload.dedupeKey)) {
      uniqueUploads.set(upload.dedupeKey, upload);
    }
  }

  const storedUploads = await Promise.all(
    Array.from(uniqueUploads.values()).map((upload) => writePreparedUploadFile(upload))
  );
  const registeredAssetsByKey = new Map<string, RegisteredMediaAsset>();

  try {
    const usageLimit = input.skipStorageLimitCheck
      ? null
      : (await getWorkspacePackageFeatureLimits(agent.workspaceId)).mediaLibraryStorageLimitBytes;
    const totalRequestedBytes = storedUploads.reduce((sum, upload) => sum + upload.sizeBytes, 0);

    const registeredAssets = await prisma.$transaction(async (tx) => {
      const lockedWorkspace = await lockWorkspaceMediaUsage(tx, agent.workspaceId);
      if (
        usageLimit !== null &&
        lockedWorkspace.mediaLibraryUsedBytes + totalRequestedBytes > usageLimit
      ) {
        throw new WorkspaceMediaStorageLimitError({
          limitBytes: usageLimit,
          usedStorageBytes: lockedWorkspace.mediaLibraryUsedBytes,
          requestedUploadBytes: totalRequestedBytes
        });
      }

      const createdAssets: RegisteredMediaAsset[] = [];
      for (const upload of storedUploads) {
        const asset = await createWorkspaceMediaAssetRecord(tx, {
          workspaceId: agent.workspaceId,
          uploadedByAgentId: agent.id ?? null,
          originalName: upload.sanitizedOriginalName,
          title: upload.title,
          storagePath: upload.storagePath,
          publicUrl: upload.publicUrl,
          mimeType: upload.mimeType,
          kind: upload.kind,
          sizeBytes: upload.sizeBytes,
          checksumSha256: upload.checksumSha256,
          sourceModule: input.sourceModule ?? MediaAssetSource.MEDIA_LIBRARY
        });
        createdAssets.push(asset);
      }

      if (totalRequestedBytes > 0) {
        await tx.workspace.update({
          where: { id: agent.workspaceId },
          data: {
            mediaLibraryUsedBytes: {
              increment: totalRequestedBytes
            }
          }
        });
      }

      return createdAssets;
    });

    registeredAssets.forEach((asset, index) => {
      registeredAssetsByKey.set(storedUploads[index]!.dedupeKey, asset);
    });
  } catch (error) {
    await Promise.all(storedUploads.map((upload) => rm(upload.storagePath, { force: true })));
    throw error;
  }

  return preparedUploads.map((upload) => {
    const asset = registeredAssetsByKey.get(upload.dedupeKey);
    if (!asset) {
      throw new Error("Unable to resolve uploaded media asset.");
    }
    return asset;
  });
}

export async function registerStoredWorkspaceMediaAsset(input: {
  workspaceId: string;
  uploadedByAgentId?: string | null;
  title?: string | null;
  originalName: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  kind?: MediaAssetKind;
  sizeBytes: number;
  checksumSha256?: string | null;
  sourceModule: MediaAssetSourceValue;
  skipStorageLimitCheck?: boolean;
}) {
  const resolvedKind =
    input.kind ??
    toMediaAssetKind(
      validateInboxUploadFile({
        fileName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes
      })
    );
  const normalizedTitle = input.title?.trim() || deriveTitleFromFileName(input.originalName);
  const normalizedOriginalName = sanitizeUploadedFileName(input.originalName);
  const normalizedChecksum = input.checksumSha256?.trim() || null;
  const storageLimit = input.skipStorageLimitCheck
    ? null
    : (await getWorkspacePackageFeatureLimits(input.workspaceId)).mediaLibraryStorageLimitBytes;

  return prisma.$transaction(async (tx) => {
    const lockedWorkspace = await lockWorkspaceMediaUsage(tx, input.workspaceId);
    const existing = await tx.workspaceMediaAsset.findFirst({
      where: {
        workspaceId: input.workspaceId,
        storagePath: input.storagePath
      },
      include: {
        uploadedByAgent: {
          select: {
            name: true
          }
        }
      }
    });

    if (existing) {
      return mapMediaAsset(existing);
    }

    if (
      storageLimit !== null &&
      lockedWorkspace.mediaLibraryUsedBytes + input.sizeBytes > storageLimit
    ) {
      throw new WorkspaceMediaStorageLimitError({
        limitBytes: storageLimit,
        usedStorageBytes: lockedWorkspace.mediaLibraryUsedBytes,
        requestedUploadBytes: input.sizeBytes
      });
    }

    const created = await createWorkspaceMediaAssetRecord(tx, {
      workspaceId: input.workspaceId,
      uploadedByAgentId: input.uploadedByAgentId ?? null,
      title: normalizedTitle,
      originalName: normalizedOriginalName,
      storagePath: input.storagePath,
      publicUrl: input.publicUrl,
      mimeType: input.mimeType.trim() || "application/octet-stream",
      kind: resolvedKind,
      sizeBytes: input.sizeBytes,
      checksumSha256: normalizedChecksum,
      sourceModule: input.sourceModule
    });

    await tx.workspace.update({
      where: { id: input.workspaceId },
      data: {
        mediaLibraryUsedBytes: {
          increment: input.sizeBytes
        }
      }
    });

    return created;
  });
}

export async function renameWorkspaceMediaAsset(input: {
  assetId: string;
  title: string;
}) {
  const agent = await requireCurrentApiAgent();
  const normalizedTitle = input.title.trim();

  if (!normalizedTitle) {
    throw new Error("Media name is required.");
  }

  const asset = await prisma.workspaceMediaAsset.findFirst({
    where: {
      id: input.assetId,
      workspaceId: agent.workspaceId
    },
    include: {
      uploadedByAgent: {
        select: {
          name: true
        }
      }
    }
  });

  if (!asset) {
    throw new Error("Media asset not found.");
  }

  const updated = await prisma.workspaceMediaAsset.update({
    where: {
      id: asset.id
    },
    data: {
      title: normalizedTitle
    },
    include: {
      uploadedByAgent: {
        select: {
          name: true
        }
      }
    }
  });

  return mapMediaAsset(updated);
}

export async function deleteWorkspaceMediaAsset(assetId: string) {
  const agent = await requireCurrentApiAgent();
  const asset = await prisma.workspaceMediaAsset.findFirst({
    where: {
      id: assetId,
      workspaceId: agent.workspaceId
    }
  });

  if (!asset) {
    throw new Error("Media asset not found.");
  }

  await assertWorkspaceMediaAssetDeleteAllowed(agent.workspaceId, asset.id);

  await prisma.$transaction(async (tx) => {
    await lockWorkspaceMediaUsage(tx, agent.workspaceId);
    await tx.workspaceMediaAsset.delete({
      where: { id: asset.id }
    });

    const workspace = await tx.workspace.findUnique({
      where: { id: agent.workspaceId },
      select: { mediaLibraryUsedBytes: true }
    });

    await tx.workspace.update({
      where: { id: agent.workspaceId },
      data: {
        mediaLibraryUsedBytes: Math.max(
          toSafeStorageNumber(workspace?.mediaLibraryUsedBytes) - asset.sizeBytes,
          0
        )
      }
    });
  });

  await rm(asset.storagePath, { force: true });
}

export function isRenderableMediaKind(kind: MediaAssetKind) {
  return kind === MediaAssetKind.IMAGE || kind === MediaAssetKind.AUDIO || kind === MediaAssetKind.VIDEO;
}

export async function findWorkspaceMediaAssetById(assetId: string) {
  const agent = await requireCurrentApiAgent();
  return prisma.workspaceMediaAsset.findFirst({
    where: {
      id: assetId,
      workspaceId: agent.workspaceId
    }
  });
}

export function getClientMediaPath(assetId: string) {
  return `/api/media-library/${assetId}`;
}

export async function recalculateWorkspaceMediaUsageBytes(workspaceId: string) {
  const aggregate = await prisma.workspaceMediaAsset.aggregate({
    where: { workspaceId },
    _sum: {
      sizeBytes: true
    }
  });

  const nextUsedBytes = aggregate._sum.sizeBytes ?? 0;
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      mediaLibraryUsedBytes: nextUsedBytes
    }
  });

  return nextUsedBytes;
}

export function isWorkspaceMediaStorageLimitError(error: unknown): error is WorkspaceMediaStorageLimitError {
  return error instanceof WorkspaceMediaStorageLimitError;
}

async function prepareUploadedFile(file: File): Promise<PreparedUpload> {
  const kind = toMediaAssetKind(
    validateInboxUploadFile({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size
    })
  );
  const sanitizedOriginalName = sanitizeUploadedFileName(file.name);
  const extension = path.extname(sanitizedOriginalName) || inferExtension(file.type, kind);
  const mimeType = file.type.trim() || inferMimeType(sanitizedOriginalName, kind) || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");

  return {
    dedupeKey: `${checksumSha256}:${file.size}:${mimeType}`,
    originalName: file.name,
    sanitizedOriginalName,
    title: deriveTitleFromFileName(file.name),
    mimeType,
    kind,
    sizeBytes: file.size,
    extension,
    checksumSha256,
    buffer
  };
}

async function writePreparedUploadFile(upload: PreparedUpload): Promise<StoredPreparedUpload> {
  const fileName = `${Date.now()}-${randomUUID().replace(/-/g, "")}${upload.extension}`;
  await mkdir(MEDIA_LIBRARY_UPLOAD_DIR, { recursive: true });
  const storagePath = path.join(MEDIA_LIBRARY_UPLOAD_DIR, fileName);
  await writeFile(storagePath, upload.buffer);

  return {
    ...upload,
    storagePath,
    publicUrl: `/uploads/media-library/${fileName}`
  };
}

async function createWorkspaceMediaAssetRecord(
  tx: TransactionClient,
  input: {
    workspaceId: string;
    uploadedByAgentId: string | null;
    title: string;
    originalName: string;
    storagePath: string;
    publicUrl: string;
    mimeType: string;
    kind: MediaAssetKind;
    sizeBytes: number;
    checksumSha256: string | null;
    sourceModule: MediaAssetSourceValue;
  }
) {
  const createInput: WorkspaceMediaAssetCreateData = {
    workspaceId: input.workspaceId,
    uploadedByAgentId: input.uploadedByAgentId,
    title: input.title,
    originalName: input.originalName,
    storagePath: input.storagePath,
    publicUrl: input.publicUrl,
    mimeType: input.mimeType,
    kind: input.kind as WorkspaceMediaAssetCreateData["kind"],
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
    sourceModule: input.sourceModule as WorkspaceMediaAssetCreateData["sourceModule"]
  };

  let asset;
  try {
    asset = await tx.workspaceMediaAsset.create({
      data: createInput,
      include: {
        uploadedByAgent: {
          select: {
            name: true
          }
        }
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isLegacyEnumError =
      errorMessage.includes("MediaAssetKind") &&
      (errorMessage.includes("DOCUMENT") || errorMessage.includes("AUDIO"));

    if (
      isLegacyEnumError &&
      (input.kind === MediaAssetKind.DOCUMENT || input.kind === MediaAssetKind.AUDIO)
    ) {
      asset = await tx.workspaceMediaAsset.create({
        data: {
          ...createInput,
          kind: MediaAssetKind.VIDEO as WorkspaceMediaAssetCreateData["kind"]
        },
        include: {
          uploadedByAgent: {
            select: {
              name: true
            }
          }
        }
      });
    } else {
      throw error;
    }
  }

  return mapMediaAsset(asset);
}

async function lockWorkspaceMediaUsage(tx: TransactionClient, workspaceId: string) {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string; mediaLibraryUsedBytes: bigint | number }>>(
    `SELECT id, "mediaLibraryUsedBytes"
     FROM "Workspace"
     WHERE id = $1
     LIMIT 1
     FOR UPDATE`,
    workspaceId
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Workspace not found.");
  }

  return {
    ...row,
    mediaLibraryUsedBytes: toSafeStorageNumber(row.mediaLibraryUsedBytes)
  };
}

async function assertWorkspaceMediaAssetDeleteAllowed(workspaceId: string, assetId: string) {
  const jsonAssetId = `"${assetId}"`;
  const [
    replyRuleCount,
    followUpRuleCount,
    messageCount,
    outboundJobCount,
    envelopeCount,
    quickReplyCount,
    campaignDraftCount,
    campaignRunCount,
    workflowCount
  ] = await Promise.all([
    prisma.automationRule.count({
      where: {
        workspaceId,
        replyMediaAssetId: assetId
      }
    }),
    prisma.automationRule.count({
      where: {
        workspaceId,
        followUpMediaAssetId: assetId
      }
    }),
    prisma.message.count({
      where: {
        mediaAssetId: assetId
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        mediaAssetId: assetId
      }
    }),
    prisma.whatsAppMessageEnvelope.count({
      where: {
        workspaceId,
        mediaAssetId: assetId
      }
    }),
    prisma.quickReply.count({
      where: {
        workspaceId,
        mediaAssetIdsJson: {
          contains: jsonAssetId
        }
      }
    }),
    prisma.campaignDraft.count({
      where: {
        workspaceId,
        selectedAttachmentIdsJson: {
          contains: jsonAssetId
        }
      }
    }),
    prisma.campaignRun.count({
      where: {
        workspaceId,
        selectedAttachmentIdsJson: {
          contains: jsonAssetId
        }
      }
    }),
    prisma.automationWorkflow.count({
      where: {
        workspaceId,
        definitionJson: {
          contains: assetId
        }
      }
    })
  ]);

  if (
    replyRuleCount ||
    followUpRuleCount ||
    messageCount ||
    outboundJobCount ||
    envelopeCount ||
    quickReplyCount ||
    campaignDraftCount ||
    campaignRunCount ||
    workflowCount
  ) {
    throw new Error("This media is still referenced by another workspace feature.");
  }
}

function mapMediaAsset(asset: {
  id: string;
  title: string;
  originalName: string;
  publicUrl: string;
  mimeType: string;
  kind: MediaAssetKind;
  sizeBytes: number;
  createdAt: Date;
  uploadedByAgent?: { name: string | null } | null;
}) {
  return {
    id: asset.id,
    title: asset.title,
    originalName: asset.originalName,
    publicUrl: getClientMediaPath(asset.id),
    mimeType: asset.mimeType,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    uploadedByName: asset.uploadedByAgent?.name ?? null,
    createdAtIso: asset.createdAt.toISOString()
  };
}

function deriveTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Media asset";
}

function inferExtension(mimeType: string, kind: MediaAssetKind) {
  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType) {
    const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim();
    if (subtype) {
      return `.${subtype}`;
    }
  }

  if (kind === MediaAssetKind.IMAGE) {
    return ".jpg";
  }

  if (kind === MediaAssetKind.AUDIO) {
    return ".mp3";
  }

  if (kind === MediaAssetKind.DOCUMENT) {
    return ".txt";
  }

  return ".mp4";
}

function inferMimeType(fileName: string, kind: MediaAssetKind) {
  const extension = path.extname(fileName).trim().toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".opus":
      return "audio/opus";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return kind === MediaAssetKind.AUDIO ? "audio/webm" : "video/webm";
    case ".3gp":
      return "video/3gpp";
    case ".mkv":
      return "video/x-matroska";
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".csv":
      return "text/csv";
    case ".ppt":
      return "application/vnd.ms-powerpoint";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".txt":
      return "text/plain";
    case ".rtf":
      return "application/rtf";
    case ".zip":
      return "application/zip";
    case ".rar":
      return "application/vnd.rar";
    case ".7z":
      return "application/x-7z-compressed";
    default:
      return kind === MediaAssetKind.AUDIO
        ? "audio/mpeg"
        : kind === MediaAssetKind.DOCUMENT
          ? "application/octet-stream"
          : null;
  }
}
