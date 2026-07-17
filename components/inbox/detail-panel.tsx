"use client";

import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { ContactLabelsManager } from "@/components/inbox/contact-labels-manager";
import { ChevronLeftIcon, LightningIcon, NoteIcon } from "@/components/inbox/icons";
import { MetadataChip } from "@/components/inbox/metadata-chip";
import { MetadataRow } from "@/components/inbox/metadata-row";
import { SidebarCard } from "@/components/inbox/sidebar-card";
import { SidebarField } from "@/components/inbox/sidebar-field";
import { Button } from "@/components/ui/button";
import { formatFinancingTag } from "@/lib/financing-tags";
import {
  createMalaysiaDate,
  formatMalaysiaDateTimeLocalInput,
  getMalaysiaDateTimeParts,
  parseMalaysiaDateTimeLocalInput
} from "@/lib/malaysia-time";
import type { InboxContactTag, InboxQuickReply, InboxSelectedConversation } from "@/components/inbox/types";
import { useToast } from "@/components/toast-provider";

type DetailTab = "notes" | "profile" | "recent";

type DetailPanelProps = {
  availableContactTags: InboxContactTag[];
  onAddTag: (tagName: string) => Promise<{ error?: string; ok: boolean }>;
  onCreateTag: (input: { description: string | null; name: string }) => Promise<{
    error?: string;
    ok: boolean;
    tag?: InboxContactTag;
  }>;
  onCreateLeadRecord: () => Promise<void>;
  onHideDetails: () => void;
  onRefreshConversation: () => void;
  onRemoveTag: (tag: string) => void;
  quickReplies: InboxQuickReply[];
  selectedConversation: InboxSelectedConversation;
  workspaceIndustryType: "PROPERTY" | "WORKSHOP" | "GENERIC";
};

