import { AgentStatus } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

type BrowserPushSubscriptionInput = {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
};

type InboxWebPushPayload = {
  body: string;
  conversationId: string | null;
  createdAt: string;
  eventId: string;
  icon: string;
  notificationId: string;
  title: string;
  url: string;
  workspaceId: string;
};

type InboxPushNotificationContext = {
  accountId: string | null;
  agentId: string;
  browserPushSubscriptionId: string;
  endpoint: string;
  authKey: string;
  p256dhKey: string;
};

const PUSH_ENABLED = process.env.INBOX_WEB_PUSH_ENABLED !== "false";
const DEFAULT_PUSH_SUBJECT = "mailto:support@connexa.local";

function isMissingBrowserPushSubscriptionSchemaError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string; meta?: { table?: string; modelName?: string } };
  return (
    candidate.code === "P2021" ||
    candidate.code === "P2022" ||
    candidate.meta?.table === "BrowserPushSubscription" ||
    candidate.meta?.modelName === "BrowserPushSubscription" ||
    candidate.message.includes("BrowserPushSubscription")
  );
}

function getAppUrl() {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

function getVapidConfiguration() {
  const publicKey = process.env.INBOX_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.INBOX_WEB_PUSH_VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.INBOX_WEB_PUSH_VAPID_SUBJECT?.trim() || DEFAULT_PUSH_SUBJECT;
  return {
    publicKey,
    privateKey,
    subject
  };
}

export function isInboxWebPushConfigured() {
  const config = getVapidConfiguration();
  return PUSH_ENABLED && Boolean(config.publicKey && config.privateKey);
}

export function getInboxWebPushPublicKey() {
  return getVapidConfiguration().publicKey || null;
}

export async function getCurrentAgentPushStatus(input: {
  accountId: string | null;
  agentId: string;
}) {
  if (!isInboxWebPushConfigured()) {
    return {
      enabled: false,
      subscriptionCount: 0,
      vapidPublicKey: null
    };
  }

  const where = input.accountId
    ? {
        accountId: input.accountId,
        enabled: true
      }
    : {
        agentId: input.agentId,
        enabled: true
      };

  let subscriptionCount = 0;
  try {
    subscriptionCount = await prisma.browserPushSubscription.count({
      where
    });
  } catch (error) {
    if (!isMissingBrowserPushSubscriptionSchemaError(error)) {
      throw error;
    }
  }

  return {
    enabled: true,
    subscriptionCount,
    vapidPublicKey: getInboxWebPushPublicKey()
  };
}

export async function upsertBrowserPushSubscription(input: {
  accountId: string | null;
  agentId: string;
  subscription: BrowserPushSubscriptionInput;
  userAgent: string | null;
}) {
  const endpoint = input.subscription.endpoint.trim();
  const p256dhKey = input.subscription.keys.p256dh.trim();
  const authKey = input.subscription.keys.auth.trim();

  if (!endpoint || !p256dhKey || !authKey) {
    throw new Error("INVALID_BROWSER_PUSH_SUBSCRIPTION");
  }

  let record;
  try {
    record = await prisma.browserPushSubscription.upsert({
      where: {
        endpoint
      },
      update: {
        accountId: input.accountId,
        agentId: input.agentId,
        p256dhKey,
        authKey,
        userAgent: input.userAgent,
        enabled: true,
        lastFailureAt: null,
        lastFailureCode: null
      },
      create: {
        accountId: input.accountId,
        agentId: input.agentId,
        endpoint,
        p256dhKey,
        authKey,
        userAgent: input.userAgent,
        enabled: true
      },
      select: {
        id: true,
        endpoint: true,
        enabled: true
      }
    });
  } catch (error) {
    if (isMissingBrowserPushSubscriptionSchemaError(error)) {
      throw new Error(
        "Browser push subscriptions are not available until the latest database migration is applied."
      );
    }

    throw error;
  }

  return {
    id: record.id,
    endpoint: record.endpoint,
    enabled: record.enabled
  };
}

export async function disableBrowserPushSubscription(input: {
  accountId: string | null;
  agentId: string;
  endpoint: string;
}) {
  const endpoint = input.endpoint.trim();
  if (!endpoint) {
    throw new Error("INVALID_BROWSER_PUSH_SUBSCRIPTION");
  }

  const where = input.accountId
    ? {
        endpoint,
        accountId: input.accountId
      }
    : {
        endpoint,
        agentId: input.agentId
      };

  try {
    await prisma.browserPushSubscription.updateMany({
      where,
      data: {
        enabled: false
      }
    });
  } catch (error) {
    if (!isMissingBrowserPushSubscriptionSchemaError(error)) {
      throw error;
    }
  }

  return {
    endpoint,
    enabled: false
  };
}

export async function dispatchInboxWebPushForMessageEvent(input: {
  workspaceId: string;
  conversationId: string | null;
  messageId: string | null;
  from: string;
  message: string;
  timestamp: string;
  direction?: "INBOUND" | "OUTBOUND" | null;
}) {
  if (!isInboxWebPushConfigured() || input.direction !== "INBOUND" || !input.conversationId) {
    return;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      workspaceId: true,
      lastMessagePreview: true,
      contact: {
        select: {
          displayName: true,
          phone: true
        }
      }
    }
  });

  if (!conversation) {
    return;
  }

  const title = conversation.contact.displayName?.trim() || conversation.contact.phone || "New Inbox message";
  const body = (input.message || conversation.lastMessagePreview || "New incoming message").trim();
  const eventId = input.messageId
    ? `message:${input.messageId}`
    : `message:${conversation.id}:${input.timestamp}`;

  await dispatchInboxWebPushToWorkspace({
    workspaceId: input.workspaceId,
    payload: {
      notificationId: eventId,
      eventId,
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      title,
      body,
      url: `/inbox?conversationId=${encodeURIComponent(conversation.id)}`,
      icon: `${getAppUrl()}/icon`,
      createdAt: input.timestamp
    }
  });
}

