import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresLearningItemRepository } from '../src/learning/postgres-learning-item.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('learning item expand schema', () => {
  let pool: Pool;
  const sourceIds: string[] = [];
  const userIds: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    if (sourceIds.length > 0) {
      await pool.query(
        'DELETE FROM video_sources WHERE id = ANY($1::bigint[])',
        [sourceIds],
      );
    }
    await pool.end();
  });

  it('keeps one item per learner and distinct contexts for the same video in two Courses', async () => {
    const courseOwner = await insertUser('course-owner');
    const postAuthor = await insertUser('post-author');
    const learner = await insertUser('learner');
    const postId = await insertPost(postAuthor);
    const sourceId = await insertSource('samevideo01');
    const firstStep = await insertCourseStep(courseOwner, postId, sourceId, 1);
    const secondStep = await insertCourseStep(courseOwner, null, sourceId, 2);

    const repository = new PostgresLearningItemRepository(pool);
    const first = await repository.ensureContext({
      userId: learner,
      provider: 'youtube',
      canonicalVideoId: 'samevideo01',
      canonicalUrl: 'https://www.youtube.com/watch?v=samevideo01',
      courseStepId: firstStep,
      sourcePostId: postId,
      provenance: { origin: 'post' },
    });
    const second = await repository.ensureContext({
      userId: learner,
      provider: 'youtube',
      canonicalVideoId: 'samevideo01',
      canonicalUrl: 'https://www.youtube.com/watch?v=samevideo01',
      courseStepId: secondStep,
      sourcePostId: null,
      provenance: { origin: 'course_step', sourcePostMissing: true },
    });

    expect(first.learningItem.id).toBe(second.learningItem.id);
    expect(first.studyContext.id).not.toBe(second.studyContext.id);
    expect(second.learningItem.provenance).toEqual({ origin: 'post' });
    expect(second.studyContext.provenance).toEqual({
      origin: 'course_step',
      sourcePostMissing: true,
    });
    await expect(
      pool.query(
        `INSERT INTO learning_items (user_id, video_source_id)
         VALUES ($1, $2)`,
        [learner, sourceId],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'learning_items_user_video_source_key',
    });

    const sourcePostNull = await pool.query<{
      sourcePostId: number | null;
      provenance: Record<string, unknown>;
    }>(
      `SELECT source_post_id AS "sourcePostId",
              learning_context_provenance AS provenance
       FROM course_steps WHERE id = $1`,
      [secondStep],
    );
    expect(sourcePostNull.rows[0]).toEqual({
      sourcePostId: null,
      provenance: { origin: 'course_step', sourcePostMissing: true },
    });
  });

  it.each([
    [
      'learning_progress',
      "'[]'::jsonb, 0, 0, 1",
      'watched_ranges, last_position_seconds, watched_coverage, version',
    ],
    ['learning_notes', "0, 'private note'", 'position_seconds, body'],
  ])(
    'rejects a cross-owner study context on %s',
    async (table, values, columns) => {
      const firstUser = await insertUser(`first-${table}`);
      const secondUser = await insertUser(`second-${table}`);
      const sourceId = await insertSource(randomVideoId());
      const item = await insertItem(firstUser, sourceId);
      const context = await insertStandaloneContext(firstUser, item);
      const stepId =
        table === 'learning_progress'
          ? await insertCourseStep(secondUser, null, sourceId, 1)
          : null;
      const legacyStepColumn = stepId === null ? '' : ', course_step_id';
      const legacyStepValue = stepId === null ? '' : ', $3';

      await expect(
        pool.query(
          `INSERT INTO ${table} (user_id, study_context_id${legacyStepColumn}, ${columns})
         VALUES ($1, $2${legacyStepValue}, ${values})`,
          stepId === null
            ? [secondUser, context]
            : [secondUser, context, stepId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    },
  );

  it('nulls a deleted context mapping without deleting a legacy progress row', async () => {
    const user = await insertUser('context-delete');
    const sourceId = await insertSource(randomVideoId());
    const stepId = await insertCourseStep(user, null, sourceId, 1);
    const item = await insertItem(user, sourceId);
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (
         user_id, learning_item_id, kind, course_step_id,
         course_step_provenance_id
       ) VALUES ($1, $2, 'course_occurrence', $3, $3)
       RETURNING id::text AS id`,
      [user, item, stepId],
    );
    const contextId = context.rows[0]?.id;
    if (!contextId) throw new Error('Expected a context');
    const progress = await pool.query<{ id: string }>(
      `INSERT INTO learning_progress (
         user_id, course_step_id, study_context_id
       ) VALUES ($1, $2, $3)
       RETURNING id::text AS id`,
      [user, stepId, contextId],
    );

    await expect(
      pool.query('DELETE FROM study_contexts WHERE id = $1', [contextId]),
    ).resolves.toMatchObject({ rowCount: 1 });
    const preserved = await pool.query<{ studyContextId: string | null }>(
      `SELECT study_context_id::text AS "studyContextId"
       FROM learning_progress WHERE id = $1`,
      [progress.rows[0]?.id],
    );
    expect(preserved.rows[0]?.studyContextId).toBeNull();
  });

  it('preserves a Course occurrence context and notes after its legacy step is deleted', async () => {
    const user = await insertUser('step-delete');
    const sourceId = await insertSource(randomVideoId());
    const stepId = await insertCourseStep(user, null, sourceId, 1);
    const item = await insertItem(user, sourceId);
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (
         user_id, learning_item_id, kind, course_step_id,
         course_step_provenance_id
       ) VALUES ($1, $2, 'course_occurrence', $3, $3)
       RETURNING id::text AS id`,
      [user, item, stepId],
    );
    const contextId = context.rows[0]?.id;
    if (!contextId) throw new Error('Expected a context');
    await pool.query(
      `INSERT INTO learning_notes (
         user_id, study_context_id, position_seconds, body
       ) VALUES ($1, $2, 12.5, 'Preserved note')`,
      [user, contextId],
    );

    await pool.query('DELETE FROM course_steps WHERE id = $1', [stepId]);

    const preserved = await pool.query<{
      courseStepId: string | null;
      provenanceId: string;
      noteCount: number;
    }>(
      `SELECT context.course_step_id::text AS "courseStepId",
              context.course_step_provenance_id::text AS "provenanceId",
              count(note.id)::integer AS "noteCount"
       FROM study_contexts AS context
       LEFT JOIN learning_notes AS note ON note.study_context_id = context.id
       WHERE context.id = $1
       GROUP BY context.id`,
      [contextId],
    );
    expect(preserved.rows[0]).toEqual({
      courseStepId: null,
      provenanceId: stepId,
      noteCount: 1,
    });
  });

  it('rejects a cross-owner study context on a quiz attempt', async () => {
    const courseOwner = await insertUser('quiz-course-owner');
    const firstUser = await insertUser('quiz-first');
    const secondUser = await insertUser('quiz-second');
    const sourceId = await insertSource(randomVideoId());
    const stepId = await insertCourseStep(courseOwner, null, sourceId, 1);
    const item = await insertItem(firstUser, sourceId);
    const context = await insertStandaloneContext(firstUser, item);
    const quizId = randomUUID();
    await pool.query(
      `INSERT INTO quizzes (id, course_step_id, status)
       VALUES ($1, $2, 'draft')`,
      [quizId, stepId],
    );

    await expect(
      pool.query(
        `INSERT INTO quiz_attempts (
           id, quiz_id, user_id, study_context_id, idempotency_key_digest,
           payload_hash, attempt_number, score
         ) VALUES ($1, $2, $3, $4, decode(repeat('ab', 32), 'hex'),
                   decode(repeat('cd', 32), 'hex'), 1, 0)`,
        [randomUUID(), quizId, secondUser, context],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('deletes personal contexts without deleting a shared video source', async () => {
    const firstUser = await insertUser('delete-first');
    const secondUser = await insertUser('delete-second');
    const sourceId = await insertSource(randomVideoId());
    const firstItem = await insertItem(firstUser, sourceId);
    const secondItem = await insertItem(secondUser, sourceId);
    await insertStandaloneContext(firstUser, firstItem);
    await insertStandaloneContext(secondUser, secondItem);

    await pool.query('DELETE FROM users WHERE id = $1', [firstUser]);
    userIds.splice(userIds.indexOf(firstUser), 1);

    const preserved = await pool.query<{
      sourceCount: number;
      itemCount: number;
      contextCount: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM video_sources WHERE id = $1) AS "sourceCount",
         (SELECT count(*)::integer FROM learning_items WHERE video_source_id = $1) AS "itemCount",
         (SELECT count(*)::integer FROM study_contexts WHERE learning_item_id = $2) AS "contextCount"`,
      [sourceId, secondItem],
    );
    expect(preserved.rows[0]).toEqual({
      sourceCount: 1,
      itemCount: 1,
      contextCount: 1,
    });
  });

  it('keeps legacy rows writable while the new mapping columns remain nullable', async () => {
    const owner = await insertUser('legacy-owner');
    const courseId = await insertCourse(owner, 'Legacy nullable Course');
    const step = await pool.query<{
      id: string;
      videoSourceId: string | null;
      provenance: unknown;
    }>(
      `INSERT INTO course_steps (
         course_id, position, title_snapshot, video_url_snapshot,
         thumbnail_url_snapshot, channel_name_snapshot, owner_learning_state
       ) VALUES ($1, 1, 'Legacy', 'https://www.youtube.com/watch?v=legacyvid01', '', '', '{}'::jsonb)
       RETURNING id::text AS id, video_source_id::text AS "videoSourceId",
                 learning_context_provenance AS provenance`,
      [courseId],
    );
    expect(step.rows[0]).toMatchObject({
      videoSourceId: null,
      provenance: null,
    });
  });

  async function insertUser(suffix: string): Promise<number> {
    const email = `${suffix}-${randomUUID()}@example.test`;
    const result = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('Learning owner', $1, $1, repeat('a', 64), 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered')
       RETURNING id`,
      [email],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a user');
    userIds.push(id);
    return id;
  }

  async function insertSource(videoId: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO video_sources (provider, canonical_video_id, canonical_url)
       VALUES ('youtube', $1, $2)
       RETURNING id::text AS id`,
      [videoId, `https://www.youtube.com/watch?v=${videoId}`],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a source');
    sourceIds.push(id);
    return id;
  }

  async function insertItem(userId: number, sourceId: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2) RETURNING id::text AS id`,
      [userId, sourceId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected an item');
    return id;
  }

  async function insertStandaloneContext(
    userId: number,
    itemId: string,
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2, 'standalone') RETURNING id::text AS id`,
      [userId, itemId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a context');
    return id;
  }

  async function insertPost(authorId: number): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO posts (
         author_id, title, video_url, thumbnail_url, channel_name,
         summary, translated_notes
       ) VALUES ($1, 'Source post', 'https://www.youtube.com/watch?v=samevideo01', '', '', '', '')
       RETURNING id`,
      [authorId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a post');
    return id;
  }

  async function insertCourse(ownerId: number, title: string): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO courses (owner_id, title, description)
       VALUES ($1, $2, '') RETURNING id`,
      [ownerId, title],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a Course');
    return id;
  }

  async function insertCourseStep(
    ownerId: number,
    sourcePostId: number | null,
    sourceId: string,
    suffix: number,
  ): Promise<string> {
    const courseId = await insertCourse(
      ownerId,
      `Course ${suffix} ${randomUUID()}`,
    );
    const result = await pool.query<{ id: string }>(
      `INSERT INTO course_steps (
         course_id, source_post_id, position, title_snapshot,
         video_url_snapshot, thumbnail_url_snapshot, channel_name_snapshot,
         owner_learning_state, video_source_id, learning_context_provenance
       ) VALUES ($1, $2, 1, 'Video', 'https://www.youtube.com/watch?v=samevideo01',
                 '', '', '{}'::jsonb, $3, $4::jsonb)
       RETURNING id::text AS id`,
      [
        courseId,
        sourcePostId,
        sourceId,
        JSON.stringify(
          sourcePostId === null
            ? { origin: 'course_step', sourcePostMissing: true }
            : { origin: 'post' },
        ),
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Expected a Course step');
    return id;
  }
});

function randomVideoId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 11);
}
