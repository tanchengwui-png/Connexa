const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
if (!m) throw new Error('DATABASE_URL missing');
const client = new Client({ connectionString: m[1] });
(async () => {
  await client.connect();
  const result = await client.query(`
    update "OutboundMessageJob"
    set status = 'CANCELED', "updatedAt" = now(), "lastError" = 'Canceled after worker recovery to avoid duplicate resend.'
    where id = $1 and status = 'PENDING'
    returning id, status, "lastError"
  `, ['cmonqp0lv00040np761u424i9']);
  console.log(JSON.stringify(result.rows, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await client.end().catch(() => {});
});
