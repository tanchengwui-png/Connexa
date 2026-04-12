"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type IndustrySetupFormProps = {
  initialIndustryType: "PROPERTY" | "WORKSHOP" | "GENERIC";
};

const options = [
  {
    value: "PROPERTY",
    label: "Property",
    description: "Buyer pipeline, viewing follow-up, financing context, and project-based lead handling."
  },
  {
    value: "WORKSHOP",
    label: "Workshop",
    description: "Service bookings, vehicle context, quotation approval, and repair-status workflows."
  },
  {
    value: "GENERIC",
    label: "Generic",
    description: "Keep the platform neutral while you validate the inbox and team workflow first."
  }
] as const;

export function IndustrySetupForm({ initialIndustryType }: IndustrySetupFormProps) {
  const router = useRouter();
  const [value, setValue] = useState<"PROPERTY" | "WORKSHOP" | "GENERIC">(initialIndustryType);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  return (
    <div className="industry-setup-stack">
      <div className="industry-setup-options">
        {options.map((option) => (
          <button
            className={`industry-setup-option${value === option.value ? " active" : ""}`}
            key={option.value}
            onClick={() => setValue(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            <p>{option.description}</p>
          </button>
        ))}
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="industry-setup-actions">
        <button
          className="button button-primary"
          onClick={async () => {
            setIsPending(true);
            setError(null);

            const response = await fetch("/api/settings/industry", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                industryType: value
              })
            });

            if (!response.ok) {
              const payload = (await response.json().catch(() => null)) as { error?: string } | null;
              setError(payload?.error ?? "Unable to save industry setup.");
              setIsPending(false);
              return;
            }

            router.refresh();
            setIsPending(false);
          }}
          type="button"
        >
          {isPending ? "Saving..." : "Save industry profile"}
        </button>
      </div>
    </div>
  );
}
