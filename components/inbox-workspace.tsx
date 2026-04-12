"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { InboxDetailPanel } from "@/components/inbox/detail-panel";
import { ChevronLeftIcon } from "@/components/inbox/icons";
import { InboxQueuePanel } from "@/components/inbox/queue-panel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { SnoozeDialog } from "@/components/inbox/snooze-dialog";
import { InboxThreadPanel } from "@/components/inbox/thread-panel";
import type {
  InboxAgent,
  InboxConversation,
  InboxCurrentAgent,
  InboxFilterKey,
  InboxQuickReply,
  InboxSelectedConversation,
  InboxSummary,
  InboxWhatsAppStatus
} from "@/components/inbox/types";

type InboxWorkspaceProps = {
  conversations: InboxConversation[];
  quickReplies: InboxQuickReply[];
  whatsapp: InboxWhatsAppStatus;
  agents: InboxAgent[];
  currentAgent: InboxCurrentAgent;
  workspaceIndustryType: "PROPERTY" | "WORKSHOP" | "GENERIC";
  summary: InboxSummary;
  selectedConversation: InboxSelectedConversation;
};

export function InboxWorkspace({
  conversations,
  quickReplies,
  whatsapp,
  agents,
  currentAgent,
  workspaceIndustryType,
  summary,
  selectedConversation
}: InboxWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [liveConversations, setLiveConversations] = useState(conversations);
  const [liveSelectedConversation, setLiveSelectedConversation] = useState(selectedConversation);
  const [messageBody, setMessageBody] = useState("");
  const [interactiveButtons, setInteractiveButtons] = useState<string[]>(["", "", ""]);
  const [interactiveListButtonText, setInteractiveListButtonText] = useState("Choose option");
  const [interactiveListOptions, setInteractiveListOptions] = useState<string[]>(["", "", "", "", ""]);
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilterKey>("all");
  const [searchValue, setSearchValue] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isButtonsEnabled, setIsButtonsEnabled] = useState(false);
  const [isListEnabled, setIsListEnabled] = useState(false);
  const [isSnoozeDialogOpen, setIsSnoozeDialogOpen] = useState(false);
  const [isSimulateInboundOpen, setIsSimulateInboundOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isRoutingPending, startRoutingTransition] = useTransition();
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(true);

  const activeConversationId = liveSelectedConversation?.id ?? liveConversations[0]?.id ?? null;

  const refreshConversationList = async () => {
    const response = await fetch("/api/conversations", {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | { conversations?: InboxConversation[] }
      | null;

    if (!payload?.conversations) {
      return null;
    }

    const nextConversations = sortConversationsByRecent(payload.conversations);
    setLiveConversations(nextConversations);
    return nextConversations;
  };

  const refreshSelectedConversation = async (conversationId: string | null) => {
    if (!conversationId) {
      setLiveSelectedConversation(null);
      return null;
    }

    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | { conversation?: InboxSelectedConversation }
      | null;

    if (payload?.conversation === undefined) {
      return null;
    }

    setLiveSelectedConversation(payload.conversation);
    return payload.conversation;
  };

  const refreshInboxPanels = async (conversationId: string | null = activeConversationId) => {
    const nextConversations = await refreshConversationList();
    const nextConversationId =
      conversationId ??
      nextConversations?.find((conversation) => conversation.id === activeConversationId)?.id ??
      nextConversations?.[0]?.id ??
      null;

    await refreshSelectedConversation(nextConversationId);
  };

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    setLiveConversations(sortConversationsByRecent(conversations));
  }, [conversations]);

  useEffect(() => {
    setLiveSelectedConversation(selectedConversation);
  }, [selectedConversation]);

  useEffect(() => {
    const refreshInbox = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      await refreshInboxPanels(activeConversationId);
    };

    const runRefresh = () => {
      void refreshInbox();
    };

    const interval = window.setInterval(runRefresh, 8000);
    window.addEventListener("focus", runRefresh);
    document.addEventListener("visibilitychange", runRefresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", runRefresh);
      document.removeEventListener("visibilitychange", runRefresh);
    };
  }, [activeConversationId]);

  useEffect(() => {
    setPendingConversationId(null);
  }, [activeConversationId]);

  useEffect(() => {
    setIsSnoozeDialogOpen(false);
    setSelectedAttachment(null);
    setInteractiveButtons(["", "", ""]);
    setInteractiveListButtonText("Choose option");
    setInteractiveListOptions(["", "", "", "", ""]);
    setIsButtonsEnabled(false);
    setIsListEnabled(false);
  }, [activeConversationId]);

  const filterCounts = useMemo(
    () => ({
      all: liveConversations.length,
      mine: liveConversations.filter((item) => item.assigneeId === currentAgent.id).length,
      unassigned: liveConversations.filter((item) => !item.assigneeId).length,
      unread: liveConversations.filter((item) => item.unreadCount > 0).length,
      hot: liveConversations.filter((item) => item.isHotLead).length
    }),
    [liveConversations, currentAgent.id]
  );

  const initialFilterCounts = useMemo(
    () => ({
      all: conversations.length,
      mine: conversations.filter((item) => item.assigneeId === currentAgent.id).length,
      unassigned: conversations.filter((item) => !item.assigneeId).length,
      unread: conversations.filter((item) => item.unreadCount > 0).length,
      hot: conversations.filter((item) => item.isHotLead).length
    }),
    [conversations, currentAgent.id]
  );

  const filteredConversations = useMemo(() => {
    const searchTerm = searchValue.trim().toLowerCase();

    return liveConversations.filter((conversation) => {
      if (filter === "mine" && conversation.assigneeId !== currentAgent.id) {
        return false;
      }

      if (filter === "unassigned" && conversation.assigneeId) {
        return false;
      }

      if (filter === "unread" && conversation.unreadCount === 0) {
        return false;
      }

      if (filter === "hot" && !conversation.isHotLead) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        conversation.contactName,
        conversation.phone,
        conversation.assignee,
        conversation.lastMessagePreview
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [liveConversations, currentAgent.id, filter, searchValue]);

  const displayedConversations = hasHydrated ? filteredConversations : conversations;
  const displayedActiveConversationId = hasHydrated
    ? activeConversationId
    : selectedConversation?.id ?? conversations[0]?.id ?? null;

  const openConversation = (conversationId: string) => {
    setPendingConversationId(conversationId);
    startRoutingTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("conversationId", conversationId);
      router.push(`/inbox?${params.toString()}`);
    });
  };

  const insertQuickReply = (body: string) => {
    setMessageBody((current) => (current ? `${current}\n${body}` : body));
  };

  const insertEmoji = (emoji: string) => {
    setMessageBody((current) => `${current}${emoji}`);
  };

  const sendMessage = async () => {
    if (!activeConversationId) {
      return;
    }

    const trimmedBody = messageBody.trim();
    const normalizedButtons = interactiveButtons.map((entry) => entry.trim()).filter(Boolean).slice(0, 3);
    const normalizedListOptions = interactiveListOptions.map((entry) => entry.trim()).filter(Boolean).slice(0, 10);
    if (!trimmedBody && !selectedAttachment) {
      setError("Message body is required.");
      return;
    }

    if (!isInternalNote && isButtonsEnabled) {
      if (!trimmedBody) {
        setError("Button messages need a message body.");
        return;
      }

      if (selectedAttachment) {
        setError("Button messages cannot include attachments yet.");
        return;
      }

      if (!normalizedButtons.length) {
        setError("Add at least one button.");
        return;
      }
    }

    if (!isInternalNote && isListEnabled) {
      if (!trimmedBody) {
        setError("List messages need a message body.");
        return;
      }

      if (selectedAttachment) {
        setError("List messages cannot include attachments yet.");
        return;
      }

      if (!normalizedListOptions.length) {
        setError("Add at least one list option.");
        return;
      }
    }

    setError(null);

    startTransition(async () => {
      const endpoint = isInternalNote
        ? `/api/conversations/${activeConversationId}/notes`
        : `/api/conversations/${activeConversationId}/messages`;

      const response = await fetch(
        endpoint,
        isInternalNote
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                body: trimmedBody,
                senderId: liveSelectedConversation?.assigneeId ?? null
              })
            }
          : (() => {
              const formData = new FormData();
              formData.append("body", trimmedBody);
              if (isButtonsEnabled && normalizedButtons.length) {
                formData.append("interactiveButtons", JSON.stringify(normalizedButtons));
              }
              if (isListEnabled && normalizedListOptions.length) {
                formData.append("interactiveListButtonText", interactiveListButtonText.trim() || "Choose option");
                formData.append("interactiveListOptions", JSON.stringify(normalizedListOptions));
              }
              if (selectedAttachment) {
                formData.append("attachment", selectedAttachment);
              }

              return {
                method: "POST",
                body: formData
              };
            })()
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to send message.");
        return;
      }

      setMessageBody("");
      setSelectedAttachment(null);
      setInteractiveButtons(["", "", ""]);
      setInteractiveListButtonText("Choose option");
      setInteractiveListOptions(["", "", "", "", ""]);
      setIsButtonsEnabled(false);
      setIsListEnabled(false);
      setIsInternalNote(false);
      await refreshInboxPanels(activeConversationId);
    });
  };

  const updateConversation = (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    snoozedUntil?: string | null;
    tags?: string[];
  }) => {
    if (!activeConversationId) {
      return;
    }

    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/conversations/${activeConversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to update conversation.");
        return;
      }

      await refreshInboxPanels(activeConversationId);
    });
  };

  const addTag = (presetTag?: string) => {
    if (!liveSelectedConversation) {
      return;
    }

    const input = presetTag ?? window.prompt("Add a tag", "") ?? "";
    const nextTag = input.trim();

    if (!nextTag) {
      return;
    }

    updateConversation({
      tags: Array.from(new Set([...liveSelectedConversation.tags, nextTag]))
    });
  };

  const removeTag = (tagToRemove: string) => {
    if (!liveSelectedConversation) {
      return;
    }

    updateConversation({
      tags: liveSelectedConversation.tags.filter((tag) => tag !== tagToRemove)
    });
  };

  const createLeadRecord = async () => {
    if (!activeConversationId) {
      throw new Error("Conversation not found.");
    }

    setError(null);

    const response = await fetch(`/api/conversations/${activeConversationId}/lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Unable to create property record.");
    }

    const payload = (await response.json()) as { lead?: { id?: string } };
    const leadId = payload.lead?.id;

    if (!leadId) {
      throw new Error("Lead record was created without an id.");
    }

    router.push(`/leads/${leadId}`);
    await refreshInboxPanels(activeConversationId);
  };

  const snoozeConversation = () => {
    if (!liveSelectedConversation) {
      return;
    }

    setIsSnoozeDialogOpen(true);
  };

  const simulateInboundMessage = (input: {
    body: string;
    conversationId?: string | null;
    phone?: string | null;
    displayName?: string | null;
    sentAt?: string | null;
    ignoreAutomationPause?: boolean;
  }) => {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/test/inbound-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; conversationId?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to simulate inbound message.");
        return;
      }

      setIsSimulateInboundOpen(false);
      setFilter("all");
      setSearchValue("");

      const conversationId = payload?.conversationId;
      if (conversationId) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("conversationId", conversationId);
        router.push(`/inbox?${params.toString()}`);
      }

      await refreshInboxPanels(conversationId ?? activeConversationId);
    });
  };

  return (
    <section className="inbox-workspace premium-inbox-workspace">
      <div className="inbox-reference-topbar">
        <div className="inbox-reference-topbar-main">
          <span className={`inbox-reference-state${whatsapp.isConfigured ? " ready" : ""}`}>
            {whatsapp.mode === "mock" ? "Mock mode" : whatsapp.isConfigured ? "Connected" : "Setup needed"}
          </span>
          <span className="inbox-reference-channel">WhatsApp</span>
          <span className="inbox-reference-meta">
            {whatsapp.mode === "mock" ? "Automation replies are simulated locally" : `Phone ID ${whatsapp.phoneNumberId ?? "Not set"}`}
          </span>
          <span className="inbox-reference-meta">Last sync {whatsapp.updatedAt ?? "Not available"}</span>
        </div>
        <div className="inbox-reference-topbar-actions">
          {currentAgent.role === "MANAGER" ? (
            <button className="inbox-reference-pill-button" onClick={() => setIsSimulateInboundOpen(true)} type="button">
              Simulate inbound
            </button>
          ) : null}
          <span className="inbox-reference-pill">{filterCounts.all} conversations</span>
          <span className="inbox-reference-pill">{filterCounts.unread} unread</span>
          <span className="inbox-reference-pill">{summary.unassigned} unassigned</span>
          <span className="inbox-reference-pill">{summary.pending} pending</span>
        </div>
      </div>

      <section className={`inbox-grid premium-inbox-grid${isDetailsVisible ? "" : " details-hidden"}`}>
        <InboxQueuePanel
          activeConversationId={displayedActiveConversationId}
          conversations={displayedConversations}
          filter={filter}
          filterCounts={hasHydrated ? filterCounts : initialFilterCounts}
          isRoutingPending={hasHydrated ? isRoutingPending : false}
          isLoading={!hasHydrated}
          onFilterChange={setFilter}
          onOpenConversation={openConversation}
          pendingConversationId={hasHydrated ? pendingConversationId : null}
          searchValue={hasHydrated ? searchValue : ""}
          onSearchValueChange={setSearchValue}
        />

        <InboxThreadPanel
          agents={agents}
          attachmentName={selectedAttachment?.name ?? null}
          canSendPublicReply={whatsapp.isConfigured}
          error={error}
          hasHydrated={hasHydrated}
          interactiveButtons={interactiveButtons}
          interactiveListButtonText={interactiveListButtonText}
          interactiveListOptions={interactiveListOptions}
          isButtonsEnabled={isButtonsEnabled}
          isInternalNote={isInternalNote}
          isListEnabled={isListEnabled}
          isPending={isPending}
          messageBody={messageBody}
          onAddTag={addTag}
          onAttachmentChange={(file) => {
            setSelectedAttachment(file);
            setError(null);
          }}
          onInteractiveButtonsChange={(buttons) => {
            setInteractiveButtons(buttons);
            setError(null);
          }}
          onInteractiveListButtonTextChange={(value) => {
            setInteractiveListButtonText(value);
            setError(null);
          }}
          onInteractiveListOptionsChange={(options) => {
            setInteractiveListOptions(options);
            setError(null);
          }}
          onInsertEmoji={insertEmoji}
          onInsertQuickReply={insertQuickReply}
          onMessageBodyChange={setMessageBody}
          onSendMessage={sendMessage}
          onSnooze={snoozeConversation}
          onToggleButtons={() => {
            setIsButtonsEnabled((current) => !current);
            setIsListEnabled(false);
            setInteractiveListButtonText("Choose option");
            setInteractiveListOptions(["", "", "", "", ""]);
            setSelectedAttachment(null);
            setError(null);
          }}
          onToggleList={() => {
            setIsListEnabled((current) => !current);
            setIsButtonsEnabled(false);
            setInteractiveButtons(["", "", ""]);
            setSelectedAttachment(null);
            setError(null);
          }}
          onToggleInternalNote={() => {
            setIsInternalNote((current) => !current);
            setIsButtonsEnabled(false);
            setIsListEnabled(false);
            setInteractiveButtons(["", "", ""]);
            setInteractiveListButtonText("Choose option");
            setInteractiveListOptions(["", "", "", "", ""]);
            setError(null);
          }}
          onUpdateConversation={updateConversation}
          quickReplies={quickReplies}
          selectedConversation={liveSelectedConversation}
          whatsappMode={whatsapp.mode}
        />

        {isDetailsVisible ? (
          <InboxDetailPanel
            onCreateLeadRecord={createLeadRecord}
            onHideDetails={() => setIsDetailsVisible(false)}
            onRefreshConversation={() => void refreshInboxPanels(activeConversationId)}
            onRemoveTag={removeTag}
            quickReplies={quickReplies}
            selectedConversation={liveSelectedConversation}
            workspaceIndustryType={workspaceIndustryType}
          />
        ) : (
          <button
            aria-label="Show details"
            className="inbox-detail-reopen-tab"
            onClick={() => setIsDetailsVisible(true)}
            type="button"
          >
            <ChevronLeftIcon />
            <span>Details</span>
          </button>
        )}
      </section>

      <SnoozeDialog
        initialValue={liveSelectedConversation?.snoozedUntilIso ?? null}
        isOpen={isSnoozeDialogOpen}
        isPending={isPending}
        onClear={() => {
          updateConversation({ snoozedUntil: null });
          setIsSnoozeDialogOpen(false);
        }}
        onClose={() => setIsSnoozeDialogOpen(false)}
        onSave={(value) => {
          updateConversation({ snoozedUntil: value });
          setIsSnoozeDialogOpen(false);
        }}
      />

      <SimulateInboundDialog
        isOpen={isSimulateInboundOpen}
        isPending={isPending}
        onClose={() => setIsSimulateInboundOpen(false)}
        onSubmit={simulateInboundMessage}
        selectedConversation={liveSelectedConversation}
      />
    </section>
  );
}

function sortConversationsByRecent(conversations: InboxConversation[]) {
  return [...conversations].sort(
    (left, right) =>
      new Date(right.lastMessageAtIso).getTime() - new Date(left.lastMessageAtIso).getTime()
  );
}