export async function dispatchInboxWebPushForConversationEvent(input: {
  workspaceId: string;
  conversationId: string | null;
  action: "snoozed" | "unsnoozed";
  trigger: "manual" | "expiry" | "incoming_message" | "workflow";
  timestamp: string;
}) {
  if (
    !isInboxWebPushConfigured() ||
    !input.conversationId ||
    input.action !== "unsnoozed" ||
    (input.trigger !== "expiry" && input.trigger !== "incoming_message")
  ) {
    return;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      workspaceId: true,
      contact: {
        select: {
          displayName: true,
          phone: true
        }
      }
    }
  });

  if (!conversation) {
    return;
  }

  const title = conversation.contact.displayName?.trim() || conversation.contact.phone || "Inbox notification";
  const body =
    input.trigger === "incoming_message"
      ? "Customer replied while snoozed. The conversation is back in the queue."
      : "Snooze expired. The conversation is back in the queue.";
  const eventId = `conversation:${conversation.id}:unsnoozed:${input.trigger}:${input.timestamp}`;

  await dispatchInboxWebPushToWorkspace({
    workspaceId: input.workspaceId,
    payload: {
      notificationId: eventId,
      eventId,
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      title,
      body,
      url: `/inbox?conversationId=${encodeURIComponent(conversation.id)}`,
      icon: `${getAppUrl()}/icon`,
      createdAt: input.timestamp
    }
  });
}

async function dispatchInboxWebPushToWorkspace(input: {
  workspaceId: string;
  payload: InboxWebPushPayload;
}) {
  const recipientAgents = await prisma.agent.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: AgentStatus.ACTIVE,
      emailVerifiedAt: {
        not: null
      },
      inboxNotificationSoundsMuted: false
    },
    select: {
      id: true,
      accountId: true
    }
  });

  if (!recipientAgents.length) {
    return;
  }

  const accountIds = recipientAgents
    .map((agent) => agent.accountId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const agentIds = recipientAgents
    .filter((agent) => !agent.accountId)
    .map((agent) => agent.id);

  let subscriptions;
  try {
    subscriptions = await prisma.browserPushSubscription.findMany({
      where: {
        enabled: true,
        OR: [
          ...(accountIds.length ? [{ accountId: { in: accountIds } }] : []),
          ...(agentIds.length ? [{ agentId: { in: agentIds } }] : [])
        ]
      },
      select: {
        id: true,
        accountId: true,
        agentId: true,
        endpoint: true,
        p256dhKey: true,
        authKey: true
      }
    });
  } catch (error) {
    if (isMissingBrowserPushSubscriptionSchemaError(error)) {
      return;
    }

    throw error;
  }

  if (!subscriptions.length) {
    return;
  }

  await Promise.all(
    subscriptions.map((subscription) =>
      sendInboxWebPushNotification(
        {
          accountId: subscription.accountId,
          agentId: subscription.agentId,
          browserPushSubscriptionId: subscription.id,
          endpoint: subscription.endpoint,
          p256dhKey: subscription.p256dhKey,
          authKey: subscription.authKey
        },
        input.payload
      )
    )
  );
}

async function sendInboxWebPushNotification(
  target: InboxPushNotificationContext,
  payload: InboxWebPushPayload
) {
  try {
    const webpush = await loadWebPushModule();
    const serializedPayload = JSON.stringify(payload);
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: {
          p256dh: target.p256dhKey,
          auth: target.authKey
        }
      },
      serializedPayload,
      {
        TTL: 60,
        topic: payload.notificationId
      }
    );

    try {
      await prisma.browserPushSubscription.update({
        where: {
          id: target.browserPushSubscriptionId
        },
        data: {
          lastSuccessfulSendAt: new Date(),
          lastFailureAt: null,
          lastFailureCode: null,
          enabled: true
        }
      });
    } catch (error) {
      if (!isMissingBrowserPushSubscriptionSchemaError(error)) {
        throw error;
      }
    }
  } catch (error) {
    const statusCode =
      typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number"
        ? String(error.statusCode)
        : "unknown";

    console.warn(
      `[inbox-web-push] send failed subscription=${target.browserPushSubscriptionId} workspace=${payload.workspaceId} notification=${payload.notificationId} status=${statusCode}`
    );

    const shouldDisable = statusCode === "404" || statusCode === "410";

    try {
      await prisma.browserPushSubscription.updateMany({
        where: {
          id: target.browserPushSubscriptionId
        },
        data: {
          enabled: shouldDisable ? false : true,
          lastFailureAt: new Date(),
          lastFailureCode: statusCode
        }
      });
    } catch (nextError) {
      if (!isMissingBrowserPushSubscriptionSchemaError(nextError)) {
        throw nextError;
      }
    }
  }
}

type WebPushModule = {
  sendNotification(
    subscription: unknown,
    payload?: string | Buffer | null,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
};

let webPushModulePromise: Promise<WebPushModule> | null = null;

async function loadWebPushModule() {
  if (!webPushModulePromise) {
    webPushModulePromise = import("web-push").then((module) => {
      const resolved = ("default" in module ? module.default : module) as WebPushModule;
      const config = getVapidConfiguration();
      resolved.setVapidDetails(config.subject, config.publicKey, config.privateKey);
      return resolved;
    });
  }

  return webPushModulePromise;
}
