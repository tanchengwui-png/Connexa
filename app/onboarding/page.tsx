import { DashboardShell } from "@/components/dashboard-shell";
import { requireCurrentAgent } from "@/lib/auth/current-user";

const onboardingSteps = [
  {
    number: "01",
    title: "Invite your team",
    body: "Bring agents, coordinators, and admin staff into the workspace so assignments and notes stay centralized."
  },
  {
    number: "02",
    title: "Review the inbox flow",
    body: "Open the shared inbox, review how conversations are assigned, and confirm the daily operating workflow."
  },
  {
    number: "03",
    title: "Connect WhatsApp later",
    body: "When you are ready, finish the provider setup from settings and move the workspace into live use."
  }
];

export default async function OnboardingPage() {
  const agent = await requireCurrentAgent();

  return (
    <DashboardShell currentPath="/settings">
      <section className="onboarding-dark-hero">
        <div className="onboarding-dark-copy">
          <span className="badge connexa-public-badge">Workspace onboarding</span>
          <h1>{agent.name}, your workspace is ready.</h1>
          <p>
            Start with the essentials: confirm the team setup, review the shared inbox
            flow, and connect the business WhatsApp number when you are ready.
          </p>
        </div>

        <div className="onboarding-dark-status">
          <div className="onboarding-dark-status-card">
            <span>Workspace status</span>
            <strong>Ready for setup</strong>
            <p>Core workspace access is already active for your manager account.</p>
          </div>
        </div>
      </section>

      <section className="onboarding-dark-grid">
        <article className="onboarding-dark-panel">
          <div className="onboarding-dark-panel-head">
            <div>
              <h2>Next steps</h2>
              <p>Keep the first-run flow short and operational.</p>
            </div>
          </div>

          <div className="onboarding-dark-steps">
            {onboardingSteps.map((step) => (
              <article className="onboarding-dark-step" key={step.number}>
                <span>{step.number}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </article>
            ))}
          </div>
        </article>

        <aside className="onboarding-dark-sidepanel">
          <div className="onboarding-dark-sidecard">
            <span>Recommended path</span>
            <strong>Invite team first</strong>
            <p>
              The workspace becomes more useful immediately once the core team can view,
              assign, and hand off conversations together.
            </p>
          </div>

          <div className="onboarding-dark-sidecard">
            <span>Where to continue</span>
            <strong>Settings and inbox</strong>
            <p>
              Use settings for provider setup and the inbox to review how the live operating
              flow will work day to day.
            </p>
          </div>
        </aside>
      </section>
    </DashboardShell>
  );
}
