"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ProductSummary = {
  id: string;
  name: string;
  description: string | null;
  area: string | null;
  location: string | null;
  financing: string | null;
  priceMin: number | null;
  priceMax: number | null;
  imageUrls: string[];
};

type LeadRecordFormProps = {
  lead: {
    id: string;
    name: string;
    phone: string;
    project: string;
    stage: string;
    priority: string;
    preferredArea: string | null;
    budget: number | null;
    financingStatus: string | null;
    nextActionAtIso: string | null;
    sourceDetail: string | null;
    owner: string | null;
    images: string[];
    productId: string | null;
  };
  products: ProductSummary[];
};

const stageOptions = [
  { label: "New lead", value: "NEW_LEAD" },
  { label: "Qualified", value: "QUALIFIED" },
  { label: "Site visit booked", value: "SITE_VISIT_BOOKED" },
  { label: "Follow-up", value: "FOLLOW_UP" },
  { label: "Negotiation", value: "NEGOTIATION" },
  { label: "Closed won", value: "CLOSED_WON" },
  { label: "Closed lost", value: "CLOSED_LOST" }
] as const;

const priorityOptions = [
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "Urgent", value: "URGENT" }
] as const;

export function LeadRecordForm({ lead, products }: LeadRecordFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    budget: lead.budget ? `${lead.budget}` : "",
    financingStatus: lead.financingStatus ?? "",
    nextActionAt: toDateTimeLocalValue(lead.nextActionAtIso),
    preferredArea: lead.preferredArea ?? "",
    priority: lead.priority,
    project: lead.project,
    sourceDetail: lead.sourceDetail ?? "",
    stage: lead.stage,
    imageUrls: lead.images.join("\n"),
    productId: lead.productId ?? ""
  });

  const galleryImages = useMemo(
    () =>
      form.imageUrls
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    [form.imageUrls]
  );

  const linkedProduct = useMemo(
    () => products.find((product) => product.id === form.productId) ?? null,
    [form.productId, products]
  );

  const stageLabel = linkedProduct
    ? `${linkedProduct.area ?? "Area"}`
    : "No product selected yet.";

  return (
    <article className="content-card lead-record-page-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Lead record</h3>
          <p className="muted">
            Keep catalog data on the property and keep the lead focused on ownership, qualification,
            budget, and the next action.
          </p>
        </div>
        <a className="button button-secondary" href="/inbox">
          Back to inbox
        </a>
      </div>

      <div className="lead-record-hero">
        <div>
          <span className="badge">Lead overview</span>
          <h2>{lead.name}</h2>
          <p className="muted">{lead.phone}</p>
        </div>
        <div className="lead-record-meta">
          <div className="lead-record-meta-card">
            <span>Owner</span>
            <strong>{lead.owner ?? "Unassigned"}</strong>
          </div>
          <div className="lead-record-meta-card">
            <span>Record ID</span>
            <strong>{lead.id}</strong>
          </div>
        </div>
      </div>

      <div className="lead-record-layout">
        <section className="lead-record-panel">
          <div className="lead-record-section-head">
          <strong>Property link</strong>
          <span>Select the property catalog entry this lead references.</span>
          </div>

          <label className="lead-record-field lead-record-field-wide">
              <span>Property</span>
            <select
              className="lead-record-input app-select"
              onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}
              value={form.productId}
            >
              <option value="">-- Select property --</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <div className="lead-record-link-summary">
            <div>
              {linkedProduct ? (
                <>
                  <strong>{linkedProduct.name}</strong>
                  <p className="muted">{linkedProduct.description ?? "No description yet."}</p>
                </>
              ) : (
                <p className="muted">Property catalog entry not selected yet.</p>
              )}
            </div>
            <a className="button button-secondary" href="/products">
              {linkedProduct ? "Open catalog" : "Create property"}
            </a>
          </div>
        </section>

        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Lead workflow</strong>
            <span>Stage, priority, budget, and next action are lead-specific.</span>
          </div>

          <div className="lead-record-form-grid">
            <label className="lead-record-field lead-record-field-wide">
              <span>Project</span>
              <input
                className="lead-record-input"
                onChange={(event) => setForm((current) => ({ ...current, project: event.target.value }))}
                type="text"
                value={form.project}
              />
            </label>

            <label className="lead-record-field">
              <span>Stage</span>
              <select
                className="lead-record-input app-select"
                onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value }))}
                value={form.stage}
              >
                {stageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="lead-record-field">
              <span>Priority</span>
              <select
                className="lead-record-input app-select"
                onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                value={form.priority}
              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="lead-record-field">
              <span>Preferred area</span>
              <input
                className="lead-record-input"
                onChange={(event) =>
                  setForm((current) => ({ ...current, preferredArea: event.target.value }))
                }
                type="text"
                value={form.preferredArea}
              />
            </label>

            <label className="lead-record-field">
              <span>Budget</span>
              <input
                className="lead-record-input"
                inputMode="numeric"
                onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))}
                type="text"
                value={form.budget}
              />
            </label>

            <label className="lead-record-field">
              <span>Financing status</span>
              <input
                className="lead-record-input"
                onChange={(event) =>
                  setForm((current) => ({ ...current, financingStatus: event.target.value }))
                }
                type="text"
                value={form.financingStatus}
              />
            </label>

            <label className="lead-record-field">
              <span>Next action</span>
              <input
                className="lead-record-input"
                onChange={(event) => setForm((current) => ({ ...current, nextActionAt: event.target.value }))}
                type="datetime-local"
                value={form.nextActionAt}
              />
            </label>

            <label className="lead-record-field lead-record-field-wide">
              <span>Source detail</span>
              <input
                className="lead-record-input"
                onChange={(event) =>
                  setForm((current) => ({ ...current, sourceDetail: event.target.value }))
                }
                type="text"
                value={form.sourceDetail}
              />
            </label>
          </div>
        </section>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Images and collateral</strong>
          <span>
            Keep any lead-specific attachments here. Property catalog assets live separately.
          </span>
        </div>

        <label className="lead-record-field lead-record-field-wide">
          <span>Image URLs</span>
          <textarea
            className="lead-record-input lead-record-textarea"
            onChange={(event) => setForm((current) => ({ ...current, imageUrls: event.target.value }))}
            placeholder={"https://example.com/property-front.jpg\nhttps://example.com/floorplan.jpg"}
            value={form.imageUrls}
          />
        </label>

        <div className="lead-record-gallery">
          {galleryImages.length ? (
            galleryImages.map((imageUrl) => (
              <a
                className="lead-record-gallery-item"
                href={imageUrl}
                key={imageUrl}
                rel="noreferrer"
                target="_blank"
              >
                <span>Image</span>
                <strong>{imageUrl}</strong>
              </a>
            ))
          ) : (
            <div className="lead-record-empty">
              No images linked yet. Add public URLs so agents can reference them from the lead.
            </div>
          )}
        </div>
      </section>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}

      <div className="lead-record-actions">
        <button
          className="button button-primary"
          disabled={isPending}
          onClick={() => {
            if (!form.project.trim()) {
              setError("Project is required.");
              return;
            }

            setError(null);
            setSuccess(null);

            startTransition(async () => {
              const response = await fetch(`/api/leads/${lead.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  budget: form.budget.trim() ? Number(form.budget.trim()) : null,
                  customData: JSON.stringify({ imageUrls: galleryImages }),
                  financingStatus: form.financingStatus.trim() || null,
                  nextActionAt: form.nextActionAt || null,
                  preferredArea: form.preferredArea.trim() || null,
                  priority: form.priority,
                  project: form.project.trim(),
                  sourceDetail: form.sourceDetail.trim() || null,
                  stage: form.stage,
                  productId: form.productId || null
                })
              });

              if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                setError(payload?.error ?? "Unable to save lead record.");
                return;
              }

              setSuccess("Lead record saved.");
              router.refresh();
            });
          }}
          type="button"
        >
          {isPending ? "Saving..." : "Save lead record"}
        </button>
      </div>
    </article>
  );
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
