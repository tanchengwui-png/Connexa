import { prisma } from "@/lib/prisma";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { QUICK_REPLY_CATEGORIES } from "@/lib/quick-reply-categories";

export async function getQuickRepliesData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    },
    include: {
      quickReplies: {
        orderBy: [{ isPinned: "desc" }, { category: "asc" }, { title: "asc" }]
      }
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  return {
    summary: {
      total: workspace.quickReplies.length,
      pinned: workspace.quickReplies.filter((item) => item.isPinned).length
    },
    quickReplies: workspace.quickReplies.map((item) => ({
      id: item.id,
      title: item.title,
      shortcut: item.shortcut,
      category: item.category,
      isPinned: item.isPinned,
      body: item.body
    })),
    categories: [...QUICK_REPLY_CATEGORIES]
  };
}

export async function createQuickReply(input: {
  title: string;
  shortcut: string;
  category?: string;
  isPinned?: boolean;
  body: string;
}) {
  const workspaceId = await requireCurrentWorkspaceId();

  const title = input.title.trim();
  const shortcut = input.shortcut.trim();
  const category = normalizeCategory(input.category);
  const body = input.body.trim();

  if (!title || !shortcut || !body) {
    throw new Error("Title, shortcut, and body are required.");
  }

  return prisma.quickReply.create({
    data: {
      workspaceId,
      title,
      shortcut,
      category,
      isPinned: Boolean(input.isPinned),
      body
    }
  });
}

export async function updateQuickReply(
  id: string,
  input: {
    title?: string;
    shortcut?: string;
    category?: string;
    isPinned?: boolean;
    body?: string;
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

  if (!title || !shortcut || !body) {
    throw new Error("Title, shortcut, and body are required.");
  }

  return prisma.quickReply.update({
    where: {
      id: quickReply.id
    },
    data: {
      title,
      shortcut,
      category,
      isPinned: Boolean(input.isPinned),
      body
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
