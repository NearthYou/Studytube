import { Pool, type PoolClient } from 'pg';
import {
  MemoryBoardRepository,
  type MemoryBoardState,
} from '../src/memory-board.repository';
import {
  assertConnectedDatabase,
  quoteSqlIdentifier,
  requireSafeDatabaseTarget,
} from './database-script-guards';

const LEGACY_DEMO_PASSWORD_HASH =
  '47f65a9430b5f109208eea5ad01ce9f5c8335244bfab3626eb91aea9a7b97b87';

export const DEMO_SEED_DISABLED_PASSWORD_HASH = 'disabled:demo-seed-login';

class DemoSeedSource extends MemoryBoardRepository {
  readState(): MemoryBoardState {
    return this.snapshotState();
  }
}

export function readDemoSeedState(): MemoryBoardState {
  return new DemoSeedSource().readState();
}

export function replacementForLegacyDemoPasswordHash(
  passwordHash: string,
): string | undefined {
  return passwordHash === LEGACY_DEMO_PASSWORD_HASH
    ? DEMO_SEED_DISABLED_PASSWORD_HASH
    : undefined;
}

export function demoPlaylistStableIdentity(playlist: {
  id: number;
  ownerId: number;
  title: string;
}): Record<string, string | number> {
  return {
    id: playlist.id,
    ownerId: playlist.ownerId,
    title: playlist.title,
  };
}

export function assertStableIdentity(
  kind: string,
  actual: object | undefined,
  expected: Record<string, string | number>,
): void {
  const actualValues = actual as Record<string, unknown> | undefined;
  const matches =
    actualValues !== undefined &&
    Object.entries(expected).every(
      ([field, expectedValue]) => actualValues[field] === expectedValue,
    );

  if (!matches) {
    throw new Error(
      `Demo ${kind} stable identity mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual ?? null)}`,
    );
  }
}

async function seedUsers(client: PoolClient, state: MemoryBoardState) {
  for (const user of state.users) {
    await client.query(
      `
        INSERT INTO users (id, name, email, password_hash, preferences, created_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        user.id,
        user.name,
        user.email,
        DEMO_SEED_DISABLED_PASSWORD_HASH,
        JSON.stringify(user.preferences),
        user.createdAt,
      ],
    );

    const existing = await client.query<{
      id: number;
      email: string;
      passwordHash: string;
    }>(
      `
        SELECT id, email, password_hash AS "passwordHash"
        FROM users
        WHERE id = $1
      `,
      [user.id],
    );
    const existingUser = existing.rows[0];

    assertStableIdentity('user', existingUser, {
      id: user.id,
      email: user.email,
    });

    const replacement = replacementForLegacyDemoPasswordHash(
      existingUser.passwordHash,
    );

    if (replacement !== undefined) {
      const updated = await client.query(
        `
          UPDATE users
          SET password_hash = $1
          WHERE id = $2
            AND email = $3
            AND password_hash = $4
        `,
        [replacement, user.id, user.email, LEGACY_DEMO_PASSWORD_HASH],
      );

      if (updated.rowCount !== 1) {
        throw new Error(
          `Demo user ${user.id} legacy password hash changed during seed`,
        );
      }

      await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    }
  }
}

async function seedPosts(
  client: PoolClient,
  state: MemoryBoardState,
  insertMissingTags: boolean,
) {
  for (const post of state.posts) {
    await client.query(
      `
        INSERT INTO posts (
          id, author_id, title, video_url, thumbnail_url, channel_name,
          summary, translated_notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        post.id,
        post.authorId,
        post.title,
        post.videoUrl,
        post.thumbnailUrl,
        post.channelName,
        post.summary,
        post.translatedNotes,
        post.createdAt,
        post.updatedAt,
      ],
    );

    const existing = await client.query<{
      id: number;
      authorId: number;
      videoUrl: string;
    }>(
      `
        SELECT id, author_id AS "authorId", video_url AS "videoUrl"
        FROM posts
        WHERE id = $1
      `,
      [post.id],
    );

    assertStableIdentity('post', existing.rows[0], {
      id: post.id,
      authorId: post.authorId,
      videoUrl: post.videoUrl,
    });

    for (const tag of post.tags) {
      const insertedTag = insertMissingTags
        ? await client.query<{ id: number }>(
            `
              INSERT INTO tags (name)
              VALUES ($1)
              ON CONFLICT (name) DO NOTHING
              RETURNING id
            `,
            [tag],
          )
        : { rows: [] };
      const tagId =
        insertedTag.rows[0]?.id ??
        (
          await client.query<{ id: number }>(
            'SELECT id FROM tags WHERE name = $1',
            [tag],
          )
        ).rows[0]?.id;

      if (tagId === undefined) {
        throw new Error(`Demo tag ${tag} could not be resolved after insert`);
      }

      await client.query(
        `
          INSERT INTO post_tags (post_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [post.id, tagId],
      );
    }

    for (const comment of post.comments) {
      await client.query(
        `
          INSERT INTO comments (id, post_id, author_id, body, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          comment.id,
          comment.postId,
          comment.authorId,
          comment.body,
          comment.createdAt,
        ],
      );

      const existingComment = await client.query<{
        id: number;
        postId: number;
        authorId: number;
      }>(
        `
          SELECT id, post_id AS "postId", author_id AS "authorId"
          FROM comments
          WHERE id = $1
        `,
        [comment.id],
      );

      assertStableIdentity('comment', existingComment.rows[0], {
        id: comment.id,
        postId: comment.postId,
        authorId: comment.authorId,
      });
    }
  }
}

