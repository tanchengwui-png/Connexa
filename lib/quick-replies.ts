import { prisma } from "@/lib/prisma";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { QUICK_REPLY_CATEGORIES } from "@/lib/quick-reply-categories";
import { listWorkspaceMediaAssets } from "@/lib/media-library";
import { formatMediaAssetSize } from "@/lib/media-library-shared";

export async function getQuickRepliesData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const [workspace, mediaAssets] = await Promise.all([
    prisma.workspace.findUnique({
      where: {
        id: workspaceId
      },
      include: {
        quickReplies: {
          orderBy: [{ category: "asc" }, { title: "asc" }]
        }
      }
    }),
    listWorkspaceMediaAssets(workspaceId)
  ]);

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  return {
    summary: {
      total: workspace.quickReplies.length,
      withMedia: workspace.quickReplies.filter((item) => parseMediaAssetIds(item.mediaAssetIdsJson).length > 0).length
    },
    quickReplies: workspace.quickReplies.map((item) => ({
      id: item.id,
      title: item.title,
      shortcut: item.shortcut,
      category: item.category,
      body: item.body,
      mediaAssetIds: parseMediaAssetIds(item.mediaAssetIdsJson)
    })),
    categories: [...QUICK_REPLY_CATEGORIES],
    mediaAssets: mediaAssets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      publicUrl: asset.publicUrl,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeLabel: formatMediaAssetSize(asset.sizeBytes)
    }))
  };
}

export async function createQuickReply(input: {
  title: string;
  shortcut: string;
  category?: string;
  body: string;
  mediaAssetIds?: string[];
}) {
  const workspaceId = await requireCurrentWorkspaceId();

  const title = input.title.trim();
  const shortcut = input.shortcut.trim();
  const category = normalizeCategory(input.category);
  const body = input.body.trim();
  const mediaAssetIds = normalizeMediaAssetIds(input.mediaAssetIds);

  if (!title || !shortcut || !body) {
    throw new Error("Title, shortcut, and body are required.");
  }

  if (mediaAssetIds.length) {
    const mediaCount = await prisma.workspaceMediaAsset.count({
      where: {
        workspaceId,
        id: {
          in: mediaAssetIds
        }
      }
    });

    if (mediaCount !== mediaAssetIds.length) {
      throw new Error("One or more selected media assets were not found.");
    }
  }

  return prisma.quickReply.create({
    data: {
      workspaceId,
      title,
      shortcut,
      category,
      body,
      mediaAssetIdsJson: mediaAssetIds.length ? JSON.stringify(mediaAssetIds) : null
    }
  });
}

export async function updateQuickReply(
  id: string,
  input: {
    title?: string;
    shortcut?: string;
    category?: string;
    body?: string;
    mediaAssetIds?: string[];
  }
) {
  const workspaceId = await requireCurrentWorkspaceId();
  const quickReply = await prisma.quickReply.findFirst({
    where: {
      id,
      workspaceId
    },
    select: {
      id: true
    }
  });

  if (!quickReply) {
    throw new Error("Quick reply not found.");
  }

  const title = input.title?.trim() ?? "";
  const shortcut = input.shortcut?.trim() ?? "";
  const category = normalizeCategory(input.category);
  const body = input.body?.trim() ?? "";
  const mediaAssetIds = normalizeMediaAssetIds(input.mediaAssetIds);

  if (!title || !shortcut || !body) {
    throw new Error("Title, shortcut, and body are required.");
  }

  if (mediaAssetIds.length) {
    const mediaCount = await prisma.workspaceMediaAsset.count({
      where: {
        workspaceId,
        id: {
          in: mediaAssetIds
        }
      }
    });

    if (mediaCount !== mediaAssetIds.length) {
      throw new Error("One or more selected media assets were not found.");
    }
  }

  return prisma.quickReply.update({
    where: {
      id: quickReply.id
    },
    data: {
      title,
      shortcut,
      category,
      body,
      mediaAssetIdsJson: mediaAssetIds.length ? JSON.stringify(mediaAssetIds) : null
    }
  });
}

export async function deleteQuickReply(id: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const quickReply = await prisma.quickReply.findFirst({
    where: {
      id,
      workspaceId
    },
    select: {
      id: true
    }
  });

  if (!quickReply) {
    throw new Error("Quick reply not found.");
  }

  return prisma.quickReply.delete({
    where: {
      id: quickReply.id
    }
  });
}

function normalizeCategory(value?: string) {
  const normalized = value?.trim() || "General";
  return QUICK_REPLY_CATEGORIES.includes(normalized as (typeof QUICK_REPLY_CATEGORIES)[number])
    ? normalized
    : "General";
}

function normalizeMediaAssetIds(value?: string[]) {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)));
}

function parseMediaAssetIds(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
