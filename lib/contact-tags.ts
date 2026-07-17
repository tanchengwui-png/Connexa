import { randomUUID } from "node:crypto";
import { execute, queryMany, queryOne } from "@/lib/db";
import {
  findContactTagByName,
  normalizeContactTagKey,
  normalizeContactTagName,
  sortContactTags
} from "@/lib/contact-tag-utils";

type WorkspaceContactTagRow = {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type InferredContactTagRow = {
  name: string;
};

export type WorkspaceContactTag = {
  id: string;
  name: string;
  description: string | null;
  source: "library" | "inferred";
};

let ensureWorkspaceContactTagsTablePromise: Promise<void> | null = null;

export async function ensureWorkspaceContactTagsTable() {
  if (!ensureWorkspaceContactTagsTablePromise) {
    ensureWorkspaceContactTagsTablePromise = (async () => {
      await execute(
        `CREATE TABLE IF NOT EXISTS "WorkspaceContactTag" (
          id TEXT PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          name TEXT NOT NULL,
          "normalizedName" TEXT NOT NULL,
          description TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
      );
      await execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceContactTag_workspaceId_normalizedName_key"
         ON "WorkspaceContactTag" ("workspaceId", "normalizedName")`
      );
      await execute(
        `CREATE INDEX IF NOT EXISTS "WorkspaceContactTag_workspaceId_createdAt_idx"
         ON "WorkspaceContactTag" ("workspaceId", "createdAt" DESC)`
      );
    })().catch((error) => {
      ensureWorkspaceContactTagsTablePromise = null;
      throw error;
    });
  }

  await ensureWorkspaceContactTagsTablePromise;
}

export async function listWorkspaceContactTags(workspaceId: string) {
  const inferredTags = await queryMany<InferredContactTagRow>(
    `SELECT DISTINCT TRIM(tag.value) AS name
     FROM "Contact" c
     CROSS JOIN LATERAL unnest(regexp_split_to_array(COALESCE(c.tags, ''), '\\s*,\\s*')) AS tag(value)
     WHERE c."workspaceId" = $1
       AND TRIM(tag.value) <> ''
     ORDER BY name ASC`,
    [workspaceId]
  );

  let libraryTags: WorkspaceContactTagRow[] = [];

  try {
    await ensureWorkspaceContactTagsTable();
    libraryTags = await queryMany<WorkspaceContactTagRow>(
      `SELECT id, "workspaceId", name, "normalizedName", description, "createdAt", "updatedAt"
       FROM "WorkspaceContactTag"
       WHERE "workspaceId" = $1
       ORDER BY LOWER(name) ASC, "createdAt" ASC`,
      [workspaceId]
    );
  } catch (error) {
    if (!isOptionalWorkspaceContactTagStorageError(error)) {
      throw error;
    }
  }

  const merged = new Map<string, WorkspaceContactTag>();

  inferredTags.forEach((tag) => {
    const name = normalizeContactTagName(tag.name);
    const normalizedName = normalizeContactTagKey(name);
    if (!normalizedName) {
      return;
    }

    merged.set(normalizedName, {
      id: `inferred:${normalizedName}`,
      name,
      description: null,
      source: "inferred"
    });
  });

  libraryTags.forEach((tag) => {
    const name = normalizeContactTagName(tag.name);
    const normalizedName = normalizeContactTagKey(name);
    if (!normalizedName) {
      return;
    }

    merged.set(normalizedName, {
      id: tag.id,
      name,
      description: tag.description,
      source: "library"
    });
  });

  return sortContactTags([...merged.values()]);
}

export async function createWorkspaceContactTag(input: {
  workspaceId: string;
  name: string;
  description?: string | null;
}) {
  await ensureWorkspaceContactTagsTable();

  const name = normalizeContactTagName(input.name);
  const normalizedName = normalizeContactTagKey(name);
  const description = normalizeContactTagName(input.description ?? "") || null;

  if (!normalizedName) {
    throw new Error("Tag name is required.");
  }

  const existingTags = await listWorkspaceContactTags(input.workspaceId);
  if (findContactTagByName(existingTags, name)) {
    throw new Error("A tag with this name already exists.");
  }

  const createdTag = await queryOne<WorkspaceContactTagRow>(
    `INSERT INTO "WorkspaceContactTag" (
       id,
       "workspaceId",
       name,
       "normalizedName",
       description
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, "workspaceId", name, "normalizedName", description, "createdAt", "updatedAt"`,
    [randomUUID(), input.workspaceId, name, normalizedName, description]
  );

  if (!createdTag) {
    throw new Error("Unable to create tag.");
  }

  return {
    id: createdTag.id,
    name: createdTag.name,
    description: createdTag.description,
    source: "library" as const
  };
}

function isOptionalWorkspaceContactTagStorageError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
  };

  return (
    candidate.code === "42501" ||
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      (candidate.message.includes('permission denied') ||
        candidate.message.includes('relation "WorkspaceContactTag" does not exist')))
  );
}
