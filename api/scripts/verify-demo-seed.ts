import { Pool, type PoolClient } from 'pg';
import type { MemoryBoardState } from '../src/memory-board.repository';
import {
  assertConnectedDatabase,
  quoteSqlIdentifier,
  requireSafeDatabaseTarget,
} from './database-script-guards';
import {
  assertStableIdentity,
  DEMO_SEED_DISABLED_PASSWORD_ALGORITHM,
  DEMO_SEED_DISABLED_PASSWORD_HASH,
  DEMO_SEED_DISABLED_PASSWORD_PARAMETERS,
  DEMO_SEED_IDENTITY_ASSURANCE,
  readDemoSeedState,
  replacementForLegacyDemoPasswordHash,
  seedDemoRows,
} from './seed-demo';

// Fixed non-secret SHA-256 fixture used only to identify the legacy demo row
// whose obsolete credential must have been replaced by the disabled marker.
const LEGACY_DEMO_PASSWORD_HASH =
  '47f65a9430b5f109208eea5ad01ce9f5c8335244bfab3626eb91aea9a7b97b87';
const CUSTOM_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdC1mb3ItdGVzdA$ZGlnZXN0LWZvci10ZXN0LW9ubHk';
// Stable labels retained in source for the legacy-hash-session and
// custom-hash-session boundary checks while the stored identifiers are UUIDs.
const LEGACY_HASH_SESSION_ID = '00000000-0000-4000-8000-000000000101';
const CUSTOM_HASH_SESSION_ID = '00000000-0000-4000-8000-000000000102';

interface DemoUserRow {
  id: number;
  email: string;
  emailCanonical: string;
  passwordHash: string;
  passwordAlgorithm: string;
  passwordParameters: unknown;
  identityAssurance: string;
  emailVerifiedAt: Date | null;
}

interface SequenceStateRow {
  sequenceSchema: string;
  sequenceName: string;
  lastValue: string;
  isCalled: boolean;
}

async function readSequenceState(
  client: PoolClient,
): Promise<SequenceStateRow[]> {
  const sequences = await client.query<{
    sequenceSchema: string;
    sequenceName: string;
  }>(`
    SELECT sequence_namespace.nspname AS "sequenceSchema",
           sequence_class.relname AS "sequenceName"
    FROM pg_class AS sequence_class
    JOIN pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_class.relnamespace
    WHERE sequence_namespace.nspname = 'public'
      AND sequence_class.relkind = 'S'
      -- Collision probes intentionally fire the cutover audit trigger inside
      -- rolled-back transactions. PostgreSQL rolls back the rows, not nextval.
      AND sequence_class.relname <> 'learning_cutover_source_changes_id_seq'
    ORDER BY sequence_class.relname
  `);
  const state: SequenceStateRow[] = [];

  for (const sequence of sequences.rows) {
    const sequenceReference = `${quoteSqlIdentifier(sequence.sequenceSchema)}.${quoteSqlIdentifier(sequence.sequenceName)}`;
    const result = await client.query<{
      lastValue: string;
      isCalled: boolean;
    }>(`
      SELECT last_value::text AS "lastValue", is_called AS "isCalled"
      FROM ${sequenceReference}
    `);
    const current = result.rows[0];

    if (!current) {
      throw new Error(`Could not read sequence state for ${sequenceReference}`);
    }

    state.push({ ...sequence, ...current });
  }

  return state;
}

function assertSequenceStateUnchanged(
  before: SequenceStateRow[],
  after: SequenceStateRow[],
): void {
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `Demo seed verifier changed sequence state: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`,
    );
  }
}

async function assertNoDemoLoginArtifacts(
  client: PoolClient,
  state: MemoryBoardState,
): Promise<void> {
  const demoUserIds = state.users.map(({ id }) => id);
  const users = await client.query<DemoUserRow>(
    `
      SELECT id,
             email,
             email_canonical AS "emailCanonical",
             password_hash AS "passwordHash",
             password_algorithm AS "passwordAlgorithm",
             password_parameters AS "passwordParameters",
             identity_assurance AS "identityAssurance",
             email_verified_at AS "emailVerifiedAt"
      FROM users
      WHERE id = ANY($1::integer[])
      ORDER BY id
    `,
    [demoUserIds],
  );

  if (users.rows.length !== state.users.length) {
    throw new Error(
      `Expected ${state.users.length} demo users, received ${users.rows.length}`,
    );
  }

  const expectedUsers = new Map(state.users.map((user) => [user.id, user]));

  for (const user of users.rows) {
    const expected = expectedUsers.get(user.id);

    assertStableIdentity(
      'verification user',
      user,
      expected
        ? { id: expected.id, email: expected.email }
        : { id: user.id, email: 'missing-demo-user' },
    );

    if (replacementForLegacyDemoPasswordHash(user.passwordHash) !== undefined) {
      throw new Error(
        `Demo user ${user.id} still stores the source-known legacy SHA-256 password hash`,
      );
    }

    if (user.emailCanonical !== user.email.toLowerCase()) {
      throw new Error(
        `Demo user ${user.id} has an inconsistent canonical email`,
      );
    }

    if (user.passwordHash === DEMO_SEED_DISABLED_PASSWORD_HASH) {
      if (
        user.passwordAlgorithm !== DEMO_SEED_DISABLED_PASSWORD_ALGORITHM ||
        JSON.stringify(user.passwordParameters) !==
          JSON.stringify(DEMO_SEED_DISABLED_PASSWORD_PARAMETERS) ||
        user.identityAssurance !== DEMO_SEED_IDENTITY_ASSURANCE ||
        user.emailVerifiedAt !== null
      ) {
        throw new Error(
          `Demo user ${user.id} has inconsistent disabled authentication metadata`,
        );
      }
    }
  }

  const disabledUserIds = users.rows
    .filter(
      ({ passwordHash }) => passwordHash === DEMO_SEED_DISABLED_PASSWORD_HASH,
    )
    .map(({ id }) => id);
  const sessions = await client.query<{ id: string; userId: number }>(
    `
      SELECT id, user_id AS "userId"
      FROM sessions
      WHERE user_id = ANY($1::integer[])
    `,
    [disabledUserIds],
  );

  if (sessions.rows.length > 0) {
    throw new Error(
      `Demo seed verification found sessions for disabled demo users: ${sessions.rows.map(({ userId }) => userId).join(', ')}`,
    );
  }
}

