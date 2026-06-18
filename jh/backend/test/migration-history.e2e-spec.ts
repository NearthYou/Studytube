import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSqlMigrations } from '../src/database/run-sql-migrations';

describe('SQL migration history (e2e)', () => {
  it('records applied migrations, skips reruns, and rejects checksum drift', async () => {
    const baseDatabaseUrl = getDatabaseUrl();
    const schemaName = `e2e_migrations_${Date.now()}`;
    const migrationsDirectory = await mkdtemp(
      join(tmpdir(), 'tail-talk-migrations-'),
    );

    await createSchema(baseDatabaseUrl, schemaName);

    try {
      const databaseUrl = withSearchPath(baseDatabaseUrl, schemaName);
      const migrationFile = join(migrationsDirectory, '001_create_probe.sql');

      await writeFile(
        migrationFile,
        'CREATE TABLE migration_probe (id int PRIMARY KEY);',
      );

      const firstRunLogs: string[] = [];

      await runSqlMigrations({
        databaseUrl,
        log: (message) => firstRunLogs.push(message),
        migrationsDirectory,
      });

      expect(firstRunLogs).toEqual(['Running 001_create_probe.sql']);
      await expectMigrationCount(databaseUrl, 1);

      const secondRunLogs: string[] = [];

      await runSqlMigrations({
        databaseUrl,
        log: (message) => secondRunLogs.push(message),
        migrationsDirectory,
      });

      expect(secondRunLogs).toEqual(['Skipping 001_create_probe.sql']);
      await expectMigrationCount(databaseUrl, 1);

      await writeFile(
        migrationFile,
        'CREATE TABLE migration_probe_drift (id int PRIMARY KEY);',
      );

      await expect(
        runSqlMigrations({
          databaseUrl,
          log: () => undefined,
          migrationsDirectory,
        }),
      ).rejects.toThrow('Migration checksum mismatch for 001_create_probe.sql');
    } finally {
      await dropSchema(baseDatabaseUrl, schemaName);
      await rm(migrationsDirectory, { force: true, recursive: true });
    }
  });
});

async function expectMigrationCount(
  databaseUrl: string,
  expectedCount: number,
) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const result = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM schema_migrations',
    );

    expect(result.rows[0].count).toBe(expectedCount);
  } finally {
    await client.end();
  }
}

function getDatabaseUrl() {
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    readEnvFile().DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL or E2E_DATABASE_URL is required.');
  }

  assertLocalDatabaseUrl(databaseUrl);

  return databaseUrl;
}

function readEnvFile() {
  const envText = readFileSync('.env', 'utf8');
  const env: Record<string, string> = {};

  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');

    env[key] = value;
  }

  return env;
}

function assertLocalDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const allowedHosts = new Set(['127.0.0.1', '::1', 'localhost']);

  if (!allowedHosts.has(url.hostname)) {
    throw new Error(
      'Migration e2e tests only run against a local Postgres host.',
    );
  }
}

function withSearchPath(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);

  url.searchParams.set('options', `-c search_path=${schema},public`);

  return url.toString();
}

async function createSchema(databaseUrl: string, schema: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  } finally {
    await client.end();
  }
}

async function dropSchema(databaseUrl: string, schema: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(
      `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`,
    );
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
