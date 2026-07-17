import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, value = ""] = entry.split("=");
    return [key, value];
  })
);

const workspaceSelector = args.get("--workspace");

if (!workspaceSelector) {
  console.error("Usage: node scripts/repair-whatsapp-conversation-duplicates.mjs --workspace=<workspace-slug-or-id>");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

function asTimestamp(value) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function chooseKeeper(conversations) {
  return [...conversations].sort((left, right) => {
    const leftChannelScore = left.channelId ? 1 : 0;
    const rightChannelScore = right.channelId ? 1 : 0;
    if (leftChannelScore !== rightChannelScore) {
      return rightChannelScore - leftChannelScore;
    }

    const leftMessageTime = asTimestamp(left.lastMessageAt);
    const rightMessageTime = asTimestamp(right.lastMessageAt);
    if (leftMessageTime !== rightMessageTime) {
      return rightMessageTime - leftMessageTime;
    }

    const leftUpdatedTime = asTimestamp(left.updatedAt);
    const rightUpdatedTime = asTimestamp(right.updatedAt);
    if (leftUpdatedTime !== rightUpdatedTime) {
      return rightUpdatedTime - leftUpdatedTime;
    }

    return left.id.localeCompare(right.id);
  })[0];
}

async function resolveWorkspace(input) {
  const { rows } = await client.query(
    `
      SELECT id, name, slug
      FROM "Workspace"
      WHERE id = $1 OR slug = $1
      LIMIT 1
    `,
    [input]
  );

  return rows[0] ?? null;
}

async function getWorkspaceDefaultChannelId(workspaceId) {
  const { rows } = await client.query(
    `
      SELECT c.id
      FROM "WhatsAppChannel" c
      WHERE c."workspaceId" = $1
      ORDER BY
        CASE
          WHEN c."connectionStatus" IN ('READY', 'SYNCING_HISTORY', 'CONNECTED', 'AUTHENTICATED', 'QR_READY', 'INITIALIZING') THEN 1
          ELSE 0
        END DESC,
        c."updatedAt" DESC,
        c."createdAt" DESC
      LIMIT 1
    `,
    [workspaceId]
  );

  return rows[0]?.id ?? null;
}

async function backfillNullConversationChannels(workspaceId, defaultChannelId) {
  if (!defaultChannelId) {
    return { updated: 0 };
  }

  const result = await client.query(
    `
      UPDATE "Conversation"
      SET "channelId" = $2
      WHERE "workspaceId" = $1
        AND "channelId" IS NULL
    `,
    [workspaceId, defaultChannelId]
  );

  return { updated: result.rowCount ?? 0 };
}

async function mergeConversationState(keepConversationId, dropConversationId) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM "ConversationAutomationState"
      WHERE "conversationId" IN ($1, $2)
      ORDER BY "updatedAt" DESC
    `,
    [keepConversationId, dropConversationId]
  );

  if (!rows.length) {
    return;
  }

  const keepState = rows.find((row) => row.conversationId === keepConversationId) ?? null;
  const dropState = rows.find((row) => row.conversationId === dropConversationId) ?? null;

  if (!dropState) {
    return;
  }

  if (!keepState) {
    await client.query(
      `
        UPDATE "ConversationAutomationState"
        SET "conversationId" = $2
        WHERE id = $1
      `,
      [dropState.id, keepConversationId]
    );
    return;
  }

  await client.query(
    `
      UPDATE "ConversationAutomationState"
      SET
        "welcomeSentAt" = COALESCE("ConversationAutomationState"."welcomeSentAt", $2),
        "awayReplySentAt" = COALESCE("ConversationAutomationState"."awayReplySentAt", $3),
        "automationPausedUntil" = CASE
          WHEN "ConversationAutomationState"."automationPausedUntil" IS NULL THEN $4::timestamp
          WHEN $4::timestamp IS NULL THEN "ConversationAutomationState"."automationPausedUntil"
          ELSE GREATEST("ConversationAutomationState"."automationPausedUntil", $4::timestamp)
        END,
        "activeFlowKey" = COALESCE("ConversationAutomationState"."activeFlowKey", $5),
        "activeFlowStep" = COALESCE("ConversationAutomationState"."activeFlowStep", $6),
        "flowStateJson" = COALESCE("ConversationAutomationState"."flowStateJson", $7),
        "lastAutoReplyAt" = CASE
          WHEN "ConversationAutomationState"."lastAutoReplyAt" IS NULL THEN $8::timestamp
          WHEN $8::timestamp IS NULL THEN "ConversationAutomationState"."lastAutoReplyAt"
          ELSE GREATEST("ConversationAutomationState"."lastAutoReplyAt", $8::timestamp)
        END,
        "lastMatchedRuleId" = COALESCE("ConversationAutomationState"."lastMatchedRuleId", $9),
        "updatedAt" = NOW()
      WHERE id = $1
    `,
    [
      keepState.id,
      dropState.welcomeSentAt,
      dropState.awayReplySentAt,
      dropState.automationPausedUntil,
      dropState.activeFlowKey,
      dropState.activeFlowStep,
      dropState.flowStateJson,
      dropState.lastAutoReplyAt,
      dropState.lastMatchedRuleId
    ]
  );

  await client.query(`DELETE FROM "ConversationAutomationState" WHERE id = $1`, [dropState.id]);
}

async function mergeConversationRuleExecutions(keepConversationId, dropConversationId) {
  const { rows } = await client.query(
    `
      SELECT id, "ruleId", "lastTriggeredAt", "triggerCount"
      FROM "ConversationRuleExecution"
      WHERE "conversationId" = $1
    `,
    [dropConversationId]
  );

  for (const row of rows) {
    const existing = await client.query(
      `
        SELECT id, "triggerCount", "lastTriggeredAt"
        FROM "ConversationRuleExecution"
        WHERE "conversationId" = $1 AND "ruleId" = $2
        LIMIT 1
      `,
      [keepConversationId, row.ruleId]
    );

    if (existing.rows[0]) {
      await client.query(
        `
          UPDATE "ConversationRuleExecution"
          SET
            "triggerCount" = $2,
            "lastTriggeredAt" = GREATEST("lastTriggeredAt", $3::timestamp),
            "updatedAt" = NOW()
          WHERE id = $1
        `,
        [
          existing.rows[0].id,
          Number(existing.rows[0].triggerCount ?? 0) + Number(row.triggerCount ?? 0),
          row.lastTriggeredAt
        ]
      );

      await client.query(`DELETE FROM "ConversationRuleExecution" WHERE id = $1`, [row.id]);
      continue;
    }

    await client.query(
      `
        UPDATE "ConversationRuleExecution"
        SET "conversationId" = $2
        WHERE id = $1
      `,
      [row.id, keepConversationId]
    );
  }
}

async function mergeConversationTeammates(keepConversationId, dropConversationId) {
  await client.query(
    `
      INSERT INTO "ConversationTeammate" ("conversationId", "agentId", "createdAt")
      SELECT $1, teammate."agentId", MIN(teammate."createdAt")
      FROM "ConversationTeammate" teammate
      WHERE teammate."conversationId" IN ($1, $2)
      GROUP BY teammate."agentId"
      ON CONFLICT ("conversationId", "agentId") DO NOTHING
    `,
    [keepConversationId, dropConversationId]
  );

  await client.query(`DELETE FROM "ConversationTeammate" WHERE "conversationId" = $1`, [dropConversationId]);
}

async function mergeDuplicateConversation(keepConversation, dropConversation) {
  await mergeConversationState(keepConversation.id, dropConversation.id);
  await mergeConversationRuleExecutions(keepConversation.id, dropConversation.id);
  await mergeConversationTeammates(keepConversation.id, dropConversation.id);

  const simpleUpdates = [
    `"Message"`,
    `"ConversationAuditEvent"`,
    `"AutomationJob"`,
    `"OutboundMessageJob"`,
    `"Note"`,
    `"Appointment"`
  ];

  for (const tableName of simpleUpdates) {
    await client.query(
      `UPDATE ${tableName} SET "conversationId" = $2 WHERE "conversationId" = $1`,
      [dropConversation.id, keepConversation.id]
    );
  }

  await client.query(
    `
      UPDATE "CampaignRunRecipient"
      SET "conversationId" = $2
      WHERE "conversationId" = $1
    `,
    [dropConversation.id, keepConversation.id]
  );

  await client.query(
    `
      UPDATE "WhatsAppMessageEnvelope"
      SET "conversationId" = $2
      WHERE "conversationId" = $1
    `,
    [dropConversation.id, keepConversation.id]
  );

  await client.query(
    `
      UPDATE "Conversation"
      SET
        "channelId" = COALESCE("channelId", $2),
        "whatsAppRemoteId" = COALESCE("whatsAppRemoteId", $3),
        status = CASE
          WHEN status = 'OPEN' OR $4 = 'OPEN' THEN 'OPEN'::"ConversationStatus"
          ELSE status
        END,
        "snoozedUntil" = CASE
          WHEN "snoozedUntil" IS NULL THEN $5::timestamp
          WHEN $5::timestamp IS NULL THEN "snoozedUntil"
          ELSE GREATEST("snoozedUntil", $5::timestamp)
        END,
        "unreadCount" = GREATEST("unreadCount", $6),
        "isHotLead" = ("isHotLead" OR $7),
        "lastMessagePreview" = CASE
          WHEN "lastMessageAt" IS NULL THEN $9
          WHEN $8::timestamp IS NULL THEN "lastMessagePreview"
          WHEN $8::timestamp > "lastMessageAt" THEN $9
          ELSE "lastMessagePreview"
        END,
        "lastMessageAt" = CASE
          WHEN "lastMessageAt" IS NULL THEN $8::timestamp
          WHEN $8::timestamp IS NULL THEN "lastMessageAt"
          ELSE GREATEST("lastMessageAt", $8::timestamp)
        END,
        "updatedAt" = NOW()
      WHERE id = $1
    `,
    [
      keepConversation.id,
      dropConversation.channelId,
      dropConversation.whatsAppRemoteId,
      dropConversation.status,
      dropConversation.snoozedUntil,
      dropConversation.unreadCount ?? 0,
      Boolean(dropConversation.isHotLead),
      dropConversation.lastMessageAt,
      dropConversation.lastMessagePreview
    ]
  );

  await client.query(`DELETE FROM "Conversation" WHERE id = $1`, [dropConversation.id]);
}

async function dedupeWorkspaceConversations(workspaceId) {
  const { rows } = await client.query(
    `
      SELECT
        conv."contactId",
        conv."channelId",
        ARRAY_AGG(
          json_build_object(
            'id', conv.id,
            'channelId', conv."channelId",
            'whatsAppRemoteId', conv."whatsAppRemoteId",
            'status', conv.status,
            'snoozedUntil', conv."snoozedUntil",
            'unreadCount', conv."unreadCount",
            'isHotLead', conv."isHotLead",
            'lastMessagePreview', conv."lastMessagePreview",
            'lastMessageAt', conv."lastMessageAt",
            'updatedAt', conv."updatedAt"
          )
          ORDER BY conv."updatedAt" DESC, conv."lastMessageAt" DESC
        ) AS conversations
      FROM "Conversation" conv
      WHERE conv."workspaceId" = $1
        AND conv."channelId" IS NOT NULL
      GROUP BY conv."contactId", conv."channelId"
      HAVING COUNT(*) > 1
    `,
    [workspaceId]
  );

  let merged = 0;

  for (const row of rows) {
    const conversations = row.conversations ?? [];
    const keeper = chooseKeeper(conversations);

    for (const conversation of conversations) {
      if (conversation.id === keeper.id) {
        continue;
      }

      await mergeDuplicateConversation(keeper, conversation);
      merged += 1;
    }
  }

  return { merged, groups: rows.length };
}

async function main() {
  await client.connect();

  const workspace = await resolveWorkspace(workspaceSelector);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceSelector}' was not found.`);
  }

  await client.query("BEGIN");

  try {
    const defaultChannelId = await getWorkspaceDefaultChannelId(workspace.id);
    const backfill = await backfillNullConversationChannels(workspace.id, defaultChannelId);
    const dedupe = await dedupeWorkspaceConversations(workspace.id);

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          workspace,
          defaultChannelId,
          backfill,
          dedupe
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
