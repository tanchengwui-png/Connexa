"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { InboxDetailPanel } from "@/components/inbox/detail-panel";
import { ChevronLeftIcon, MuteIcon, VolumeIcon } from "@/components/inbox/icons";
import { NewConversationDialog } from "@/components/inbox/new-conversation-dialog";
import { InboxQueuePanel } from "@/components/inbox/queue-panel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { SnoozeDialog } from "@/components/inbox/snooze-dialog";
import { InboxThreadPanel } from "@/components/inbox/thread-panel";
import { normalizeInboxSelectedConversation } from "@/lib/inbox-message-normalization";
import { useInboxBrowserNotifications } from "@/lib/use-inbox-browser-notifications";
import { useInboxNotificationSoundPreference } from "@/lib/use-inbox-notification-sound-preference";
import type {
  InboxAgent,
  InboxComposerAttachment,
  InboxConversation,
  InboxContactTag,
  InboxCustomFilter,
  InboxFilterCounts,
  InboxCurrentAgent,
  InboxFilterKey,
  InboxMediaAsset,
  InboxMentionCandidate,
  InboxQuickReply,
  InboxSelectedMention,
  InboxSelectedConversation,
  InboxSummary,
  InboxMessage,
  InboxWhatsAppStatus
} from "@/components/inbox/types";

type InboxWorkspaceProps = {
  conversations: InboxConversation[];
  contactTags: InboxContactTag[];
  quickReplies: InboxQuickReply[];
  mediaAssets: InboxMediaAsset[];
  whatsapp: InboxWhatsAppStatus;
  agents: InboxAgent[];
  currentAgent: InboxCurrentAgent;
  workspaceIndustryType: "PROPERTY" | "WORKSHOP" | "GENERIC";
  summary: InboxSummary;
  selectedConversation: InboxSelectedConversation;
};

const INBOX_NOTIFICATION_EVENT = "connexa:inbox-notification";

type InboxAckEvent = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  providerMessageId: string;
  ack: number;
  ackStatus: "pending" | "sent" | "delivered" | "read" | "played";
  deliveryStatus: InboxMessage["deliveryStatus"];
  timestamp: string;
};

type InboxConversationEvent = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  action: "snoozed" | "unsnoozed";
  trigger: "manual" | "expiry" | "incoming_message" | "workflow";
  snoozedUntil: string | null;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  timestamp: string;
};

type InboxChatStateEvent = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  isMuted: boolean;
  muteExpiration: string | null;
  isArchived: boolean;
  isPinned: boolean;
  unreadCount: number;
  timestamp: string;
};

const PRIMARY_TOOLBAR_FILTERS: Array<{ key: InboxFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "unread", label: "Unread" },
  { key: "snoozed", label: "Snoozed" },
  { key: "assigned-others", label: "Assigned to others" },
  { key: "unassigned", label: "Unowned" },
  { key: "hot", label: "Hot" }
];

