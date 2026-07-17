"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type WorkspaceMembership = {
  agentId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  isCurrent: boolean;
};

export function WorkspaceSwitcher({
  memberships,
  variant = "default"
}: {
  memberships: WorkspaceMembership[];
  variant?: "default" | "compact" | "menu";
}) {
  const router = useRouter();
  const currentMembership = memberships.find((membership) => membership.isCurrent) ?? memberships[0];
  const [selectedAgentId, setSelectedAgentId] = useState(currentMembership?.agentId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAgentId(currentMembership?.agentId ?? "");
    setPending(false);
  }, [currentMembership?.agentId]);

  async function switchWorkspace(agentId: string) {
    if (!agentId || agentId === currentMembership?.agentId) {
      return;
    }

    setPending(true);
    setError(null);

    const response = await fetch("/api/auth/switch-workspace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId
      })
    });

    const data = (await response.json()) as { error?: string; redirectTo?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to switch workspace.");
      setPending(false);
      return;
    }

    router.push(data.redirectTo ?? "/inbox");
    router.refresh();
  }

  if (memberships.length <= 1) {
    return null;
  }

  const isCompactVariant = variant === "compact" || variant === "menu";
  const isMenuVariant = variant === "menu";

  return (
    <div className={`workspace-switcher${isCompactVariant ? " compact" : ""}${isMenuVariant ? " menu" : ""}`}>
      <label className="workspace-switcher-label" htmlFor="workspace-switcher">
        Workspace
      </label>
      <select
        className="app-select workspace-switcher-select"
        id="workspace-switcher"
        onChange={(event) => {
          const nextAgentId = event.target.value;
          setSelectedAgentId(nextAgentId);
          void switchWorkspace(nextAgentId);
        }}
        value={selectedAgentId}
      >
        {memberships.map((membership) => (
          <option key={membership.agentId} value={membership.agentId}>
            {isMenuVariant ? membership.workspaceName : `${membership.workspaceName} (${membership.role.toLowerCase()})`}
          </option>
        ))}
      </select>

      {isMenuVariant ? null : (
        <button
          className="button button-secondary workspace-switcher-button"
          disabled={pending || selectedAgentId === currentMembership?.agentId}
          onClick={() => void switchWorkspace(selectedAgentId)}
          type="button"
        >
          {pending ? "Switching..." : "Switch workspace"}
        </button>
      )}

      {error ? <p className="form-error workspace-switcher-error">{error}</p> : null}
    </div>
  );
}
