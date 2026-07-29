import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runCourseBackfill } from '../scripts/backfill-courses';
import { verifyCourseBackfill } from '../scripts/verify-course-backfill';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

interface MigratedCourseRow {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  visibility: string;
  status: string;
  version: number;
  createdAt: Date;
}

interface MigratedStepRow {
  id: string;
  sourcePostId: number | null;
  position: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  ownerLearningState: unknown;
}

interface MigratedFeedbackRow {
  id: number;
  authorId: number;
  rating: number;
  body: string;
  createdAt: Date;
}

interface BackfillAuditRow {
  orderStrategy: string;
  sourceFingerprint: string;
  targetFingerprint: string;
  stepCount: number;
  feedbackCount: number;
  completedAt: Date;
}

describe('legacy playlist to Course migration', () => {
  let pool: Pool;
  const ownerIds: number[] = [];
  const playlistIds: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterEach(async () => {
    if (playlistIds.length > 0) {
      await pool.query(
        'DELETE FROM course_backfill_audits WHERE legacy_playlist_id = ANY($1::int[])',
        [playlistIds],
      );
    }

    if (ownerIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        ownerIds,
      ]);
    }

    ownerIds.length = 0;
    playlistIds.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('resumes after a deterministic stop without changing a completed Course', async () => {
    const ownerId = await insertUser(pool, ownerIds);
    const postIds = await Promise.all([
      insertPost(pool, ownerId, 'First source'),
      insertPost(pool, ownerId, 'Second source'),
      insertPost(pool, ownerId, 'Third source'),
    ]);
    const firstPlaylistId = await insertPlaylist(
      pool,
      playlistIds,
      ownerId,
      'First legacy playlist',
      'First description',
    );
    const secondPlaylistId = await insertPlaylist(
      pool,
      playlistIds,
      ownerId,
      'Second legacy playlist',
      'Second description',
    );
    await insertPlaylistItem(pool, firstPlaylistId, postIds[0], 2);
    await insertPlaylistItem(pool, firstPlaylistId, postIds[1], 1);
    await insertPlaylistItem(pool, secondPlaylistId, postIds[2], 1);
    const feedbackId = await insertFeedback(
      pool,
      firstPlaylistId,
      ownerId,
      5,
      'Preserve this feedback',
    );

    await expect(
      runCourseBackfill(pool, {
        cutoverMode: 'legacy',
        stopAfterCompletedPlaylists: 1,
      }),
    ).rejects.toThrow('test interruption after 1 completed playlist');

    const firstState = await readMigratedState(pool, firstPlaylistId);
    expect(firstState).toMatchObject({
      course: {
        id: firstPlaylistId,
        ownerId,
        title: 'First legacy playlist',
        description: 'First description',
        visibility: 'private',
        status: 'draft',
        version: 1,
      },
      steps: [
        { sourcePostId: postIds[1], position: 1, title: 'Second source' },
        { sourcePostId: postIds[0], position: 2, title: 'First source' },
      ],
      feedback: [
        {
          id: feedbackId,
          authorId: ownerId,
          rating: 5,
          body: 'Preserve this feedback',
        },
      ],
      audit: { orderStrategy: 'legacy_position' },
    });
    expect(await auditedFixtureCount(pool, playlistIds)).toBe(1);

    await expect(
      runCourseBackfill(pool, { cutoverMode: 'legacy' }),
    ).resolves.toMatchObject({ migrated: 1, rebuilt: 0, skipped: 1 });

    expect(await auditedFixtureCount(pool, playlistIds)).toBe(2);
    expect(await readMigratedState(pool, firstPlaylistId)).toEqual(firstState);
    await expect(verifyCourseBackfill(pool)).resolves.toMatchObject({
      ok: true,
      playlistCount: 2,
    });
  });

  it('uses post ID fallback and transactionally rebuilds a changed source', async () => {
    const ownerId = await insertUser(pool, ownerIds);
    const higherPostId = await insertPost(pool, ownerId, 'Higher post');
    const lowerPostId = await insertPost(pool, ownerId, 'Lower post');
    const playlistId = await insertPlaylist(
      pool,
      playlistIds,
      ownerId,
      'Ambiguous order',
      'Before delta',
    );
    await insertPlaylistItem(pool, playlistId, higherPostId, 3);
    await insertPlaylistItem(pool, playlistId, lowerPostId, 1);

    await expect(
      runCourseBackfill(pool, { cutoverMode: 'legacy' }),
    ).resolves.toMatchObject({ migrated: 1, rebuilt: 0, skipped: 0 });
    const before = await readMigratedState(pool, playlistId);
    const expectedPostOrder = [higherPostId, lowerPostId].sort(
      (left, right) => left - right,
    );

    expect(before.audit).toMatchObject({
      orderStrategy: 'post_id_fallback',
      stepCount: 2,
    });
    expect(
      before.steps.map((step: { sourcePostId: number }) => step.sourcePostId),
    ).toEqual(expectedPostOrder);

    await pool.query(
      `
        UPDATE playlists
        SET title = 'Ambiguous order refreshed',
            description = 'After delta'
        WHERE id = $1
      `,
      [playlistId],
    );

    await expect(
      runCourseBackfill(pool, { cutoverMode: 'freeze' }),
    ).resolves.toMatchObject({ migrated: 0, rebuilt: 1, skipped: 0 });
    const after = await readMigratedState(pool, playlistId);

    expect(after.course).toMatchObject({
      title: 'Ambiguous order refreshed',
      description: 'After delta',
    });
    expect(after.audit.sourceFingerprint).not.toBe(
      before.audit.sourceFingerprint,
    );
    expect(after.audit.targetFingerprint).not.toBe(
      before.audit.targetFingerprint,
    );

    await expect(
      runCourseBackfill(pool, { cutoverMode: 'freeze' }),
    ).resolves.toMatchObject({ migrated: 0, rebuilt: 0, skipped: 1 });
    await expect(verifyCourseBackfill(pool)).resolves.toMatchObject({
      ok: true,
      playlistCount: 1,
    });
  });

  it('reports exact root, snapshot, and feedback corruption', async () => {
    const ownerId = await insertUser(pool, ownerIds);
    const postId = await insertPost(pool, ownerId, 'Verifier source');
    const playlistId = await insertPlaylist(
      pool,
      playlistIds,
      ownerId,
      'Verifier playlist',
      'Verifier description',
    );
    await insertPlaylistItem(pool, playlistId, postId, 1);
    await insertFeedback(pool, playlistId, ownerId, 4, 'Verifier feedback');
    await runCourseBackfill(pool, { cutoverMode: 'legacy' });

    const corruptions = [
      {
        sql: `UPDATE courses SET title = 'Corrupt title' WHERE id = $1`,
        diagnostic: `playlist ${playlistId}: root mismatch`,
      },
      {
        sql: `
          UPDATE course_steps
          SET video_url_snapshot = 'https://corrupt.example.test/video'
          WHERE course_id = $1
        `,
        diagnostic: `playlist ${playlistId}: ordered snapshot mismatch`,
      },
      {
        sql: `
          UPDATE course_feedback
          SET body = 'Corrupt feedback'
          WHERE course_id = $1
        `,
        diagnostic: `playlist ${playlistId}: feedback mismatch`,
      },
    ];

    for (const corruption of corruptions) {
      await pool.query(corruption.sql, [playlistId]);
      const verification = await verifyCourseBackfill(pool);

      expect(verification.ok).toBe(false);
      expect(verification.diagnostics).toContain(corruption.diagnostic);
      expect(verification.diagnostics).toContain(
        `playlist ${playlistId}: target fingerprint stale`,
      );
      await expect(
        runCourseBackfill(pool, { cutoverMode: 'freeze' }),
      ).resolves.toMatchObject({ rebuilt: 1 });
    }

    await expect(verifyCourseBackfill(pool)).resolves.toMatchObject({
      ok: true,
      diagnostics: [],
    });
  });

  it('refuses course mode before overwriting a native Course edit', async () => {
    const ownerId = await insertUser(pool, ownerIds);
    const postId = await insertPost(pool, ownerId, 'Native edit source');
    const playlistId = await insertPlaylist(
      pool,
      playlistIds,
      ownerId,
      'Before native edit',
      '',
    );
    await insertPlaylistItem(pool, playlistId, postId, 1);
    await runCourseBackfill(pool, { cutoverMode: 'legacy' });
    await pool.query(
      `UPDATE courses SET title = 'Native owner edit' WHERE id = $1`,
      [playlistId],
    );
    const before = await readMigratedState(pool, playlistId);

    await expect(
      runCourseBackfill(pool, { cutoverMode: 'course' }),
    ).rejects.toThrow(
      'Course backfill is disabled while Course cutover mode is course',
    );

    expect(await readMigratedState(pool, playlistId)).toEqual(before);
  });

  it('preserves legacy text that exceeds native Course request limits', async () => {
    const ownerId = await insertUser(pool, ownerIds);
    const longTitle = 'T'.repeat(201);
    const longDescription = 'D'.repeat(4_001);
    const longFeedback = 'F'.repeat(2_001);
    const postId = await insertPost(pool, ownerId, longTitle);
    const playlistId = await insertPlaylist(
      pool,
      playlistIds,
      ownerId,
      longTitle,
      longDescription,
    );
    await insertPlaylistItem(pool, playlistId, postId, 1);
    await insertFeedback(pool, playlistId, ownerId, 5, longFeedback);

    await expect(
      runCourseBackfill(pool, { cutoverMode: 'legacy' }),
    ).resolves.toMatchObject({ migrated: 1 });
    const migrated = await readMigratedState(pool, playlistId);

    expect(migrated.course).toMatchObject({
      title: longTitle,
      description: longDescription,
    });
    expect(migrated.steps[0]).toMatchObject({ title: longTitle });
    expect(migrated.feedback[0]).toMatchObject({ body: longFeedback });
    await expect(verifyCourseBackfill(pool)).resolves.toMatchObject({
      ok: true,
      diagnostics: [],
    });
  });
});

