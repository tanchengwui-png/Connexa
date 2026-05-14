const fs = require("fs");
const { Client } = require("pg");

const env = fs.readFileSync(".env.local", "utf8");
const match = env.match(/DATABASE_URL="([^"]+)"/);

if (!match) {
  throw new Error("DATABASE_URL missing");
}

const phone = process.argv[2] || "60126717379";
const client = new Client({ connectionString: match[1] });

async function main() {
  await client.connect();

  const [messages, rules, states, settings, workflows] = await Promise.all([
    client.query(
      `select m.direction,
              m.body,
              m."sentAt",
              m."createdAt",
              c.id as conversation_id,
              s."activeFlowKey",
              s."activeFlowStep",
              s."automationPausedUntil",
              s."lastMatchedRuleId"
         from "Message" m
         join "Conversation" c on c.id = m."conversationId"
         join "Contact" ct on ct.id = c."contactId"
    left join "ConversationAutomationState" s on s."conversationId" = c.id
        where ct.phone = $1
        order by m."createdAt" desc
        limit 15`,
      [phone]
    ),
    client.query(
      `select ar.id,
              ar.name,
              ar."triggerType",
              ar."matchType",
              ar.keyword,
              ar.enabled,
              ar.priority,
              ar."cooldownMinutes",
              ar."workflowId",
              ar."businessHoursOnly",
              ar."stopAfterMatch"
         from "AutomationRule" ar
        where ar."workspaceId" = (
                select "workspaceId"
                  from "Contact"
                 where phone = $1
                 limit 1
              )
        order by ar.priority asc, ar."createdAt" asc`,
      [phone]
    ),
    client.query(
      `select c.id as conversation_id,
              ct.id as contact_id,
              ct.phone,
              ct."displayName",
              s."activeFlowKey",
              s."activeFlowStep",
              s."automationPausedUntil",
              s."lastMatchedRuleId",
              s."welcomeSentAt",
              s."awayReplySentAt",
              s."lastAutoReplyAt"
         from "Contact" ct
         join "Conversation" c on c."contactId" = ct.id
    left join "ConversationAutomationState" s on s."conversationId" = c.id
        where ct.phone = $1
        order by c."updatedAt" desc
        limit 5`,
      [phone]
    ),
    client.query(
      `select "workflowFlowEnabled",
              "activeWorkflowId",
              "businessHoursEnabled",
              "awayReplyEnabled",
              "regexEnabled"
         from "WorkspaceAutomationSettings"
        where "workspaceId" = (
                select "workspaceId"
                  from "Contact"
                 where phone = $1
                 limit 1
              )`,
      [phone]
    ),
    client.query(
      `select id, name
         from "AutomationWorkflow"
        where "workspaceId" = (
                select "workspaceId"
                  from "Contact"
                 where phone = $1
                 limit 1
              )
        order by "updatedAt" desc`,
      [phone]
    )
  ]);

  console.log(
    JSON.stringify(
      {
        phone,
        messages: messages.rows,
        rules: rules.rows,
        states: states.rows,
        settings: settings.rows,
        workflows: workflows.rows
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
