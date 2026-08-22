import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  activateLearningCutover,
  backfillLearningItems,
} from '../scripts/backfill-learning-items';
import { verifyLearningItemBackfill } from '../scripts/verify-learning-item-backfill';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('learning cutover', () => {
  let pool: Pool;
  const userIds: number[] = [];
  let activationCandidate:
    | { runId: string; writerRelease: string; ownerId: number }
    | undefined;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    await pool.end();
  });

  it('backfills each owner without changing legacy learning facts and activates only matching parity', async () => {
    const courseOwner = await insertUser('course-owner');
    const postAuthor = await insertUser('post-author');
    const learner = await insertUser('learner');
    const postId = await insertPost(postAuthor, 'cutovervid1');
    const { stepId, quizId } = await insertCourseStep(
      courseOwner,
      postId,
      'cutovervid1',
    );
    const progressId = await insertProgress(learner, stepId);
    const eventId = await insertProgressEvent(learner, stepId);
    const attemptId = await insertQuizAttempt(learner, quizId);
    const before = await legacyFacts(progressId, eventId, attemptId);

    const first = await backfillLearningItems(pool, {
      batchSize: 2,
      writerRelease: `e2e-${randomUUID()}`,
    });
    const second = await backfillLearningItems(pool, {
      batchSize: 2,
      writerRelease: first.writerRelease,
      runId: first.runId,
    });
    const verification = await verifyLearningItemBackfill(pool);

    expect(second.sourceWatermark).toBe(first.sourceWatermark);
    expect(first.processedWatermark).toBe(first.sourceWatermark);
    expect(second.processedWatermark).toBe(first.processedWatermark);
    expect(verification).toMatchObject({
      ok: true,
      duplicateMappings: 0,
      ownerMismatches: 0,
      orphans: 0,
    });
    expect(verification.sourceCount).toBe(verification.targetCount);
    expect(verification.sourceFingerprint).toBe(verification.targetFingerprint);
    expect(await legacyFacts(progressId, eventId, attemptId)).toEqual(before);

    activationCandidate = {
      runId: first.runId,
      writerRelease: first.writerRelease,
      ownerId: postAuthor,
    };

    const owners = await pool.query<{ ownerId: number }>(
      `SELECT DISTINCT item.user_id AS "ownerId"
       FROM legacy_learning_context_mappings AS mapping
       JOIN learning_items AS item ON item.id = mapping.learning_item_id
       WHERE mapping.entity_kind IN ('post', 'course_step', 'learning_progress',
                                     'learning_progress_event', 'quiz_attempt')
         AND mapping.legacy_entity_id = ANY($1::text[])
       ORDER BY item.user_id`,
      [
        [
          String(postId),
          String(stepId),
          String(progressId),
          eventId,
          attemptId,
        ],
      ],
    );
    expect(owners.rows.map(({ ownerId }) => ownerId)).toEqual(
      [courseOwner, postAuthor, learner].sort((left, right) => left - right),
    );
  });

  it('aborts without a marker on timeout and resumes from the same source watermark', async () => {
    const owner = await insertUser('resume-owner');
    await insertPost(owner, 'resumevid01');
    const writerRelease = `e2e-${randomUUID()}`;
    const first = await backfillLearningItems(pool, {
      batchSize: 1,
      writerRelease,
    });

    const aborted = await activateLearningCutover(pool, {
      runId: first.runId,
      writerRelease,
      maxFreezeMs: 0,
    });
    expect(aborted).toMatchObject({
      activated: false,
      reason: 'FREEZE_TIMEOUT',
    });
    expect(await markerCount(writerRelease)).toBe(0);

    const resumed = await backfillLearningItems(pool, {
      batchSize: 1,
      writerRelease,
      runId: first.runId,
    });
    expect(resumed.sourceWatermark).toBe(first.sourceWatermark);
  });

  it('does not activate when an owner mapping fails parity', async () => {
    const owner = await insertUser('parity-owner');
    const postId = await insertPost(owner, 'parityvid01');
    const writerRelease = `e2e-${randomUUID()}`;
    const run = await backfillLearningItems(pool, {
      batchSize: 10,
      writerRelease,
    });
    await pool.query(
      `UPDATE legacy_learning_context_mappings
       SET user_id = $1
       WHERE entity_kind = 'post' AND legacy_entity_id = $2`,
      [userIds.find((id) => id !== owner), String(postId)],
    );

    const result = await activateLearningCutover(pool, {
      runId: run.runId,
      writerRelease,
      maxFreezeMs: 10_000,
      skipDeltaCatchUpForTest: true,
    });
    expect(result).toMatchObject({ activated: false, reason: 'PARITY_FAILED' });
    expect(await markerCount(writerRelease)).toBe(0);
    await pool.query(
      `UPDATE legacy_learning_context_mappings
       SET user_id = $1
       WHERE entity_kind = 'post' AND legacy_entity_id = $2`,
      [owner, String(postId)],
    );
  });

  it('catches up insert and update deltas, then resumes the same run after timeout', async () => {
    if (!activationCandidate) throw new Error('activation candidate missing');

    const deltaPostId = await insertPost(
      activationCandidate.ownerId,
      'deltaold001',
    );
    await pool.query('UPDATE posts SET video_url = $2 WHERE id = $1', [
      deltaPostId,
      'https://www.youtube.com/watch?v=deltanew001',
    ]);

    const timedOut = await activateLearningCutover(pool, {
      runId: activationCandidate.runId,
      writerRelease: activationCandidate.writerRelease,
      maxFreezeMs: 0,
    });
    expect(timedOut).toMatchObject({
      activated: false,
      reason: 'FREEZE_TIMEOUT',
    });
    expect(await markerCount(activationCandidate.writerRelease)).toBe(0);

    const activated = await activateLearningCutover(pool, {
      runId: activationCandidate.runId,
      writerRelease: activationCandidate.writerRelease,
      maxFreezeMs: 10_000,
    });
    expect(activated.activated).toBe(true);
    expect(await markerCount(activationCandidate.writerRelease)).toBe(1);

    const deltaMapping = await pool.query<{ canonicalVideoId: string }>(
      `SELECT source.canonical_video_id AS "canonicalVideoId"
       FROM legacy_learning_context_mappings AS mapping
       JOIN video_sources AS source ON source.id = mapping.video_source_id
       WHERE mapping.entity_kind = 'post'
         AND mapping.legacy_entity_id = $1
         AND mapping.user_id = $2`,
      [String(deltaPostId), activationCandidate.ownerId],
    );
    expect(deltaMapping.rows).toEqual([{ canonicalVideoId: 'deltanew001' }]);
  });

  async function insertUser(label: string): Promise<number> {
    const email = `${label}-${randomUUID()}@example.test`;
    const result = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('Cutover user', $1, $1, repeat('a', 64), 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered') RETURNING id`,
      [email],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('user insert failed');
    userIds.push(id);
    return id;
  }

  async function insertPost(ownerId: number, videoId: string): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO posts (
         author_id, title, video_url, thumbnail_url, channel_name, summary,
         translated_notes
       ) VALUES ($1, 'Legacy video', $2, '', '', 'summary', 'notes') RETURNING id`,
      [ownerId, `https://www.youtube.com/watch?v=${videoId}`],
    );
    return result.rows[0].id;
  }

  async function insertCourseStep(
    ownerId: number,
    postId: number,
    videoId: string,
  ): Promise<{ stepId: string; quizId: string }> {
    const course = await pool.query<{ id: number }>(
      "INSERT INTO courses (owner_id, title) VALUES ($1, 'Legacy Course') RETURNING id",
      [ownerId],
    );
    const step = await pool.query<{ id: string }>(
      `INSERT INTO course_steps (
         course_id, source_post_id, position, title_snapshot,
         video_url_snapshot, owner_learning_state
       ) VALUES ($1, $2, 1, 'Step', $3, '{}'::jsonb) RETURNING id::text AS id`,
      [course.rows[0].id, postId, `https://youtu.be/${videoId}`],
    );
    const quizId = randomUUID();
    await pool.query(
      "INSERT INTO quizzes (id, course_step_id, status) VALUES ($1, $2, 'draft')",
      [quizId, step.rows[0].id],
    );
    return { stepId: step.rows[0].id, quizId };
  }

  async function insertProgress(
    userId: number,
    stepId: string,
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO learning_progress (
         user_id, course_step_id, watched_ranges, last_position_seconds,
         watched_coverage, best_quiz_score
       ) VALUES ($1, $2, '[{"start":0,"end":25}]', 17, 0.5, 80)
       RETURNING id::text AS id`,
      [userId, stepId],
    );
    return result.rows[0].id;
  }

  async function insertProgressEvent(
    userId: number,
    stepId: string,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO learning_progress_events (
         id, user_id, course_step_id, idempotency_key_digest, payload_hash, start_seconds,
         end_seconds, last_position_seconds, occurred_at
       ) VALUES ($1, $2, $3, decode(repeat('ab', 32), 'hex'),
                 decode(repeat('ac', 32), 'hex'), 0, 25, 17, now())`,
      [id, userId, stepId],
    );
    return id;
  }

  async function insertQuizAttempt(
    userId: number,
    quizId: string,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO quiz_attempts (
         id, quiz_id, user_id, idempotency_key_digest, payload_hash,
         attempt_number, score
       ) VALUES ($1, $2, $3, decode(repeat('bc', 32), 'hex'),
                 decode(repeat('cd', 32), 'hex'), 1, 80)`,
      [id, quizId, userId],
    );
    return id;
  }

  async function legacyFacts(
    progressId: string,
    eventId: string,
    attemptId: string,
  ) {
    const result = await pool.query<{ facts: unknown }>(
      `SELECT jsonb_build_object(
         'progress', (SELECT to_jsonb(p) - 'study_context_id' FROM learning_progress p WHERE id = $1),
         'event', (SELECT to_jsonb(e) - 'study_context_id' FROM learning_progress_events e WHERE id = $2),
         'attempt', (SELECT to_jsonb(a) - 'study_context_id' FROM quiz_attempts a WHERE id = $3)
       ) AS facts`,
      [progressId, eventId, attemptId],
    );
    return result.rows[0].facts;
  }

  async function markerCount(writerRelease: string): Promise<number> {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM learning_cutover_authority
       WHERE writer_release = $1`,
      [writerRelease],
    );
    return result.rows[0]?.count ?? 0;
  }
});
