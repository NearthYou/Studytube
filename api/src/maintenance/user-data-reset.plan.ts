import { createHash } from 'node:crypto';
import {
  PRESERVED_APPLICATION_TABLES,
  RESET_APPLICATION_TABLES,
} from './user-data-reset.manifest';

type ResetPlanSqlClient = {
  query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type UserDataResetPlan = Readonly<{
  databaseName: string;
  migrationNames: readonly string[];
  resetTables: readonly { name: string; rows: number }[];
  preservedTables: readonly { name: string; rows: number }[];
  manifestSha256: string;
  planSha256: string;
  preservedFingerprintSha256: string;
  totalResetRows: number;
}>;

export function classifyUserDataResetTables(liveTables: readonly string[]) {
  const reset = new Set<string>(RESET_APPLICATION_TABLES);
  const preserved = new Set<string>(PRESERVED_APPLICATION_TABLES);
  const known = new Set([...reset, ...preserved]);
  const normalized = [...new Set(liveTables)].sort();

  for (const table of normalized) {
    if (!known.has(table))
      throw new Error(`UNKNOWN_APPLICATION_TABLE:${table}`);
  }
  for (const table of known) {
    if (!normalized.includes(table)) {
      throw new Error(`MISSING_APPLICATION_TABLE:${table}`);
    }
  }
  return {
    resetTables: [...RESET_APPLICATION_TABLES],
    preservedTables: [...PRESERVED_APPLICATION_TABLES],
  } as const;
}

export async function buildUserDataResetPlan(
  client: ResetPlanSqlClient,
): Promise<UserDataResetPlan> {
  const live = await client.query<{ tableName: string }>(
    `SELECT table_name AS "tableName"
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const classified = classifyUserDataResetTables(
    live.rows.map((row) => row.tableName),
  );
  const database = await client.query<{ databaseName: string }>(
    'SELECT current_database() AS "databaseName"',
  );
  const migrations = await client.query<{ migrationName: string }>(
    'SELECT name AS "migrationName" FROM pgmigrations ORDER BY id',
  );
  const resetTables = await tableCounts(client, classified.resetTables);
  const preservedTables = await tableCounts(client, classified.preservedTables);
  const preservedFingerprintSha256 = await preservedFingerprint(
    client,
    classified.preservedTables,
  );
  const manifestSha256 = createHash('sha256')
    .update(
      JSON.stringify({
        resetTables: classified.resetTables,
        preservedTables: classified.preservedTables,
      }),
      'utf8',
    )
    .digest('hex');

  const databaseName = database.rows[0]?.databaseName ?? '';
  if (!databaseName) throw new Error('RESET_DATABASE_NAME_MISSING');
  const migrationNames = migrations.rows.map((row) => row.migrationName);
  const totalResetRows = resetTables.reduce(
    (total, table) => total + table.rows,
    0,
  );
  const planSha256 = createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 'studytube.user-data-reset-plan.v1',
        databaseName,
        migrationNames,
        resetTables,
        preservedTables,
        manifestSha256,
        preservedFingerprintSha256,
        totalResetRows,
      }),
      'utf8',
    )
    .digest('hex');

  return Object.freeze({
    databaseName,
    migrationNames,
    resetTables,
    preservedTables,
    manifestSha256,
    planSha256,
    preservedFingerprintSha256,
    totalResetRows,
  });
}

async function preservedFingerprint(
  client: ResetPlanSqlClient,
  tables: readonly string[],
) {
  const hash = createHash('sha256');
  for (const table of tables) {
    if (!/^[a-z_]+$/u.test(table)) throw new Error('INVALID_MANIFEST_TABLE');
    hash.update(`${table}\0`, 'utf8');
    const result = await client.query<{ rowValue: string }>(
      `SELECT to_jsonb(row)::text AS "rowValue"
       FROM "${table}" AS row
       ORDER BY to_jsonb(row)::text`,
    );
    for (const row of result.rows) {
      const value = String(row.rowValue);
      hash.update(`${Buffer.byteLength(value, 'utf8')}:`, 'utf8');
      hash.update(value, 'utf8');
    }
  }
  return hash.digest('hex');
}

async function tableCounts(
  client: ResetPlanSqlClient,
  tables: readonly string[],
) {
  const counts: Array<{ name: string; rows: number }> = [];
  for (const table of tables) {
    if (!/^[a-z_]+$/u.test(table)) throw new Error('INVALID_MANIFEST_TABLE');
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM "${table}"`,
    );
    counts.push({ name: table, rows: Number(result.rows[0]?.count ?? 0) });
  }
  return counts;
}
