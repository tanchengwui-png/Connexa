import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query(`
      SELECT
        w.id,
        w."mediaLibraryUsedBytes" AS "cachedUsedBytes",
        COALESCE(SUM(asset."sizeBytes"), 0) AS "actualUsedBytes"
      FROM "Workspace" w
      LEFT JOIN "WorkspaceMediaAsset" asset ON asset."workspaceId" = w.id
      GROUP BY w.id, w."mediaLibraryUsedBytes"
      ORDER BY w.id ASC
    `);

    let updated = 0;

    for (const row of rows) {
      const actualUsedBytes = Number(row.actualUsedBytes ?? 0);
      const cachedUsedBytes = Number(row.cachedUsedBytes ?? 0);

      if (actualUsedBytes === cachedUsedBytes) {
        continue;
      }

      await client.query(`UPDATE "Workspace" SET "mediaLibraryUsedBytes" = $2 WHERE id = $1`, [row.id, actualUsedBytes]);
      updated += 1;
    }

    console.info(JSON.stringify({ ok: true, workspacesScanned: rows.length, updated }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
