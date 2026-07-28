import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  assertConnectedDatabase,
  requireSafeDatabaseTarget,
} from './database-script-guards';

const TABLES = [
  ['users', 'id'],
  ['sessions', 'token'],
  ['posts', 'id'],
  ['video_assets', 'id'],
  ['tags', 'id'],
  ['post_tags', 'post_id, tag_id'],
  ['comments', 'id'],
  ['playlists', 'id'],
  ['playlist_items', 'playlist_id, post_id'],
  ['playlist_feedback', 'id'],
  ['post_embeddings', 'post_id'],
] as const;

const SEQUENCES = [
  'users_id_seq',
  'posts_id_seq',
  'video_assets_id_seq',
  'tags_id_seq',
  'comments_id_seq',
  'playlists_id_seq',
  'playlist_feedback_id_seq',
] as const;

const INDEXES = [
  'users_lower_email_idx',
  'sessions_user_id_idx',
  'posts_author_updated_at_idx',
  'posts_updated_at_idx',
  'post_tags_tag_id_idx',
  'comments_post_created_at_idx',
  'comments_author_id_idx',
  'playlists_owner_created_at_idx',
  'playlist_items_playlist_position_idx',
  'playlist_items_post_id_idx',
  'playlist_feedback_playlist_created_at_idx',
  'playlist_feedback_author_id_idx',
] as const;

const EXPECTED_MIGRATIONS = [
  '1753660800000_baseline-schema',
  '1753660801000_concurrent-indexes',
] as const;

const INDEX_MIGRATION_APPLICATION_NAME =
  'studytube-migration-adoption-index-build';

interface TableFingerprint {
  rowCount: number;
  fingerprint: string;
}

interface SequenceState {
  lastValue: string;
  isCalled: boolean;
}

interface DatabaseSnapshot {
  tables: Record<string, TableFingerprint>;
  sequences: Record<string, SequenceState>;
}

interface StartedMigration {
  completion: Promise<void>;
  isSettled: () => boolean;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function assertMigrationHistoryAbsent(client: PoolClient) {
  const result = await client.query<{ migrationHistory: string | null }>(
    `SELECT to_regclass('public.pgmigrations')::text AS "migrationHistory"`,
  );

  if (result.rows[0]?.migrationHistory !== null) {
    throw new Error(
      'Legacy fixture already contains pgmigrations; adoption must begin without migration history',
    );
  }
}

async function readTableFingerprints(
  client: PoolClient,
): Promise<Record<string, TableFingerprint>> {
  const fingerprints: Record<string, TableFingerprint> = {};

  for (const [table, orderBy] of TABLES) {
    const result = await client.query<{ row: string }>(
      `
        SELECT to_jsonb(fingerprint_row)::text AS row
        FROM (
          SELECT *
          FROM ${quoteIdentifier(table)}
          ORDER BY ${orderBy}
        ) AS fingerprint_row
      `,
    );

    if (result.rows.length === 0) {
      throw new Error(`Legacy fixture table ${table} must contain data`);
    }

    fingerprints[table] = {
      rowCount: result.rows.length,
      fingerprint: createHash('sha256')
        .update(result.rows.map(({ row }) => row).join('\n'))
        .digest('hex'),
    };
  }

  return fingerprints;
}

async function readSequenceStates(
  client: PoolClient,
): Promise<Record<string, SequenceState>> {
  const sequences: Record<string, SequenceState> = {};

  for (const sequence of SEQUENCES) {
    const result = await client.query<{
      lastValue: string;
      isCalled: boolean;
    }>(
      `SELECT last_value::text AS "lastValue", is_called AS "isCalled"
       FROM ${quoteIdentifier(sequence)}`,
    );
    const state = result.rows[0];

    if (!state) {
      throw new Error(
        `Sequence ${sequence} is missing from the legacy fixture`,
      );
    }

    sequences[sequence] = state;
  }

  return sequences;
}

async function readSnapshot(client: PoolClient): Promise<DatabaseSnapshot> {
  return {
    tables: await readTableFingerprints(client),
    sequences: await readSequenceStates(client),
  };
}

function assertSnapshotUnchanged(
  before: DatabaseSnapshot,
  after: DatabaseSnapshot,
  phase: string,
) {
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `${phase} changed legacy table fingerprints or sequence state: ${JSON.stringify({ before, after })}`,
    );
  }
}

function migrationConnectionString(
  connectionString: string,
  applicationName?: string,
): string {
  if (!applicationName) {
    return connectionString;
  }

  const url = new URL(connectionString);
  url.searchParams.set('application_name', applicationName);
  return url.toString();
}

