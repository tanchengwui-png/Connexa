import { prisma } from "@/lib/prisma";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { AppointmentStatus, AppointmentType } from "@/lib/db-types";

type CreateAppointmentInput = {
  conversationId: string;
  title: string;
  type: AppointmentType;
  startAt: string;
  endAt: string;
  location?: string | null;
  note?: string | null;
};

export async function createAppointment(input: CreateAppointmentInput) {
  const agent = await requireCurrentAgent();
  const workspaceId = agent.workspaceId;
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("Appointment start and end time are required.");
  }

  if (endAt <= startAt) {
    throw new Error("Appointment end time must be later than the start time.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId
    },
    include: {
      contact: {
        include: {
          leads: {
            include: {
              product: true
            },
            orderBy: {
              lastActivityAt: "desc"
            },
            take: 1
          }
        }
      }
    }
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const lead = conversation.contact.leads[0] ?? null;

  return prisma.appointment.create({
    data: {
      workspaceId,
      contactId: conversation.contactId,
      leadId: lead?.id ?? null,
      productId: lead?.productId ?? null,
      conversationId: conversation.id,
      ownerId: conversation.assigneeId ?? lead?.ownerId ?? agent.id,
      title: input.title.trim() || defaultAppointmentTitle(conversation.contact.displayName, lead?.product?.name ?? null, input.type),
      type: input.type,
      status: AppointmentStatus.SCHEDULED,
      startAt,
      endAt,
      location: normalizeOptionalString(input.location),
      note: normalizeOptionalString(input.note)
    },
    include: {
      contact: true,
      product: true,
      owner: true,
      lead: true
    }
  });
}

export async function getAgentAppointments(agentId: string) {
  const workspaceId = await requireCurrentWorkspaceId();

  return prisma.appointment.findMany({
    where: {
      workspaceId,
      ownerId: agentId,
      status: AppointmentStatus.SCHEDULED
    },
    include: {
      contact: true,
      product: true,
      lead: true
    },
    orderBy: {
      startAt: "asc"
    }
  });
}

function normalizeOptionalString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function defaultAppointmentTitle(contactName: string, productName: string | null, type: AppointmentType) {
  if (type === AppointmentType.SITE_VISIT && productName) {
    return `Site visit: ${productName}`;
  }

  if (type === AppointmentType.CALL) {
    return `Call with ${contactName}`;
  }

  return `Meeting with ${contactName}`;
}
