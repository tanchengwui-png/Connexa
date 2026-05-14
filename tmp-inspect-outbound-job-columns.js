const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const m = env.match(/DATABASE_URL="([^"]+)"/);
if (!m) throw new Error('DATABASE_URL missing');
const client = new Client({ connectionString: m[1] });
(async () => {
  await client.connect();
  const rows = (await client.query(`
    select column_name, data_type
    from information_schema.columns
    where table_name = 'OutboundMessageJob'
    order by ordinal_position
  `)).rows;
  console.log(JSON.stringify(rows, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await client.end().catch(() => {});
});
