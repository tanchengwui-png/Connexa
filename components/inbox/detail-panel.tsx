"use client";

import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { ChevronLeftIcon, LightningIcon, NoteIcon } from "@/components/inbox/icons";
import { MetadataChip } from "@/components/inbox/metadata-chip";
import { MetadataRow } from "@/components/inbox/metadata-row";
import { SidebarCard } from "@/components/inbox/sidebar-card";
import { SidebarField } from "@/components/inbox/sidebar-field";
import { formatFinancingTag } from "@/lib/financing-tags";
import type { InboxQuickReply, InboxSelectedConversation } from "@/components/inbox/types";
import { useToast } from "@/components/toast-provider";

type DetailTab = "notes" | "profile" | "recent";

type DetailPanelProps = {
  onCreateLeadRecord: () => Promise<void>;
  onHideDetails: () => void;
  onRefreshConversation: () => void;
  onRemoveTag: (tag: string) => void;
  quickReplies: InboxQuickReply[];
  selectedConversation: InboxSelectedConversation;
  workspaceIndustryType: "PROPERTY" | "WORKSHOP" | "GENERIC";
};

export function InboxDetailPanel({
  onCreateLeadRecord,
  onHideDetails,
  onRefreshConversation,
  onRemoveTag,
  quickReplies,
  selectedConversation,
  workspaceIndustryType
}: DetailPanelProps) {
  const { success } = useToast();
  const [activeTab, setActiveTab] = useState<DetailTab>("profile");
  const [isScheduling, setIsScheduling] = useState(false);
  const [isSavingAppointment, setIsSavingAppointment] = useState(false);
  const [appointmentError, setAppointmentError] = useState<string | null>(null);
  const [appointmentForm, setAppointmentForm] = useState(() => createDefaultAppointmentForm());

  if (!selectedConversation) {
    return (
      <aside className="inbox-column inbox-detail-panel">
        <div className="inbox-empty-state">
          <p className="muted">Select a conversation to view contact details and activity.</p>
        </div>
      </aside>
    );
  }

  const latestMessage = selectedConversation.messages[selectedConversation.messages.length - 1];
  const conversation = selectedConversation;

  async function scheduleAppointment() {
    setIsSavingAppointment(true);
    setAppointmentError(null);

    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: conversation.id,
        title: appointmentForm.title,
        type: appointmentForm.type,
        startAt: new Date(appointmentForm.startAt).toISOString(),
        endAt: new Date(appointmentForm.endAt).toISOString(),
        location: appointmentForm.location,
        note: appointmentForm.note
      })
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setAppointmentError(payload?.error ?? "Unable to schedule appointment.");
      setIsSavingAppointment(false);
      return;
    }

    success("Appointment scheduled", "The property appointment has been added to Calendar.");
    setAppointmentForm(createDefaultAppointmentForm());
    setIsScheduling(false);
    setIsSavingAppointment(false);
    onRefreshConversation();
  }

  return (
    <aside className="inbox-column inbox-detail-panel">
      <div className="inbox-detail-stack whatsapp-reference-detail">
        <div className="inbox-detail-overview">
          <div className="inbox-detail-overview-head">
            <div className="inbox-detail-overview-copy">
              <strong>Contact info</strong>
              <span className="inbox-detail-overview-name" title={selectedConversation.contactName}>
                {selectedConversation.contactName}
              </span>
            </div>
            <button
              aria-label="Hide details"
              className="inbox-detail-collapse-button"
              onClick={onHideDetails}
              type="button"
            >
              <ChevronLeftIcon />
            </button>
          </div>
        </div>

        <div className="inbox-detail-tabs" role="tablist" aria-label="Contact info tabs">
          <TabButton active={activeTab === "profile"} label="Profile" onClick={() => setActiveTab("profile")} />
          <TabButton active={activeTab === "notes"} label="Notes" onClick={() => setActiveTab("notes")} />
          <TabButton active={activeTab === "recent"} label="Recent" onClick={() => setActiveTab("recent")} />
        </div>

        {activeTab === "profile" ? (
          <>
            <SidebarCard eyebrow="Profile" title={selectedConversation.contactName}>
              <div className="inbox-detail-grid">
                <SidebarField label="Phone" value={selectedConversation.phone} />
                <SidebarField label="Owner" value={selectedConversation.assignee} />
                <SidebarField label="Status" value={selectedConversation.status} />
                <SidebarField label="Messages" value={`${selectedConversation.messages.length}`} />
              </div>
            </SidebarCard>

            <SidebarCard eyebrow="Tags" title="Contact labels">
              <div className="inbox-detail-chip-row">
                {selectedConversation.tags.length ? (
                  selectedConversation.tags.map((tag) => (
                    <MetadataChip key={tag} onRemove={() => onRemoveTag(tag)}>
                      {tag}
                    </MetadataChip>
                  ))
                ) : (
                  <span className="inbox-detail-placeholder">No tags applied yet.</span>
                )}
              </div>
            </SidebarCard>

            {workspaceIndustryType === "PROPERTY" ? (
              <PropertyProfileCard
                appointmentError={appointmentError}
                appointmentForm={appointmentForm}
                isSavingAppointment={isSavingAppointment}
                isScheduling={isScheduling}
                onAppointmentFormChange={setAppointmentForm}
                onCreateLeadRecord={onCreateLeadRecord}
                onSchedule={() => void scheduleAppointment()}
                onToggleSchedule={() => setIsScheduling((current) => !current)}
                selectedConversation={selectedConversation}
              />
            ) : null}

            {selectedConversation.lead?.product ? (
              <SidebarCard eyebrow="Profile" title={selectedConversation.lead.product.name}>
                <div className="inbox-detail-grid">
                  {selectedConversation.lead.product.area ? (
                    <SidebarField label="Area" value={selectedConversation.lead.product.area} />
                  ) : null}
                  {selectedConversation.lead.product.location ? (
                    <SidebarField label="Location" value={selectedConversation.lead.product.location} />
                  ) : null}
                  <SidebarField
                    label="Price range"
                    value={
                      selectedConversation.lead.product.priceMin || selectedConversation.lead.product.priceMax
                        ? `${selectedConversation.lead.product.priceMin ?? "?"} - ${
                            selectedConversation.lead.product.priceMax ?? "?"
                          }`
                        : "Not set"
                    }
                  />
                </div>
                {selectedConversation.lead.product.financingTags.length ? (
                  <div className="inbox-detail-chip-row">
                    {selectedConversation.lead.product.financingTags.map((tag) => (
                      <MetadataChip key={tag}>{formatFinancingTag(tag)}</MetadataChip>
                    ))}
                  </div>
                ) : null}
              </SidebarCard>
            ) : null}
          </>
        ) : null}

        {activeTab === "notes" ? (
          <SidebarCard eyebrow="Notes" title="Internal context">
            <div className="inbox-detail-feed">
              {selectedConversation.notes.length ? (
                selectedConversation.notes.map((note) => (
                  <div className="inbox-detail-feed-item" key={note.id}>
                    <div className="inbox-detail-feed-head">
                      <strong>{note.author}</strong>
                      <span>{note.createdAt}</span>
                    </div>
                    <p>{note.body}</p>
                  </div>
                ))
              ) : (
                <div className="inbox-detail-placeholder-block">
                  <NoteIcon />
                  <span>No internal notes saved yet.</span>
                </div>
              )}
            </div>
          </SidebarCard>
        ) : null}

        {activeTab === "recent" ? (
          <>
            <SidebarCard eyebrow="Activity" title="Conversation summary">
              <div className="inbox-detail-list">
                <MetadataRow label="Latest activity" value={latestMessage?.sentAt ?? "No activity"} />
                <MetadataRow label="Quick replies" value={`${quickReplies.length} available`} />
                <MetadataRow label="Owner" value={selectedConversation.assignee} />
              </div>
            </SidebarCard>

            <SidebarCard eyebrow="Recent" title="Latest thread events">
              <div className="inbox-detail-feed">
                <div className="inbox-detail-feed-item">
                  <div className="inbox-detail-feed-head">
                    <strong>Last customer reply</strong>
                    <span>{latestMessage?.sentAt ?? "No reply yet"}</span>
                  </div>
                  <p>{latestMessage?.body ?? "This conversation does not have message history yet."}</p>
                </div>
              </div>
            </SidebarCard>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`inbox-detail-tab${active ? " active" : ""}`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function PropertyProfileCard({
  appointmentError,
  appointmentForm,
  isSavingAppointment,
  isScheduling,
  onAppointmentFormChange,
  onCreateLeadRecord,
  onSchedule,
  onToggleSchedule,
  selectedConversation
}: {
  appointmentError: string | null;
  appointmentForm: ReturnType<typeof createDefaultAppointmentForm>;
  isSavingAppointment: boolean;
  isScheduling: boolean;
  onAppointmentFormChange: Dispatch<SetStateAction<ReturnType<typeof createDefaultAppointmentForm>>>;
  onCreateLeadRecord: () => Promise<void>;
  onSchedule: () => void;
  onToggleSchedule: () => void;
  selectedConversation: NonNullable<InboxSelectedConversation>;
}) {
  if (!selectedConversation.lead) {
    return (
      <SidebarCard eyebrow="Profile" title="No linked lead">
        <div className="inbox-detail-placeholder-block">
          <LightningIcon />
          <span>No property lead is linked to this contact yet.</span>
          <button className="inbox-search-tool" onClick={() => void onCreateLeadRecord()} type="button">
            Create property record
          </button>
        </div>
      </SidebarCard>
    );
  }

  return (
    <SidebarCard eyebrow="Profile" title={selectedConversation.lead.project}>
      <div className="inbox-detail-chip-row">
        <MetadataChip>{selectedConversation.lead.stage}</MetadataChip>
        <MetadataChip tone="hot">{selectedConversation.lead.priority}</MetadataChip>
      </div>
      <div className="inbox-detail-grid">
        <SidebarField label="Area" value={selectedConversation.lead.preferredArea ?? "Not captured"} />
        <SidebarField label="Budget" value={selectedConversation.lead.budget ?? "Not captured"} />
        <SidebarField label="Financing" value={selectedConversation.lead.financingStatus ?? "Not captured"} />
        <SidebarField label="Next action" value={selectedConversation.lead.nextActionAt ?? "No reminder set"} />
      </div>
      <div className="inbox-detail-action-row">
        <button className="inbox-search-tool" onClick={onToggleSchedule} type="button">
          {isScheduling ? "Close scheduler" : "Schedule appointment"}
        </button>
        <a className="inbox-search-tool" href={`/leads/${selectedConversation.lead.id}`}>
          Open property record
        </a>
      </div>
      {isScheduling ? (
        <div className="inbox-appointment-form">
          <label className="contact-assignment-label">
            <span>Appointment title</span>
            <input
              className="lead-record-input"
              onChange={(event) => onAppointmentFormChange((current) => ({ ...current, title: event.target.value }))}
              type="text"
              value={appointmentForm.title}
            />
          </label>
          <div className="inbox-appointment-grid">
            <label className="contact-assignment-label">
              <span>Type</span>
              <select
                className="lead-record-input app-select"
                onChange={(event) =>
                  onAppointmentFormChange((current) => ({
                    ...current,
                    type: event.target.value
                  }))
                }
                value={appointmentForm.type}
              >
                <option value="SITE_VISIT">Site visit</option>
                <option value="CALL">Call</option>
                <option value="MEETING">Meeting</option>
              </select>
            </label>
            <div className="inbox-appointment-date-stack">
              <label className="contact-assignment-label">
                <span>Start</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => onAppointmentFormChange((current) => ({ ...current, startAt: event.target.value }))}
                  type="datetime-local"
                  value={appointmentForm.startAt}
                />
              </label>
              <label className="contact-assignment-label">
                <span>End</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => onAppointmentFormChange((current) => ({ ...current, endAt: event.target.value }))}
                  type="datetime-local"
                  value={appointmentForm.endAt}
                />
              </label>
            </div>
          </div>
          {appointmentError ? <div className="form-error">{appointmentError}</div> : null}
          <button
            className="button button-primary"
            disabled={isSavingAppointment}
            onClick={onSchedule}
            type="button"
          >
            {isSavingAppointment ? "Scheduling..." : "Confirm appointment"}
          </button>
        </div>
      ) : null}
    </SidebarCard>
  );
}

function createDefaultAppointmentForm(title = "Property site visit", location = "") {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title,
    type: "SITE_VISIT",
    startAt: toDateTimeLocalValue(start),
    endAt: toDateTimeLocalValue(end),
    location,
    note: ""
  };
}

function toDateTimeLocalValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
