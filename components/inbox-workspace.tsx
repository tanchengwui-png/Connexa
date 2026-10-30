"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { InboxDetailPanel } from "@/components/inbox/detail-panel";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DesktopAlertIcon,
  IncognitoIcon,
  MuteIcon,
  PlusIcon,
  VolumeIcon
} from "@/components/inbox/icons";
import { NewConversationDialog } from "@/components/inbox/new-conversation-dialog";
import { InboxQueuePanel } from "@/components/inbox/queue-panel";
import { InboxStatusStrip } from "@/components/inbox/status-strip";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { SnoozeDialog } from "@/components/inbox/snooze-dialog";
import { InboxThreadPanel } from "@/components/inbox/thread-panel";
import { normalizeInboxSelectedConversation } from "@/lib/inbox-message-normalization";
import {
  buildInboxHrefWithConversation,
  buildInboxHrefWithoutConversation,
  isCurrentInboxConversationResponse
} from "@/lib/inbox-selection";
import { useInboxBrowserNotifications } from "@/lib/use-inbox-browser-notifications";
import { useInboxNotificationSoundPreference } from "@/lib/use-inbox-notification-sound-preference";
import type {
  InboxAgent,
  InboxComposerAttachment,
  InboxConversation,
  InboxConversationPage,
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
  conversationPage: InboxConversationPage;
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
const RECENT_CONVERSATION_CACHE_SIZE = 8;

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
  { key: "groups", label: "Groups" },
  { key: "unread", label: "Unread" },
  { key: "snoozed", label: "Snoozed" },
  { key: "assigned-others", label: "Assigned to others" },
  { key: "unassigned", label: "Unowned" },
  { key: "hot", label: "Hot" }
];