async function insertUser(pool: Pool, ownerIds: number[]): Promise<number> {
  const email = `course-migration-${randomUUID()}@example.test`;
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash, password_algorithm,
        password_parameters, password_version, identity_assurance
      )
      VALUES (
        'Migration owner', $1, $1, repeat('a', 64), 'legacy_sha256',
        '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
        1, 'legacy_grandfathered'
      )
      RETURNING id
    `,
    [email],
  );
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error('Expected a user ID');
  }

  ownerIds.push(id);
  return id;
}

async function insertPost(
  pool: Pool,
  ownerId: number,
  title: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO posts (
        author_id, title, video_url, thumbnail_url, channel_name,
        summary, translated_notes
      )
      VALUES (
        $1, $2, 'https://video.example.test/watch',
        'https://image.example.test/thumb.jpg', 'Migration channel', '', ''
      )
      RETURNING id
    `,
    [ownerId, title],
  );
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error('Expected a post ID');
  }

  return id;
}

async function insertPlaylist(
  pool: Pool,
  playlistIds: number[],
  ownerId: number,
  title: string,
  description: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO playlists (owner_id, title, description)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [ownerId, title, description],
  );
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error('Expected a playlist ID');
  }

  playlistIds.push(id);
  return id;
}

async function insertPlaylistItem(
  pool: Pool,
  playlistId: number,
  postId: number,
  position: number,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO playlist_items (playlist_id, post_id, position)
      VALUES ($1, $2, $3)
    `,
    [playlistId, postId, position],
  );
}

async function insertFeedback(
  pool: Pool,
  playlistId: number,
  authorId: number,
  rating: number,
  body: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO playlist_feedback (playlist_id, author_id, rating, body)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [playlistId, authorId, rating, body],
  );
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error('Expected a feedback ID');
  }

  return id;
}

async function auditedFixtureCount(
  pool: Pool,
  playlistIds: readonly number[],
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `
      SELECT count(*)::integer AS count
      FROM course_backfill_audits
      WHERE legacy_playlist_id = ANY($1::int[])
    `,
    [playlistIds],
  );

  return result.rows[0]?.count ?? 0;
}

async function readMigratedState(pool: Pool, courseId: number) {
  const [course, steps, feedback, audit] = await Promise.all([
    pool.query<MigratedCourseRow>(
      `
        SELECT id, owner_id AS "ownerId", title, description, visibility,
               status, version, created_at AS "createdAt"
        FROM courses
        WHERE id = $1
      `,
      [courseId],
    ),
    pool.query<MigratedStepRow>(
      `
        SELECT id, source_post_id AS "sourcePostId", position,
               title_snapshot AS title,
               video_url_snapshot AS "videoUrl",
               thumbnail_url_snapshot AS "thumbnailUrl",
               channel_name_snapshot AS "channelName",
               owner_learning_state AS "ownerLearningState"
        FROM course_steps
        WHERE course_id = $1
        ORDER BY position
      `,
      [courseId],
    ),
    pool.query<MigratedFeedbackRow>(
      `
        SELECT id, author_id AS "authorId", rating, body,
               created_at AS "createdAt"
        FROM course_feedback
        WHERE course_id = $1
        ORDER BY id
      `,
      [courseId],
    ),
    pool.query<BackfillAuditRow>(
      `
        SELECT order_strategy AS "orderStrategy",
               encode(source_fingerprint, 'hex') AS "sourceFingerprint",
               encode(target_fingerprint, 'hex') AS "targetFingerprint",
               step_count AS "stepCount",
               feedback_count AS "feedbackCount",
               completed_at AS "completedAt"
        FROM course_backfill_audits
        WHERE legacy_playlist_id = $1
      `,
      [courseId],
    ),
  ]);

  return {
    course: course.rows[0],
    steps: steps.rows,
    feedback: feedback.rows,
    audit: audit.rows[0],
  };
}
