import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

function uniqueChannelIds(values) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  );
}

function pickOnlyChannelId(values) {
  const unique = uniqueChannelIds(values);
  return unique.length === 1 ? unique[0] : null;
}

function resolveBackfillChannelId({ currentChannelId, relatedChannelIds = [], workspaceDefaultChannelId }) {
  if (typeof currentChannelId === "string" && currentChannelId.trim()) {
    return currentChannelId.trim();
  }

  const relatedChannelId = pickOnlyChannelId(relatedChannelIds);
  if (relatedChannelId) {
    return relatedChannelId;
  }

  if (uniqueChannelIds(relatedChannelIds).length > 1) {
    return null;
  }

  return typeof workspaceDefaultChannelId === "string" && workspaceDefaultChannelId.trim()
    ? workspaceDefaultChannelId.trim()
    : null;
}

async function getWorkspaceDefaultChannelIds() {
  const { rows } = await client.query(`
    SELECT
      w.id AS "workspaceId",
      (
        SELECT c.id
        FROM "WhatsAppChannel" c
        WHERE c."workspaceId" = w.id
        ORDER BY
          CASE
            WHEN c."connectionStatus" IN ('READY', 'SYNCING_HISTORY', 'CONNECTED', 'AUTHENTICATED', 'QR_READY', 'INITIALIZING') THEN 1
            ELSE 0
          END DESC,
          c."updatedAt" DESC,
          c."createdAt" DESC
        LIMIT 1
      ) AS "defaultChannelId"
    FROM "Workspace" w
  `);

  return new Map(rows.map((row) => [row.workspaceId, row.defaultChannelId]));
}

async function backfillConversations(defaultChannelsByWorkspace) {
  const { rows } = await client.query(`
    SELECT
      conv.id,
      conv."workspaceId",
      conv."channelId",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT env."channelId"), NULL) AS "envelopeChannelIds",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT job."channelId"), NULL) AS "jobChannelIds",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT run."channelId"), NULL) AS "campaignChannelIds"
    FROM "Conversation" conv
    LEFT JOIN "WhatsAppMessageEnvelope" env ON env."conversationId" = conv.id
    LEFT JOIN "OutboundMessageJob" job ON job."conversationId" = conv.id
    LEFT JOIN "CampaignRunRecipient" recipient ON recipient."conversationId" = conv.id
    LEFT JOIN "CampaignRun" run ON run.id = recipient."campaignRunId"
    WHERE conv."channelId" IS NULL
    GROUP BY conv.id
  `);

  let updated = 0;
  let unresolved = 0;

  for (const row of rows) {
    const channelId = resolveBackfillChannelId({
      currentChannelId: row.channelId,
      relatedChannelIds: [
        ...(row.envelopeChannelIds ?? []),
        ...(row.jobChannelIds ?? []),
        ...(row.campaignChannelIds ?? [])
      ],
      workspaceDefaultChannelId: defaultChannelsByWorkspace.get(row.workspaceId) ?? null
    });

    if (!channelId) {
      unresolved += 1;
      continue;
    }

    await client.query(`UPDATE "Conversation" SET "channelId" = $2 WHERE id = $1`, [row.id, channelId]);
    updated += 1;
  }

  return { updated, unresolved };
}

async function backfillOutboundJobs(defaultChannelsByWorkspace) {
  const { rows } = await client.query(`
    SELECT
      job.id,
      job."workspaceId",
      job."channelId",
      conv."channelId" AS "conversationChannelId",
      run."channelId" AS "campaignRunChannelId"
    FROM "OutboundMessageJob" job
    LEFT JOIN "Conversation" conv ON conv.id = job."conversationId"
    LEFT JOIN "CampaignRun" run ON run.id = job."campaignRunId"
    WHERE job."channelId" IS NULL
  `);

  let updated = 0;
  let unresolved = 0;

  for (const row of rows) {
    const channelId = resolveBackfillChannelId({
      currentChannelId: row.channelId,
      relatedChannelIds: [row.conversationChannelId, row.campaignRunChannelId],
      workspaceDefaultChannelId: defaultChannelsByWorkspace.get(row.workspaceId) ?? null
    });

    if (!channelId) {
      unresolved += 1;
      continue;
    }

    await client.query(`UPDATE "OutboundMessageJob" SET "channelId" = $2 WHERE id = $1`, [row.id, channelId]);
    updated += 1;
  }

  return { updated, unresolved };
}