export function InboxDetailPanel({
  availableContactTags,
  onAddTag,
  onCreateTag,
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
  const profileIdentityField = getProfileIdentityField(selectedConversation);

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
        startAt: parseMalaysiaDateTimeLocalInput(appointmentForm.startAt)?.toISOString(),
        endAt: parseMalaysiaDateTimeLocalInput(appointmentForm.endAt)?.toISOString(),
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
              <strong>Contact Details</strong>
              <span className="inbox-detail-overview-name">Conversation profile and activity</span>
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

        <div className="inbox-contact-profile-card">
          <div className="inbox-contact-profile-avatar">
            {selectedConversation.photoUrl ? (
              <img
                alt=""
                className="chatbox-avatar-image"
                src={`/api/conversations/${selectedConversation.id}/avatar`}
              />
            ) : (
              getInitials(selectedConversation.contactName)
            )}
          </div>
          <strong className="inbox-contact-profile-name">{selectedConversation.contactName}</strong>
          <span className="inbox-contact-profile-subline">
            {selectedConversation.isGroup ? "Group conversation" : selectedConversation.phone}
          </span>
        </div>

        <div className="inbox-contact-quick-actions">
          <a className="inbox-contact-quick-action" href={`/message-logs?conversationId=${selectedConversation.id}`}>
            <span>Logs</span>
          </a>
          {selectedConversation.scheduledCount ? (
            <a className="inbox-contact-quick-action" href={`/scheduled-messages?conversationId=${selectedConversation.id}`}>
              <span>Scheduled</span>
            </a>
          ) : (
            <button className="inbox-contact-quick-action" onClick={() => setActiveTab("recent")} type="button">
              <span>Recent</span>
            </button>
          )}
          {selectedConversation.lead ? (
            <a className="inbox-contact-quick-action" href={`/leads/${selectedConversation.lead.id}`}>
              <span>Lead</span>
            </a>
          ) : (
            <button className="inbox-contact-quick-action" onClick={() => void onCreateLeadRecord()} type="button">
              <span>Create Lead</span>
            </button>
          )}
          <button className="inbox-contact-quick-action" onClick={() => setActiveTab("notes")} type="button">
            <span>Notes</span>
          </button>
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
                <SidebarField label={profileIdentityField.label} value={profileIdentityField.value} />
                <SidebarField label="Primary owner" value={selectedConversation.assignee} />
                <SidebarField
                  label="Supporting teammates"
                  value={selectedConversation.teammates.length ? selectedConversation.teammates.map((teammate) => teammate.name).join(", ") : "None"}
                />
                <SidebarField label="Status" value={selectedConversation.status} />
                <SidebarField label="Messages" value={`${selectedConversation.messages.length}`} />
              </div>
              <div className="inbox-detail-link-row">
                <a className="inbox-scheduled-link" href={`/message-logs?conversationId=${selectedConversation.id}`}>
                  Open message logs
                </a>
                {selectedConversation.scheduledCount ? (
                  <a className="inbox-scheduled-link" href={`/scheduled-messages?conversationId=${selectedConversation.id}`}>
                    Open scheduled queue
                  </a>
                ) : null}
              </div>
            </SidebarCard>

            <SidebarCard eyebrow="Tags" title="Contact labels">
              <ContactLabelsManager
                availableTags={availableContactTags}
                onAddTag={onAddTag}
                onCreateTag={onCreateTag}
                onRemoveTag={onRemoveTag}
                selectedTags={selectedConversation.tags}
              />
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
                <MetadataRow label="Primary owner" value={selectedConversation.assignee} />
                <MetadataRow
                  label="Supporting teammates"
                  value={selectedConversation.teammates.length ? selectedConversation.teammates.map((teammate) => teammate.name).join(", ") : "None"}
                />
              </div>
              <div className="inbox-detail-link-row">
                <a className="inbox-scheduled-link" href={`/message-logs?conversationId=${selectedConversation.id}`}>
                  View audit history
                </a>
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

function getInitials(value: string) {
  return value
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getProfileIdentityField(selectedConversation: NonNullable<DetailPanelProps["selectedConversation"]>) {
  if (selectedConversation.isGroup) {
    return {
      label: "Group",
      value: selectedConversation.contactName || "Group conversation"
    };
  }

  return {
    label: "Phone",
    value: selectedConversation.phone
  };
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
    <Button
      aria-selected={active}
      className={`inbox-detail-tab${active ? " active" : ""}`}
      onClick={onClick}
      role="tab"
      selected={active}
      variant="toggle"
    >
      {label}
    </Button>
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
      <SidebarCard eyebrow="Lead" title="No linked lead">
        <div className="inbox-detail-placeholder-block">
          <LightningIcon />
          <span>No lead is linked to this contact yet.</span>
          <button className="inbox-search-tool" onClick={() => void onCreateLeadRecord()} type="button">
            Create lead
          </button>
        </div>
      </SidebarCard>
    );
  }

  return (
    <SidebarCard eyebrow="Lead" title={selectedConversation.lead.project}>
      <div className="inbox-detail-chip-row">
        <MetadataChip>{selectedConversation.lead.stage}</MetadataChip>
        <MetadataChip tone="hot">{selectedConversation.lead.priority}</MetadataChip>
      </div>
      <div className="inbox-detail-grid">
        <SidebarField label="Preferred area" value={selectedConversation.lead.preferredArea ?? "Not captured"} />
        <SidebarField label="Budget" value={selectedConversation.lead.budget ?? "Not captured"} />
        <SidebarField label="Financing" value={selectedConversation.lead.financingStatus ?? "Not captured"} />
        <SidebarField label="Next Action" value={selectedConversation.lead.nextActionAt ?? "No reminder set"} />
      </div>
      <div className="inbox-detail-action-row">
        <button className="inbox-search-tool" onClick={onToggleSchedule} type="button">
          {isScheduling ? "Close scheduler" : "Schedule appointment"}
        </button>
        <a className="inbox-search-tool" href={`/leads/${selectedConversation.lead.id}`}>
          Open lead
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
  const now = getMalaysiaDateTimeParts(new Date());
  const start = createMalaysiaDate({
    year: now.year,
    month: now.month,
    day: now.day,
    hour: now.hour + 1,
    minute: 0,
    second: 0
  });
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title,
    type: "SITE_VISIT",
    startAt: formatMalaysiaDateTimeLocalInput(start),
    endAt: formatMalaysiaDateTimeLocalInput(end),
    location,
    note: ""
  };
}