async function verifyLegacySessionInvalidation(
  client: PoolClient,
  state: MemoryBoardState,
): Promise<void> {
  const legacyUser = state.users[0];
  const customUser = state.users[1];

  if (!legacyUser || !customUser) {
    throw new Error(
      'Demo seed must contain two users for session invalidation verification',
    );
  }

  await client.query('BEGIN');

  try {
    const legacyUpdate = await client.query(
      `
        UPDATE users
        SET password_hash = $1,
            password_algorithm = 'legacy_sha256',
            password_parameters = '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
            identity_assurance = 'legacy_grandfathered',
            email_verified_at = NULL
        WHERE id = $2
      `,
      [LEGACY_DEMO_PASSWORD_HASH, legacyUser.id],
    );
    const customUpdate = await client.query(
      `
        UPDATE users
        SET password_hash = $1,
            password_algorithm = 'argon2id',
            password_parameters = '{"memoryKiB":65536,"timeCost":3,"parallelism":1}'::jsonb
        WHERE id = $2
      `,
      [CUSTOM_PASSWORD_HASH, customUser.id],
    );

    if (legacyUpdate.rowCount !== 1 || customUpdate.rowCount !== 1) {
      throw new Error(
        'Demo users are missing for session boundary verification',
      );
    }

    await client.query(
      `
        INSERT INTO sessions (
          id, token_digest, user_id, absolute_expires_at,
          idle_expires_at, last_seen_at
        )
        VALUES
          ($1, decode(repeat('11', 32), 'hex'), $2, now() + interval '7 days', now() + interval '1 day', now()),
          ($3, decode(repeat('22', 32), 'hex'), $4, now() + interval '7 days', now() + interval '1 day', now())
      `,
      [
        LEGACY_HASH_SESSION_ID,
        legacyUser.id,
        CUSTOM_HASH_SESSION_ID,
        customUser.id,
      ],
    );

    await seedDemoRows(client, state, {
      insertMissingTags: false,
      synchronizeSequences: false,
    });

    const users = await client.query<{
      id: number;
      passwordHash: string;
      passwordAlgorithm: string;
    }>(
      `
        SELECT id,
               password_hash AS "passwordHash",
               password_algorithm AS "passwordAlgorithm"
        FROM users
        WHERE id = ANY($1::integer[])
      `,
      [[legacyUser.id, customUser.id]],
    );
    const passwordHashes = new Map<
      number,
      { passwordHash: string; passwordAlgorithm: string }
    >(
      users.rows.map(({ id, passwordHash, passwordAlgorithm }) => [
        id,
        { passwordHash, passwordAlgorithm },
      ]),
    );

    if (
      passwordHashes.get(legacyUser.id)?.passwordHash !==
        DEMO_SEED_DISABLED_PASSWORD_HASH ||
      passwordHashes.get(legacyUser.id)?.passwordAlgorithm !==
        DEMO_SEED_DISABLED_PASSWORD_ALGORITHM
    ) {
      throw new Error('Legacy demo password hash was not disabled');
    }

    if (
      passwordHashes.get(customUser.id)?.passwordHash !==
        CUSTOM_PASSWORD_HASH ||
      passwordHashes.get(customUser.id)?.passwordAlgorithm !== 'argon2id'
    ) {
      throw new Error('Custom demo password hash was overwritten');
    }

    const sessions = await client.query<{ id: string }>(
      `
        SELECT id
        FROM sessions
        WHERE id = ANY($1::uuid[])
      `,
      [[LEGACY_HASH_SESSION_ID, CUSTOM_HASH_SESSION_ID]],
    );
    const sessionIds = new Set(sessions.rows.map(({ id }) => id));

    if (sessionIds.has(LEGACY_HASH_SESSION_ID)) {
      throw new Error('Legacy-hash demo user session was not invalidated');
    }

    if (!sessionIds.has(CUSTOM_HASH_SESSION_ID)) {
      throw new Error(
        'Custom-hash demo user session was incorrectly invalidated',
      );
    }
  } finally {
    await client.query('ROLLBACK');
  }
}

