import { prisma } from "@/lib/prisma";

export const WHATSAPP_RUNTIME_EVENT_TYPES = {
  QR_READY: "QR_READY",
  QR_DISPLAYED: "QR_DISPLAYED",
  AUTHENTICATED: "AUTHENTICATED",
  READY: "READY",
  UI_CONNECTED: "UI_CONNECTED",
  INBOX_USABLE: "INBOX_USABLE",
  HISTORY_JOB_QUEUED: "HISTORY_JOB_QUEUED",
  HISTORY_JOB_STARTED: "HISTORY_JOB_STARTED",
  HISTORY_FIRST_BATCH_COMPLETED: "HISTORY_FIRST_BATCH_COMPLETED",
  HISTORY_BOOTSTRAP_COMPLETED: "HISTORY_BOOTSTRAP_COMPLETED",
  HISTORY_FULL_SYNC_COMPLETED: "HISTORY_FULL_SYNC_COMPLETED",
  HISTORY_CHAT_TIMEOUT: "HISTORY_CHAT_TIMEOUT",
  AUTH_FAILURE: "AUTH_FAILURE",
  DISCONNECTED: "DISCONNECTED",
  RECONNECT_SCHEDULED: "RECONNECT_SCHEDULED",
  RUNTIME_RECYCLED: "RUNTIME_RECYCLED",
  STALL_RECOVERY: "STALL_RECOVERY",
  SUPERVISOR_PAUSED: "SUPERVISOR_PAUSED",
  SUPERVISOR_RESUMED: "SUPERVISOR_RESUMED",
  IDLE_EVICTED: "IDLE_EVICTED",
  INITIALIZE_ERROR: "INITIALIZE_ERROR"
} as const;

export async function logWhatsAppRuntimeEvent(input: {
  workspaceId: string;
  sessionClientId?: string | null;
  eventType: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await prisma.whatsAppRuntimeEvent.create({
      data: {
        workspaceId: input.workspaceId,
        sessionClientId: input.sessionClientId ?? null,
        eventType: input.eventType,
        message: input.message?.trim() || null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null
      }
    });
  } catch (error) {
    console.warn(
      `[whatsapp-web][runtime-event] workspace=${input.workspaceId} type=${input.eventType} ${
        error instanceof Error ? error.message : "Unknown event log error."
      }`
    );
  }
}
