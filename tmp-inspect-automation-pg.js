const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await client.connect();

  const convoRes = await client.query(`
    select c.id, c.status, c."workspaceId", c."contactId", c."whatsAppRemoteId", c."lastMessagePreview", c."lastMessageAt", c."updatedAt",
           s."activeFlowKey", s."activeFlowStep", s."flowStateJson", s."lastMatchedRuleId"
    from "Conversation" c
    left join "ConversationAutomationState" s on s."conversationId" = c.id
    where c."contactId" = 'cmolcvgob002w0nnz3vam8k0s'
    order by c."updatedAt" desc
    limit 1
  `);
  const convo = convoRes.rows[0] || null;
  console.log(JSON.stringify({ conversation: convo }, null, 2));
  if (!convo) return;

  const settingsRes = await client.query(`
    select "workflowFlowEnabled", "activeWorkflowId", "businessHoursEnabled", "awayReplyEnabled", "decisionFlowEnabled"
    from "WorkspaceAutomationSettings"
    where "workspaceId" = '${convo.workspaceId}'
    limit 1
  `);
  console.log(JSON.stringify({ settings: settingsRes.rows[0] || null }, null, 2));

  if (convo.lastMatchedRuleId) {
    const ruleRes = await client.query(`
      select id, name, "triggerType", keyword, "replyBody", "workflowId"
      from "AutomationRule"
      where id = '${convo.lastMatchedRuleId}'
      limit 1
    `);
    console.log(JSON.stringify({ rule: ruleRes.rows[0] || null }, null, 2));

    const workflowId = ruleRes.rows[0] && ruleRes.rows[0].workflowId;
    if (workflowId) {
      const wfRes = await client.query(`
        select id, name, "definitionJson"
        from "AutomationWorkflow"
        where id = '${workflowId}'
        limit 1
      `);
      console.log(JSON.stringify({ workflow: wfRes.rows[0] || null }, null, 2));
    }
  }

  await client.end();
})().catch(async (err) => {
  console.error(err);
  try { await client.end(); } catch {}
  process.exit(1);
});
