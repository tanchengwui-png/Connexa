"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginWorkspaceOption = {
  agentId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
};

type WorkspaceSelectionState = {
  challengeToken: string;
  options: LoginWorkspaceOption[];
};

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectionState, setSelectionState] = useState<WorkspaceSelectionState | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData(event.currentTarget);

    if (selectionState) {
      const response = await fetch("/api/auth/login/select-workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          challengeToken: selectionState.challengeToken,
          agentId: selectedAgentId
        })
      });

      const data = (await response.json()) as { error?: string; redirectTo?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to complete sign in.");
        setPending(false);
        return;
      }

      router.push(data.redirectTo ?? "/inbox");
      router.refresh();
      return;
    }

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        remember: formData.get("remember") === "on"
      })
    });

    const data = (await response.json()) as {
      error?: string;
      redirectTo?: string;
      requiresWorkspaceSelection?: boolean;
      challengeToken?: string;
      options?: LoginWorkspaceOption[];
    };

    if (!response.ok) {
      setError(data.error ?? "Unable to sign in.");
      setPending(false);
      return;
    }

    if (data.requiresWorkspaceSelection && data.challengeToken && data.options?.length) {
      setSelectionState({
        challengeToken: data.challengeToken,
        options: data.options
      });
      setSelectedAgentId(data.options[0]?.agentId ?? "");
      setPending(false);
      return;
    }

    router.push(data.redirectTo ?? "/inbox");
    router.refresh();
  }

  return (
    <form className="auth-form metrica-login-form" method="post" onSubmit={handleSubmit}>
      {selectionState ? (
        <>
          <div className="auth-support-note">
            <strong>Choose a workspace</strong>
            <span className="muted">This email belongs to multiple workspaces. Select which one to enter.</span>
          </div>

          <label className="control-block">
            <span className="control-label">Workspace</span>
            <select
              className="control-input"
              name="agentId"
              onChange={(event) => setSelectedAgentId(event.target.value)}
              value={selectedAgentId}
            >
              {selectionState.options.map((option) => (
                <option key={option.agentId} value={option.agentId}>
                  {`${option.workspaceName} (${option.role.toLowerCase()})`}
                </option>
              ))}
            </select>
          </label>

          <button
            className="auth-inline-link"
            onClick={() => {
              setSelectionState(null);
              setSelectedAgentId("");
              setError(null);
            }}
            type="button"
          >
            Use a different email
          </button>
        </>
      ) : (
        <>
          <label className="control-block">
            <span className="control-label">Email</span>
            <input className="control-input" name="email" placeholder="you@company.com" type="email" />
          </label>

          <label className="control-block">
            <span className="control-label">Password</span>
            <input
              className="control-input"
              name="password"
              placeholder="Enter your password"
              type="password"
            />
          </label>

          <div className="auth-form-meta">
            <label className="auth-checkbox">
              <input name="remember" type="checkbox" />
              <span>Remember me</span>
            </label>

            <a className="auth-inline-link" href="/">
              Forgot password?
            </a>
          </div>
        </>
      )}

      {error ? <p className="form-error metrica-login-error">{error}</p> : null}

      <button className="button button-primary auth-submit metrica-login-submit" disabled={pending} type="submit">
        {pending ? "Logging in..." : selectionState ? "Continue" : "Log In"}
      </button>
    </form>
  );
}
