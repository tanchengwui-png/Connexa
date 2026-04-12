import { prisma } from "@/lib/prisma";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";

export async function requireCurrentWorkspace() {
  const workspaceId = await requireCurrentWorkspaceId();
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    }
  });

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  return workspace;
}