export function InboxWorkspace({
  conversations,
  contactTags,
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
  const toast = useToast();
  const [liveConversations, setLiveConversations] = useState(conversations);
  const [liveSelectedConversation, setLiveSelectedConversation] = useState(() =>
    normalizeInboxSelectedConversation(selectedConversation)
  );
  const [liveContactTags, setLiveContactTags] = useState(contactTags);
  const [liveMediaAssets, setLiveMediaAssets] = useState(mediaAssets);
  const [messageBody, setMessageBody] = useState("");
  const [mentionCandidates, setMentionCandidates] = useState<InboxMentionCandidate[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<InboxSelectedMention[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<InboxComposerAttachment[]>([]);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilterKey>("all");
  const [searchValue, setSearchValue] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSimulateInboundOpen, setIsSimulateInboundOpen] = useState(false);
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [isSnoozeDialogOpen, setIsSnoozeDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isRoutingPending, startRoutingTransition] = useTransition();
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(true);
  const toolbarFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isToolbarFilterOpen, setIsToolbarFilterOpen] = useState(false);
  const [isNotificationSoundPreferencePending, setIsNotificationSoundPreferencePending] = useState(false);
  const [channelStates, setChannelStates] = useState(
    () =>
      new Map(
        whatsapp.channels.map((channel) => [
          channel.id,
          {
            connectionMethod: channel.connectionMethod,
            incognitoMode: channel.incognitoMode
          }
        ])
      )
  );
  const { isMuted: isInboxNotificationSoundsMuted, updateMutedPreference } =
    useInboxNotificationSoundPreference({
      agentId: currentAgent.id,
      workspaceId: currentAgent.workspaceId,
      initialMuted: currentAgent.inboxNotificationSoundsMuted
    });
  const {
    permissionState: inboxDesktopPermissionState,
    pushEnabled: isInboxDesktopPushEnabled,
    subscriptionCount: inboxDesktopSubscriptionCount,
    isPending: isInboxDesktopNotificationsPending,
    error: inboxDesktopNotificationsError,
    shouldShowPrompt: shouldShowInboxDesktopNotificationsPrompt,
    setMuted: setInboxDesktopNotificationsMuted,
    enableDesktopNotifications,
    dismissDesktopNotificationsForNow,
    dismissDesktopNotificationsPromptPermanently
  } = useInboxBrowserNotifications({
    agentId: currentAgent.id,
    workspaceId: currentAgent.workspaceId,
    initialMuted: currentAgent.inboxNotificationSoundsMuted,
    initialPromptDismissedAt: currentAgent.inboxDesktopNotificationsPromptDismissedAt
  });
  const liveConversationsRef = useRef(sortConversationsByRecent(conversations));
  const conversationListRefreshRef = useRef<{
    key: string;
    promise: Promise<InboxConversation[] | null>;
  } | null>(null);
  const selectedConversationAbortRef = useRef<AbortController | null>(null);
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
  const selectedChannelId = searchParams?.get("channelId") ?? null;
  const currentSearchParams = searchParams?.toString() ?? "";
  const singleWorkspaceChannel = whatsapp.channels.length === 1 ? whatsapp.channels[0] : null;
  const incognitoTargetChannelId = selectedChannelId ?? singleWorkspaceChannel?.id ?? null;
  const activeConversationChannelId =
    liveSelectedConversation?.channelId ??
    liveConversations.find((conversation) => conversation.id === activeConversationId)?.channelId ??
    null;
  const selectedChannelState = incognitoTargetChannelId ? channelStates.get(incognitoTargetChannelId) ?? null : null;
  const selectedChannelSupportsIncognito = selectedChannelState?.connectionMethod === "web";
  const eligibleNewConversationChannels = whatsapp.channels.filter(
    (channel) => channel.supportsNewNumberConversation
  );
  const defaultNewConversationChannelId =
    (selectedChannelId &&
    eligibleNewConversationChannels.some((channel) => channel.id === selectedChannelId)
      ? selectedChannelId
      : eligibleNewConversationChannels.length === 1
        ? eligibleNewConversationChannels[0].id
        : null) ?? null;
  const isActiveConversationIncognito =
    !!activeConversationChannelId &&
    channelStates.get(activeConversationChannelId)?.connectionMethod === "web" &&
    channelStates.get(activeConversationChannelId)?.incognitoMode === true;
  const personalChannelCount = whatsapp.channels.filter((channel) => channel.connectionMethod === "web").length;
  const isActiveConversationPersonalChannel = activeConversationChannelId
    ? channelStates.get(activeConversationChannelId)?.connectionMethod === "web"
    : personalChannelCount === 1
      ? whatsapp.channels.some((channel) => channel.connectionMethod === "web")
      : false;
  const customFilters = useMemo(() => buildCustomFilters(liveConversations), [liveConversations]);
  const availableContactTags = useMemo(
    () => mergeWorkspaceContactTags(liveContactTags, liveConversations),
    [liveContactTags, liveConversations]
  );
  const activeCustomFilter = useMemo(
    () => customFilters.find((item) => item.key === filter) ?? null,
    [customFilters, filter]
  );

  const refreshConversationList = async () => {
    const params = new URLSearchParams();
    if (selectedChannelId) {
      params.set("channelId", selectedChannelId);
    }

    const requestPath = `/api/conversations${params.toString() ? `?${params.toString()}` : ""}`;
    if (conversationListRefreshRef.current?.key === requestPath) {
      return conversationListRefreshRef.current.promise;
    }

    const refreshRequest = (async () => {
      const response = await fetch(requestPath, {
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
      publishIncomingConversationNotifications(liveConversationsRef.current, nextConversations);
      liveConversationsRef.current = nextConversations;
      setLiveConversations(nextConversations);
      return nextConversations;
    })();

    conversationListRefreshRef.current = {
      key: requestPath,
      promise: refreshRequest
    };
    void refreshRequest.then(() => {
      if (conversationListRefreshRef.current?.promise === refreshRequest) {
        conversationListRefreshRef.current = null;
      }
    }, () => {
      if (conversationListRefreshRef.current?.promise === refreshRequest) {
        conversationListRefreshRef.current = null;
      }
    });

    return refreshRequest;
  };

  const refreshSelectedConversation = async (conversationId: string | null) => {
    if (!conversationId) {
      selectedConversationAbortRef.current?.abort();
      setLiveSelectedConversation(null);
      return null;
    }

    selectedConversationAbortRef.current?.abort();
    const abortController = new AbortController();
    selectedConversationAbortRef.current = abortController;

    const params = new URLSearchParams();
    if (selectedChannelId) {
      params.set("channelId", selectedChannelId);
    }

    try {
      const response = await fetch(
        `/api/conversations/${conversationId}${params.toString() ? `?${params.toString()}` : ""}`,
        {
          method: "GET",
          cache: "no-store",
          signal: abortController.signal
        }
      );

      if (!response.ok || selectedConversationAbortRef.current !== abortController) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as
        | { conversation?: InboxSelectedConversation }
        | null;

      if (payload?.conversation === undefined || selectedConversationAbortRef.current !== abortController) {
        return null;
      }

      const normalizedConversation = normalizeInboxSelectedConversation(payload.conversation ?? null);
      setLiveSelectedConversation(normalizedConversation);
      return normalizedConversation;
    } catch (error) {
      if (abortController.signal.aborted) {
        return null;
      }
      throw error;
    } finally {
      if (selectedConversationAbortRef.current === abortController) {
        selectedConversationAbortRef.current = null;
      }
    }
  };

  useEffect(() => {
    return () => {
      selectedConversationAbortRef.current?.abort();
    };
  }, []);

  const refreshInboxPanels = async (conversationId: string | null = activeConversationId) => {
    const nextConversations = await refreshConversationList();
    const nextConversationId =
      conversationId ??
      nextConversations?.find((conversation) => conversation.id === activeConversationId)?.id ??
      nextConversations?.[0]?.id ??
      null;

    await refreshSelectedConversation(nextConversationId);
  };

  const toggleInboxNotificationSounds = async () => {
    const nextMuted = !isInboxNotificationSoundsMuted;
    setIsNotificationSoundPreferencePending(true);

    try {
      await updateMutedPreference(nextMuted);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update Inbox notifications.";
      setError(message);
      toast.error("Inbox notification preference failed", message);
    } finally {
      setIsNotificationSoundPreferencePending(false);
    }
  };

  useEffect(() => {
    setInboxDesktopNotificationsMuted(isInboxNotificationSoundsMuted);
  }, [isInboxNotificationSoundsMuted, setInboxDesktopNotificationsMuted]);

  const startNewConversation = (input: {
    channelId: string;
    countryCode: string;
    phoneNumber: string;
    displayName: string;
    messageText: string;
  }) => {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/inbox/new-conversation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          idempotencyKey:
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            code?: string;
            existingContact?: {
              id: string;
              displayName: string;
              phone: string;
            };
            conversation?: {
              id: string;
            };
          }
        | null;

      if (!response.ok) {
        const nextError =
          payload?.code === "NEW_NUMBER_CONVERSATION_CONTACT_EXISTS" && payload.existingContact
            ? `${payload.existingContact.displayName || payload.existingContact.phone} already exists in your contacts. Open the existing conversation instead.`
            : payload?.error ?? "Unable to start the conversation.";
        setError(nextError);
        toast.error("New conversation failed", nextError);
        return;
      }

      const conversationId = payload?.conversation?.id ?? null;
      setIsNewConversationOpen(false);
      setFilter("all");
      setSearchValue("");

      const params = new URLSearchParams(currentSearchParams);
      if (input.channelId) {
        params.set("channelId", input.channelId);
      }
      if (conversationId) {
        params.set("conversationId", conversationId);
      }
      router.push(`/inbox?${params.toString()}`);
      await refreshInboxPanels(conversationId ?? activeConversationId);
    });
  };

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    const nextConversations = sortConversationsByRecent(conversations);
    liveConversationsRef.current = nextConversations;
    setLiveConversations(nextConversations);
  }, [conversations]);

  useEffect(() => {
    setLiveMediaAssets(mediaAssets);
  }, [mediaAssets]);

  useEffect(() => {
    setChannelStates(
      new Map(
        whatsapp.channels.map((channel) => [
          channel.id,
          {
            connectionMethod: channel.connectionMethod,
            incognitoMode: channel.incognitoMode
          }
        ])
      )
    );
  }, [whatsapp.channels]);

  useEffect(() => {
    liveConversationsRef.current = liveConversations;
  }, [liveConversations]);

  useEffect(() => {
    setLiveSelectedConversation(normalizeInboxSelectedConversation(selectedConversation));
  }, [selectedConversation]);

  useEffect(() => {
    if (!filter.startsWith("custom:")) {
      return;
    }

    if (!customFilters.some((item) => item.key === filter)) {
      setFilter("all");
    }
  }, [customFilters, filter]);

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
    const params = new URLSearchParams();
    if (selectedChannelId) {
      params.set("channelId", selectedChannelId);
    }

    const eventSource = new EventSource(`/api/inbox/events${params.toString() ? `?${params.toString()}` : ""}`);

    const handleMessage = () => {
      void refreshInboxPanels(activeConversationId);
    };

    const handleConversation = (event: MessageEvent<string>) => {
      const payload = parseInboxConversationEvent(event.data);
      if (!payload) {
        return;
      }

      if (payload.action === "unsnoozed" && payload.conversationId) {
        const nextConversation = liveConversationsRef.current.find((conversation) => conversation.id === payload.conversationId);
        if (nextConversation) {
          const title =
            payload.trigger === "incoming_message"
              ? "Conversation unsnoozed"
              : payload.trigger === "expiry"
                ? "Snooze expired"
                : "Snooze updated";
          const message =
            payload.trigger === "incoming_message"
              ? `${nextConversation.contactName || nextConversation.phone} replied and returned to the queue.`
              : payload.trigger === "expiry"
                ? `${nextConversation.contactName || nextConversation.phone} returned to the queue.`
                : `${nextConversation.contactName || nextConversation.phone} is active in the queue again.`;
          toast.success(title, message);
          publishSnoozeReminderNotification(nextConversation, payload);
        }
      }

      void refreshInboxPanels(activeConversationId);
    };

    const handleAck = (event: MessageEvent<string>) => {
      const payload = parseInboxAckEvent(event.data);
      if (!payload) {
        return;
      }

      setLiveSelectedConversation((current) => {
        if (!current || current.id !== payload.conversationId) {
          return current;
        }

        let hasMatchedMessage = false;
        const nextMessages = current.messages.map((message) => {
          const matchesMessageId = payload.messageId ? message.id === payload.messageId : false;
          const matchesProviderMessageId =
            Boolean(message.providerMessageId) && message.providerMessageId === payload.providerMessageId;

          if (!matchesMessageId && !matchesProviderMessageId) {
            return message;
          }

          hasMatchedMessage = true;
          return {
            ...message,
            ack: payload.ack,
            ackUpdatedAt: payload.timestamp,
            deliveryStatus: payload.deliveryStatus
          };
        });

        if (!hasMatchedMessage) {
          return current;
        }

        return {
          ...current,
          messages: nextMessages
        };
      });
    };

    const handleChatState = (event: MessageEvent<string>) => {
      const payload = parseInboxChatStateEvent(event.data);
      if (!payload) {
        return;
      }

      void refreshInboxPanels(payload.conversationId ?? activeConversationId);
    };

    eventSource.addEventListener("inbox:message", handleMessage);
    eventSource.addEventListener("inbox:ack", handleAck as EventListener);
    eventSource.addEventListener("inbox:conversation", handleConversation as EventListener);
    eventSource.addEventListener("inbox:chat-state", handleChatState as EventListener);

    eventSource.onerror = () => {
      void refreshInboxPanels(activeConversationId);
    };

    return () => {
      eventSource.removeEventListener("inbox:message", handleMessage);
      eventSource.removeEventListener("inbox:ack", handleAck as EventListener);
      eventSource.removeEventListener("inbox:conversation", handleConversation as EventListener);
      eventSource.removeEventListener("inbox:chat-state", handleChatState as EventListener);
      eventSource.close();
    };
  }, [activeConversationId, selectedChannelId, toast]);

  useEffect(() => {
    setPendingConversationId(null);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const activeConversation = liveConversations.find((conversation) => conversation.id === activeConversationId);
    if (!activeConversation || activeConversation.unreadCount === 0 || isActiveConversationIncognito) {
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
  }, [activeConversationId, isActiveConversationIncognito, liveConversations]);

  useEffect(() => {
    setSelectedAttachments([]);
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
    () => buildFilterCounts(liveConversations, currentAgent.id, customFilters),
    [customFilters, currentAgent.id, liveConversations]
  );

  const initialFilterCounts = useMemo(
    () => buildFilterCounts(conversations, currentAgent.id, customFilters),
    [conversations, currentAgent.id, customFilters]
  );

  const filteredConversations = useMemo(() => {
    const searchTerm = searchValue.trim().toLowerCase();

    return liveConversations.filter((conversation) => {
      if (filter === "snoozed") {
        if (!conversation.isSnoozed) {
          return false;
        }
      } else if (filter !== "all" && conversation.isSnoozed) {
        return false;
      }

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

      if (activeCustomFilter && !conversation.tags.some((tag) => normalizeInboxTag(tag) === activeCustomFilter.tag)) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        conversation.contactName,
        conversation.phone,
        conversation.assignee,
        conversation.lastMessagePreview,
        conversation.tags.join(" ")
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [activeCustomFilter, currentAgent.id, filter, liveConversations, searchValue]);

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
      const params = new URLSearchParams(currentSearchParams);
      params.set("conversationId", conversationId);
      router.push(`/inbox?${params.toString()}`);
    });
  };

  const insertQuickReply = (quickReply: InboxQuickReply) => {
    setMessageBody((current) => (current ? `${current}\n${quickReply.body}` : quickReply.body));
    setSelectedAttachments(
      quickReply.mediaAssetIds.map((assetId) => ({
        assetId,
        sendAsVoice: false
      }))
    );
  };

  const sendMessage = async (scheduledFor?: string) => {
    if (!activeConversationId) {
      return;
    }

    const trimmedBody = messageBody.trim();
    const activeMentions = selectedMentions.filter((mention) => messageBody.includes(`@${mention.label}`));
    if (!trimmedBody && !selectedAttachments.length) {
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
              if (selectedAttachments.length) {
                formData.append("attachments", JSON.stringify(selectedAttachments));
                formData.append(
                  "mediaAssetIds",
                  JSON.stringify(selectedAttachments.map((attachment) => attachment.assetId))
                );
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
      setSelectedAttachments([]);
      setSelectedMentions([]);
      setReplyToMessageId(null);
      setIsInternalNote(false);
      await refreshInboxPanels(activeConversationId);
    });
  };

  const patchConversation = async (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
    snoozeReason?: string | null;
    muteDuration?: "8h" | "1w" | "always" | null;
    tags?: string[];
  }) => {
    if (!activeConversationId) {
      return {
        ok: false as const,
        error: "Conversation not found."
      };
    }

    setError(null);

    const response = await fetch(`/api/conversations/${activeConversationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const message = payload?.error ?? "Unable to update conversation.";
      setError(message);
      return {
        ok: false as const,
        error: message
      };
    }

    await refreshInboxPanels(activeConversationId);
    return {
      ok: true as const
    };
  };

  const updateConversation = (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
    snoozeReason?: string | null;
    muteDuration?: "8h" | "1w" | "always" | null;
    tags?: string[];
  }) => {
    startTransition(() => {
      void patchConversation(updates);
    });
  };

  const toggleIncognitoMode = () => {
    if (!incognitoTargetChannelId || !selectedChannelSupportsIncognito) {
      return;
    }

    const nextIncognitoMode = !(selectedChannelState?.incognitoMode === true);
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/inbox/channels/${incognitoTargetChannelId}/incognito`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          incognitoMode: nextIncognitoMode
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            channel?: {
              id: string;
              connectionMethod: "api" | "web";
              incognitoMode: boolean;
            };
            error?: string;
          }
        | null;

      const nextChannel = payload?.channel;

      if (!response.ok || !nextChannel) {
        setError(payload?.error ?? "Unable to update incognito mode.");
        return;
      }

      setChannelStates((current) => {
        const next = new Map(current);
        next.set(nextChannel.id, {
          connectionMethod: nextChannel.connectionMethod,
          incognitoMode: nextChannel.incognitoMode
        });
        return next;
      });
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

  const addExistingContactTag = async (tagName: string) => {
    if (!liveSelectedConversation) {
      return {
        ok: false as const,
        error: "Conversation not found."
      };
    }

    return patchConversation({
      tags: Array.from(new Set([...liveSelectedConversation.tags, tagName]))
    });
  };

  const createContactTag = async (input: { description: string | null; name: string }) => {
    setError(null);

    const response = await fetch("/api/contact-tags", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          tag?: InboxContactTag;
        }
      | null;

    if (!response.ok || !payload?.tag) {
      const message = payload?.error ?? "Unable to create contact tag.";
      setError(message);
      return {
        ok: false as const,
        error: message
      };
    }

    const createdTag = payload.tag;
    setLiveContactTags((current) => mergeWorkspaceContactTags(current, [], [createdTag]));

    return {
      ok: true as const,
      tag: createdTag
    };
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
        const params = new URLSearchParams(currentSearchParams);
        params.set("conversationId", conversationId);
        router.push(`/inbox?${params.toString()}`);
      }

      await refreshInboxPanels(conversationId ?? activeConversationId);
    });
  };

  return (
    <section className="inbox-workspace premium-inbox-workspace">
      <div className="inbox-workspace-chrome">
        {shouldShowInboxDesktopNotificationsPrompt ? (
          <div className="inbox-snooze-banner inbox-desktop-notifications-banner">
            <div className="inbox-snooze-banner-copy">
              <strong>Enable desktop notifications</strong>
              <span>Enable desktop notifications to receive new Inbox alerts when this tab is in the background.</span>
            </div>
            <div className="inbox-snooze-banner-actions">
              <button
                className="button button-secondary"
                disabled={isInboxDesktopNotificationsPending}
                onClick={() => void enableDesktopNotifications()}
                type="button"
              >
                {isInboxDesktopNotificationsPending ? "Enabling..." : "Enable desktop notifications"}
              </button>
              <button
                className="button button-secondary"
                onClick={dismissDesktopNotificationsForNow}
                type="button"
              >
                Not now
              </button>
              <button
                className="button button-secondary"
                onClick={() => void dismissDesktopNotificationsPromptPermanently()}
                type="button"
              >
                Don&apos;t ask again
              </button>
            </div>
          </div>
        ) : null}

        {inboxWhatsAppWarning ? (
          <div className="inbox-snooze-banner">
            <strong>WhatsApp connection lost</strong>
            <span>{inboxWhatsAppWarning}</span>
            <a className="button button-secondary" href="/settings/whatsapp">
              Start fresh session
            </a>
          </div>
        ) : null}

        {inboxDesktopNotificationsError ? (
          <div className="inbox-new-conversation-help">{inboxDesktopNotificationsError}</div>
        ) : null}

        <div className="inbox-reference-topbar">
          <div className="inbox-reference-topbar-main">
            <div className="inbox-reference-topbar-left">
              <button
                aria-label="Start a new conversation"
                className="button button-primary inbox-new-conversation-button"
                disabled={!eligibleNewConversationChannels.length || isPending}
                onClick={() => setIsNewConversationOpen(true)}
                type="button"
              >
                New conversation
              </button>
              {whatsapp.channels.length ? (
                <div className="inbox-channel-controls">
                  <label className="scheduled-bulk-select-all">
                    <select
                      onChange={(event) => {
                        const params = new URLSearchParams(currentSearchParams);
                        if (event.target.value) {
                          params.set("channelId", event.target.value);
                        } else {
                          params.delete("channelId");
                        }
                        params.delete("conversationId");
                        router.push(`/inbox?${params.toString()}`);
                      }}
                      value={selectedChannelId ?? ""}
                    >
                      <option value="">All numbers</option>
                      {whatsapp.channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="inbox-reference-topbar-actions">
              <Button
                aria-label="Toggle WhatsApp incognito mode"
                aria-pressed={selectedChannelState?.incognitoMode === true}
                className={`inbox-incognito-toggle${selectedChannelState?.incognitoMode ? " active" : ""}`}
                disabled={!incognitoTargetChannelId || !selectedChannelSupportsIncognito || isPending}
                onClick={toggleIncognitoMode}
                selected={selectedChannelState?.incognitoMode === true}
                title="Read chats without sending seen receipts"
                variant="toggle"
              >
                Incognito
              </Button>
              <Button
                aria-label={
                  isInboxNotificationSoundsMuted
                    ? "Unmute notifications"
                    : "Mute notifications"
                }
                aria-pressed={isInboxNotificationSoundsMuted}
                className={`inbox-incognito-toggle inbox-notification-sound-toggle${isInboxNotificationSoundsMuted ? " active" : ""}`}
                onClick={() => void toggleInboxNotificationSounds()}
                selected={isInboxNotificationSoundsMuted}
                title={
                  isInboxNotificationSoundsMuted
                    ? "Inbox sounds and desktop notifications are muted for this workspace."
                    : "Mute notifications"
                }
                variant="toggle"
              >
                {isInboxNotificationSoundsMuted ? <MuteIcon /> : <VolumeIcon />}
                <span>
                  {isNotificationSoundPreferencePending
                    ? "Saving..."
                    : isInboxNotificationSoundsMuted
                      ? "Sound muted"
                      : "Sound on"}
                </span>
              </Button>
            </div>
          </div>
          <PortalDropdown
            align="end"
            anchorRef={toolbarFilterButtonRef}
            className="inbox-portal-menu"
            onClose={() => setIsToolbarFilterOpen(false)}
            open={isToolbarFilterOpen}
          >
            <div className="inbox-menu-panel">
              <div className="inbox-menu-panel-head">
                <strong>Inbox filters</strong>
                <span>Switch queue views</span>
              </div>
              {PRIMARY_TOOLBAR_FILTERS.map((item) => (
                <button
                  className={`inbox-menu-item${filter === item.key ? " active" : ""}`}
                  key={item.key}
                  onClick={() => {
                    setFilter(item.key);
                    setIsToolbarFilterOpen(false);
                  }}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{filterCounts[item.key] ?? 0}</strong>
                </button>
              ))}
              {customFilters.length ? (
                <>
                  <span className="inbox-menu-section-label">Custom categories</span>
                  {customFilters.map((item) => (
                    <button
                      className={`inbox-menu-item${filter === item.key ? " active" : ""}`}
                      key={item.key}
                      onClick={() => {
                        setFilter(item.key);
                        setIsToolbarFilterOpen(false);
                      }}
                      type="button"
                    >
                      <span>{item.label}</span>
                      <strong>{filterCounts[item.key] ?? 0}</strong>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </PortalDropdown>
        </div>
      </div>

      <div className="inbox-workspace-body">
        <section className={`inbox-grid premium-inbox-grid${isDetailsVisible ? "" : " details-hidden"}`}>
          <InboxQueuePanel
            activeConversationId={displayedActiveConversationId}
            conversations={displayedConversations}
            hasSearchQuery={Boolean(searchValue.trim())}
            isFilterMenuOpen={isToolbarFilterOpen}
            isRoutingPending={hasHydrated ? isRoutingPending : false}
            isLoading={!hasHydrated}
            onToggleFilterMenu={() => setIsToolbarFilterOpen((current) => !current)}
            onOpenConversation={openConversation}
            pendingConversationId={hasHydrated ? pendingConversationId : null}
            searchValue={searchValue}
            onSearchValueChange={setSearchValue}
            toolbarFilterButtonRef={toolbarFilterButtonRef}
            unreadCount={filterCounts.unread}
          />

          <InboxThreadPanel
            agents={agents}
            mediaAssets={liveMediaAssets}
            selectedAttachments={selectedAttachments}
            mentionCandidates={mentionCandidates}
            canSendPublicReply={isWhatsAppReady && canReplyToSelectedConversation}
            canTakeOverConversation={canTakeOverSelectedConversation}
            currentAgent={currentAgent}
            error={error}
            hasHydrated={hasHydrated}
            isMuteSupported={isActiveConversationPersonalChannel}
            isInternalNote={isInternalNote}
            isPending={isPending}
            isPersonalChannel={isActiveConversationPersonalChannel}
            messageBody={messageBody}
            selectedMentions={selectedMentions}
            onAddTag={addTag}
            onAttachmentChange={(attachments) => {
              setSelectedAttachments(attachments);
              setError(null);
            }}
            onMediaAssetsChange={(assets) => {
              setLiveMediaAssets(assets);
            }}
            onDeleteMessage={deleteMessage}
            onInsertQuickReply={insertQuickReply}
            onMessageBodyChange={setMessageBody}
            onSetMute={(duration) => updateConversation({ muteDuration: duration })}
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
              setSelectedAttachments([]);
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
              availableContactTags={availableContactTags}
              onAddTag={addExistingContactTag}
              onCreateTag={createContactTag}
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
      </div>

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

      <NewConversationDialog
        channels={whatsapp.channels}
        defaultChannelId={defaultNewConversationChannelId}
        isOpen={isNewConversationOpen}
        isPending={isPending}
        onClose={() => setIsNewConversationOpen(false)}
        onSubmit={startNewConversation}
      />

      <SnoozeDialog
        initialReason={liveSelectedConversation?.snoozeReason ?? null}
        initialValue={liveSelectedConversation?.snoozedUntilIso ?? null}
        isOpen={isSnoozeDialogOpen}
        isPending={isPending}
        onClear={() => {
          setIsSnoozeDialogOpen(false);
          updateConversation({ snoozedUntil: null, snoozeReason: null });
        }}
        onClose={() => setIsSnoozeDialogOpen(false)}
        onSave={({ reason, value }) => {
          setIsSnoozeDialogOpen(false);
          updateConversation({ snoozedUntil: value, snoozeReason: reason });
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

function buildFilterCounts(
  conversations: InboxConversation[],
  currentAgentId: string,
  customFilters: InboxCustomFilter[]
): InboxFilterCounts {
  const counts: InboxFilterCounts = {
    all: conversations.length,
    mine: conversations.filter(
      (item) => !item.isSnoozed && (item.assigneeId === currentAgentId || item.teammateIds.includes(currentAgentId))
    ).length,
    "assigned-others": conversations.filter(
      (item) =>
        !item.isSnoozed &&
        Boolean(item.assigneeId) &&
        item.assigneeId !== currentAgentId &&
        !item.teammateIds.includes(currentAgentId)
    ).length,
    unassigned: conversations.filter((item) => !item.isSnoozed && !item.assigneeId).length,
    unread: conversations.filter((item) => !item.isSnoozed && item.unreadCount > 0).length,
    hot: conversations.filter((item) => !item.isSnoozed && item.isHotLead).length,
    snoozed: conversations.filter((item) => item.isSnoozed).length
  };

  customFilters.forEach((filter) => {
    counts[filter.key] = conversations.filter(
      (item) => !item.isSnoozed && item.tags.some((tag) => normalizeInboxTag(tag) === filter.tag)
    ).length;
  });

  return counts;
}

function buildCustomFilters(conversations: InboxConversation[]) {
  const filters = new Map<string, InboxCustomFilter>();

  conversations.forEach((conversation) => {
    conversation.tags.forEach((tag) => {
      const nextFilter = createCustomInboxFilter(tag);
      if (!nextFilter || filters.has(nextFilter.tag)) {
        return;
      }

      filters.set(nextFilter.tag, nextFilter);
    });
  });

  return [...filters.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function mergeWorkspaceContactTags(
  currentTags: InboxContactTag[],
  conversations: InboxConversation[],
  nextTags: InboxContactTag[] = []
) {
  const merged = new Map<string, InboxContactTag>();

  [...currentTags, ...nextTags].forEach((tag) => {
    const normalizedName = tag.name.trim().toLowerCase();
    if (!normalizedName) {
      return;
    }

    merged.set(normalizedName, tag);
  });

  conversations.forEach((conversation) => {
    conversation.tags.forEach((tag) => {
      const name = tag.trim();
      const normalizedName = name.toLowerCase();
      if (!normalizedName || merged.has(normalizedName)) {
        return;
      }

      merged.set(normalizedName, {
        id: `conversation:${normalizedName}`,
        name,
        description: null,
        source: "inferred"
      });
    });
  });

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function createCustomInboxFilter(value: string) {
  const label = value.trim();
  const tag = normalizeInboxTag(label);
  if (!label || !tag) {
    return null;
  }

  return {
    key: `custom:${slugifyInboxTag(tag)}`,
    label,
    tag
  } satisfies InboxCustomFilter;
}

function normalizeInboxTag(value: string) {
  return value.trim().toLowerCase();
}

function slugifyInboxTag(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || encodeURIComponent(value.trim().toLowerCase()).replace(/%/g, "").toLowerCase();
}

function publishIncomingConversationNotifications(
  previousConversations: InboxConversation[],
  nextConversations: InboxConversation[]
) {
  if (typeof window === "undefined") {
    return;
  }

  const previousById = new Map(previousConversations.map((conversation) => [conversation.id, conversation]));

  nextConversations.forEach((conversation) => {
    const previous = previousById.get(conversation.id);
    const previousUnreadCount = previous?.unreadCount ?? 0;
    const hasMoreUnread = conversation.unreadCount > previousUnreadCount;
    const hasNewerMessage =
      !previous ||
      new Date(conversation.lastMessageAtIso).getTime() > new Date(previous.lastMessageAtIso).getTime();

    if (!hasMoreUnread || !hasNewerMessage || conversation.isMuted) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(INBOX_NOTIFICATION_EVENT, {
        detail: {
          id: `${conversation.id}:${conversation.lastMessageAtIso}:${conversation.unreadCount}`,
          conversationId: conversation.id,
          contactName: conversation.contactName || conversation.phone,
          message: conversation.lastMessagePreview || "New incoming message",
          timestamp: conversation.lastMessageAtIso,
          timestampLabel: conversation.lastMessageAt || "Just now"
        }
      })
    );
  });
}

function parseInboxAckEvent(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<InboxAckEvent>;
    if (
      typeof parsed.providerMessageId !== "string" ||
      typeof parsed.deliveryStatus !== "string" ||
      typeof parsed.ack !== "number" ||
      typeof parsed.timestamp !== "string"
    ) {
      return null;
    }

    return {
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : "",
      channelId: typeof parsed.channelId === "string" ? parsed.channelId : null,
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      messageId: typeof parsed.messageId === "string" ? parsed.messageId : null,
      providerMessageId: parsed.providerMessageId,
      ack: parsed.ack,
      ackStatus: parsed.ackStatus ?? "pending",
      deliveryStatus: parsed.deliveryStatus,
      timestamp: parsed.timestamp
    } satisfies InboxAckEvent;
  } catch {
    return null;
  }
}

function parseInboxConversationEvent(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<InboxConversationEvent>;
    if (
      typeof parsed.workspaceId !== "string" ||
      (parsed.channelId !== null && parsed.channelId !== undefined && typeof parsed.channelId !== "string") ||
      (parsed.conversationId !== null && parsed.conversationId !== undefined && typeof parsed.conversationId !== "string") ||
      (parsed.action !== "snoozed" && parsed.action !== "unsnoozed") ||
      (parsed.trigger !== "manual" &&
        parsed.trigger !== "expiry" &&
        parsed.trigger !== "incoming_message" &&
        parsed.trigger !== "workflow") ||
      typeof parsed.timestamp !== "string"
    ) {
      return null;
    }

    return {
      workspaceId: parsed.workspaceId,
      channelId: parsed.channelId ?? null,
      conversationId: parsed.conversationId ?? null,
      action: parsed.action,
      trigger: parsed.trigger,
      snoozedUntil: typeof parsed.snoozedUntil === "string" ? parsed.snoozedUntil : null,
      snoozeReason: typeof parsed.snoozeReason === "string" ? parsed.snoozeReason : null,
      snoozeStatus: typeof parsed.snoozeStatus === "string" ? parsed.snoozeStatus : null,
      timestamp: parsed.timestamp
    } satisfies InboxConversationEvent;
  } catch {
    return null;
  }
}

function parseInboxChatStateEvent(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<InboxChatStateEvent>;
    if (
      typeof parsed.workspaceId !== "string" ||
      (parsed.channelId !== null && parsed.channelId !== undefined && typeof parsed.channelId !== "string") ||
      (parsed.conversationId !== null && parsed.conversationId !== undefined && typeof parsed.conversationId !== "string") ||
      typeof parsed.isMuted !== "boolean" ||
      typeof parsed.isArchived !== "boolean" ||
      typeof parsed.isPinned !== "boolean" ||
      typeof parsed.unreadCount !== "number" ||
      typeof parsed.timestamp !== "string"
    ) {
      return null;
    }

    return {
      workspaceId: parsed.workspaceId,
      channelId: parsed.channelId ?? null,
      conversationId: parsed.conversationId ?? null,
      isMuted: parsed.isMuted,
      muteExpiration: typeof parsed.muteExpiration === "string" ? parsed.muteExpiration : null,
      isArchived: parsed.isArchived,
      isPinned: parsed.isPinned,
      unreadCount: parsed.unreadCount,
      timestamp: parsed.timestamp
    } satisfies InboxChatStateEvent;
  } catch {
    return null;
  }
}

function publishSnoozeReminderNotification(
  conversation: InboxConversation,
  event: InboxConversationEvent
) {
  if (typeof window === "undefined" || (event.trigger !== "expiry" && event.trigger !== "incoming_message")) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(INBOX_NOTIFICATION_EVENT, {
      detail: {
        id:
          event.trigger === "expiry"
            ? `${conversation.id}:snooze:expiry:${event.snoozedUntil ?? event.timestamp}`
            : `${conversation.id}:snooze:${event.trigger}:${event.timestamp}`,
        conversationId: conversation.id,
        contactName: conversation.contactName || conversation.phone,
        kind: event.trigger === "expiry" ? "snooze-expired" : "message",
        message:
          event.trigger === "incoming_message"
            ? "Customer replied while snoozed. The conversation is back in the queue."
            : "Snooze time reached. The conversation is back in the queue.",
        timestamp: event.timestamp,
        timestampLabel: event.trigger === "incoming_message" ? "Customer reply" : "Snooze expired"
      }
    })
  );
}

function getInboxDesktopNotificationStatusLabel(input: {
  inboxDesktopPermissionState: "unsupported" | "insecure" | "default" | "granted" | "denied";
  inboxDesktopSubscriptionCount: number;
  isInboxDesktopPushEnabled: boolean;
  isMuted: boolean;
}) {
  if (input.inboxDesktopPermissionState === "unsupported") {
    return "Desktop notifications not supported";
  }

  if (input.inboxDesktopPermissionState === "insecure") {
    return "Desktop notifications need HTTPS";
  }

  if (input.isMuted) {
    return "Inbox notifications muted";
  }

  if (input.inboxDesktopPermissionState === "denied") {
    return "Notifications blocked by browser";
  }

  if (input.inboxDesktopPermissionState === "default") {
    return "Permission not requested";
  }

  if (input.inboxDesktopSubscriptionCount > 0) {
    return "Desktop notifications enabled";
  }

  return "Desktop notifications enabled";
}