async function backfillCampaignRuns(defaultChannelsByWorkspace) {
  const { rows } = await client.query(`
    SELECT
      run.id,
      run."workspaceId",
      run."channelId",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT job."channelId"), NULL) AS "jobChannelIds",
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT conv."channelId"), NULL) AS "conversationChannelIds"
    FROM "CampaignRun" run
    LEFT JOIN "OutboundMessageJob" job ON job."campaignRunId" = run.id
    LEFT JOIN "CampaignRunRecipient" recipient ON recipient."campaignRunId" = run.id
    LEFT JOIN "Conversation" conv ON conv.id = recipient."conversationId"
    WHERE run."channelId" IS NULL
    GROUP BY run.id
  `);

  let updated = 0;
  let unresolved = 0;

  for (const row of rows) {
    const channelId = resolveBackfillChannelId({
      currentChannelId: row.channelId,
      relatedChannelIds: [...(row.jobChannelIds ?? []), ...(row.conversationChannelIds ?? [])],
      workspaceDefaultChannelId: defaultChannelsByWorkspace.get(row.workspaceId) ?? null
    });

    if (!channelId) {
      unresolved += 1;
      continue;
    }

    await client.query(`UPDATE "CampaignRun" SET "channelId" = $2 WHERE id = $1`, [row.id, channelId]);
    updated += 1;
  }

  return { updated, unresolved };
}

async function backfillEnvelopes(defaultChannelsByWorkspace) {
  const { rows } = await client.query(`
    SELECT
      env.id,
      env."workspaceId",
      env."channelId",
      conv."channelId" AS "conversationChannelId",
      msgConv."channelId" AS "messageConversationChannelId"
    FROM "WhatsAppMessageEnvelope" env
    LEFT JOIN "Conversation" conv ON conv.id = env."conversationId"
    LEFT JOIN "Message" msg ON msg.id = env."messageId"
    LEFT JOIN "Conversation" msgConv ON msgConv.id = msg."conversationId"
    WHERE env."channelId" IS NULL
  `);

  let updated = 0;
  let unresolved = 0;

  for (const row of rows) {
    const channelId = resolveBackfillChannelId({
      currentChannelId: row.channelId,
      relatedChannelIds: [row.conversationChannelId, row.messageConversationChannelId],
      workspaceDefaultChannelId: defaultChannelsByWorkspace.get(row.workspaceId) ?? null
    });

    if (!channelId) {
      unresolved += 1;
      continue;
    }

    await client.query(`UPDATE "WhatsAppMessageEnvelope" SET "channelId" = $2 WHERE id = $1`, [row.id, channelId]);
    updated += 1;
  }

  return { updated, unresolved };
}

try {
  await client.connect();
  await client.query("BEGIN");

  const defaultChannelsByWorkspace = await getWorkspaceDefaultChannelIds();
  const conversations = await backfillConversations(defaultChannelsByWorkspace);
  const outboundJobs = await backfillOutboundJobs(defaultChannelsByWorkspace);
  const campaignRuns = await backfillCampaignRuns(defaultChannelsByWorkspace);
  const envelopes = await backfillEnvelopes(defaultChannelsByWorkspace);

  await client.query("COMMIT");

  console.log("WhatsApp channel backfill completed.");
  console.table({
    conversations,
    outboundJobs,
    campaignRuns,
    envelopes
  });
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
