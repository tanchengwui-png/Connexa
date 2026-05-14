const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await client.connect();
  const res = await client.query(`
    select id, direction, body, "sentAt", "createdAt", "providerMessageId"
    from "Message"
    where "conversationId" = 'cmolcvgoh002x0nnzh3qiw48s'
    order by "createdAt" asc
    limit 50
  `);
  console.log(JSON.stringify({ messages: res.rows }, null, 2));
  await client.end();
})().catch(async (err) => {
  console.error(err);
  try { await client.end(); } catch {}
  process.exit(1);
});
