import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresAccountErasureRepository } from '../src/account/postgres-account-erasure.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('account deletion data graph (e2e)', () => {
  let pool: Pool;
  const cleanupUserIds: number[] = [];
  const cleanupSourceIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterEach(async () => {
    if (cleanupUserIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        cleanupUserIds,
      ]);
    }
    if (cleanupSourceIds.length > 0) {
      await pool.query(
        `UPDATE video_sources SET current_source_caption_artifact_id = NULL
         WHERE id = ANY($1::bigint[])`,
        [cleanupSourceIds],
      );
      await pool.query(
        `DELETE FROM caption_artifacts
         WHERE video_source_id = ANY($1::bigint[])`,
        [cleanupSourceIds],
      );
      await pool.query(
        'DELETE FROM video_sources WHERE id = ANY($1::bigint[])',
        [cleanupSourceIds],
      );
    }
    cleanupUserIds.length = 0;
    cleanupSourceIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('deletes owned work and exclusive captions while preserving a shared source', async () => {
    const firstUser = await insertGoogleUser('delete-first');
    const secondUser = await insertGoogleUser('delete-second');
    const sharedSource = await insertVideoSource('shared');
    const exclusiveSource = await insertVideoSource('exclusive');
    await insertLearningItem(firstUser, sharedSource);
    await insertLearningItem(secondUser, sharedSource);
    const exclusiveItem = await insertLearningItem(firstUser, exclusiveSource);
    const contextId = await insertContext(firstUser, exclusiveItem);
    await pool.query(
      `INSERT INTO learning_notes (
         user_id, study_context_id, position_seconds, body
       ) VALUES ($1, $2::bigint, 12.5, 'Delete this note')`,
      [firstUser, contextId],
    );
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO work_outbox_events (
         id, owner_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_schema_version, payload
       ) VALUES ($1, $2, 'retrieval_embedding.requested', 'study_context',
                 $3, 1, 1, '{}'::jsonb)`,
      [eventId, firstUser, contextId],
    );
    await pool.query(
      `INSERT INTO work_job_results (
         id, event_id, handler_version, outcome
       ) VALUES ($1, $2, 'retrieval-embedding-v2', 'succeeded')`,
      [randomUUID(), eventId],
    );
    const artifact = await pool.query<{ id: string }>(
      `INSERT INTO caption_artifacts (
         video_source_id, kind, generation, source_language,
         provider, work_event_id, handler_version
       ) VALUES ($1::bigint, 'youtube_caption', 1, 'en',
                 'youtube', $2, 'learning-caption-v1')
       RETURNING id::text AS id`,
      [exclusiveSource, eventId],
    );
    const artifactId = artifact.rows[0]?.id;
    if (!artifactId) throw new Error('Expected caption artifact');
    await pool.query(
      `INSERT INTO caption_generation_states (artifact_id, status)
       VALUES ($1::bigint, 'ready')`,
      [artifactId],
    );
    await pool.query(
      `INSERT INTO caption_artifact_segments (
         artifact_id, ordinal, start_seconds, end_seconds, text
       ) VALUES ($1::bigint, 0, 0, 4, 'Owned caption')`,
      [artifactId],
    );
    await pool.query(
      `UPDATE video_sources SET current_source_caption_artifact_id = $2::bigint
       WHERE id = $1::bigint`,
      [exclusiveSource, artifactId],
    );
    const sessionId = await insertReauthenticatedSession(firstUser);

    const repository = new PostgresAccountErasureRepository(pool);
    await expect(
      repository.erase({
        userId: firstUser,
        sessionId,
        reauthCutoff: new Date(Date.now() - 5 * 60 * 1000),
        erasedAt: new Date(),
      }),
    ).resolves.toEqual({ status: 'deleted' });
    cleanupUserIds.splice(cleanupUserIds.indexOf(firstUser), 1);
    cleanupSourceIds.splice(cleanupSourceIds.indexOf(exclusiveSource), 1);

    const counts = await pool.query<{
      user: number;
      session: number;
      item: number;
      note: number;
      event: number;
      result: number;
      sharedSource: number;
      sharedItem: number;
      exclusiveSource: number;
      exclusiveArtifact: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE id = $1) AS user,
         (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS session,
         (SELECT count(*)::int FROM learning_items WHERE user_id = $1) AS item,
         (SELECT count(*)::int FROM learning_notes WHERE user_id = $1) AS note,
         (SELECT count(*)::int FROM work_outbox_events WHERE owner_id = $1) AS event,
         (SELECT count(*)::int FROM work_job_results WHERE event_id = $2) AS result,
         (SELECT count(*)::int FROM video_sources WHERE id = $3::bigint) AS "sharedSource",
         (SELECT count(*)::int FROM learning_items
          WHERE user_id = $4 AND video_source_id = $3::bigint) AS "sharedItem",
         (SELECT count(*)::int FROM video_sources WHERE id = $5::bigint) AS "exclusiveSource",
         (SELECT count(*)::int FROM caption_artifacts
          WHERE video_source_id = $5::bigint) AS "exclusiveArtifact"`,
      [firstUser, eventId, sharedSource, secondUser, exclusiveSource],
    );
    expect(counts.rows[0]).toEqual({
      user: 0,
      session: 0,
      item: 0,
      note: 0,
      event: 0,
      result: 0,
      sharedSource: 1,
      sharedItem: 1,
      exclusiveSource: 0,
      exclusiveArtifact: 0,
    });
  });

  it('does not delete an account without recent reauthentication', async () => {
    const userId = await insertGoogleUser('delete-without-reauth');
    const sessionId = await insertSession(userId, null);
    const repository = new PostgresAccountErasureRepository(pool);

    await expect(
      repository.erase({
        userId,
        sessionId,
        reauthCutoff: new Date(Date.now() - 5 * 60 * 1000),
        erasedAt: new Date(),
      }),
    ).resolves.toEqual({ status: 'reauth_required' });
    await expect(
      pool.query('SELECT id FROM users WHERE id = $1', [userId]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  async function insertGoogleUser(label: string) {
    const email = `${label}-${randomUUID()}@example.com`;
    const result = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, google_subject,
         password_hash, password_algorithm, password_parameters,
         password_version, identity_assurance, email_verified_at
       ) VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL,
                 'google_verified', statement_timestamp())
       RETURNING id`,
      [label, email, email, `google-${randomUUID()}`],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected Google user');
    cleanupUserIds.push(id);
    return id;
  }

  async function insertVideoSource(label: string) {
    const videoId = `${label}-${randomUUID()}`;
    const result = await pool.query<{ id: string }>(
      `INSERT INTO video_sources (
         provider, canonical_video_id, canonical_url
       ) VALUES ('youtube', $1, $2)
       RETURNING id::text AS id`,
      [videoId, `https://www.youtube.com/watch?v=${videoId}`],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected video source');
    cleanupSourceIds.push(id);
    return id;
  }

  async function insertLearningItem(userId: number, sourceId: string) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2::bigint)
       RETURNING id::text AS id`,
      [userId, sourceId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected learning item');
    return id;
  }

  async function insertContext(userId: number, itemId: string) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2::bigint, 'standalone')
       RETURNING id::text AS id`,
      [userId, itemId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected study context');
    return id;
  }

  function insertReauthenticatedSession(userId: number) {
    return insertSession(userId, new Date());
  }

  async function insertSession(userId: number, reauthenticatedAt: Date | null) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO sessions (
         id, token_digest, user_id, created_at,
         absolute_expires_at, idle_expires_at, last_seen_at,
         google_reauthenticated_at
       ) VALUES ($1, $2, $3, statement_timestamp() - interval '1 hour',
                 statement_timestamp() + interval '1 day',
                 statement_timestamp() + interval '1 day',
                 statement_timestamp(), $4)`,
      [
        id,
        createHash('sha256').update(randomUUID(), 'utf8').digest(),
        userId,
        reauthenticatedAt,
      ],
    );
    return id;
  }
});
