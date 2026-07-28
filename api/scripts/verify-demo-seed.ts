import { Pool, type PoolClient } from 'pg';
import type { MemoryBoardState } from '../src/memory-board.repository';
import {
  assertConnectedDatabase,
  quoteSqlIdentifier,
  requireSafeDatabaseTarget,
} from './database-script-guards';
import {
  assertStableIdentity,
  DEMO_SEED_DISABLED_PASSWORD_HASH,
  readDemoSeedState,
  replacementForLegacyDemoPasswordHash,
  seedDemoRows,
} from './seed-demo';

const LEGACY_DEMO_PASSWORD_HASH =
  '47f65a9430b5f109208eea5ad01ce9f5c8335244bfab3626eb91aea9a7b97b87';
const CUSTOM_PASSWORD_HASH = 'custom-password-hash-for-session-boundary';

interface DemoUserRow {
  id: number;
  email: string;
  passwordHash: string;
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
      SELECT id, email, password_hash AS "passwordHash"
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
  }

  const disabledUserIds = users.rows
    .filter(
      ({ passwordHash }) => passwordHash === DEMO_SEED_DISABLED_PASSWORD_HASH,
    )
    .map(({ id }) => id);
  const sessions = await client.query<{ token: string; userId: number }>(
    `
      SELECT token, user_id AS "userId"
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
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [LEGACY_DEMO_PASSWORD_HASH, legacyUser.id],
    );
    const customUpdate = await client.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [CUSTOM_PASSWORD_HASH, customUser.id],
    );

    if (legacyUpdate.rowCount !== 1 || customUpdate.rowCount !== 1) {
      throw new Error(
        'Demo users are missing for session boundary verification',
      );
    }

    await client.query(
      `
        INSERT INTO sessions (token, user_id)
        VALUES ('legacy-hash-session', $1), ('custom-hash-session', $2)
      `,
      [legacyUser.id, customUser.id],
    );

    await seedDemoRows(client, state, {
      insertMissingTags: false,
      synchronizeSequences: false,
    });

    const users = await client.query<{ id: number; passwordHash: string }>(
      `
        SELECT id, password_hash AS "passwordHash"
        FROM users
        WHERE id = ANY($1::integer[])
      `,
      [[legacyUser.id, customUser.id]],
    );
    const passwordHashes = new Map(
      users.rows.map(({ id, passwordHash }) => [id, passwordHash]),
    );

    if (
      passwordHashes.get(legacyUser.id) !== DEMO_SEED_DISABLED_PASSWORD_HASH
    ) {
      throw new Error('Legacy demo password hash was not disabled');
    }

    if (passwordHashes.get(customUser.id) !== CUSTOM_PASSWORD_HASH) {
      throw new Error('Custom demo password hash was overwritten');
    }

    const sessions = await client.query<{ token: string }>(
      `
        SELECT token
        FROM sessions
        WHERE token IN ('legacy-hash-session', 'custom-hash-session')
      `,
    );
    const sessionTokens = new Set(sessions.rows.map(({ token }) => token));

    if (sessionTokens.has('legacy-hash-session')) {
      throw new Error('Legacy-hash demo user session was not invalidated');
    }

    if (!sessionTokens.has('custom-hash-session')) {
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
