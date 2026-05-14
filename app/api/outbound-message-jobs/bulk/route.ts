import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { OutboundMessageJobStatus } from "@prisma/client";
import { supportsCanceledOutboundMessageJobs } from "@/lib/outbound-message-job-status";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json()) as {
      action?: "cancel" | "send-now";
      jobIds?: string[];
    };

    const jobIds = Array.from(
      new Set((body.jobIds ?? []).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))
    );

    if (!jobIds.length) {
      return NextResponse.json({ error: "Select at least one scheduled job." }, { status: 400 });
    }

    if (body.action !== "cancel" && body.action !== "send-now") {
      return NextResponse.json({ error: "Unsupported bulk action." }, { status: 400 });
    }

    if (body.action === "cancel" && !(await supportsCanceledOutboundMessageJobs())) {
      return NextResponse.json({ error: "Canceling scheduled jobs is not supported in this environment yet." }, { status: 400 });
    }

    const jobs = await prisma.outboundMessageJob.findMany({
      where: {
        id: {
          in: jobIds
        },
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

    if (!jobs.length) {
      return NextResponse.json({ error: "No matching scheduled jobs were found." }, { status: 404 });
    }

    const actionableJobs = jobs.filter(
      (job) =>
        !job.message.providerMessageId &&
        job.status !== OutboundMessageJobStatus.RUNNING &&
        (!(body.action === "cancel") || job.status !== OutboundMessageJobStatus.CANCELED)
    );

    if (!actionableJobs.length) {
      return NextResponse.json({ error: "No selected jobs can be updated right now." }, { status: 400 });
    }

    if (body.action === "send-now") {
      const result = await prisma.outboundMessageJob.updateMany({
        where: {
          id: {
            in: actionableJobs.map((job) => job.id)
          }
        },
        data: {
          status: OutboundMessageJobStatus.PENDING,
          attempts: 0,
          lastError: null,
          lockedAt: null,
          availableAt: new Date()
        }
      });

      return NextResponse.json({ ok: true, updatedCount: result.count });
    }

    const result = await prisma.outboundMessageJob.updateMany({
      where: {
        id: {
          in: actionableJobs.map((job) => job.id)
        }
      },
      data: {
        status: OutboundMessageJobStatus.CANCELED,
        lockedAt: null,
        lastError: "Canceled by operator."
      }
    });

    return NextResponse.json({ ok: true, updatedCount: result.count });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update scheduled jobs."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