export function InboxWorkspace({
  conversations,
  conversationPage,
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
  const routeConversationId = searchParams?.get("conversationId") ?? null;
  const toast = useToast();
  const [liveConversations, setLiveConversations] = useState(conversations);
  const [liveConversationPage, setLiveConversationPage] = useState(conversationPage);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [liveWhatsApp, setLiveWhatsApp] = useState(whatsapp);
  const [liveSelectedConversation, setLiveSelectedConversation] = useState(() =>
    normalizeInboxSelectedConversation(selectedConversation)
  );
  const [liveContactTags, setLiveContactTags] = useState(contactTags);
  const [liveMediaAssets, setLiveMediaAssets] = useState(mediaAssets);
  const [messageBody, setMessageBody] = useState("");
  const [mentionCandidates, setMentionCandidates] = useState<InboxMentionCandidate[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<InboxSelectedMention[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<InboxComposerAttachment[]>([]);
  const [recordedVoiceNote, setRecordedVoiceNote] = useState<File | null>(null);
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
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(true);
  const [isQueueVisible, setIsQueueVisible] = useState(true);
  const toolbarFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeSendIdempotencyKeyRef = useRef<string | null>(null);
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
    isLocallyDisabled: areInboxDesktopNotificationsDisabled,
    isPending: isInboxDesktopNotificationsPending,
    error: inboxDesktopNotificationsError,
    setMuted: setInboxDesktopNotificationsMuted,
    enableDesktopNotifications,
    disableDesktopNotifications
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
  const conversationListEtagRef = useRef<string | null>(null);
  const selectedConversationAbortRef = useRef<AbortController | null>(null);
  const selectedConversationCacheRef = useRef(new Map<string, NonNullable<InboxSelectedConversation>>());
  const routeConversationIdRef = useRef(routeConversationId);
  const inboxUsableTimingReportedRef = useRef(false);
  const hasDisconnectedWhatsAppSession =
    liveWhatsApp.mode !== "mock" &&
    (liveWhatsApp.runtimeStatus === "DISCONNECTED" || liveWhatsApp.runtimeStatus === "AUTH_FAILED");
  const isWhatsAppReady = liveWhatsApp.isConfigured && !hasDisconnectedWhatsAppSession;
  const inboxConnectionLabel =
    liveWhatsApp.mode === "mock"
      ? "Mock mode"
      : hasDisconnectedWhatsAppSession
        ? "Connection lost"
        : isWhatsAppReady
          ? "Connected"
          : "Setup needed";
  const inboxConnectionMeta =
    liveWhatsApp.mode === "mock"
      ? "Automation replies are simulated locally"
      : hasDisconnectedWhatsAppSession
        ? "Session is disconnected. Existing conversations stay visible until you relink WhatsApp."
        : `Phone ID ${liveWhatsApp.phoneNumberId ?? "Not set"}`;
  const inboxWhatsAppWarning = hasDisconnectedWhatsAppSession
    ? liveWhatsApp.runtimeStatus === "AUTH_FAILED"
      ? "WhatsApp session failed authentication. Existing conversations remain visible, but sending and sync are paused until you reconnect."
      : "WhatsApp session ended on the linked phone. Existing conversations remain visible, but sending and sync are paused until you reconnect."
    : null;
  const inboxSenderWarning = liveWhatsApp.mode !== "mock" && !liveWhatsApp.senderReachable
    ? "Connexa cannot currently reach the WhatsApp sender service. The last saved WhatsApp connection state is shown; this does not confirm that the phone session disconnected."
    : null;

  const activeConversationId = routeConversationId;
  const activeConversation =
    liveSelectedConversation?.id === activeConversationId ? liveSelectedConversation : null;
  const shouldShowHistoryStatus =
    (liveWhatsApp.mode !== "mock" &&
      liveWhatsApp.channels.some((channel) => channel.connectionMethod === "web")) ||
    liveWhatsApp.historySyncActive ||
    liveWhatsApp.historySyncPhase === "deferred" ||
    liveWhatsApp.historySyncPhase === "error" ||
    liveWhatsApp.historySyncPhase === "disconnected";
  const inboxDesktopNotificationsEnabled =
    inboxDesktopPermissionState === "granted" &&
    !areInboxDesktopNotificationsDisabled &&
    (!isInboxDesktopPushEnabled || inboxDesktopSubscriptionCount > 0);
  const inboxDesktopNotificationsUnavailable =
    inboxDesktopPermissionState === "unsupported" || inboxDesktopPermissionState === "insecure";
  const inboxDesktopNotificationsBlocked = inboxDesktopPermissionState === "denied";
  const inboxDesktopNotificationsButtonLabel = isInboxDesktopNotificationsPending
    ? "Saving..."
    : inboxDesktopNotificationsEnabled
      ? "Desktop alerts on"
      : inboxDesktopNotificationsBlocked
        ? "Desktop alerts blocked"
        : inboxDesktopNotificationsUnavailable
          ? "Desktop alerts unavailable"
          : "Desktop alerts off";
  const selectedChannelId = searchParams?.get("channelId") ?? null;
  const currentSearchParams = searchParams?.toString() ?? "";
  const activeConversationChannelId =
    activeConversation?.channelId ??
    liveConversations.find((conversation) => conversation.id === activeConversationId)?.channelId ??
    null;
  const personalWhatsAppChannels = whatsapp.channels.filter((channel) => channel.connectionMethod === "web");
  const singlePersonalWhatsAppChannel =
    personalWhatsAppChannels.length === 1 ? personalWhatsAppChannels[0] : null;
  const incognitoTargetChannelId =
    selectedChannelId ?? activeConversationChannelId ?? singlePersonalWhatsAppChannel?.id ?? null;
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

  useEffect(() => {
    if (!incognitoTargetChannelId || !isWhatsAppReady || inboxUsableTimingReportedRef.current) return;
    inboxUsableTimingReportedRef.current = true;
    const timingKey = `connexa:whatsapp-inbox-usable:${incognitoTargetChannelId}`;
    if (window.sessionStorage.getItem(timingKey)) return;
    window.sessionStorage.setItem(timingKey, "1");

    void fetch("/api/settings/whatsapp/timing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: incognitoTargetChannelId,
        eventType: "INBOX_USABLE",
        observedAt: new Date().toISOString()
      }),
      keepalive: true
    }).catch(() => null);
  }, [incognitoTargetChannelId, isWhatsAppReady]);
  const activeCustomFilter = useMemo(
    () => customFilters.find((item) => item.key === filter) ?? null,
    [customFilters, filter]
  );

  const refreshConversationList = async (options: { suppressNotifications?: boolean } = {}) => {
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
        cache: "no-store",
        headers: conversationListEtagRef.current
          ? { "if-none-match": conversationListEtagRef.current }
          : undefined
      });

      if (response.status === 304) {
        return liveConversationsRef.current;
      }

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            conversations?: InboxConversation[];
            page?: InboxConversationPage;
          }
        | null;

      if (!payload?.conversations) {
        return null;
      }

      conversationListEtagRef.current = response.headers.get("etag");
      const nextConversations = mergeConversationPages(
        payload.conversations,
        liveConversationsRef.current
      );
      if (!options.suppressNotifications) {
        publishIncomingConversationNotifications(liveConversationsRef.current, nextConversations);
      }
      liveConversationsRef.current = nextConversations;
      setLiveConversations(nextConversations);
      if (payload.page) {
        setLiveConversationPage(payload.page);
      }
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

  const loadMoreConversations = async () => {
    if (!liveConversationPage.hasMore || !liveConversationPage.nextCursor || isLoadingMoreConversations) {
      return;
    }
    setIsLoadingMoreConversations(true);
    try {
      const params = new URLSearchParams({ cursor: liveConversationPage.nextCursor, limit: "50" });
      if (selectedChannelId) params.set("channelId", selectedChannelId);
      const response = await fetch(`/api/conversations?${params.toString()}`, {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => null)) as
        | {
            conversations?: InboxConversation[];
            page?: InboxConversationPage;
          }
        | null;
      if (!payload?.conversations || !payload.page) return;
      const nextConversations = mergeConversationPages(
        liveConversationsRef.current,
        payload.conversations
      );
      liveConversationsRef.current = nextConversations;
      setLiveConversations(nextConversations);
      setLiveConversationPage(payload.page);
    } finally {
      setIsLoadingMoreConversations(false);
    }
  };

  const refreshHistorySyncStatus = async () => {
    const response = await fetch("/api/inbox/history-sync-status", {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as
      | {
          channels?: Array<{
            channelId: string;
            runtimeStatus: string;
            phase: InboxWhatsAppStatus["historySyncPhase"];
            active: boolean;
            isCaughtUp: boolean;
            startedAt: string | null;
            progressAt: string | null;
            lastSuccessfulSyncAt: string | null;
            nextReconciliationAt: string | null;
            totalChats: number | null;
            processedChats: number;
            remainingChats: number;
            deferredChats: number;
            newMessages: number;
            lastError: string | null;
          }>;
        }
      | null;
    const statuses = payload?.channels ?? [];
    const preferredChannelId = selectedChannelId ?? activeConversationChannelId;
    const status =
      statuses.find((item) => item.channelId === preferredChannelId) ??
      statuses.find((item) => item.active) ??
      statuses[0];
    if (!status) return null;

    const progressAgeMs = status.progressAt ? Date.now() - new Date(status.progressAt).getTime() : 0;
    setLiveWhatsApp((current) => ({
      ...current,
      channels: current.channels.map((channel) =>
        channel.id === status.channelId ? { ...channel, runtimeStatus: status.runtimeStatus } : channel
      ),
      runtimeStatus: status.runtimeStatus,
      isInboxReady: ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status.runtimeStatus),
      isHistoryStabilizing: status.active,
      historySyncFullyCaughtUp: status.isCaughtUp,
      historySyncProcessedChats: status.processedChats,
      historySyncTotalChats: status.totalChats,
      historySyncPhase: status.phase,
      historySyncActive: status.active,
      historySyncStartedAt: status.startedAt,
      historySyncProgressAt: status.progressAt,
      historySyncLastSuccessfulAt: status.lastSuccessfulSyncAt,
      historySyncNextReconciliationAt: status.nextReconciliationAt,
      historySyncRemainingChats: status.remainingChats,
      historySyncDeferredChats: status.deferredChats,
      historySyncNewMessages: status.newMessages,
      isHistoryStuck: status.active && progressAgeMs > 5 * 60_000,
      isLiveOnlyMode: status.phase === "deferred" || status.phase === "error",
      lastSyncError: status.lastError
    }));
    return status;
  };

  const refreshSelectedConversation = async (conversationId: string | null) => {
    if (!conversationId) {
      selectedConversationAbortRef.current?.abort();
      setLiveSelectedConversation(null);
      return null;
    }

    if (routeConversationIdRef.current !== conversationId) {
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
      if (
        !normalizedConversation ||
        !isCurrentInboxConversationResponse({
          requestedConversationId: conversationId,
          routeConversationId: routeConversationIdRef.current,
          responseConversationId: normalizedConversation?.id ?? null
        })
      ) {
        return null;
      }
      cacheSelectedConversation(selectedConversationCacheRef.current, normalizedConversation);
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
      setPendingConversationId((current) => (current === conversationId ? null : current));
    }
  };

  const loadOlderMessages = async () => {
    const current = liveSelectedConversation;
    const cursor = current?.messagePage.nextCursor;
    if (!current || !cursor) return;
    const params = new URLSearchParams({ messageCursor: cursor, messageLimit: "50" });
    if (selectedChannelId) params.set("channelId", selectedChannelId);
    const response = await fetch(`/api/conversations/${current.id}?${params.toString()}`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = (await response.json().catch(() => null)) as
      | { conversation?: InboxSelectedConversation | null }
      | null;
    const older = normalizeInboxSelectedConversation(payload?.conversation ?? null);
    if (!older || older.id !== current.id) return;
    setLiveSelectedConversation((latest) =>
      latest && latest.id === older.id
        ? normalizeInboxSelectedConversation({
            ...latest,
            messagePage: older.messagePage,
            messages: [...older.messages, ...latest.messages]
          })
        : latest
    );
  };

  useEffect(() => {
    return () => {
      selectedConversationAbortRef.current?.abort();
    };
  }, []);

  const refreshInboxPanels = async (
    conversationId: string | null = activeConversationId,
    suppressNotifications = false
  ) => {
    await Promise.all([
      refreshConversationList({ suppressNotifications }),
      refreshSelectedConversation(conversationId),
      refreshHistorySyncStatus()
    ]);
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

  const handleDesktopNotificationsClick = async () => {
    if (inboxDesktopNotificationsEnabled) {
      const disabled = await disableDesktopNotifications();
      if (!disabled) {
        return;
      }

      setError(null);
      toast.success(
        "Desktop alerts disabled",
        "This browser will no longer show desktop notifications for new Inbox messages."
      );
      return;
    }

    if (inboxDesktopNotificationsBlocked) {
      const message = "Allow notifications for this site in your browser settings, then refresh Connexa.";
      setError(message);
      toast.error("Desktop alerts are blocked", message);
      return;
    }

    if (inboxDesktopNotificationsUnavailable) {
      const message =
        inboxDesktopPermissionState === "insecure"
          ? "Open Connexa over HTTPS to enable desktop alerts."
          : "Desktop alerts are not supported by this browser.";
      setError(message);
      toast.error("Desktop alerts unavailable", message);
      return;
    }

    const enabled = await enableDesktopNotifications();
    if (!enabled) {
      return;
    }

    setError(null);
    toast.success(
      "Desktop alerts enabled",
      "New Inbox messages can now appear as desktop notifications."
    );
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
    const abortController = new AbortController();
    const loadMediaAssets = async () => {
      const response = await fetch("/api/inbox/media-assets", {
        cache: "no-store",
        signal: abortController.signal
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => null)) as { assets?: InboxMediaAsset[] } | null;
      if (payload?.assets) setLiveMediaAssets(payload.assets);
    };
    const timeoutId = window.setTimeout(() => void loadMediaAssets().catch(() => null), 0);
    const metadataTimeoutId = window.setTimeout(() => {
      void refreshConversationList({ suppressNotifications: true });
      if (routeConversationIdRef.current) {
        void refreshSelectedConversation(routeConversationIdRef.current);
      }
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(metadataTimeoutId);
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    const nextConversations = sortConversationsByRecent(conversations);
    liveConversationsRef.current = nextConversations;
    setLiveConversations(nextConversations);
  }, [conversations]);

  useEffect(() => {
    setLiveConversationPage(conversationPage);
  }, [conversationPage]);

  useEffect(() => {
    setLiveWhatsApp(whatsapp);
  }, [whatsapp]);

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
    routeConversationIdRef.current = routeConversationId;
    selectedConversationAbortRef.current?.abort();

    if (!routeConversationId) {
      setLiveSelectedConversation(null);
      return;
    }

    const cachedConversation = selectedConversationCacheRef.current.get(routeConversationId);
    if (cachedConversation) {
      cacheSelectedConversation(selectedConversationCacheRef.current, cachedConversation);
      setLiveSelectedConversation(cachedConversation);
      void refreshSelectedConversation(routeConversationId);
      return;
    }

    const normalizedConversation = normalizeInboxSelectedConversation(selectedConversation);
    if (normalizedConversation?.id === routeConversationId) {
      cacheSelectedConversation(selectedConversationCacheRef.current, normalizedConversation);
      setLiveSelectedConversation(normalizedConversation);
      return;
    }

    setLiveSelectedConversation(null);
    void refreshSelectedConversation(routeConversationId);
  }, [routeConversationId, selectedConversation]);

  useEffect(() => {
    if (!routeConversationId) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
        return;
      }

      if (pendingDeleteMessageId) {
        setPendingDeleteMessageId(null);
        return;
      }

      if (document.querySelector(".inbox-portal-menu, [role='dialog'], [role='listbox']")) {
        return;
      }

      event.preventDefault();
      selectedConversationAbortRef.current?.abort();
      routeConversationIdRef.current = null;
      setPendingConversationId(null);
      setLiveSelectedConversation(null);

      window.history.pushState(null, "", buildInboxHrefWithoutConversation(currentSearchParams));
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [currentSearchParams, pendingDeleteMessageId, routeConversationId, router]);

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

    let timeoutId: number | null = null;
    const scheduleRecoveryPoll = () => {
      timeoutId = window.setTimeout(async () => {
        await refreshInbox();
        scheduleRecoveryPoll();
      }, 90_000 + Math.floor(Math.random() * 15_000));
    };
    scheduleRecoveryPoll();
    window.addEventListener("focus", runRefresh);
    document.addEventListener("visibilitychange", runRefresh);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
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
    let refreshTimer: number | null = null;
    let hiddenRefreshPending = false;
    let suppressNextNotification = false;
    let lastErrorRecoveryAt = 0;

    const scheduleRealtimeRefresh = (suppressNotifications = false) => {
      suppressNextNotification = suppressNextNotification || suppressNotifications;
      if (document.visibilityState !== "visible") {
        hiddenRefreshPending = true;
        return;
      }
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        const suppress = suppressNextNotification;
        suppressNextNotification = false;
        void refreshInboxPanels(activeConversationId, suppress);
      }, 250);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && hiddenRefreshPending) {
        hiddenRefreshPending = false;
        scheduleRealtimeRefresh(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleMessage = (event: MessageEvent<string>) => {
      const payload = parseInboxMessageEvent(event.data);
      // A historical personal-web event still refreshes the UI, but it cannot
      // create a tab/browser notification through this refresh path.
      scheduleRealtimeRefresh(payload?.notificationEligible === false);
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

      scheduleRealtimeRefresh();
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

      scheduleRealtimeRefresh();
    };

    eventSource.addEventListener("inbox:message", handleMessage);
    eventSource.addEventListener("inbox:ack", handleAck as EventListener);
    eventSource.addEventListener("inbox:conversation", handleConversation as EventListener);
    eventSource.addEventListener("inbox:chat-state", handleChatState as EventListener);

    eventSource.onerror = () => {
      if (Date.now() - lastErrorRecoveryAt < 30_000) return;
      lastErrorRecoveryAt = Date.now();
      scheduleRealtimeRefresh(true);
    };

    return () => {
      eventSource.removeEventListener("inbox:message", handleMessage);
      eventSource.removeEventListener("inbox:ack", handleAck as EventListener);
      eventSource.removeEventListener("inbox:conversation", handleConversation as EventListener);
      eventSource.removeEventListener("inbox:chat-state", handleChatState as EventListener);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      eventSource.close();
    };
  }, [activeConversationId, selectedChannelId, toast]);

  useEffect(() => {
    if (pendingConversationId && activeConversation?.id === pendingConversationId) {
      setPendingConversationId(null);
    }
  }, [activeConversation?.id, pendingConversationId]);

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
    if (!activeConversationId || !activeConversation?.isGroup || isInternalNote) {
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
  }, [activeConversationId, isInternalNote, activeConversation?.isGroup]);

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

      if (filter === "groups" && !conversation.isGroup) {
        return false;
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
  const displayedActiveConversationId = hasHydrated ? activeConversationId : selectedConversation?.id ?? null;
  const canReplyToSelectedConversation = Boolean(
    !activeConversation?.assigneeId ||
      activeConversation.assigneeId === currentAgent.id ||
      currentAgent.role === "MANAGER"
  );
  const requiresTakeOverForPublicReply = Boolean(isWhatsAppReady && !canReplyToSelectedConversation && activeConversation);
  const canTakeOverSelectedConversation = Boolean(
    activeConversation?.assigneeId && activeConversation.assigneeId !== currentAgent.id
  );
  const replyingToMessage =
    activeConversation?.messages.find((message) => message.id === replyToMessageId) ?? null;

  const openConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) {
      return;
    }

    selectedConversationAbortRef.current?.abort();
    routeConversationIdRef.current = conversationId;
    setPendingConversationId(conversationId);
    setLiveSelectedConversation(selectedConversationCacheRef.current.get(conversationId) ?? null);

    // A chat selection is client state, not a full page navigation. Keeping the
    // URL in history preserves deep links/back-forward while avoiding another
    // run of the expensive Inbox server loader for every click.
    window.history.pushState(null, "", buildInboxHrefWithConversation(currentSearchParams, conversationId));
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

    if (activeSendIdempotencyKeyRef.current) {
      return;
    }

    const trimmedBody = messageBody.trim();
    const activeMentions = selectedMentions.filter((mention) => messageBody.includes(`@${mention.label}`));
    if (!trimmedBody && !selectedAttachments.length && !recordedVoiceNote) {
      setError("Message body or media is required.");
      return;
    }

    setError(null);

    const idempotencyKey = crypto.randomUUID();
    activeSendIdempotencyKeyRef.current = idempotencyKey;
    startTransition(async () => {
      try {
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
                senderId: activeConversation?.assigneeId ?? null
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
              if (recordedVoiceNote) {
                formData.append("recordedVoiceNote", recordedVoiceNote);
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
                headers: {
                  "Idempotency-Key": idempotencyKey
                },
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
      setRecordedVoiceNote(null);
      setSelectedMentions([]);
      setReplyToMessageId(null);
      setIsInternalNote(false);
      await refreshInboxPanels(activeConversationId);
      } finally {
        activeSendIdempotencyKeyRef.current = null;
      }
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
    if (!incognitoTargetChannelId) {
      const message = "Select a WhatsApp number or open a conversation before changing incognito mode.";
      setError(message);
      toast.error("Choose a WhatsApp number", message);
      return;
    }

    if (!selectedChannelSupportsIncognito) {
      const message = "Incognito mode is only available for personal WhatsApp sessions.";
      setError(message);
      toast.error("Incognito mode unavailable", message);
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
        const message = payload?.error ?? "Unable to update incognito mode.";
        setError(message);
        toast.error("Incognito mode update failed", message);
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
      toast.success(
        nextChannel.incognitoMode ? "Incognito mode enabled" : "Incognito mode disabled",
        nextChannel.incognitoMode
          ? "Reading chats on this number will not send seen receipts."
          : "Reading chats on this number can send seen receipts again."
      );
    });
  };

  const takeOverConversation = () => {
    if (!activeConversation) {
      return;
    }

    updateConversation({
      assigneeId: currentAgent.id,
      teammateIds: activeConversation.teammateIds.filter((id) => id !== currentAgent.id)
    });
  };

  const addTag = (presetTag?: string) => {
    if (!activeConversation) {
      return;
    }

    const input = presetTag ?? window.prompt("Add a tag", "") ?? "";
    const nextTag = input.trim();

    if (!nextTag) {
      return;
    }

    updateConversation({
      tags: Array.from(new Set([...activeConversation.tags, nextTag]))
    });
  };

  const deleteMessage = (messageId: string) => {
    if (!activeConversationId) {
      return;
    }

    const targetMessage = activeConversation?.messages.find((message) => message.id === messageId);
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
    if (!activeConversation) {
      return;
    }

    updateConversation({
      tags: activeConversation.tags.filter((tag) => tag !== tagToRemove)
    });
  };

  const addExistingContactTag = async (tagName: string) => {
    if (!activeConversation) {
      return {
        ok: false as const,
        error: "Conversation not found."
      };
    }

    return patchConversation({
      tags: Array.from(new Set([...activeConversation.tags, tagName]))
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
    <section className="inbox-workspace premium-inbox-workspace inbox-reference-v2">
      <div className="inbox-workspace-chrome">
        {inboxWhatsAppWarning ? (
          <div className="inbox-snooze-banner">
            <strong>WhatsApp connection lost</strong>
            <span>{inboxWhatsAppWarning}</span>
            <a className="button button-secondary" href="/settings/whatsapp">
              Start fresh session
            </a>
          </div>
        ) : null}

        {inboxSenderWarning ? (
          <div className="inbox-snooze-banner">
            <strong>WhatsApp sender unavailable</strong>
            <span>{inboxSenderWarning}</span>
            <a className="button button-secondary" href="/settings/whatsapp">
              View connection status
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
                className="button button-primary inbox-new-conversation-button inbox-toolbar-icon-action"
                disabled={!eligibleNewConversationChannels.length || isPending}
                onClick={() => setIsNewConversationOpen(true)}
                title="New conversation"
                type="button"
              >
                <PlusIcon />
                <span className="inbox-toolbar-control-label">New conversation</span>
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
              {shouldShowHistoryStatus ? <InboxStatusStrip summary={summary} whatsapp={liveWhatsApp} /> : null}
              <div
                className={`inbox-desktop-notifications-compact${inboxDesktopNotificationsEnabled ? " is-enabled" : ""}${inboxDesktopNotificationsBlocked ? " is-blocked" : ""}`}
              >
                <button
                  aria-pressed={inboxDesktopNotificationsEnabled}
                  className="button button-secondary inbox-desktop-notifications-enable"
                  disabled={isInboxDesktopNotificationsPending}
                  onClick={() => void handleDesktopNotificationsClick()}
                  aria-label={inboxDesktopNotificationsButtonLabel}
                  title={inboxDesktopNotificationsButtonLabel}
                  type="button"
                >
                  <DesktopAlertIcon />
                  <span className="inbox-toolbar-control-label">{inboxDesktopNotificationsButtonLabel}</span>
                </button>
              </div>
              <Button
                aria-label={
                  selectedChannelState?.incognitoMode === true
                    ? "Turn off WhatsApp incognito mode"
                    : "Turn on WhatsApp incognito mode"
                }
                aria-pressed={selectedChannelState?.incognitoMode === true}
                className={`inbox-incognito-toggle${selectedChannelState?.incognitoMode ? " active" : ""}`}
                disabled={isPending}
                onClick={toggleIncognitoMode}
                selected={selectedChannelState?.incognitoMode === true}
                title={
                  !incognitoTargetChannelId
                    ? "Select a WhatsApp number or open a conversation"
                    : !selectedChannelSupportsIncognito
                      ? "Available for personal WhatsApp sessions"
                      : "Read chats without sending seen receipts"
                }
                variant="toggle"
              >
                <IncognitoIcon />
                <span className="inbox-toolbar-control-label">
                  {isPending
                    ? "Saving..."
                    : selectedChannelState?.incognitoMode === true
                      ? "Incognito on"
                      : "Incognito off"}
                </span>
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
                <span className="inbox-toolbar-control-label">
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
        <section
          className={`inbox-grid premium-inbox-grid${isDetailsVisible ? "" : " details-hidden"}${isQueueVisible ? "" : " queue-hidden"}`}
        >
          {isQueueVisible ? (
            <InboxQueuePanel
              activeConversationId={displayedActiveConversationId}
              activeFilter={filter}
              conversations={displayedConversations}
              filterCounts={filterCounts}
              loadedCount={liveConversations.length}
              totalCount={Math.max(liveConversationPage.totalCount, liveConversations.length)}
              hasSearchQuery={Boolean(searchValue.trim())}
              isFilterMenuOpen={isToolbarFilterOpen}
              isRoutingPending={hasHydrated ? pendingConversationId !== null : false}
              isLoading={!hasHydrated}
              hasMore={liveConversationPage.hasMore}
              isLoadingMore={isLoadingMoreConversations}
              onLoadMore={() => void loadMoreConversations()}
              onHideQueue={() => setIsQueueVisible(false)}
              onSelectFilter={setFilter}
              onToggleFilterMenu={() => setIsToolbarFilterOpen((current) => !current)}
              onOpenConversation={openConversation}
              pendingConversationId={hasHydrated ? pendingConversationId : null}
              searchValue={searchValue}
              onSearchValueChange={setSearchValue}
              toolbarFilterButtonRef={toolbarFilterButtonRef}
            />
          ) : (
            <button
              aria-label="Show conversation list"
              className="inbox-queue-reopen-tab"
              onClick={() => setIsQueueVisible(true)}
              type="button"
            >
              <ChevronRightIcon />
              <span>Chats</span>
            </button>
          )}

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
            onRecordedVoiceNoteChange={(file) => {
              setRecordedVoiceNote(file);
              setError(null);
            }}
            onMediaAssetsChange={(assets) => {
              setLiveMediaAssets(assets);
            }}
            onDeleteMessage={deleteMessage}
            onInsertQuickReply={insertQuickReply}
            onInternalNoteChange={setIsInternalNote}
            onMessageBodyChange={setMessageBody}
            onLoadOlderMessages={loadOlderMessages}
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
            recordedVoiceNote={recordedVoiceNote}
            onScheduleMessage={(value) => void sendMessage(value)}
            onSendMessage={() => void sendMessage()}
            onSnoozeConversation={() => setIsSnoozeDialogOpen(true)}
            onTakeOverConversation={takeOverConversation}
            onUpdateConversation={updateConversation}
            quickReplies={quickReplies}
            requiresTakeOverForPublicReply={requiresTakeOverForPublicReply}
            selectedConversation={activeConversation}
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
              selectedConversation={activeConversation}
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
        selectedConversation={activeConversation}
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
        initialReason={activeConversation?.snoozeReason ?? null}
        initialValue={activeConversation?.snoozedUntilIso ?? null}
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

function cacheSelectedConversation(
  cache: Map<string, NonNullable<InboxSelectedConversation>>,
  conversation: NonNullable<InboxSelectedConversation>
) {
  // Reinsert on access so the Map also acts as a tiny LRU. Capping this keeps
  // media-heavy message payloads from growing with every chat opened.
  cache.delete(conversation.id);
  cache.set(conversation.id, conversation);

  while (cache.size > RECENT_CONVERSATION_CACHE_SIZE) {
    const oldestConversationId = cache.keys().next().value;
    if (!oldestConversationId) break;
    cache.delete(oldestConversationId);
  }
}

function mergeConversationPages(primary: InboxConversation[], secondary: InboxConversation[]) {
  const byId = new Map<string, InboxConversation>();
  for (const conversation of [...secondary, ...primary]) {
    byId.set(conversation.id, conversation);
  }
  return sortConversationsByRecent(Array.from(byId.values()));
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
    groups: conversations.filter((item) => !item.isSnoozed && item.isGroup).length,
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

function parseInboxMessageEvent(value: string) {
  try {
    const parsed = JSON.parse(value) as { notificationEligible?: unknown };
    return { notificationEligible: parsed.notificationEligible === false };
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
