import { NextRequest, NextResponse } from "next/server";
import { OutboundMessageJobStatus } from "@prisma/client";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
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
      action?: "cancel" | "send-now";
    };

    if (body.action !== "cancel" && body.action !== "send-now") {
      return NextResponse.json({ error: "Unsupported campaign run action." }, { status: 400 });
    }

    if (body.action === "cancel" && !(await supportsCanceledOutboundMessageJobs())) {
      return NextResponse.json({ error: "Canceling scheduled jobs is not supported in this environment yet." }, { status: 400 });
    }

    const run = await prisma.campaignRun.findFirst({
      where: {
        id,
        workspaceId: agent.workspaceId
      },
      select: {
        id: true
      }
    });

    if (!run) {
      return NextResponse.json({ error: "Campaign run not found." }, { status: 404 });
    }

    const jobs = await prisma.outboundMessageJob.findMany({
      where: {
        workspaceId: agent.workspaceId,
        campaignRunId: run.id
      },
      include: {
        message: {
          select: {
            providerMessageId: true
          }
        }
      }
    });

    if (!jobs.length) {
      return NextResponse.json({ error: "No outbound jobs were found for this campaign run." }, { status: 404 });
    }

    const actionableJobs = jobs.filter(
      (job) =>
        !job.message.providerMessageId &&
        job.status !== OutboundMessageJobStatus.RUNNING &&
        (!(body.action === "cancel") || job.status !== OutboundMessageJobStatus.CANCELED)
    );

    if (!actionableJobs.length) {
      return NextResponse.json({ error: "No campaign jobs can be updated right now." }, { status: 400 });
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
              : "Unable to update campaign run jobs."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
