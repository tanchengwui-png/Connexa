import "dotenv/config";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __connexaPool: Pool | undefined;
}

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  return connectionString;
}

function createPool() {
  return new Pool({
    connectionString: getConnectionString()
  });
}

function getPool() {
  if (!global.__connexaPool) {
    global.__connexaPool = createPool();
  }

  return global.__connexaPool;
}

export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  executor: DbExecutor = getPool()
) {
  const result = await executor.query<T>(sql, values);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  executor: DbExecutor = getPool()
) {
  const result = await executor.query<T>(sql, values);
  return result.rows;
}

export async function execute(sql: string, values: unknown[] = [], executor: DbExecutor = getPool()) {
  return executor.query(sql, values);
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
