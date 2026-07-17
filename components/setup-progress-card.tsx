type SetupProgressCardProps = {
  activeStep: 1 | 2 | 3 | 4;
  selectedMethodLabel?: string | null;
  variant?: "guided" | "settings";
};

const steps = [
  {
    id: 1,
    title: "Select Number",
    description: "Choose the workspace WhatsApp channel you want to manage."
  },
  {
    id: 2,
    title: "Choose Method",
    description: "Use WhatsApp Web for QR setup or Business API for Meta Cloud."
  },
  {
    id: 3,
    title: "Connect Phone",
    description: "Scan QR or save API credentials for the selected channel."
  },
  {
    id: 4,
    title: "Verify Inbox",
    description: "Confirm the inbox is ready for live conversations."
  }
] as const;

export function SetupProgressCard({
  activeStep,
  selectedMethodLabel,
  variant = "settings"
}: SetupProgressCardProps) {
  const isGuided = variant === "guided";

  return (
    <div className="wa-progress-card">
      <div className="wa-progress-copy">
        <span className="wa-progress-kicker">{isGuided ? "Activate inbox" : "Let's Get Connected!"}</span>
        <h2>{isGuided ? "Connect WhatsApp first" : "WhatsApp setup"}</h2>
        <p>
          {isGuided
            ? "Link the business phone once so your team can start working from the shared inbox."
            : "Move through four simple steps: number, method, connection, and inbox verification."}
        </p>
      </div>

      {selectedMethodLabel ? (
        <div className="wa-progress-method-chip">{selectedMethodLabel}</div>
      ) : null}

      <div className="wa-progress-steps" aria-label="WhatsApp setup progress">
        {steps.map((step, index) => {
          const isActive = step.id === activeStep;
          const isComplete = step.id < activeStep;

          return (
            <div
              className={`wa-progress-step${isActive ? " active" : ""}${isComplete ? " complete" : ""}`}
              key={step.id}
            >
              <div className="wa-progress-marker-column" aria-hidden="true">
                <span className="wa-progress-marker">{step.id}</span>
                {index < steps.length - 1 ? <span className="wa-progress-connector" /> : null}
              </div>
              <div className="wa-progress-step-copy">
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
