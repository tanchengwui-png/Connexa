import { findWorkspaceById } from "@/lib/db-auth";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";

export async function requireCurrentWorkspace() {
  const workspaceId = await requireCurrentWorkspaceId();
  const workspace = await findWorkspaceById(workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  return workspace;
}