async function seedPlaylists(client: PoolClient, state: MemoryBoardState) {
  for (const playlist of state.playlists) {
    await client.query(
      `
        INSERT INTO playlists (
          id, owner_id, title, description, created_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        playlist.id,
        playlist.ownerId,
        playlist.title,
        playlist.description,
        playlist.createdAt,
      ],
    );

    const existing = await client.query<{
      id: number;
      ownerId: number;
      title: string;
    }>(
      `
        SELECT id, owner_id AS "ownerId", title
        FROM playlists
        WHERE id = $1
      `,
      [playlist.id],
    );

    assertStableIdentity(
      'playlist',
      existing.rows[0],
      demoPlaylistStableIdentity(playlist),
    );

    for (const [index, postId] of playlist.postIds.entries()) {
      await client.query(
        `
          INSERT INTO playlist_items (playlist_id, post_id, position)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `,
        [playlist.id, postId, index + 1],
      );
    }

    for (const feedback of playlist.feedback) {
      await client.query(
        `
          INSERT INTO playlist_feedback (
            id, playlist_id, author_id, rating, body, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          feedback.id,
          feedback.playlistId,
          feedback.authorId,
          feedback.rating,
          feedback.body,
          feedback.createdAt,
        ],
      );

      const existingFeedback = await client.query<{
        id: number;
        playlistId: number;
        authorId: number;
      }>(
        `
          SELECT id,
                 playlist_id AS "playlistId",
                 author_id AS "authorId"
          FROM playlist_feedback
          WHERE id = $1
        `,
        [feedback.id],
      );

      assertStableIdentity('feedback', existingFeedback.rows[0], {
        id: feedback.id,
        playlistId: feedback.playlistId,
        authorId: feedback.authorId,
      });
    }
  }
}

export async function synchronizeSequences(client: PoolClient) {
  for (const [table, column] of [
    ['users', 'id'],
    ['posts', 'id'],
    ['comments', 'id'],
    ['playlists', 'id'],
    ['playlist_feedback', 'id'],
  ]) {
    const result = await client.query<{
      sequenceName: string | null;
      sequenceSchema: string | null;
      sequenceRelation: string | null;
      maxId: string;
    }>(
      `
        WITH target_sequence AS (
          SELECT pg_get_serial_sequence($1, $2) AS sequence_name
        )
        SELECT target_sequence.sequence_name AS "sequenceName",
               sequence_namespace.nspname AS "sequenceSchema",
               sequence_class.relname AS "sequenceRelation",
               COALESCE((SELECT MAX(id) FROM ${table}), 0)::text AS "maxId"
        FROM target_sequence
        LEFT JOIN pg_class AS sequence_class
          ON sequence_class.oid = target_sequence.sequence_name::regclass
        LEFT JOIN pg_namespace AS sequence_namespace
          ON sequence_namespace.oid = sequence_class.relnamespace
      `,
      [table, column],
    );
    const sequence = result.rows[0];

    if (
      !sequence?.sequenceName ||
      !sequence.sequenceSchema ||
      !sequence.sequenceRelation
    ) {
      throw new Error(`No serial sequence found for ${table}.${column}`);
    }

    const maxId = Number(sequence.maxId);
    const sequenceReference = `${quoteSqlIdentifier(sequence.sequenceSchema)}.${quoteSqlIdentifier(sequence.sequenceRelation)}`;
    const sequenceState = await client.query<{
      lastValue: string;
      isCalled: boolean;
    }>(`
      SELECT last_value::text AS "lastValue", is_called AS "isCalled"
      FROM ${sequenceReference}
    `);
    const current = sequenceState.rows[0];
    const lastValue = Number(current?.lastValue);

    if (!Number.isSafeInteger(maxId) || maxId < 0) {
      throw new Error(`Invalid maximum id for ${table}.${column}`);
    }

    if (!Number.isSafeInteger(lastValue) || lastValue < 0) {
      throw new Error(`Invalid sequence value for ${table}.${column}`);
    }

    if (typeof current?.isCalled !== 'boolean') {
      throw new Error(`Invalid sequence state for ${table}.${column}`);
    }

    if (shouldAdvanceSequence(maxId, lastValue)) {
      await client.query('SELECT setval($1::regclass, $2, true)', [
        sequence.sequenceName,
        maxId,
      ]);
    }
  }
}

export function shouldAdvanceSequence(
  maxId: number,
  lastValue: number,
): boolean {
  return maxId > 0 && maxId >= lastValue;
}

interface SeedDemoRowsOptions {
  insertMissingTags?: boolean;
  synchronizeSequences?: boolean;
}

export async function seedDemoRows(
  client: PoolClient,
  state: MemoryBoardState,
  options: SeedDemoRowsOptions = {},
): Promise<void> {
  if (options.synchronizeSequences !== false) {
    await client.query(`
      LOCK TABLE users, posts, comments, playlists, playlist_feedback
      IN SHARE ROW EXCLUSIVE MODE
    `);
  }

  await seedUsers(client, state);
  await seedPosts(client, state, options.insertMissingTags !== false);
  await seedPlaylists(client, state);

  if (options.synchronizeSequences !== false) {
    await synchronizeSequences(client);
  }
}

async function main() {
  const target = requireSafeDatabaseTarget('ALLOW_DEMO_SEED');
  const pool = new Pool({ connectionString: target.connectionString });

  try {
    const client = await pool.connect();

    try {
      await assertConnectedDatabase(client, target.allowedDatabaseNames);
      const state = readDemoSeedState();
      await client.query('BEGIN');

      try {
        await seedDemoRows(client, state);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      console.log(
        'StudyTube demo data seeded without overwriting existing rows.',
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
