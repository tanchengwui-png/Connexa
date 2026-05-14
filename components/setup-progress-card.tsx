type SetupProgressCardProps = {
  activeStep: 1 | 2;
  selectedMethodLabel?: string | null;
  variant?: "guided" | "settings";
};

const steps = [
  {
    id: 1,
    title: "Integration Method",
    description: "Choose the connection path that matches your scale and operational model."
  },
  {
    id: 2,
    title: "Setup Connection",
    description: "Configure credentials or scan QR, then finalize the workspace connection."
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
        <span className="wa-progress-kicker">{isGuided ? "Activate inbox" : "Let&apos;s Get Connected!"}</span>
        <h2>{isGuided ? "Connect WhatsApp first" : "Setup your account"}</h2>
        <p>
          {isGuided
            ? "Link the business phone once so your team can start working from the shared inbox."
            : "Move through a short guided setup so the inbox lands on a stable WhatsApp connection."}
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
