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
  InboxMediaAsset,
  InboxMentionCandidate,
  InboxQuickReply,
  InboxSelectedMention,
  InboxSelectedConversation,
  InboxSummary,
  InboxWhatsAppStatus
} from "@/components/inbox/types";

type InboxWorkspaceProps = {
  conversations: InboxConversation[];
  quickReplies: InboxQuickReply[];
  mediaAssets: InboxMediaAsset[];
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
  mediaAssets,
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
  const [mentionCandidates, setMentionCandidates] = useState<InboxMentionCandidate[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<InboxSelectedMention[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilterKey>("all");
  const [searchValue, setSearchValue] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSimulateInboundOpen, setIsSimulateInboundOpen] = useState(false);
  const [isSnoozeDialogOpen, setIsSnoozeDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isRoutingPending, startRoutingTransition] = useTransition();
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(true);
  const hasDisconnectedWhatsAppSession =
    whatsapp.mode !== "mock" &&
    (whatsapp.runtimeStatus === "DISCONNECTED" || whatsapp.runtimeStatus === "AUTH_FAILED");
  const isWhatsAppReady = whatsapp.isConfigured && !hasDisconnectedWhatsAppSession;
  const inboxConnectionLabel =
    whatsapp.mode === "mock"
      ? "Mock mode"
      : hasDisconnectedWhatsAppSession
        ? "Connection lost"
        : isWhatsAppReady
          ? "Connected"
          : "Setup needed";
  const inboxConnectionMeta =
    whatsapp.mode === "mock"
      ? "Automation replies are simulated locally"
      : hasDisconnectedWhatsAppSession
        ? "Session is disconnected. Existing conversations stay visible until you relink WhatsApp."
        : `Phone ID ${whatsapp.phoneNumberId ?? "Not set"}`;
  const inboxWhatsAppWarning = hasDisconnectedWhatsAppSession
    ? whatsapp.runtimeStatus === "AUTH_FAILED"
      ? "WhatsApp session failed authentication. Existing conversations remain visible, but sending and sync are paused until you reconnect."
      : "WhatsApp session ended on the linked phone. Existing conversations remain visible, but sending and sync are paused until you reconnect."
    : null;

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
    if (!activeConversationId) {
      return;
    }

    const activeConversation = liveConversations.find((conversation) => conversation.id === activeConversationId);
    if (!activeConversation || activeConversation.unreadCount === 0) {
      return;
    }

    setLiveConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              unreadCount: 0
            }
          : conversation
      )
    );

    void fetch(`/api/conversations/${activeConversationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        markAsRead: true
      })
    });
  }, [activeConversationId, liveConversations]);

  useEffect(() => {
    setSelectedAttachmentIds([]);
    setReplyToMessageId(null);
    setSelectedMentions([]);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId || !liveSelectedConversation?.isGroup || isInternalNote) {
      setMentionCandidates([]);
      return;
    }

    const abortController = new AbortController();
    const loadMentionCandidates = async () => {
      const response = await fetch(`/api/conversations/${activeConversationId}/mentions`, {
        method: "GET",
        cache: "no-store",
        signal: abortController.signal
      }).catch(() => null);

      if (!response?.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { candidates?: InboxMentionCandidate[] }
        | null;

      setMentionCandidates(payload?.candidates ?? []);
    };

    void loadMentionCandidates();

    return () => abortController.abort();
  }, [activeConversationId, isInternalNote, liveSelectedConversation?.isGroup]);

  const filterCounts = useMemo(
    () => ({
      all: liveConversations.length,
      mine: liveConversations.filter((item) => item.assigneeId === currentAgent.id || item.teammateIds.includes(currentAgent.id)).length,
      "assigned-others": liveConversations.filter(
        (item) => Boolean(item.assigneeId) && item.assigneeId !== currentAgent.id && !item.teammateIds.includes(currentAgent.id)
      ).length,
      unassigned: liveConversations.filter((item) => !item.assigneeId).length,
      unread: liveConversations.filter((item) => item.unreadCount > 0).length,
      hot: liveConversations.filter((item) => item.isHotLead).length
    }),
    [liveConversations, currentAgent.id]
  );

  const initialFilterCounts = useMemo(
    () => ({
      all: conversations.length,
      mine: conversations.filter((item) => item.assigneeId === currentAgent.id || item.teammateIds.includes(currentAgent.id)).length,
      "assigned-others": conversations.filter(
        (item) => Boolean(item.assigneeId) && item.assigneeId !== currentAgent.id && !item.teammateIds.includes(currentAgent.id)
      ).length,
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
        if (!conversation.teammateIds.includes(currentAgent.id)) {
          return false;
        }
      }

      if (filter === "unassigned" && conversation.assigneeId) {
        return false;
      }

      if (
        filter === "assigned-others" &&
        (!conversation.assigneeId || conversation.assigneeId === currentAgent.id || conversation.teammateIds.includes(currentAgent.id))
      ) {
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
  const canReplyToSelectedConversation = Boolean(
    !liveSelectedConversation?.assigneeId ||
      liveSelectedConversation.assigneeId === currentAgent.id ||
      currentAgent.role === "MANAGER"
  );
  const requiresTakeOverForPublicReply = Boolean(isWhatsAppReady && !canReplyToSelectedConversation && liveSelectedConversation);
  const canTakeOverSelectedConversation = Boolean(
    liveSelectedConversation?.assigneeId && liveSelectedConversation.assigneeId !== currentAgent.id
  );
  const replyingToMessage =
    liveSelectedConversation?.messages.find((message) => message.id === replyToMessageId) ?? null;

  const openConversation = (conversationId: string) => {
    setPendingConversationId(conversationId);
    startRoutingTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("conversationId", conversationId);
      router.push(`/inbox?${params.toString()}`);
    });
  };

  const insertQuickReply = (quickReply: InboxQuickReply) => {
    setMessageBody((current) => (current ? `${current}\n${quickReply.body}` : quickReply.body));
    setSelectedAttachmentIds(quickReply.mediaAssetIds);
  };

  const sendMessage = async (scheduledFor?: string) => {
    if (!activeConversationId) {
      return;
    }

    const trimmedBody = messageBody.trim();
    const activeMentions = selectedMentions.filter((mention) => messageBody.includes(`@${mention.label}`));
    if (!trimmedBody && !selectedAttachmentIds.length) {
      setError("Message body or media is required.");
      return;
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
              if (selectedAttachmentIds.length) {
                formData.append("mediaAssetIds", JSON.stringify(selectedAttachmentIds));
              }
              if (activeMentions.length) {
                formData.append("mentions", JSON.stringify(activeMentions));
              }
              if (replyToMessageId) {
                formData.append("replyToMessageId", replyToMessageId);
              }
              if (scheduledFor) {
                formData.append("scheduledFor", scheduledFor);
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
      setSelectedAttachmentIds([]);
      setSelectedMentions([]);
      setReplyToMessageId(null);
      setIsInternalNote(false);
      await refreshInboxPanels(activeConversationId);
    });
  };

  const updateConversation = (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
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

  const takeOverConversation = () => {
    if (!liveSelectedConversation) {
      return;
    }

    updateConversation({
      assigneeId: currentAgent.id,
      teammateIds: liveSelectedConversation.teammateIds.filter((id) => id !== currentAgent.id)
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

  const deleteMessage = (messageId: string) => {
    if (!activeConversationId) {
      return;
    }

    const targetMessage = liveSelectedConversation?.messages.find((message) => message.id === messageId);
    if (!targetMessage) {
      return;
    }

    setPendingDeleteMessageId(messageId);
  };

  const confirmDeleteMessage = () => {
    if (!activeConversationId || !pendingDeleteMessageId) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/conversations/${activeConversationId}/messages/${pendingDeleteMessageId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to delete message.");
        return;
      }

      if (replyToMessageId === pendingDeleteMessageId) {
        setReplyToMessageId(null);
      }

      setPendingDeleteMessageId(null);
      await refreshInboxPanels(activeConversationId);
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
      throw new Error(payload?.error ?? "Unable to create lead.");
    }

    const payload = (await response.json()) as { lead?: { id?: string } };
    const leadId = payload.lead?.id;

    if (!leadId) {
      throw new Error("Lead record was created without an id.");
    }

    await refreshInboxPanels(activeConversationId);
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
      {inboxWhatsAppWarning ? (
        <div className="inbox-snooze-banner">
          <strong>WhatsApp connection lost</strong>
          <span>{inboxWhatsAppWarning}</span>
          <a className="button button-secondary" href="/settings/whatsapp">
            Start fresh session
          </a>
        </div>
      ) : null}

      <div className="inbox-reference-topbar">
        <div className="inbox-reference-topbar-main">
          <span className={`inbox-reference-state${isWhatsAppReady ? " ready" : ""}`}>
            {inboxConnectionLabel}
          </span>
          <span className="inbox-reference-channel">WhatsApp</span>
          <span className="inbox-reference-meta">{inboxConnectionMeta}</span>
          <span className="inbox-reference-meta">Last sync {whatsapp.updatedAt ?? "Not available"}</span>
        </div>
        <div className="inbox-reference-topbar-actions">
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
          mediaAssets={mediaAssets}
          selectedAttachmentIds={selectedAttachmentIds}
          mentionCandidates={mentionCandidates}
          canSendPublicReply={isWhatsAppReady && canReplyToSelectedConversation}
          canTakeOverConversation={canTakeOverSelectedConversation}
          currentAgent={currentAgent}
          error={error}
          hasHydrated={hasHydrated}
          isInternalNote={isInternalNote}
          isPending={isPending}
          messageBody={messageBody}
          selectedMentions={selectedMentions}
          onAddTag={addTag}
          onAttachmentChange={(attachmentIds) => {
            setSelectedAttachmentIds(attachmentIds);
            setError(null);
          }}
          onDeleteMessage={deleteMessage}
          onInsertQuickReply={insertQuickReply}
          onMessageBodyChange={setMessageBody}
          onSelectedMentionsChange={setSelectedMentions}
          onReplyToMessage={(messageId) => {
            setReplyToMessageId(messageId || null);
            setError(null);
          }}
          replyingToMessage={
            replyingToMessage
              ? {
                  id: replyingToMessage.id,
                  sender: replyingToMessage.sender,
                  body: replyingToMessage.body,
                  attachmentName: replyingToMessage.attachmentName
                }
              : null
          }
          onScheduleMessage={(value) => void sendMessage(value)}
          onSendMessage={() => void sendMessage()}
          onSnoozeConversation={() => setIsSnoozeDialogOpen(true)}
          onTakeOverConversation={takeOverConversation}
          onToggleInternalNote={() => {
            setIsInternalNote((current) => !current);
            setSelectedAttachmentIds([]);
            setSelectedMentions([]);
            setError(null);
          }}
          onUpdateConversation={updateConversation}
          quickReplies={quickReplies}
          requiresTakeOverForPublicReply={requiresTakeOverForPublicReply}
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

      {pendingDeleteMessageId ? (
        <div className="inbox-dialog-backdrop" onClick={() => setPendingDeleteMessageId(null)}>
          <div
            aria-modal="true"
            className="inbox-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="inbox-dialog-head">
              <div>
                <strong>Delete for everyone</strong>
                <p>This will attempt to remove the message from WhatsApp for all participants.</p>
              </div>
              <button className="inbox-dialog-close" onClick={() => setPendingDeleteMessageId(null)} type="button">
                ×
              </button>
            </div>
            <div className="lead-record-panel">
              <p className="muted">WhatsApp may reject this if the message is no longer eligible for revoke.</p>
            </div>
            <div className="inbox-dialog-actions">
              <button className="inbox-dialog-secondary" onClick={() => setPendingDeleteMessageId(null)} type="button">
                Cancel
              </button>
              <button className="inbox-dialog-primary" disabled={isPending} onClick={confirmDeleteMessage} type="button">
                {isPending ? "Deleting..." : "Delete for everyone"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SimulateInboundDialog
        isOpen={isSimulateInboundOpen}
        isPending={isPending}
        onClose={() => setIsSimulateInboundOpen(false)}
        onSubmit={simulateInboundMessage}
        selectedConversation={liveSelectedConversation}
      />

      <SnoozeDialog
        initialValue={liveSelectedConversation?.snoozedUntilIso ?? null}
        isOpen={isSnoozeDialogOpen}
        isPending={isPending}
        onClear={() => {
          setIsSnoozeDialogOpen(false);
          updateConversation({ snoozedUntil: null });
        }}
        onClose={() => setIsSnoozeDialogOpen(false)}
        onSave={(value) => {
          setIsSnoozeDialogOpen(false);
          updateConversation({ snoozedUntil: value });
        }}
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
