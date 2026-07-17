import { prisma } from "@/lib/prisma";

export const WHATSAPP_RUNTIME_EVENT_TYPES = {
  QR_READY: "QR_READY",
  AUTHENTICATED: "AUTHENTICATED",
  READY: "READY",
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