function startMigration(
  connectionString: string,
  count?: number,
  applicationName?: string,
): StartedMigration {
  const cliPath = join(
    process.cwd(),
    'node_modules',
    'node-pg-migrate',
    'bin',
    'node-pg-migrate.js',
  );
  const args = [cliPath, 'up'];

  if (count !== undefined) {
    args.push(String(count));
  }

  args.push('--migrations-dir', 'migrations');

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: migrationConnectionString(
        connectionString,
        applicationName,
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let settled = false;

  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => {
      settled = true;
      reject(error);
    });
    child.once('close', (code, signal) => {
      settled = true;

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Migration process exited with ${code ?? signal ?? 'unknown'}:\n${Buffer.concat(stderr).toString()}${Buffer.concat(stdout).toString()}`,
        ),
      );
    });
  });

  return { completion, isSettled: () => settled };
}

async function runMigration(
  connectionString: string,
  count?: number,
): Promise<void> {
  await startMigration(connectionString, count).completion;
}

async function assertMigrationHistory(
  client: PoolClient,
  expectedNames: readonly string[],
) {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM pgmigrations ORDER BY id',
  );
  const actualNames = result.rows.map(({ name }) => name);

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Expected migration history ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}`,
    );
  }
}

async function waitForConcurrentIndexBuild(
  client: PoolClient,
  migration: StartedMigration,
) {
  const deadline = Date.now() + 4_000;

  while (Date.now() < deadline) {
    const result = await client.query<{ active: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE application_name = $1
            AND state = 'active'
            AND query LIKE '%CREATE INDEX CONCURRENTLY%'
        ) AS active
      `,
      [INDEX_MIGRATION_APPLICATION_NAME],
    );

    if (result.rows[0]?.active) {
      return;
    }

    if (migration.isSettled()) {
      throw new Error(
        'Concurrent index migration completed before the held writer was observed',
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting to observe CREATE INDEX CONCURRENTLY');
}

async function verifyNonBlockingIndexMigration(
  pool: Pool,
  connectionString: string,
) {
  const blocker = await pool.connect();
  const writer = await pool.connect();
  const monitor = await pool.connect();
  let blockerTransactionOpen = false;
  let failure: unknown;
  let migration: StartedMigration | undefined;

  try {
    await blocker.query('BEGIN');
    blockerTransactionOpen = true;
    await blocker.query('UPDATE users SET email = email WHERE id = $1', [41]);

    migration = startMigration(
      connectionString,
      undefined,
      INDEX_MIGRATION_APPLICATION_NAME,
    );
    await waitForConcurrentIndexBuild(monitor, migration);

    await writer.query("SET statement_timeout = '2s'");
    const result = await writer.query(
      'UPDATE users SET name = name WHERE id = $1',
      [42],
    );

    if (result.rowCount !== 1) {
      throw new Error(
        `Expected the independent user update to affect one row, received ${result.rowCount ?? 0}`,
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    if (blockerTransactionOpen) {
      try {
        await blocker.query('COMMIT');
      } catch (error) {
        failure ??= error;
      }
    }

    if (migration) {
      try {
        await migration.completion;
      } catch (error) {
        failure ??= error;
      }
    }

    monitor.release();
    writer.release();
    blocker.release();
  }

  if (failure) {
    throw failure instanceof Error
      ? failure
      : new Error('Migration adoption verification failed', {
          cause: failure,
        });
  }
}

async function assertIndexesReady(client: PoolClient) {
  const result = await client.query<{
    name: string;
    indisvalid: boolean;
    indisready: boolean;
  }>(
    `
      SELECT index_class.relname AS name,
             index_state.indisvalid,
             index_state.indisready
      FROM pg_index AS index_state
      JOIN pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
      JOIN pg_class AS table_class
        ON table_class.oid = index_state.indrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = 'public'
      ORDER BY index_class.relname
    `,
  );
  const byName = new Map(result.rows.map((index) => [index.name, index]));
  const missing = INDEXES.filter((name) => !byName.has(name));
  const unusable = result.rows.filter(
    ({ indisvalid, indisready }) => !indisvalid || !indisready,
  );

  if (missing.length > 0) {
    throw new Error(`Concurrent indexes are missing: ${missing.join(', ')}`);
  }

  if (unusable.length > 0) {
    throw new Error(
      `Indexes are not valid and ready: ${JSON.stringify(unusable)}`,
    );
  }
}

async function main() {
  const target = requireSafeDatabaseTarget('ALLOW_MIGRATION_ADOPTION_TEST');
  const pool = new Pool({ connectionString: target.connectionString });

  try {
    const client = await pool.connect();

    try {
      await assertConnectedDatabase(client, target.databaseName);
      await assertMigrationHistoryAbsent(client);
      const before = await readSnapshot(client);

      await runMigration(target.connectionString, 1);
      await assertMigrationHistory(client, EXPECTED_MIGRATIONS.slice(0, 1));

      const afterBaseline = await readSnapshot(client);
      assertSnapshotUnchanged(before, afterBaseline, 'Baseline adoption');

      await verifyNonBlockingIndexMigration(pool, target.connectionString);
      await assertMigrationHistory(client, EXPECTED_MIGRATIONS);
      await assertIndexesReady(client);

      const afterIndexes = await readSnapshot(client);
      assertSnapshotUnchanged(
        before,
        afterIndexes,
        'Concurrent index migration',
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(
    'Legacy adoption preserved every table fingerprint and sequence while concurrent indexes allowed an independent write.',
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
