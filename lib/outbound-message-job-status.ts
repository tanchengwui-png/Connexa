import { prisma } from "@/lib/prisma";

declare global {
  var outboundMessageJobStatusesPromise: Promise<Set<string>> | undefined;
}

async function loadOutboundMessageJobStatuses() {
  const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'OutboundMessageJobStatus'
    ORDER BY e.enumsortorder
  `;

  return new Set(rows.map((row) => row.enumlabel));
}

export async function getSupportedOutboundMessageJobStatuses() {
  if (!global.outboundMessageJobStatusesPromise) {
    global.outboundMessageJobStatusesPromise = loadOutboundMessageJobStatuses();
  }

  return global.outboundMessageJobStatusesPromise;
}

export async function supportsCanceledOutboundMessageJobs() {
  const statuses = await getSupportedOutboundMessageJobStatuses();
  return statuses.has("CANCELED");
}
