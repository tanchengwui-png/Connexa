import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { MediaAssetKind } from "@prisma/client";
import { requireCurrentApiAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { getAppBaseUrl, resolveMediaAssetUrl, toClientMediaUrl } from "@/lib/media-library-urls";
import { type MediaLibraryAsset } from "@/lib/media-library-shared";
import { prisma } from "@/lib/prisma";

const MEDIA_LIBRARY_MAX_ITEMS = 40;
const MEDIA_LIBRARY_MAX_FILE_BYTES = 20 * 1024 * 1024;
const MEDIA_LIBRARY_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "media-library");

export async function getMediaLibraryData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const assets = await listWorkspaceMediaAssets(workspaceId);

  return {
    assets,
    limits: {
      maxItems: MEDIA_LIBRARY_MAX_ITEMS,
      maxFileBytes: MEDIA_LIBRARY_MAX_FILE_BYTES,
      remainingItems: Math.max(0, MEDIA_LIBRARY_MAX_ITEMS - assets.length)
    }
  };
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

  return assets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    originalName: asset.originalName,
    publicUrl: getClientMediaPath(asset.id),
    mimeType: asset.mimeType,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    uploadedByName: asset.uploadedByAgent?.name ?? null,
    createdAtIso: asset.createdAt.toISOString()
  }));
}

export async function createWorkspaceMediaAsset(input: {
  file: File;
}) {
  const agent = await requireCurrentApiAgent();
  const currentCount = await prisma.workspaceMediaAsset.count({
    where: { workspaceId: agent.workspaceId }
  });

  if (currentCount >= MEDIA_LIBRARY_MAX_ITEMS) {
    throw new Error(`Media library is full. Keep up to ${MEDIA_LIBRARY_MAX_ITEMS} files.`);
  }

  const file = input.file;
  if (file.size > MEDIA_LIBRARY_MAX_FILE_BYTES) {
    throw new Error("Media uploads must be 20 MB or smaller.");
  }

  const kind = inferMediaKind(file.type);
  if (!kind) {
    throw new Error("Only image, audio, video, and PDF uploads are supported.");
  }

  const extension = path.extname(file.name) || inferExtension(file.type, kind);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;

  await mkdir(MEDIA_LIBRARY_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(MEDIA_LIBRARY_UPLOAD_DIR, fileName);
  const arrayBuffer = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));

  const publicPath = `/uploads/media-library/${fileName}`;
  const normalizedTitle = deriveTitleFromFileName(file.name);

  const asset = await prisma.workspaceMediaAsset.create({
    data: {
      workspaceId: agent.workspaceId,
      uploadedByAgentId: agent.id,
      title: normalizedTitle,
      originalName: file.name,
      storagePath: filePath,
      publicUrl: publicPath,
      mimeType: file.type || "application/octet-stream",
      kind,
      sizeBytes: file.size
    },
    include: {
      uploadedByAgent: {
        select: {
          name: true
        }
      }
    }
  });

  return mapMediaAsset(asset);
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
    },
    include: {
      replyRules: {
        select: { id: true, name: true }
      },
      followUpRules: {
        select: { id: true, name: true }
      }
    }
  });

  if (!asset) {
    throw new Error("Media asset not found.");
  }

  if (asset.replyRules.length || asset.followUpRules.length) {
    throw new Error("This media is still used by an automation rule.");
  }

  await prisma.workspaceMediaAsset.delete({
    where: { id: asset.id }
  });
  await rm(asset.storagePath, { force: true });
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

export function isRenderableMediaKind(kind: MediaAssetKind) {
  return kind === MediaAssetKind.IMAGE || kind === MediaAssetKind.AUDIO || kind === MediaAssetKind.VIDEO;
}

export async function findWorkspaceMediaAssetById(assetId: string) {
  return prisma.workspaceMediaAsset.findUnique({
    where: {
      id: assetId
    }
  });
}

export function getClientMediaPath(assetId: string) {
  return `/api/media-library/${assetId}`;
}

function deriveTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Media asset";
}

function inferMediaKind(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return MediaAssetKind.IMAGE;
  }

  if (mimeType.startsWith("audio/")) {
    return MediaAssetKind.AUDIO;
  }

  if (mimeType.startsWith("video/")) {
    return MediaAssetKind.VIDEO;
  }

  if (mimeType === "application/pdf") {
    return MediaAssetKind.VIDEO;
  }

  return null;
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

  return ".mp4";
}
