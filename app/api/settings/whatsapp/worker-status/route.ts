import { NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import {
  getOutboundMessageJobStatus,
  retryFailedOutboundMessageJobs
} from "@/lib/outbound-message-jobs";

export async function GET() {
  try {
    const manager = await requireApiManager();
    const status = await getOutboundMessageJobStatus(manager.workspaceId);

    return NextResponse.json(
      {
        status,
        worker: {
          endpointConfigured: Boolean(process.env.OUTBOUND_WORKER_TOKEN?.trim()),
          appUrl: process.env.APP_URL?.trim() ?? null
        }
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to load outbound worker status."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}

export async function POST() {
  try {
    const manager = await requireApiManager();
    const result = await retryFailedOutboundMessageJobs(manager.workspaceId);
    const status = await getOutboundMessageJobStatus(manager.workspaceId);

    return NextResponse.json({ ok: true, result, status }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to retry failed outbound jobs."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}
