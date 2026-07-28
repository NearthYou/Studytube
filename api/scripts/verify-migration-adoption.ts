import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  assertConnectedDatabase,
  requireSafeDatabaseTarget,
} from './database-script-guards';

const LEGACY_TABLES = [
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

const PRESERVED_BOARD_TABLES = LEGACY_TABLES.filter(
  ([table]) => table !== 'users' && table !== 'sessions',
);

const SEQUENCES = [
  'users_id_seq',
  'posts_id_seq',
  'video_assets_id_seq',
  'tags_id_seq',
  'comments_id_seq',
  'playlists_id_seq',
  'playlist_feedback_id_seq',
] as const;

const CONCURRENT_INDEXES = [
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
  '1753660802000_auth-hardening',
] as const;

const INDEX_MIGRATION_APPLICATION_NAME =
  'studytube-migration-adoption-index-build';
const LEGACY_SHA256 = 'a'.repeat(64);
const DISABLED_PASSWORD_HASH = 'disabled:demo-seed-login';

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

interface LegacyAuthRow {
  id: number;
  email: string;
  passwordHash: string;
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
  tables: ReadonlyArray<readonly [string, string]>,
): Promise<Record<string, TableFingerprint>> {
  const fingerprints: Record<string, TableFingerprint> = {};

  for (const [table, orderBy] of tables) {
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

async function readSnapshot(
  client: PoolClient,
  tables: ReadonlyArray<readonly [string, string]>,
): Promise<DatabaseSnapshot> {
  return {
    tables: await readTableFingerprints(client, tables),
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
  const cliPath = require.resolve('node-pg-migrate/bin/node-pg-migrate');
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
      1,
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
  const missing = CONCURRENT_INDEXES.filter((name) => !byName.has(name));
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

async function readLegacyAuthRows(
  client: PoolClient,
): Promise<LegacyAuthRow[]> {
  const result = await client.query<LegacyAuthRow>(`
    SELECT id, email, password_hash AS "passwordHash"
    FROM users
    ORDER BY id
  `);
  return result.rows;
}

async function restoreLegacyAuthRows(
  client: PoolClient,
  rows: LegacyAuthRow[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      'UPDATE users SET email = $1, password_hash = $2 WHERE id = $3',
      [row.email, row.passwordHash, row.id],
    );
  }
}

async function expectAuthMigrationFailure(
  client: PoolClient,
  connectionString: string,
  description: string,
  prepare: () => Promise<void>,
  expected: RegExp,
): Promise<void> {
  const originalRows = await readLegacyAuthRows(client);

  try {
    await prepare();
    let failure: unknown;

    try {
      await runMigration(connectionString, 1);
    } catch (error) {
      failure = error;
    }

    if (!(failure instanceof Error) || !expected.test(failure.message)) {
      throw new Error(
        `Expected ${description} to abort auth migration, received ${failure instanceof Error ? failure.message : 'no error'}`,
      );
    }

    await assertMigrationHistory(client, EXPECTED_MIGRATIONS.slice(0, 2));

    const leakedMutation = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'email_canonical'
    `);

    if (leakedMutation.rows[0]?.count !== '0') {
      throw new Error(`${description} mutated schema before aborting`);
    }
  } finally {
    await restoreLegacyAuthRows(client, originalRows);
  }
}

async function verifyAuthPreflightFailures(
  client: PoolClient,
  connectionString: string,
): Promise<void> {
  await expectAuthMigrationFailure(
    client,
    connectionString,
    'unknown password representation',
    async () => undefined,
    /unknown password representation user IDs.*\{41,42\}/i,
  );

  await expectAuthMigrationFailure(
    client,
    connectionString,
    'invalid non-ASCII legacy email',
    async () => {
      await client.query(
        "UPDATE users SET email = 'légacy@example.test' WHERE id = 41",
      );
    },
    /invalid legacy email user IDs.*41/i,
  );

  await expectAuthMigrationFailure(
    client,
    connectionString,
    'invalid control-character legacy email',
    async () => {
      await client.query('UPDATE users SET email = $1 WHERE id = 41', [
        'legacy\nowner@example.test',
      ]);
    },
    /invalid legacy email user IDs.*41/i,
  );

  await expectAuthMigrationFailure(
    client,
    connectionString,
    'trim-induced canonical collision',
    async () => {
      await client.query(
        `
          UPDATE users
          SET email = CASE id
            WHEN 41 THEN ' Shared@Example.Test '
            WHEN 42 THEN 'shared@example.test'
          END
          WHERE id IN (41, 42)
        `,
      );
    },
    /canonical email collisions.*41.*42/i,
  );
}

async function readPreservedUserFingerprint(
  client: PoolClient,
): Promise<string> {
  const result = await client.query<{ row: string }>(`
    SELECT jsonb_build_object(
      'id', id,
      'name', name,
      'preferences', preferences,
      'created_at', created_at
    )::text AS row
    FROM users
    ORDER BY id
  `);

  return createHash('sha256')
    .update(result.rows.map(({ row }) => row).join('\n'))
    .digest('hex');
}

async function prepareValidAuthAdoption(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE users
      SET email = CASE id
            WHEN 41 THEN ' Legacy-Owner@Example.Test '
            ELSE email
          END,
          password_hash = CASE id
            WHEN 41 THEN $1
            WHEN 42 THEN $2
            ELSE password_hash
          END
      WHERE id IN (41, 42)
    `,
    [LEGACY_SHA256, DISABLED_PASSWORD_HASH],
  );
}

async function assertDigestColumnsAndConstraints(
  client: PoolClient,
): Promise<void> {
  const expectedColumns = new Map([
    ['sessions.token_digest', 'bytea'],
    ['pending_registrations.verification_digest', 'bytea'],
    ['pending_registrations.enrollment_digest', 'bytea'],
    ['auth_rate_limits.subject_digest', 'bytea'],
    ['verification_email_outbox.payload_hash', 'bytea'],
  ]);
  const columns = await client.query<{
    tableName: string;
    columnName: string;
    dataType: string;
  }>(`
    SELECT table_name AS "tableName",
           column_name AS "columnName",
           data_type AS "dataType"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'sessions',
        'pending_registrations',
        'auth_rate_limits',
        'verification_email_outbox'
      )
  `);
  const actualColumns = new Map(
    columns.rows.map(({ tableName, columnName, dataType }) => [
      `${tableName}.${columnName}`,
      dataType,
    ]),
  );

  for (const [column, dataType] of expectedColumns) {
    if (actualColumns.get(column) !== dataType) {
      throw new Error(`Digest column ${column} is not ${dataType}`);
    }
  }

  for (const rawColumn of [
    'sessions.token',
    'pending_registrations.verification_token',
    'pending_registrations.enrollment_token',
  ]) {
    if (actualColumns.has(rawColumn)) {
      throw new Error(
        `Raw secret column remains after auth adoption: ${rawColumn}`,
      );
    }
  }

  const lengthConstraints = await client.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace_row
      ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname IN (
        'sessions',
        'pending_registrations',
        'auth_rate_limits',
        'verification_email_outbox'
      )
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%octet_length(%'
  `);

  if (lengthConstraints.rows.length < expectedColumns.size) {
    throw new Error('Digest length constraints are incomplete');
  }
}

async function assertAuthAdoption(client: PoolClient): Promise<void> {
  const users = await client.query<{
    id: number;
    email: string;
    emailCanonical: string;
    passwordAlgorithm: string;
    identityAssurance: string;
    emailVerifiedAt: Date | null;
  }>(`
    SELECT id,
           email,
           email_canonical AS "emailCanonical",
           password_algorithm AS "passwordAlgorithm",
           identity_assurance AS "identityAssurance",
           email_verified_at AS "emailVerifiedAt"
    FROM users
    ORDER BY id
  `);
  const expected = [
    {
      id: 41,
      email: 'Legacy-Owner@Example.Test',
      emailCanonical: 'legacy-owner@example.test',
      passwordAlgorithm: 'legacy_sha256',
    },
    {
      id: 42,
      email: 'legacy-collaborator@example.test',
      emailCanonical: 'legacy-collaborator@example.test',
      passwordAlgorithm: 'disabled',
    },
  ];

  for (const expectedUser of expected) {
    const user = users.rows.find(({ id }) => id === expectedUser.id);

    if (
      !user ||
      user.email !== expectedUser.email ||
      user.emailCanonical !== expectedUser.emailCanonical ||
      user.passwordAlgorithm !== expectedUser.passwordAlgorithm ||
      user.identityAssurance !== 'legacy_grandfathered' ||
      user.emailVerifiedAt !== null
    ) {
      throw new Error(
        `Auth adoption produced inconsistent grandfathered user ${expectedUser.id}`,
      );
    }
  }

  const sessions = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM sessions',
  );

  if (sessions.rows[0]?.count !== '0') {
    throw new Error('Expected all legacy sessions were invalidated');
  }

  await assertDigestColumnsAndConstraints(client);

  const claimIndex = await client.query<{ predicate: string | null }>(`
    SELECT pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate
    FROM pg_index AS index_row
    JOIN pg_class AS index_class ON index_class.oid = index_row.indexrelid
    WHERE index_class.relname = 'verification_email_outbox_claim_idx'
  `);
  const predicate = claimIndex.rows[0]?.predicate;

  if (!predicate || /\bnow\s*\(/i.test(predicate)) {
    throw new Error(
      'Outbox claim index is missing or has a volatile predicate',
    );
  }

  await client.query('BEGIN');

  try {
    const inserted = await client.query<{ digestLength: number }>(
      `
        INSERT INTO sessions (
          id, token_digest, user_id, absolute_expires_at,
          idle_expires_at, last_seen_at
        )
        VALUES (
          '00000000-0000-4000-8000-000000000201',
          decode(repeat('ab', 32), 'hex'),
          41,
          now() + interval '7 days',
          now() + interval '1 day',
          now()
        )
        RETURNING octet_length(token_digest) AS "digestLength"
      `,
    );

    if (inserted.rows[0]?.digestLength !== 32) {
      throw new Error('New digest session did not store a 32-byte digest');
    }
  } finally {
    await client.query('ROLLBACK');
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
      const before = await readSnapshot(client, LEGACY_TABLES);

      await runMigration(target.connectionString, 1);
      await assertMigrationHistory(client, EXPECTED_MIGRATIONS.slice(0, 1));
      assertSnapshotUnchanged(
        before,
        await readSnapshot(client, LEGACY_TABLES),
        'Baseline adoption',
      );

      await verifyNonBlockingIndexMigration(pool, target.connectionString);
      await assertMigrationHistory(client, EXPECTED_MIGRATIONS.slice(0, 2));
      await assertIndexesReady(client);
      assertSnapshotUnchanged(
        before,
        await readSnapshot(client, LEGACY_TABLES),
        'Concurrent index migration',
      );

      await verifyAuthPreflightFailures(client, target.connectionString);
      await prepareValidAuthAdoption(client);

      const preservedUsers = await readPreservedUserFingerprint(client);
      const preservedBoard = await readSnapshot(client, PRESERVED_BOARD_TABLES);

      await runMigration(target.connectionString, 1);
      await assertMigrationHistory(client, EXPECTED_MIGRATIONS);
      await assertAuthAdoption(client);

      if ((await readPreservedUserFingerprint(client)) !== preservedUsers) {
        throw new Error(
          'Auth adoption changed preserved legacy user identity data',
        );
      }

      assertSnapshotUnchanged(
        preservedBoard,
        await readSnapshot(client, PRESERVED_BOARD_TABLES),
        'Auth adoption',
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(
    'Legacy adoption preserved user IDs and board data, rejected unsafe credentials, invalidated raw sessions, and installed the digest-only auth schema.',
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
