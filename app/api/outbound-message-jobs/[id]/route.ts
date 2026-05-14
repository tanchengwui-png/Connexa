import { NextRequest, NextResponse } from "next/server";
import { OutboundMessageJobStatus } from "@prisma/client";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { parseMalaysiaDateTimeLocalInput } from "@/lib/malaysia-time";
import { supportsCanceledOutboundMessageJobs } from "@/lib/outbound-message-job-status";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: "cancel" | "reschedule" | "send-now";
      scheduledFor?: string | null;
    };

    const job = await prisma.outboundMessageJob.findFirst({
      where: {
        id,
        workspaceId: agent.workspaceId
      },
      include: {
        message: {
          select: {
            id: true,
            providerMessageId: true,
            conversationId: true
          }
        }
      }
    });

    if (!job) {
      return NextResponse.json({ error: "Scheduled job not found." }, { status: 404 });
    }

    if (job.message.providerMessageId) {
      return NextResponse.json({ error: "This job has already been sent." }, { status: 400 });
    }

    if (job.status === OutboundMessageJobStatus.RUNNING) {
      return NextResponse.json({ error: "This job is already being processed." }, { status: 400 });
    }

    if (body.action === "send-now") {
      const updated = await prisma.outboundMessageJob.update({
        where: {
          id: job.id
        },
        data: {
          status: OutboundMessageJobStatus.PENDING,
          attempts: 0,
          lastError: null,
          lockedAt: null,
          availableAt: new Date()
        }
      });

      return NextResponse.json({ ok: true, job: updated });
    }

    if (body.action === "reschedule") {
      const scheduledFor = body.scheduledFor?.trim() ?? "";
      const nextDate = scheduledFor ? parseMalaysiaDateTimeLocalInput(scheduledFor) ?? new Date(scheduledFor) : null;

      if (!nextDate || Number.isNaN(nextDate.getTime())) {
        return NextResponse.json({ error: "Scheduled date is invalid." }, { status: 400 });
      }

      if (nextDate.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Scheduled send time must be in the future." }, { status: 400 });
      }

      const updated = await prisma.outboundMessageJob.update({
        where: {
          id: job.id
        },
        data: {
          status: OutboundMessageJobStatus.PENDING,
          attempts: 0,
          lastError: null,
          lockedAt: null,
          availableAt: nextDate
        }
      });

      return NextResponse.json({ ok: true, job: updated });
    }

    if (body.action === "cancel") {
      if (!(await supportsCanceledOutboundMessageJobs())) {
        return NextResponse.json({ error: "Canceling scheduled jobs is not supported in this environment yet." }, { status: 400 });
      }

      const updated = await prisma.outboundMessageJob.update({
        where: {
          id: job.id
        },
        data: {
          status: OutboundMessageJobStatus.CANCELED,
          lockedAt: null,
          lastError: "Canceled by operator."
        }
      });

      return NextResponse.json({ ok: true, job: updated });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update outbound job."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
