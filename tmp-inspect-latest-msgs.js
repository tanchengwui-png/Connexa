const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
(async () => {
  await client.connect();
  const res = await client.query(`
    select m.direction, m.body, m."sentAt", m."createdAt", c.id as conversation_id,
           s."activeFlowKey", s."activeFlowStep", s."flowStateJson", s."lastMatchedRuleId"
    from "Message" m
    join "Conversation" c on c.id = m."conversationId"
    join "Contact" ct on ct.id = c."contactId"
    left join "ConversationAutomationState" s on s."conversationId" = c.id
    where ct.phone = '60126717379'
    order by m."createdAt" desc
    limit 15
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch(async (err) => { console.error(err); try { await client.end(); } catch {} process.exit(1); });
