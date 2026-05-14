const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
if (!m) throw new Error('DATABASE_URL missing');
const client = new Client({ connectionString: m[1] });
(async () => {
  await client.connect();
  const phone = '60126717379';
  const data = {};
  data.contact = (await client.query(`select id, "workspaceId", phone, "displayName", tags from "Contact" where phone = $1 order by "createdAt" desc limit 1`, [phone])).rows[0] || null;
  if (!data.contact) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  data.conversations = (await client.query(`
    select c.id, c.status, c."updatedAt", s."activeFlowKey", s."activeFlowStep", s."lastMatchedRuleId", s."lastAutoReplyAt", s."welcomeSentAt", s."flowStateJson"
    from "Conversation" c
    left join "ConversationAutomationState" s on s."conversationId" = c.id
    where c."contactId" = $1
    order by c."updatedAt" desc
    limit 5
  `, [data.contact.id])).rows;
  const latestConversationId = data.conversations[0]?.id;
  if (latestConversationId) {
    data.messages = (await client.query(`
      select id, direction, body, "createdAt"
      from "Message"
      where "conversationId" = $1
      order by "createdAt" desc
      limit 12
    `, [latestConversationId])).rows;
    data.executions = (await client.query(`
      select e."ruleId", e."lastTriggeredAt", r.name, r.keyword, r."cooldownMinutes", r.enabled, r."replyBody", r."workflowId"
      from "ConversationRuleExecution" e
      join "AutomationRule" r on r.id = e."ruleId"
      where e."conversationId" = $1
      order by e."lastTriggeredAt" desc
    `, [latestConversationId])).rows;
  }
  console.log(JSON.stringify(data, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await client.end().catch(() => {});
});
