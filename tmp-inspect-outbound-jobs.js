const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
if (!m) throw new Error('DATABASE_URL missing');
const client = new Client({ connectionString: m[1] });
(async () => {
  await client.connect();
  const rows = (await client.query(`
    select j.id, j.status, j.attempts, j."lastError", j."createdAt", j."updatedAt", j."availableAt", j."lockedAt",
           j.to, j.body, j."messageId", m.body as message_body
    from "OutboundMessageJob" j
    left join "Message" m on m.id = j."messageId"
    where j."conversationId" = $1
    order by j."createdAt" desc
    limit 10
  `, ['cmolcvgoh002x0nnzh3qiw48s'])).rows;
  console.log(JSON.stringify(rows, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await client.end().catch(() => {});
});