async function assertNoRows(
  client: PoolClient,
  query: string,
  values: unknown[],
  description: string,
): Promise<void> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM (${query}) AS guarded_rows`,
    values,
  );

  if (result.rows[0]?.count !== '0') {
    throw new Error(
      `Stable identity collision wrote dependent ${description} before aborting`,
    );
  }
}

async function expectStableIdentityCollision(
  client: PoolClient,
  state: MemoryBoardState,
  kind: string,
  prepare: () => Promise<void>,
  verifyNoDependentWrites?: () => Promise<void>,
): Promise<void> {
  await client.query('BEGIN');

  try {
    await prepare();
    let collisionError: unknown;

    try {
      await seedDemoRows(client, state, {
        insertMissingTags: false,
        synchronizeSequences: false,
      });
    } catch (error) {
      collisionError = error;
    }

    if (
      !(collisionError instanceof Error) ||
      !collisionError.message.includes(`Demo ${kind} stable identity mismatch`)
    ) {
      throw new Error(
        `Expected a ${kind} stable identity collision, received ${collisionError instanceof Error ? collisionError.message : 'no error'}`,
      );
    }

    await verifyNoDependentWrites?.();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function verifyStableIdentityCollisions(
  client: PoolClient,
  state: MemoryBoardState,
): Promise<void> {
  await expectStableIdentityCollision(
    client,
    state,
    'user',
    async () => {
      await client.query(
        "UPDATE users SET email = 'seed-collision@studytube.local' WHERE id = 1",
      );
      await client.query('DELETE FROM post_tags WHERE post_id = 1');
    },
    () =>
      assertNoRows(
        client,
        'SELECT 1 FROM post_tags WHERE post_id = $1',
        [1],
        'post tags after a user collision',
      ),
  );

  await expectStableIdentityCollision(
    client,
    state,
    'post',
    async () => {
      await client.query(
        "UPDATE posts SET video_url = 'https://collision.invalid/video' WHERE id = 1",
      );
      await client.query('DELETE FROM post_tags WHERE post_id = 1');
      await client.query('DELETE FROM comments WHERE post_id = 1');
    },
    async () => {
      await assertNoRows(
        client,
        'SELECT 1 FROM post_tags WHERE post_id = $1',
        [1],
        'post tags after a post collision',
      );
      await assertNoRows(
        client,
        'SELECT 1 FROM comments WHERE post_id = $1',
        [1],
        'comments after a post collision',
      );
    },
  );

  await expectStableIdentityCollision(
    client,
    state,
    'playlist',
    async () => {
      await client.query('UPDATE playlists SET owner_id = 1 WHERE id = 1');
      await client.query('DELETE FROM playlist_items WHERE playlist_id = 1');
    },
    () =>
      assertNoRows(
        client,
        'SELECT 1 FROM playlist_items WHERE playlist_id = $1',
        [1],
        'playlist items after a playlist collision',
      ),
  );

  await expectStableIdentityCollision(client, state, 'comment', async () => {
    await client.query('UPDATE comments SET post_id = 2 WHERE id = 1');
  });

  const feedbackId = 2_000_000_000;
  const firstPlaylist = state.playlists[0];

  if (!firstPlaylist) {
    throw new Error(
      'Demo seed must contain a playlist for feedback verification',
    );
  }

  const stateWithFeedback: MemoryBoardState = {
    ...state,
    playlists: state.playlists.map((playlist) =>
      playlist.id === firstPlaylist.id
        ? {
            ...playlist,
            feedback: [
              ...playlist.feedback,
              {
                id: feedbackId,
                playlistId: playlist.id,
                authorId: 1,
                authorName: 'StudyTube Learner',
                rating: 5,
                body: 'Transient collision verification feedback',
                createdAt: new Date(0).toISOString(),
              },
            ],
          }
        : playlist,
    ),
  };

  await expectStableIdentityCollision(
    client,
    stateWithFeedback,
    'feedback',
    async () => {
      await seedDemoRows(client, stateWithFeedback, {
        insertMissingTags: false,
        synchronizeSequences: false,
      });
      await client.query(
        'UPDATE playlist_feedback SET author_id = 2 WHERE id = $1',
        [feedbackId],
      );
    },
  );
}

async function main() {
  const target = requireSafeDatabaseTarget('ALLOW_DEMO_SEED');
  const pool = new Pool({ connectionString: target.connectionString });

  try {
    const client = await pool.connect();

    try {
      await assertConnectedDatabase(client, target.allowedDatabaseNames);
      const state = readDemoSeedState();
      const sequenceStateBefore = await readSequenceState(client);
      await assertNoDemoLoginArtifacts(client, state);
      await verifyLegacySessionInvalidation(client, state);
      await verifyStableIdentityCollisions(client, state);
      assertSequenceStateUnchanged(
        sequenceStateBefore,
        await readSequenceState(client),
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(
    `Demo seed login and stable identity verification completed for ${target.databaseName}.`,
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
